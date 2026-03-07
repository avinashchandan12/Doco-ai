"""
ocr_service.py — Real prescription OCR using AWS Textract + Gemini.

Pipeline:
  1. Send image bytes to AWS Textract (detect_document_text)
  2. Concatenate all LINE blocks into raw text
  3. Ask Gemini to parse the text into structured medication list
  4. Return { medications, raw_text, confidence }

Graceful degradation: any error → returns empty medications list with
confidence=0.0 so the UI can show a partial result rather than crashing.
"""
import os
import json
import logging
import re
import boto3
from botocore.exceptions import ClientError
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

AWS_REGION = os.environ.get("AWS_REGION", "ap-south-1")
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or os.environ.get("EMERGENT_LLM_KEY")


# ---------------------------------------------------------------------------
# Textract client
# ---------------------------------------------------------------------------

def _get_textract_client():
    return boto3.client(
        "textract",
        region_name=AWS_REGION,
        aws_access_key_id=AWS_ACCESS_KEY_ID,
        aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    )


# ---------------------------------------------------------------------------
# Step 1 — Extract raw text via Textract
# ---------------------------------------------------------------------------

def _textract_extract(image_bytes: bytes) -> str:
    """
    Call Textract detect_document_text on raw image bytes.
    Returns concatenated LINE-level text.
    """
    client = _get_textract_client()
    response = client.detect_document_text(
        Document={"Bytes": image_bytes}
    )

    lines = [
        block["Text"]
        for block in response.get("Blocks", [])
        if block.get("BlockType") == "LINE" and block.get("Text")
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Step 2 — Parse raw text into structured meds via Gemini
# ---------------------------------------------------------------------------

_PARSE_PROMPT = """You are a clinical pharmacist assistant. Below is raw OCR text extracted from a handwritten or printed prescription image.

Parse it and return a JSON object with this exact structure:
{{
  "medications": [
    {{
      "name": "Drug name",
      "dosage": "e.g. 500mg",
      "frequency": "e.g. Twice daily",
      "duration": "e.g. 5 days"
    }}
  ],
  "confidence": 0.0
}}

Rules:
- "confidence" should be a float 0.0–1.0 reflecting how clearly the prescription was readable (1.0 = perfect, 0.3 = very unclear/handwritten)
- If a field (dosage / frequency / duration) is not mentioned, use "N/A"
- If you cannot find any medications, return {{ "medications": [], "confidence": 0.0 }}
- Do NOT add explanation outside the JSON
- Common abbreviations: OD=Once daily, BD/BID=Twice daily, TDS/TID=Three times daily, QID=Four times daily, SOS/PRN=As needed, Tab=Tablet, Cap=Capsule, Inj=Injection

Prescription text:
{raw_text}"""


def _gemini_parse(raw_text: str) -> Dict[str, Any]:
    """
    Send raw OCR text to Gemini and get structured medications back.
    """
    import google.generativeai as genai

    if not GEMINI_API_KEY:
        logger.error("No Gemini API key configured for OCR parsing")
        return {"medications": [], "confidence": 0.0}

    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-2.0-flash")

    prompt = _PARSE_PROMPT.format(raw_text=raw_text)
    response = model.generate_content(prompt)

    # Parse JSON from response
    json_match = re.search(r'\{[\s\S]*\}', response.text)
    if not json_match:
        logger.warning(f"Gemini OCR parse: no JSON in response: {response.text[:300]}")
        return {"medications": [], "confidence": 0.0}

    result = json.loads(json_match.group())
    return {
        "medications": result.get("medications", []),
        "confidence": float(result.get("confidence", 0.0)),
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def extract_prescription(image_bytes: bytes, filename: str = "") -> Dict[str, Any]:
    """
    Main entry point called from server.py.

    Returns:
        {
            "medications": [ { name, dosage, frequency, duration }, ... ],
            "raw_text": "<textract output>",
            "confidence": 0.85
        }

    Never raises — errors are caught and logged, returning empty medications
    so the upload doesn't crash the UI.
    """
    try:
        # Step 1 — Textract
        logger.info(f"OCR: starting Textract extraction for '{filename}'")
        raw_text = _textract_extract(image_bytes)
        logger.info(f"OCR: Textract extracted {len(raw_text)} chars")

        if not raw_text.strip():
            logger.warning("OCR: Textract returned empty text — image may be blank or unsupported format")
            return {"medications": [], "raw_text": "", "confidence": 0.0}

        # Step 2 — Gemini parse
        logger.info("OCR: sending to Gemini for structured parsing")
        parsed = _gemini_parse(raw_text)

        logger.info(
            f"OCR: found {len(parsed['medications'])} medications, "
            f"confidence={parsed['confidence']}"
        )

        return {
            "medications": parsed["medications"],
            "raw_text": raw_text,
            "confidence": parsed["confidence"],
        }

    except ClientError as e:
        error_code = e.response["Error"]["Code"]
        logger.error(f"OCR: Textract ClientError ({error_code}): {str(e)}")
        return {"medications": [], "raw_text": "", "confidence": 0.0}

    except Exception as e:
        logger.error(f"OCR: unexpected error: {str(e)}")
        return {"medications": [], "raw_text": "", "confidence": 0.0}
