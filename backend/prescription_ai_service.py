import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException


def _extract_code_text(resource: dict) -> str:
    code = resource.get("code", {})
    if isinstance(code, dict):
        if isinstance(code.get("text"), str) and code.get("text").strip():
            return code["text"].strip()
        codings = code.get("coding", [])
        if isinstance(codings, list):
            for coding in codings:
                display = coding.get("display")
                if isinstance(display, str) and display.strip():
                    return display.strip()
    return ""


def _extract_med_name(resource: dict) -> str:
    for key in ("medicationCodeableConcept", "code"):
        med = resource.get(key, {})
        if isinstance(med, dict):
            if isinstance(med.get("text"), str) and med.get("text").strip():
                return med["text"].strip()
            codings = med.get("coding", [])
            if isinstance(codings, list):
                for coding in codings:
                    display = coding.get("display")
                    if isinstance(display, str) and display.strip():
                        return display.strip()
    if isinstance(resource.get("medicationReference"), dict):
        display = resource["medicationReference"].get("display", "")
        if isinstance(display, str) and display.strip():
            return display.strip()
    return "Unknown medication"


def _extract_dosage(resource: dict) -> str:
    dosage_list = resource.get("dosageInstruction", [])
    if isinstance(dosage_list, list) and dosage_list:
        dosage = dosage_list[0]
        if isinstance(dosage.get("text"), str) and dosage.get("text").strip():
            return dosage["text"].strip()

    dose = resource.get("doseAndRate", [])
    if isinstance(dose, list) and dose:
        first = dose[0]
        quantity = first.get("doseQuantity", {})
        value = quantity.get("value")
        unit = quantity.get("unit")
        if value is not None and unit:
            return f"{value} {unit}"
    return "Not specified"


def _extract_recorded_date(resource: dict) -> str:
    for key in ("recordedDate", "authoredOn", "effectiveDateTime", "dateAsserted"):
        value = resource.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return datetime.now(timezone.utc).isoformat()


def _extract_clinical_status(resource: dict) -> str:
    status = resource.get("clinicalStatus", {})
    if isinstance(status, dict):
        if isinstance(status.get("text"), str) and status.get("text").strip():
            return status["text"].strip()
        codings = status.get("coding", [])
        if isinstance(codings, list):
            for coding in codings:
                code = coding.get("code")
                if isinstance(code, str) and code.strip():
                    return code.strip()
    fallback = resource.get("status")
    if isinstance(fallback, str) and fallback.strip():
        return fallback.strip()
    return "unknown"


async def get_clinical_context(
    patient_id: str,
    session_id: str,
    use_abha: bool = True,
    db: Any = None,
) -> Dict[str, List[dict]]:
    """
    Build context from latest ABHA-synced FHIR bundles.
    Returns: { "past_meds": [...], "chronic_conditions": [...] }
    """
    if not use_abha:
        return {"past_meds": [], "chronic_conditions": []}

    if db is None:
        raise HTTPException(status_code=500, detail="Database context is not configured")

    cursor = (
        db.abha_fhir_bundles.find(
            {"patient_id": patient_id},
            {"_id": 0, "bundle": 1, "created_at": 1},
        )
        .sort("created_at", -1)
        .limit(5)
    )
    bundles = await cursor.to_list(length=5)

    if not bundles:
        return {"past_meds": [], "chronic_conditions": []}

    past_meds: List[dict] = []
    chronic_conditions: List[dict] = []
    seen_med_keys = set()
    seen_cond_keys = set()

    for bundle_doc in bundles:
        bundle = bundle_doc.get("bundle") or {}
        entries = bundle.get("entry", [])
        if not isinstance(entries, list):
            continue

        for entry in entries:
            resource = entry.get("resource", {})
            rtype = resource.get("resourceType")

            if rtype in ("MedicationRequest", "MedicationStatement"):
                med_name = _extract_med_name(resource)
                dosage = _extract_dosage(resource)
                clinical_status = _extract_clinical_status(resource)
                recorded_date = _extract_recorded_date(resource)

                med_key = f"{med_name}|{dosage}|{clinical_status}"
                if med_key in seen_med_keys:
                    continue
                seen_med_keys.add(med_key)

                past_meds.append(
                    {
                        "name": med_name,
                        "dosage": dosage,
                        "recordedDate": recorded_date,
                        "clinicalStatus": clinical_status,
                    }
                )

            elif rtype == "Condition":
                condition_name = _extract_code_text(resource) or "Unknown condition"
                clinical_status = _extract_clinical_status(resource)
                cond_key = f"{condition_name}|{clinical_status}"

                # Keep conditions that look active/persistent/chronic.
                combined = f"{condition_name} {clinical_status}".lower()
                if not any(tag in combined for tag in ("chronic", "active", "recurrence", "relapse")):
                    continue

                if cond_key in seen_cond_keys:
                    continue
                seen_cond_keys.add(cond_key)

                chronic_conditions.append(
                    {
                        "name": condition_name,
                        "clinicalStatus": clinical_status,
                    }
                )

    return {
        "past_meds": past_meds[:50],
        "chronic_conditions": chronic_conditions[:50],
    }


def build_prescription_prompt(
    symptoms: List[str],
    clinical_context: Dict[str, List[dict]],
    use_abha: bool = True,
) -> Tuple[str, str]:
    """
    Returns (prompt_type, prompt_text).
    """
    symptom_text = ", ".join(symptoms) if symptoms else "No symptoms provided"
    has_abha_data = (
        use_abha
        and (len(clinical_context.get("past_meds", [])) > 0 or len(clinical_context.get("chronic_conditions", [])) > 0)
    )

    output_contract = (
        'Return ONLY valid JSON in this exact format:\n'
        "{\n"
        '  "suggested_medications": [\n'
        '    { "name": "", "dosage": "", "frequency": "", "reason": "" }\n'
        "  ],\n"
        '  "warnings": ["Interaction found with past drug X", "Patient allergic to Y"]\n'
        "}"
    )

    if has_abha_data:
        prompt_type = "PROMPT_A_HISTORICAL_CONTEXT"
        prompt_text = (
            "You are a Clinical Assistant for a Doctor. "
            f"The patient has a history of {json.dumps(clinical_context)}. "
            f"Today, the doctor recorded: {symptom_text}. "
            "Based on the patient's longitudinal record, suggest a prescription. "
            "IMPORTANT: Check for contraindications with their current medications listed in ABHA "
            "and prioritize medicines that have worked in the past for this patient.\n\n"
            f"{output_contract}"
        )
    else:
        prompt_type = "PROMPT_B_SYMPTOM_ONLY"
        prompt_text = (
            "You are a Clinical Assistant for a Doctor. "
            "We do not have previous history for this patient. "
            f"The doctor recorded the following current symptoms: {symptom_text}. "
            "Suggest a standard-of-care prescription and ask the doctor if there are any known allergies "
            "or chronic conditions we should be aware of, as ABHA data is unavailable.\n\n"
            f"{output_contract}"
        )

    return prompt_type, prompt_text


def _extract_json_object(text: str) -> dict:
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        raise ValueError("Model response did not contain JSON object")
    return json.loads(match.group())


def _validate_ai_suggestion(payload: dict) -> dict:
    suggested = payload.get("suggested_medications")
    warnings = payload.get("warnings")

    if not isinstance(suggested, list):
        suggested = []
    if not isinstance(warnings, list):
        warnings = []

    clean_meds = []
    for item in suggested:
        if not isinstance(item, dict):
            continue
        clean_meds.append(
            {
                "name": str(item.get("name", "")).strip(),
                "dosage": str(item.get("dosage", "")).strip(),
                "frequency": str(item.get("frequency", "")).strip(),
                "reason": str(item.get("reason", "")).strip(),
            }
        )

    return {
        "suggested_medications": clean_meds,
        "warnings": [str(w).strip() for w in warnings if str(w).strip()],
    }


async def generate_ai_prescription(prompt_text: str) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("EMERGENT_LLM_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="AI service not configured")

    try:
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-3-flash-preview"
        )
        response = model.generate_content(prompt_text)
        response_text = response.text or ""
        parsed = _extract_json_object(response_text)
        return _validate_ai_suggestion(parsed)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prescription AI generation failed: {str(exc)}")


def build_fhir_medication_requests(
    suggested_medications: List[dict],
    patient_id: str,
    session_id: str,
) -> List[dict]:
    """
    Create FHIR-ready MedicationRequest skeletons for ABDM linking workflows.
    """
    now = datetime.now(timezone.utc).isoformat()
    resources = []
    for idx, med in enumerate(suggested_medications, start=1):
        resources.append(
            {
                "resourceType": "MedicationRequest",
                "id": f"{session_id}-{idx}",
                "status": "draft",
                "intent": "order",
                "subject": {"reference": f"Patient/{patient_id}"},
                "authoredOn": now,
                "medicationCodeableConcept": {"text": med.get("name", "")},
                "dosageInstruction": [
                    {
                        "text": f"{med.get('dosage', '').strip()} {med.get('frequency', '').strip()}".strip()
                    }
                ],
                "note": [{"text": med.get("reason", "")}],
            }
        )
    return resources


def generate_prescription_pdf(
    workspace: dict,
    patient_info: dict,
    doctor_info: dict,
    qr_url: str,
    output_dir: Optional[str] = None,
) -> str:
    """
    Generate an ABDM-compliant prescription PDF with:
    - Dynamic doctor letterhead
    - Patient demographics (including ABHA address)
    - Medications table
    - Drug-interaction warnings
    - QR code linking to ABDM Health Locker
    - Signature / stamp footer
    Returns the filepath of the generated PDF.
    """
    import io
    import qrcode
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch, mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, Image as RLImage,
    )

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%d %B %Y")
    filename = f"prescription_{patient_info.get('patient_id', 'rx')}_{now.strftime('%Y%m%d_%H%M%S')}.pdf"

    if output_dir:
        filepath = Path(output_dir) / filename
    else:
        reports_dir = Path(__file__).parent / "reports"
        reports_dir.mkdir(exist_ok=True)
        filepath = reports_dir / filename

    doc = SimpleDocTemplate(
        str(filepath),
        pagesize=A4,
        topMargin=0.6 * inch,
        bottomMargin=0.6 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    teal = colors.HexColor("#0F766E")
    red = colors.HexColor("#B91C1C")
    gray = colors.HexColor("#64748B")
    light_gray = colors.HexColor("#F1F5F9")
    dark = colors.HexColor("#0F172A")

    h1 = ParagraphStyle("H1", fontSize=20, textColor=teal, fontName="Helvetica-Bold", spaceAfter=2)
    h2 = ParagraphStyle("H2", fontSize=11, textColor=teal, fontName="Helvetica-Bold", spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("Body", fontSize=9, textColor=dark, spaceAfter=4, fontName="Helvetica")
    bold_body = ParagraphStyle("BoldBody", fontSize=9, textColor=dark, fontName="Helvetica-Bold", spaceAfter=4)
    small = ParagraphStyle("Small", fontSize=8, textColor=gray, spaceAfter=2, fontName="Helvetica")
    warn = ParagraphStyle("Warn", fontSize=9, textColor=red, fontName="Helvetica-Bold", spaceAfter=3)
    center = ParagraphStyle("Center", fontSize=8, textColor=gray, alignment=1, fontName="Helvetica")

    elements = []

    # ── LETTERHEAD ──────────────────────────────────────────────────────────
    doctor_name = doctor_info.get("name", "Doctor")
    doctor_qual = doctor_info.get("qualification", "")
    doctor_location = doctor_info.get("location", "")
    reg_no = doctor_info.get("reg_no", "Reg. No. N/A")

    header_data = [
        [
            Paragraph("<b>DOCO AI</b> — Clinical Co-Pilot", h1),
            "",
        ],
        [
            Paragraph(f"<b>Dr. {doctor_name}</b>   {doctor_qual}", bold_body),
            Paragraph(f"<b>Date:</b> {date_str}", bold_body),
        ],
        [
            Paragraph(f"{doctor_location}", body),
            Paragraph(f"<b>Reg No:</b> {reg_no}", body),
        ],
    ]
    header_table = Table(header_data, colWidths=[4.5 * inch, 2.5 * inch])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("SPAN", (0, 0), (1, 0)),
    ]))
    elements.append(header_table)
    elements.append(HRFlowable(width="100%", thickness=2, color=teal, spaceAfter=8))

    # ── PATIENT INFO ────────────────────────────────────────────────────────
    elements.append(Paragraph("Patient Information", h2))
    p_name = patient_info.get("patient_name", "—")
    p_age = patient_info.get("patient_age", "—")
    p_gender = patient_info.get("patient_gender", "—")
    p_abha = patient_info.get("abha_address", "")

    patient_row = [
        [
            Paragraph(f"<b>Name:</b> {p_name}", body),
            Paragraph(f"<b>Age:</b> {p_age}", body),
            Paragraph(f"<b>Gender:</b> {p_gender}", body),
        ]
    ]
    if p_abha:
        patient_row.append([
            Paragraph(f"<b>ABHA Address:</b> {p_abha}", body),
            "",
            "",
        ])

    pat_table = Table(patient_row, colWidths=[2.5 * inch, 1.5 * inch, 3 * inch])
    pat_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light_gray),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [light_gray]),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
        ("INNERGRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#E2E8F0")),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]))
    elements.append(pat_table)
    elements.append(Spacer(1, 10))

    # ── MEDICATIONS TABLE ────────────────────────────────────────────────────
    current_draft = workspace.get("current_draft", {})
    ai_suggestion = workspace.get("ai_suggestion", {})
    meds = (
        current_draft.get("suggested_medications")
        or ai_suggestion.get("suggested_medications")
        or []
    )
    warnings_list = (
        current_draft.get("warnings")
        or ai_suggestion.get("warnings")
        or []
    )

    elements.append(Paragraph("Prescribed Medications", h2))
    if meds:
        med_headers = ["#", "Medication", "Dosage", "Frequency", "Clinical Reason"]
        med_rows = [med_headers]
        for i, m in enumerate(meds, 1):
            med_rows.append([
                str(i),
                m.get("name", ""),
                m.get("dosage", ""),
                m.get("frequency", ""),
                m.get("reason", ""),
            ])

        med_table = Table(
            med_rows,
            colWidths=[0.3 * inch, 1.7 * inch, 1.1 * inch, 1.1 * inch, 2.8 * inch],
            repeatRows=1,
        )
        med_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), teal),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, light_gray]),
            ("FONTSIZE", (0, 1), (-1, -1), 8),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        elements.append(med_table)
    else:
        elements.append(Paragraph("No medications prescribed.", body))

    elements.append(Spacer(1, 8))

    # ── WARNINGS / DRUG INTERACTIONS ────────────────────────────────────────
    if warnings_list:
        elements.append(Paragraph("⚠ Clinical Warnings / Drug Interactions", h2))
        for w in warnings_list:
            elements.append(Paragraph(f"⚠ {w}", warn))
        elements.append(Spacer(1, 6))

    # ── CLINICAL NOTES ───────────────────────────────────────────────────────
    free_text = patient_info.get("free_text_notes", "").strip()
    if free_text:
        elements.append(Paragraph("Doctor's Notes", h2))
        elements.append(Paragraph(free_text, body))
        elements.append(Spacer(1, 8))

    elements.append(HRFlowable(width="100%", thickness=0.5, color=gray, spaceAfter=10))

    # ── FOOTER ROW: signature + QR code ─────────────────────────────────────
    # Generate QR code image in-memory
    qr_img_data = None
    try:
        qr = qrcode.QRCode(version=1, box_size=3, border=2)
        qr.add_data(qr_url or "https://abdm.gov.in/healthlocker")
        qr.make(fit=True)
        qr_pil = qr.make_image(fill_color="black", back_color="white")
        buf = io.BytesIO()
        qr_pil.save(buf, format="PNG")
        buf.seek(0)
        qr_img_data = RLImage(buf, width=1.2 * inch, height=1.2 * inch)
    except Exception:
        qr_img_data = Paragraph("QR Code Unavailable", small)

    sig_block = [
        Paragraph("_____________________________", body),
        Paragraph(f"<b>Dr. {doctor_name}</b>", bold_body),
        Paragraph("Signature / Digital Stamp", small),
    ]
    qr_block = [
        qr_img_data,
        Paragraph("Scan to view in ABDM Health Locker", center),
    ]

    footer_table = Table(
        [[sig_block, qr_block]],
        colWidths=[4.5 * inch, 2.5 * inch],
    )
    footer_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
    ]))
    elements.append(footer_table)
    elements.append(Spacer(1, 8))
    elements.append(
        Paragraph(
            "This prescription was generated by DOCO AI Clinical Co-Pilot. "
            "It is ABDM-compliant and digitally traceable. "
            "Final dispensing is at the pharmacist's professional discretion.",
            center,
        )
    )

    doc.build(elements)
    return str(filepath)

