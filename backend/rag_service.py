"""
rag_service.py — AWS Bedrock Knowledge Base retrieval service.

Calls the Bedrock Agent Runtime `retrieve` API to fetch relevant medical
guideline chunks (WHO, ICMR, drug databases) for a given clinical case.

Graceful degradation: any error → returns empty list so the pipeline
continues with Gemini-only analysis and never blocks the doctor.
"""
import os
import logging
import boto3
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config (loaded from environment, set at module level for reuse)
# ---------------------------------------------------------------------------
BEDROCK_KB_ID = os.environ.get("AWS_BEDROCK_KB_ID", "")
BEDROCK_REGION = os.environ.get("AWS_BEDROCK_REGION", "us-east-1")
BEDROCK_TOP_K = int(os.environ.get("BEDROCK_RAG_TOP_K", "5"))
BEDROCK_RELEVANCE_THRESHOLD = float(os.environ.get("BEDROCK_RELEVANCE_THRESHOLD", "0.70"))


def _get_bedrock_client():
    """Return a boto3 bedrock-agent-runtime client."""
    return boto3.client(
        "bedrock-agent-runtime",
        region_name=BEDROCK_REGION,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )


def _build_retrieval_query(case_data: dict) -> str:
    """
    Construct a concise retrieval query from case data.
    Focuses on symptoms, medications, and clinical notes — the signals
    most likely to match guideline content.
    """
    parts = []

    symptoms = case_data.get("symptoms", [])
    if symptoms:
        parts.append("Symptoms: " + ", ".join(symptoms))

    duration = case_data.get("duration", "")
    if duration:
        parts.append(f"Duration: {duration}")

    vitals = case_data.get("vitals", {})
    vital_parts = []
    if vitals.get("bp"):
        vital_parts.append(f"BP {vitals['bp']}")
    if vitals.get("temperature"):
        vital_parts.append(f"Temp {vitals['temperature']}")
    if vitals.get("pulse"):
        vital_parts.append(f"Pulse {vitals['pulse']}")
    if vital_parts:
        parts.append("Vitals: " + ", ".join(vital_parts))

    clinical_notes = case_data.get("clinical_notes", "")
    if clinical_notes:
        # Truncate notes to avoid overly long queries
        parts.append(f"Clinical Notes: {clinical_notes[:500]}")

    prescription = case_data.get("prescription_data", {})
    if prescription and isinstance(prescription, dict):
        meds = prescription.get("medications", [])
        if meds:
            med_names = [m.get("name", "") for m in meds if m.get("name")]
            if med_names:
                parts.append("Current Medications: " + ", ".join(med_names))

    return ". ".join(parts) or "General clinical guidelines"


def _parse_retrieval_results(results: List[dict]) -> List[Dict[str, Any]]:
    """
    Parse raw Bedrock retrieve results into clean GuidelineChunk dicts.
    Each chunk: { title, content, source, source_url, relevance_score }
    """
    chunks = []
    for item in results:
        score = item.get("score", 0.0)

        # Filter by relevance threshold
        if score < BEDROCK_RELEVANCE_THRESHOLD:
            continue

        content_text = item.get("content", {}).get("text", "").strip()
        if not content_text:
            continue

        # Extract location / source info
        location = item.get("location", {})
        s3_location = location.get("s3Location", {})
        source_uri = s3_location.get("uri", "")

        # Try to extract a readable source name from the S3 key
        source_name = ""
        if source_uri:
            # e.g. s3://bucket/who_hypertension_2023.pdf → "who_hypertension_2023.pdf"
            source_name = source_uri.split("/")[-1] if "/" in source_uri else source_uri

        # Extract metadata if present
        metadata = item.get("metadata", {})
        title = (
            metadata.get("document_title")
            or metadata.get("title")
            or metadata.get("x-amz-bedrock-kb-source-uri", source_name)
            or source_name
            or "Clinical Guideline"
        )

        # Infer source organisation from filename / metadata
        source_org = _infer_source_org(source_uri, metadata)

        chunks.append({
            "title": title,
            "content": content_text,
            "source": source_org,
            "source_url": source_uri,
            "relevance_score": round(score, 4),
        })

    return chunks


def _infer_source_org(source_uri: str, metadata: dict) -> str:
    """Infer WHO / ICMR / DrugDB label from URI or metadata."""
    combined = (source_uri + str(metadata)).lower()
    if "who" in combined:
        return "WHO"
    if "icmr" in combined:
        return "ICMR"
    if "drug" in combined or "medicine" in combined or "pharma" in combined:
        return "Drug Database"
    return "Clinical Guidelines"


async def retrieve_guidelines(case_data: dict) -> tuple[List[Dict[str, Any]], bool]:
    """
    Main entry point — retrieve relevant medical guideline chunks from Bedrock.

    Returns:
        (chunks, rag_available)
        - chunks: list of GuidelineChunk dicts (empty list on failure / no KB configured)
        - rag_available: True if Bedrock was successfully queried

    Never raises — any exception is caught and logged, returning ([], False)
    so the analysis pipeline can always continue with Gemini.
    """
    if not BEDROCK_KB_ID:
        logger.warning("AWS_BEDROCK_KB_ID not configured — skipping RAG retrieval")
        return [], False

    query = _build_retrieval_query(case_data)
    logger.info(f"RAG retrieval query: {query[:150]}...")

    try:
        client = _get_bedrock_client()

        response = client.retrieve(
            knowledgeBaseId=BEDROCK_KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": BEDROCK_TOP_K,
                }
            },
        )

        raw_results = response.get("retrievalResults", [])
        chunks = _parse_retrieval_results(raw_results)

        logger.info(
            f"RAG: retrieved {len(raw_results)} results, "
            f"{len(chunks)} passed relevance threshold ({BEDROCK_RELEVANCE_THRESHOLD})"
        )
        return chunks, True

    except Exception as e:
        logger.error(f"RAG retrieval failed: {str(e)} — continuing with Gemini-only analysis")
        return [], False
