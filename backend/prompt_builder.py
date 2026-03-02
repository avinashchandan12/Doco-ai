"""
prompt_builder.py — Builds enriched Gemini prompts for RAG-augmented clinical analysis.

Two modes:
- build_enriched_prompt(): injects RAG guideline chunks above the case data
- build_basic_prompt(): fallback when RAG is unavailable, includes a disclaimer

Token budget: RAG context is capped at ~6,000 characters to avoid overflowing
Gemini's context window with the rest of the prompt.
"""
import json
from typing import List, Dict, Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_RAG_CONTEXT_CHARS = 6_000  # Hard cap on total injected guideline text

SYSTEM_PROMPT = """You are a senior experienced physician assisting a rural general practitioner.
You are NOT diagnosing patients.
You provide clinical decision support only.
Use conservative, medically responsible language.
Never provide definitive diagnoses.
Always present possibilities, considerations, and safety-oriented red flags.
Maintain professional doctor-to-doctor tone.
When clinical guidelines are provided, you MUST reference them in your analysis and explicitly \
note when a guideline directly applies to the case.

IMPORTANT: You MUST respond with ONLY valid JSON in this exact format, no additional text:
{
  "clinical_summary": "Brief summary of the case presentation, noting which guidelines were applied",
  "considerations": ["Consideration 1", "Consideration 2"],
  "red_flags": ["Red flag 1 if any"],
  "prescription_review": ["Review point 1 if prescription provided"],
  "next_steps": ["Recommended next step 1", "Recommended next step 2"]
}"""

SYSTEM_PROMPT_NO_RAG = """You are a senior experienced physician assisting a rural general practitioner.
You are NOT diagnosing patients.
You provide clinical decision support only.
Use conservative, medically responsible language.
Never provide definitive diagnoses.
Always present possibilities, considerations, and safety-oriented red flags.
Maintain professional doctor-to-doctor tone.

NOTE: Clinical guideline database is currently unavailable. Base your response on standard \
medical knowledge and recommend the physician verify against current guidelines.

IMPORTANT: You MUST respond with ONLY valid JSON in this exact format, no additional text:
{
  "clinical_summary": "Brief summary of the case presentation",
  "considerations": ["Consideration 1", "Consideration 2"],
  "red_flags": ["Red flag 1 if any"],
  "prescription_review": ["Review point 1 if prescription provided"],
  "next_steps": ["Recommended next step 1", "Recommended next step 2"]
}"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_case_section(case_data: dict) -> str:
    """Format the patient case data into a readable text block."""
    symptoms_str = ", ".join(case_data.get("symptoms", [])) or "None reported"
    vitals = case_data.get("vitals", {})
    vitals_str = (
        f"Temperature: {vitals.get('temperature', 'N/A')}, "
        f"BP: {vitals.get('bp', 'N/A')}, "
        f"Pulse: {vitals.get('pulse', 'N/A')}"
    )

    prescription_info = ""
    if case_data.get("prescription_data"):
        prescription_info = f"\nCurrent Prescription: {json.dumps(case_data['prescription_data'])}"

    return (
        f"Symptoms: {symptoms_str}\n"
        f"Duration: {case_data.get('duration', 'Not specified')}\n"
        f"Vitals: {vitals_str}\n"
        f"Clinical Notes: {case_data.get('clinical_notes', 'None provided')}"
        f"{prescription_info}"
    )


def _format_guideline_chunks(chunks: List[Dict[str, Any]]) -> str:
    """
    Format RAG chunks into a structured text block for the prompt.
    Respects the MAX_RAG_CONTEXT_CHARS budget.
    """
    if not chunks:
        return ""

    lines = ["RETRIEVED CLINICAL GUIDELINES (Government-certified sources):"]
    total_chars = len(lines[0])

    for i, chunk in enumerate(chunks, 1):
        source_label = chunk.get("source", "Clinical Guidelines")
        title = chunk.get("title", "Guideline")
        content = chunk.get("content", "")
        score_pct = int(chunk.get("relevance_score", 0) * 100)

        # Truncate individual chunk content if needed
        available = MAX_RAG_CONTEXT_CHARS - total_chars - 200  # 200 char buffer
        if available <= 0:
            break

        truncated_content = content[:available] if len(content) > available else content

        entry = (
            f"\n[Guideline {i}] [{source_label}] {title} (Relevance: {score_pct}%)\n"
            f"{truncated_content}"
        )

        total_chars += len(entry)

        if total_chars > MAX_RAG_CONTEXT_CHARS:
            break

        lines.append(entry)

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_enriched_prompt(case_data: dict, chunks: List[Dict[str, Any]]) -> tuple[str, str]:
    """
    Build a RAG-augmented prompt for Gemini.

    Returns:
        (system_prompt, user_prompt) tuple ready for genai.GenerativeModel
    """
    guideline_block = _format_guideline_chunks(chunks)
    case_block = _format_case_section(case_data)

    user_prompt = f"""{guideline_block}

---

PATIENT CASE:
{case_block}

Generate a clinical decision support response in the exact JSON format specified.
Where applicable, reference the specific guideline you are drawing from."""

    return SYSTEM_PROMPT, user_prompt


def build_basic_prompt(case_data: dict) -> tuple[str, str]:
    """
    Build a basic prompt (no RAG context) — used when Bedrock is unavailable.

    Returns:
        (system_prompt, user_prompt) tuple
    """
    case_block = _format_case_section(case_data)

    user_prompt = f"""Please analyze this clinical case:

{case_block}

Generate a clinical decision support response in the exact JSON format specified."""

    return SYSTEM_PROMPT_NO_RAG, user_prompt
