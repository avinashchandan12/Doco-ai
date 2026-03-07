from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi.responses import FileResponse, RedirectResponse
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import json
import re
import boto3
from botocore.exceptions import ClientError
import tempfile
from abdm_crypto import ABDMCrypto
from abdm_service import ABDMService
from prescription_ai_service import (
    get_clinical_context,
    build_prescription_prompt,
    generate_ai_prescription,
    build_fhir_medication_requests,
    generate_prescription_pdf,
)

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url, tls=True, tlsAllowInvalidCertificates=False)
db = client[os.environ['DB_NAME']]


# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET', 'clinical-copilot-secret')
JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
JWT_EXPIRATION_HOURS = int(os.environ.get('JWT_EXPIRATION_HOURS', 24))

# AWS S3 Config
AWS_S3_BUCKET = os.environ.get('AWS_S3_BUCKET')  # None → fallback to local disk
AWS_REGION = os.environ.get('AWS_REGION', 'ap-south-1')

# AWS Bedrock RAG Config
BEDROCK_KB_ID = os.environ.get('AWS_BEDROCK_KB_ID', '')
BEDROCK_REGION = os.environ.get('AWS_BEDROCK_REGION', 'us-east-1')
BEDROCK_TOP_K = int(os.environ.get('BEDROCK_RAG_TOP_K', '5'))
BEDROCK_THRESHOLD = float(os.environ.get('BEDROCK_RELEVANCE_THRESHOLD', '0.70'))

# ABDM V3 Config
ABDM_CERT_URL = os.environ.get(
    "ABDM_CERT_URL",
    "https://abhasbx.abdm.gov.in/abha/api/v3/profile/public/certificate",
)
ABDM_ENROL_BY_AADHAAR_URL = os.environ.get(
    "ABDM_ENROL_BY_AADHAAR_URL",
    "https://abhasbx.abdm.gov.in/abha/api/v3/enrollment/enrol/byAadhaar",
)
ABDM_GATEWAY_TOKEN = os.environ.get("ABDM_GATEWAY_TOKEN", "")
ABDM_X_CM_ID = os.environ.get("ABDM_X_CM_ID", "sbx")
ABDM_REQUEST_TIMEOUT_SECONDS = float(os.environ.get("ABDM_REQUEST_TIMEOUT_SECONDS", "20"))
ABDM_CERT_CACHE_TTL_SECONDS = int(os.environ.get("ABDM_CERT_CACHE_TTL_SECONDS", "900"))

abdm_crypto = ABDMCrypto(
    cert_url=ABDM_CERT_URL,
    timeout_seconds=ABDM_REQUEST_TIMEOUT_SECONDS,
    cert_cache_ttl_seconds=ABDM_CERT_CACHE_TTL_SECONDS,
    auth_token=ABDM_GATEWAY_TOKEN,
    x_cm_id=ABDM_X_CM_ID,
)

abdm_service = ABDMService(
    enrol_by_aadhaar_url=ABDM_ENROL_BY_AADHAAR_URL,
    gateway_token=ABDM_GATEWAY_TOKEN,
    timeout_seconds=ABDM_REQUEST_TIMEOUT_SECONDS,
    x_cm_id=ABDM_X_CM_ID,
)

def get_s3_client():
    """Return a boto3 S3 client. Uses IAM role on EB, or env keys locally."""
    return boto3.client(
        's3',
        region_name=AWS_REGION,
        aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
        aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
    )

def upload_to_s3(file_bytes: bytes, s3_key: str, content_type: str = 'application/octet-stream') -> str:
    """Upload bytes to S3 and return the public S3 URL."""
    s3 = get_s3_client()
    s3.put_object(
        Bucket=AWS_S3_BUCKET,
        Key=s3_key,
        Body=file_bytes,
        ContentType=content_type,
    )
    return f"https://{AWS_S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{s3_key}"

def get_presigned_url(s3_key: str, expiry: int = 3600) -> str:
    """Generate a pre-signed download URL for an S3 object."""
    s3 = get_s3_client()
    try:
        url = s3.generate_presigned_url(
            'get_object',
            Params={'Bucket': AWS_S3_BUCKET, 'Key': s3_key},
            ExpiresIn=expiry,
        )
        return url
    except ClientError as e:
        logger.error(f"S3 presigned URL error: {e}")
        raise HTTPException(status_code=500, detail="Could not generate download URL")

# Create the main app
app = FastAPI(title="AI Clinical Co-Pilot API")

# Create router with /api prefix
api_router = APIRouter(prefix="/api")

# Security
security = HTTPBearer()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ============== SCHEMAS ==============

class DoctorSignup(BaseModel):
    name: str
    email: EmailStr
    password: str
    qualification: str
    location: str
    hospital_name: Optional[str] = None
    specialization: Optional[str] = None
    contact: Optional[str] = None
    reg_no: Optional[str] = None
    website: Optional[str] = None

class DoctorLogin(BaseModel):
    email: EmailStr
    password: str

class DoctorResponse(BaseModel):
    id: str
    name: str
    email: str
    qualification: str
    location: str
    hospital_name: Optional[str] = None
    specialization: Optional[str] = None
    contact: Optional[str] = None
    reg_no: Optional[str] = None
    website: Optional[str] = None
    created_at: str

class DoctorProfileUpdate(BaseModel):
    name: Optional[str] = None
    qualification: Optional[str] = None
    location: Optional[str] = None
    hospital_name: Optional[str] = None
    specialization: Optional[str] = None
    contact: Optional[str] = None
    reg_no: Optional[str] = None
    website: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    doctor: DoctorResponse

class VitalsInput(BaseModel):
    temperature: Optional[str] = None
    bp: Optional[str] = None
    pulse: Optional[str] = None

class CaseCreate(BaseModel):
    patient_name: Optional[str] = None
    patient_age: Optional[str] = None
    patient_gender: Optional[str] = None
    symptoms: List[str]
    duration: str
    vitals: VitalsInput
    clinical_notes: Optional[str] = None
    prescription_data: Optional[dict] = None
    image_url: Optional[str] = None

class AIAnalysisResult(BaseModel):
    clinical_summary: str
    considerations: List[str]
    red_flags: List[str]
    prescription_review: List[str]
    next_steps: List[str]

class GuidelineChunk(BaseModel):
    title: str
    content: str
    source: str
    source_url: Optional[str] = None
    relevance_score: float

class RAGMetadata(BaseModel):
    rag_available: bool
    chunks_retrieved: int

class CaseResponse(BaseModel):
    id: str
    doctor_id: str
    patient_name: Optional[str] = None
    patient_age: Optional[str] = None
    patient_gender: Optional[str] = None
    symptoms: List[str]
    duration: str
    vitals: dict
    clinical_notes: Optional[str]
    prescription_data: Optional[dict]
    image_url: Optional[str]
    ai_analysis: Optional[dict]
    guidelines: Optional[List[dict]] = None
    rag_metadata: Optional[dict] = None
    created_at: str
    updated_at: str

class PrescriptionExtractResponse(BaseModel):
    medications: List[dict]
    raw_text: str
    confidence: float


class ABHAGenerateOTPRequest(BaseModel):
    aadhaar_number: str = Field(..., pattern=r"^\d{12}$")


class ABHAGenerateOTPResponse(BaseModel):
    message: str
    txnId: str


class ABHATransactionRecord(BaseModel):
    id: str
    doctor_id: str
    txnId: str
    request_id: str
    status: str
    aadhaar_last4: str
    created_at: str
    updated_at: str


class ContextMedicationItem(BaseModel):
    name: str
    dosage: str
    recordedDate: str
    clinicalStatus: str


class ContextConditionItem(BaseModel):
    name: str
    clinicalStatus: str


class ClinicalContext(BaseModel):
    past_meds: List[ContextMedicationItem]
    chronic_conditions: List[ContextConditionItem]


class PrescriptionSuggestedMedication(BaseModel):
    name: str
    dosage: str
    frequency: str
    reason: str


class PrescriptionAISuggestion(BaseModel):
    suggested_medications: List[PrescriptionSuggestedMedication]
    warnings: List[str]


class PrescriptionSuggestRequest(BaseModel):
    patient_id: str
    session_id: str
    symptoms: List[str] = Field(default_factory=list)
    use_abha: bool = True
    current_draft: Optional[Dict[str, Any]] = None


class PrescriptionSuggestResponse(BaseModel):
    prompt_type: str
    clinical_context: ClinicalContext
    ai_suggestion: PrescriptionAISuggestion
    fhir_medication_requests: List[Dict[str, Any]]


class PrescriptionAcceptRequest(BaseModel):
    patient_id: str
    session_id: str


class PrescriptionAcceptResponse(BaseModel):
    message: str
    current_draft: PrescriptionAISuggestion
    updated_at: str


class PrescriptionPrintRequest(BaseModel):
    patient_id: str
    session_id: str
    patient_name: Optional[str] = None
    patient_age: Optional[str] = None
    patient_gender: Optional[str] = None
    abha_address: Optional[str] = None
    free_text_notes: Optional[str] = None
    abha_locker_url: Optional[str] = None


class PrescriptionWorkspaceResponse(BaseModel):
    patient_id: str
    session_id: str
    doctor_id: str
    use_abha: Optional[bool] = True
    symptoms: Optional[List[str]] = None
    clinical_context: Optional[ClinicalContext] = None
    prompt_type: Optional[str] = None
    ai_suggestion: Optional[PrescriptionAISuggestion] = None
    current_draft: Optional[PrescriptionAISuggestion] = None
    fhir_medication_requests: Optional[List[Dict[str, Any]]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class AnalyseCaseBody(BaseModel):
    """Optional request body for /ai/analyse-case. Enables doctor brainstorm iteration."""
    doctor_context: Optional[str] = None

# ============== AUTH HELPERS ==============

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))

def create_token(doctor_id: str) -> str:
    payload = {
        "sub": doctor_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRATION_HOURS),
        "iat": datetime.now(timezone.utc)
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_doctor(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        doctor_id = payload.get("sub")
        if not doctor_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        doctor = await db.doctors.find_one({"id": doctor_id}, {"_id": 0})
        if not doctor:
            raise HTTPException(status_code=401, detail="Doctor not found")
        return doctor
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# ============== AI SERVICE ==============

async def analyze_case_with_ai(case_data: dict, doctor_context: Optional[str] = None) -> dict:
    """
    Orchestrate: RAG retrieve → enriched prompt → Gemini generate.

    Returns a dict with:
      - ai_analysis: structured clinical analysis from Gemini
      - guidelines: raw guideline chunks from Bedrock (shown to doctor)
      - rag_metadata: { rag_available, chunks_retrieved }
    """
    import google.generativeai as genai
    from rag_service import retrieve_guidelines
    from prompt_builder import build_enriched_prompt, build_basic_prompt

    # Support both GEMINI_API_KEY and legacy EMERGENT_LLM_KEY
    api_key = os.environ.get('GEMINI_API_KEY') or os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        logger.error("No AI API key found (GEMINI_API_KEY or EMERGENT_LLM_KEY)")
        raise HTTPException(status_code=500, detail="AI service not configured")

    # ── Step 1: RAG retrieval (graceful fallback built into rag_service) ──
    logger.info(f"Starting RAG retrieval for case {case_data.get('id', 'unknown')}")
    guidelines, rag_available = await retrieve_guidelines(case_data)
    logger.info(f"RAG result: available={rag_available}, chunks={len(guidelines)}")

    # Get previous analysis for brainstorm context
    previous_analysis = case_data.get("ai_analysis") if doctor_context else None

    # ── Step 2: Build prompt (enriched if RAG returned chunks, basic otherwise) ──
    if guidelines:
        system_prompt, user_prompt = build_enriched_prompt(
            case_data, guidelines,
            doctor_context=doctor_context,
            previous_analysis=previous_analysis,
        )
    else:
        system_prompt, user_prompt = build_basic_prompt(
            case_data,
            doctor_context=doctor_context,
            previous_analysis=previous_analysis,
        )

    # ── Step 3: Fetch image if present ──
    input_content = [user_prompt]
    image_url = case_data.get("image_url")
    
    if image_url:
        logger.info(f"Image found for case: {image_url}")
        try:
            image_bytes = None
            if image_url.startswith("/api/uploads/"):
                # Local development fallback
                filename = image_url.split("/")[-1]
                file_path = ROOT_DIR / "uploads" / filename
                if file_path.exists():
                    with open(file_path, "rb") as f:
                        image_bytes = f.read()
            elif image_url.startswith("http") and AWS_S3_BUCKET:
                # S3 (assuming it's a pre-signed URL or public URL; for simplicity, we 
                # can just download it via requests if it's accessible or use boto3 if it's our bucket)
                # Parse the key from the doco-ai-uploads URL
                import urllib.parse
                s3_key = urllib.parse.urlparse(image_url).path.lstrip("/")
                s3_client = boto3.client(
                    "s3", 
                    region_name=os.environ.get("AWS_REGION", "ap-south-1"),
                    aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
                    aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY")
                )
                response = s3_client.get_object(Bucket=AWS_S3_BUCKET, Key=s3_key)
                image_bytes = response['Body'].read()

            if image_bytes:
                # Determine mime type naively from URL
                mime_type = "image/jpeg"
                if image_url.lower().endswith(".png"):
                    mime_type = "image/png"
                elif image_url.lower().endswith(".webp"):
                    mime_type = "image/webp"

                input_content.insert(0, {
                    "mime_type": mime_type,
                    "data": image_bytes
                })
                logger.info("Successfully attached image to Gemini prompt")
            else:
                logger.warning(f"Could not load image bytes for {image_url}")
        except Exception as img_err:
            logger.error(f"Failed to fetch image for analysis: {img_err}")

    # ── Step 4: Call Gemini ──
    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-3-flash-preview", # Fallback to a vision-capable standard model if this preview fails
            system_instruction=system_prompt
        )
        response = model.generate_content(input_content)
        response_text = response.text

        # Parse JSON from response
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            result = json.loads(json_match.group())
            ai_analysis = {
                "clinical_summary": result.get("clinical_summary", "Analysis completed"),
                "considerations": result.get("considerations", []),
                "red_flags": result.get("red_flags", []),
                "image_findings": result.get("image_findings", []),
                "prescription_review": result.get("prescription_review", []),
                "next_steps": result.get("next_steps", [])
            }
        else:
            logger.error(f"Failed to parse AI response: {response_text}")
            ai_analysis = {
                "clinical_summary": "AI analysis completed. Please review the case details.",
                "considerations": ["Manual clinical review recommended"],
                "red_flags": [],
                "image_findings": [],
                "prescription_review": [],
                "next_steps": ["Continue standard clinical evaluation"]
            }

        return {
            "ai_analysis": ai_analysis,
            "guidelines": guidelines,
            "rag_metadata": {
                "rag_available": rag_available,
                "chunks_retrieved": len(guidelines),
            }
        }

    except Exception as e:
        logger.error(f"AI analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")




# ============== OCR SERVICE (Textract + Gemini) ==============


# ============== PDF SERVICE ==============

def generate_case_pdf(case_data: dict, doctor_name: str, output_dir: str = None) -> str:
    """Generate PDF report for a case. Returns the filepath of the generated PDF."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

    filename = f"case_report_{case_data['id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"

    if output_dir:
        # Use provided temp directory (e.g., for S3 upload)
        filepath = Path(output_dir) / filename
    else:
        # Default: local reports directory
        reports_dir = ROOT_DIR / "reports"
        reports_dir.mkdir(exist_ok=True)
        filepath = reports_dir / filename

    doc = SimpleDocTemplate(str(filepath), pagesize=A4, topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle('Title', parent=styles['Heading1'], fontSize=18, textColor=colors.HexColor('#0F766E'), spaceAfter=20)
    heading_style = ParagraphStyle('Heading', parent=styles['Heading2'], fontSize=14, textColor=colors.HexColor('#0F766E'), spaceBefore=15, spaceAfter=10)
    body_style = ParagraphStyle('Body', parent=styles['Normal'], fontSize=10, spaceAfter=8)
    alert_style = ParagraphStyle('Alert', parent=styles['Normal'], fontSize=10, textColor=colors.HexColor('#BE123C'), spaceAfter=8)
    
    elements = []
    
    # Title
    elements.append(Paragraph("AI Clinical Co-Pilot - Case Report", title_style))
    elements.append(Paragraph(f"<b>Physician:</b> {doctor_name}", body_style))
    elements.append(Paragraph(f"<b>Case ID:</b> {case_data['id']}", body_style))
    elements.append(Paragraph(f"<b>Date:</b> {case_data.get('created_at', 'N/A')}", body_style))
    elements.append(Spacer(1, 20))
    
    # Symptoms
    elements.append(Paragraph("Presenting Symptoms", heading_style))
    symptoms = ", ".join(case_data.get('symptoms', []))
    elements.append(Paragraph(f"<b>Symptoms:</b> {symptoms}", body_style))
    elements.append(Paragraph(f"<b>Duration:</b> {case_data.get('duration', 'N/A')}", body_style))
    
    # Vitals
    elements.append(Paragraph("Vitals", heading_style))
    vitals = case_data.get('vitals', {})
    vitals_text = f"Temperature: {vitals.get('temperature', 'N/A')} | BP: {vitals.get('bp', 'N/A')} | Pulse: {vitals.get('pulse', 'N/A')}"
    elements.append(Paragraph(vitals_text, body_style))
    
    # Clinical Notes
    if case_data.get('clinical_notes'):
        elements.append(Paragraph("Clinical Notes", heading_style))
        elements.append(Paragraph(case_data['clinical_notes'], body_style))
    
    # Prescription
    if case_data.get('prescription_data'):
        elements.append(Paragraph("Prescription Information", heading_style))
        meds = case_data['prescription_data'].get('medications', [])
        for med in meds:
            med_text = f"• {med.get('name', 'N/A')} - {med.get('dosage', 'N/A')} - {med.get('frequency', 'N/A')}"
            elements.append(Paragraph(med_text, body_style))
    
    # AI Analysis
    ai_analysis = case_data.get('ai_analysis', {})
    if ai_analysis:
        elements.append(Paragraph("AI Clinical Decision Support", heading_style))
        
        if ai_analysis.get('clinical_summary'):
            elements.append(Paragraph(f"<b>Summary:</b> {ai_analysis['clinical_summary']}", body_style))
        
        if ai_analysis.get('considerations'):
            elements.append(Paragraph("<b>Considerations:</b>", body_style))
            for c in ai_analysis['considerations']:
                elements.append(Paragraph(f"• {c}", body_style))
        
        if ai_analysis.get('red_flags'):
            elements.append(Paragraph("<b>Red Flags:</b>", body_style))
            for rf in ai_analysis['red_flags']:
                elements.append(Paragraph(f"⚠ {rf}", alert_style))
        
        if ai_analysis.get('next_steps'):
            elements.append(Paragraph("<b>Recommended Next Steps:</b>", body_style))
            for ns in ai_analysis['next_steps']:
                elements.append(Paragraph(f"→ {ns}", body_style))
    
    # Disclaimer
    elements.append(Spacer(1, 30))
    disclaimer_style = ParagraphStyle('Disclaimer', parent=styles['Normal'], fontSize=8, textColor=colors.gray, alignment=1)
    elements.append(Paragraph("DISCLAIMER: This report is generated by an AI clinical decision support system. It does not constitute a diagnosis. Final medical judgment rests with the treating physician.", disclaimer_style))
    
    doc.build(elements)
    return str(filepath)

# ============== AUTH ROUTES ==============

@api_router.post("/auth/signup", response_model=TokenResponse)
async def signup(data: DoctorSignup):
    # Check if email exists
    existing = await db.doctors.find_one({"email": data.email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    doctor_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    doctor_doc = {
        "id": doctor_id,
        "name": data.name,
        "email": data.email,
        "password": hash_password(data.password),
        "qualification": data.qualification,
        "location": data.location,
        "hospital_name": data.hospital_name,
        "specialization": data.specialization,
        "contact": data.contact,
        "reg_no": data.reg_no,
        "website": data.website,
        "created_at": now
    }
    
    await db.doctors.insert_one(doctor_doc)
    
    token = create_token(doctor_id)
    
    return TokenResponse(
        access_token=token,
        doctor=DoctorResponse(
            id=doctor_id,
            name=data.name,
            email=data.email,
            qualification=data.qualification,
            location=data.location,
            hospital_name=data.hospital_name,
            specialization=data.specialization,
            contact=data.contact,
            reg_no=data.reg_no,
            website=data.website,
            created_at=now
        )
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(data: DoctorLogin):
    doctor = await db.doctors.find_one({"email": data.email}, {"_id": 0})
    if not doctor:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    if not verify_password(data.password, doctor['password']):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_token(doctor['id'])
    
    return TokenResponse(
        access_token=token,
        doctor=DoctorResponse(
            id=doctor['id'],
            name=doctor['name'],
            email=doctor['email'],
            qualification=doctor['qualification'],
            location=doctor['location'],
            hospital_name=doctor.get('hospital_name'),
            specialization=doctor.get('specialization'),
            contact=doctor.get('contact'),
            reg_no=doctor.get('reg_no'),
            website=doctor.get('website'),
            created_at=doctor['created_at']
        )
    )

# ============== DOCTOR ROUTES ==============

@api_router.get("/doctor/profile", response_model=DoctorResponse)
async def get_profile(doctor: dict = Depends(get_current_doctor)):
    return DoctorResponse(
        id=doctor['id'],
        name=doctor['name'],
        email=doctor['email'],
        qualification=doctor['qualification'],
        location=doctor['location'],
        hospital_name=doctor.get('hospital_name'),
        specialization=doctor.get('specialization'),
        contact=doctor.get('contact'),
        reg_no=doctor.get('reg_no'),
        website=doctor.get('website'),
        created_at=doctor['created_at']
    )

@api_router.put("/doctor/profile", response_model=DoctorResponse)
async def update_doctor_profile(
    data: DoctorProfileUpdate,
    doctor: dict = Depends(get_current_doctor),
):
    """Update doctor profile / clinic settings."""
    update_fields = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")
    now = datetime.now(timezone.utc).isoformat()
    update_fields["updated_at"] = now
    await db.doctors.update_one({"id": doctor["id"]}, {"$set": update_fields})
    updated = await db.doctors.find_one({"id": doctor["id"]}, {"_id": 0})
    return DoctorResponse(
        id=updated["id"],
        name=updated["name"],
        email=updated["email"],
        qualification=updated.get("qualification", ""),
        location=updated.get("location", ""),
        hospital_name=updated.get("hospital_name"),
        specialization=updated.get("specialization"),
        contact=updated.get("contact"),
        reg_no=updated.get("reg_no"),
        website=updated.get("website"),
        created_at=updated["created_at"],
    )

# ============== ABHA / ABDM ROUTES ==============

@api_router.post("/v3/abha/generate-otp", response_model=ABHAGenerateOTPResponse)
async def generate_abha_otp(
    data: ABHAGenerateOTPRequest,
    doctor: dict = Depends(get_current_doctor),
):
    aadhaar_number = data.aadhaar_number

    try:
        encrypted_aadhaar = await abdm_crypto.encrypt(aadhaar_number)
    except Exception as exc:
        logger.error(f"ABDM encryption error: {str(exc)}")
        raise HTTPException(status_code=502, detail="Failed to encrypt Aadhaar for ABDM")

    response_data, request_id = await abdm_service.enrol_by_aadhaar(encrypted_aadhaar)
    txn_id = response_data.get("txnId") or response_data.get("txn_id")

    if not txn_id:
        logger.error(f"ABDM response missing txnId for request_id={request_id}")
        raise HTTPException(status_code=502, detail="ABDM response missing transaction ID")

    now = datetime.now(timezone.utc).isoformat()
    txn_record = ABHATransactionRecord(
        id=str(uuid.uuid4()),
        doctor_id=doctor["id"],
        txnId=txn_id,
        request_id=request_id,
        status="OTP_SENT",
        aadhaar_last4=aadhaar_number[-4:],
        created_at=now,
        updated_at=now,
    )
    await db.abha_transactions.insert_one(txn_record.model_dump())

    return ABHAGenerateOTPResponse(
        message="OTP sent to Aadhaar-linked mobile",
        txnId=txn_id,
    )


# ============== PRESCRIPTION AI ROUTES ==============

@api_router.post("/prescriptions/suggest", response_model=PrescriptionSuggestResponse)
async def suggest_prescription(
    data: PrescriptionSuggestRequest,
    doctor: dict = Depends(get_current_doctor),
):
    clinical_context_raw = await get_clinical_context(
        patient_id=data.patient_id,
        session_id=data.session_id,
        use_abha=data.use_abha,
        db=db,
    )
    prompt_type, prompt_text = build_prescription_prompt(
        symptoms=data.symptoms,
        clinical_context=clinical_context_raw,
        use_abha=data.use_abha,
    )
    ai_suggestion_raw = await generate_ai_prescription(prompt_text)
    fhir_requests = build_fhir_medication_requests(
        suggested_medications=ai_suggestion_raw.get("suggested_medications", []),
        patient_id=data.patient_id,
        session_id=data.session_id,
    )

    clinical_context = ClinicalContext(
        past_meds=[ContextMedicationItem(**item) for item in clinical_context_raw.get("past_meds", [])],
        chronic_conditions=[ContextConditionItem(**item) for item in clinical_context_raw.get("chronic_conditions", [])],
    )
    ai_suggestion = PrescriptionAISuggestion(**ai_suggestion_raw)

    now = datetime.now(timezone.utc).isoformat()
    await db.prescription_workspaces.update_one(
        {
            "patient_id": data.patient_id,
            "session_id": data.session_id,
            "doctor_id": doctor["id"],
        },
        {
            "$set": {
                "patient_id": data.patient_id,
                "session_id": data.session_id,
                "doctor_id": doctor["id"],
                "use_abha": data.use_abha,
                "symptoms": data.symptoms,
                "clinical_context": clinical_context.model_dump(),
                "prompt_type": prompt_type,
                "ai_suggestion": ai_suggestion.model_dump(),
                "fhir_medication_requests": fhir_requests,
                "updated_at": now,
            },
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "created_at": now,
            },
        },
        upsert=True,
    )

    if data.current_draft is not None:
        await db.prescription_workspaces.update_one(
            {
                "patient_id": data.patient_id,
                "session_id": data.session_id,
                "doctor_id": doctor["id"],
            },
            {"$set": {"current_draft": data.current_draft, "updated_at": now}},
        )

    return PrescriptionSuggestResponse(
        prompt_type=prompt_type,
        clinical_context=clinical_context,
        ai_suggestion=ai_suggestion,
        fhir_medication_requests=fhir_requests,
    )


@api_router.post("/prescriptions/accept", response_model=PrescriptionAcceptResponse)
async def accept_prescription_suggestion(
    data: PrescriptionAcceptRequest,
    doctor: dict = Depends(get_current_doctor),
):
    workspace = await db.prescription_workspaces.find_one(
        {
            "patient_id": data.patient_id,
            "session_id": data.session_id,
            "doctor_id": doctor["id"],
        },
        {"_id": 0},
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Prescription workspace not found")

    ai_suggestion_raw = workspace.get("ai_suggestion")
    if not ai_suggestion_raw:
        raise HTTPException(status_code=400, detail="No AI suggestion available to accept")

    ai_suggestion = PrescriptionAISuggestion(**ai_suggestion_raw)
    now = datetime.now(timezone.utc).isoformat()
    await db.prescription_workspaces.update_one(
        {
            "patient_id": data.patient_id,
            "session_id": data.session_id,
            "doctor_id": doctor["id"],
        },
        {
            "$set": {
                "current_draft": ai_suggestion.model_dump(),
                "updated_at": now,
            }
        },
    )

    return PrescriptionAcceptResponse(
        message="AI suggestion accepted and current draft updated",
        current_draft=ai_suggestion,
        updated_at=now,
    )


@api_router.get("/prescriptions/workspace/{patient_id}/{session_id}", response_model=PrescriptionWorkspaceResponse)
async def get_prescription_workspace(
    patient_id: str,
    session_id: str,
    doctor: dict = Depends(get_current_doctor),
):
    """Fetch the stored prescription workspace (draft, suggestion, context) for a patient session."""
    workspace = await db.prescription_workspaces.find_one(
        {
            "patient_id": patient_id,
            "session_id": session_id,
            "doctor_id": doctor["id"],
        },
        {"_id": 0},
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Prescription workspace not found")

    # Coerce nested models safely
    clinical_context_raw = workspace.get("clinical_context")
    clinical_context = None
    if clinical_context_raw:
        try:
            clinical_context = ClinicalContext(**clinical_context_raw)
        except Exception:
            clinical_context = None

    ai_suggestion_raw = workspace.get("ai_suggestion")
    ai_suggestion = None
    if ai_suggestion_raw:
        try:
            ai_suggestion = PrescriptionAISuggestion(**ai_suggestion_raw)
        except Exception:
            ai_suggestion = None

    current_draft_raw = workspace.get("current_draft")
    current_draft = None
    if current_draft_raw:
        try:
            current_draft = PrescriptionAISuggestion(**current_draft_raw)
        except Exception:
            current_draft = None

    return PrescriptionWorkspaceResponse(
        patient_id=workspace["patient_id"],
        session_id=workspace["session_id"],
        doctor_id=workspace["doctor_id"],
        use_abha=workspace.get("use_abha", True),
        symptoms=workspace.get("symptoms"),
        clinical_context=clinical_context,
        prompt_type=workspace.get("prompt_type"),
        ai_suggestion=ai_suggestion,
        current_draft=current_draft,
        fhir_medication_requests=workspace.get("fhir_medication_requests"),
        created_at=workspace.get("created_at"),
        updated_at=workspace.get("updated_at"),
    )


@api_router.post("/prescriptions/print")
async def print_prescription(
    data: PrescriptionPrintRequest,
    doctor: dict = Depends(get_current_doctor),
):
    """Generate an ABDM-compliant prescription PDF with QR code and return a download URL."""
    workspace = await db.prescription_workspaces.find_one(
        {
            "patient_id": data.patient_id,
            "session_id": data.session_id,
            "doctor_id": doctor["id"],
        },
        {"_id": 0},
    )
    if not workspace:
        # Allow printing even without a saved workspace (manual prescription only mode)
        workspace = {}

    patient_info = {
        "patient_id": data.patient_id,
        "patient_name": data.patient_name or "Unknown",
        "patient_age": data.patient_age or "N/A",
        "patient_gender": data.patient_gender or "N/A",
        "abha_address": data.abha_address or "",
        "free_text_notes": data.free_text_notes or "",
    }

    doctor_info = {
        "name": doctor.get("name", "Doctor"),
        "qualification": doctor.get("qualification", ""),
        "location": doctor.get("location", ""),
        "reg_no": doctor.get("reg_no", "Reg. No. N/A"),
    }

    qr_url = (
        data.abha_locker_url
        or f"https://abdm.gov.in/healthlocker?patient={data.patient_id}"
    )

    try:
        if AWS_S3_BUCKET:
            with tempfile.TemporaryDirectory() as tmpdir:
                pdf_path = generate_prescription_pdf(
                    workspace=workspace,
                    patient_info=patient_info,
                    doctor_info=doctor_info,
                    qr_url=qr_url,
                    output_dir=tmpdir,
                )
                pdf_filename = Path(pdf_path).name
                s3_key = f"prescriptions/{pdf_filename}"
                with open(pdf_path, "rb") as f:
                    upload_to_s3(f.read(), s3_key, "application/pdf")
            presigned_url = get_presigned_url(s3_key)
            return {"pdf_url": presigned_url, "pdf_filename": pdf_filename}
        else:
            pdf_path = generate_prescription_pdf(
                workspace=workspace,
                patient_info=patient_info,
                doctor_info=doctor_info,
                qr_url=qr_url,
            )
            pdf_filename = Path(pdf_path).name
            return {"pdf_url": f"/api/reports/download/{pdf_filename}", "pdf_filename": pdf_filename}
    except Exception as exc:
        logger.error(f"Prescription PDF generation failed: {exc}")
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(exc)}")


# ============== CASE ROUTES ==============

@api_router.post("/cases/create", response_model=CaseResponse)
async def create_case(data: CaseCreate, doctor: dict = Depends(get_current_doctor)):
    case_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    case_doc = {
        "id": case_id,
        "doctor_id": doctor['id'],
        "patient_name": data.patient_name,
        "patient_age": data.patient_age,
        "patient_gender": data.patient_gender,
        "symptoms": data.symptoms,
        "duration": data.duration,
        "vitals": data.vitals.model_dump(),
        "clinical_notes": data.clinical_notes,
        "prescription_data": data.prescription_data,
        "image_url": data.image_url,
        "ai_analysis": None,
        "created_at": now,
        "updated_at": now
    }
    
    await db.cases.insert_one(case_doc)
    
    return CaseResponse(**{k: v for k, v in case_doc.items() if k != '_id'})

@api_router.get("/cases/list", response_model=List[CaseResponse])
async def list_cases(doctor: dict = Depends(get_current_doctor)):
    cases = await db.cases.find({"doctor_id": doctor['id']}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return [CaseResponse(**c) for c in cases]

@api_router.get("/cases/{case_id}", response_model=CaseResponse)
async def get_case(case_id: str, doctor: dict = Depends(get_current_doctor)):
    case = await db.cases.find_one({"id": case_id, "doctor_id": doctor['id']}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    return CaseResponse(**case)

@api_router.put("/cases/{case_id}", response_model=CaseResponse)
async def update_case(case_id: str, data: CaseCreate, doctor: dict = Depends(get_current_doctor)):
    case = await db.cases.find_one({"id": case_id, "doctor_id": doctor['id']})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    
    now = datetime.now(timezone.utc).isoformat()
    
    update_data = {
        "symptoms": data.symptoms,
        "duration": data.duration,
        "vitals": data.vitals.model_dump(),
        "clinical_notes": data.clinical_notes,
        "prescription_data": data.prescription_data,
        "image_url": data.image_url,
        "updated_at": now
    }
    
    await db.cases.update_one({"id": case_id}, {"$set": update_data})
    
    updated_case = await db.cases.find_one({"id": case_id}, {"_id": 0})
    return CaseResponse(**updated_case)

# ============== UPLOAD ROUTES ==============

@api_router.post("/cases/upload-prescription", response_model=PrescriptionExtractResponse)
async def upload_prescription(file: UploadFile = File(...), doctor: dict = Depends(get_current_doctor)):
    from ocr_service import extract_prescription

    # Read file content into memory
    content = await file.read()

    if AWS_S3_BUCKET:
        # Save to S3 for audit trail
        s3_key = f"prescriptions/{uuid.uuid4()}_{file.filename}"
        upload_to_s3(content, s3_key, file.content_type or 'application/octet-stream')

    # Real OCR: Textract → Gemini structured parsing
    result = await extract_prescription(content, file.filename)
    return PrescriptionExtractResponse(**result)

@api_router.post("/cases/upload-image")
async def upload_image(file: UploadFile = File(...), doctor: dict = Depends(get_current_doctor)):
    file_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    content = await file.read()
    content_type = file.content_type or 'image/jpeg'

    if AWS_S3_BUCKET:
        s3_key = f"uploads/{file_id}{file_ext}"
        image_url = upload_to_s3(content, s3_key, content_type)
    else:
        # Local fallback (for development)
        uploads_dir = ROOT_DIR / "uploads"
        uploads_dir.mkdir(exist_ok=True)
        file_path = uploads_dir / f"{file_id}{file_ext}"
        with open(file_path, "wb") as f:
            f.write(content)
        image_url = f"/api/uploads/{file_id}{file_ext}"

    return {"image_url": image_url, "filename": file.filename}

# Serve uploaded files (only used in local dev without S3)
@api_router.get("/uploads/{filename}")
async def get_upload(filename: str):
    file_path = ROOT_DIR / "uploads" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

# ============== AI ROUTES ==============

@api_router.post("/ai/analyse-case")
async def analyse_case(
    case_id: str,
    body: AnalyseCaseBody = None,
    doctor: dict = Depends(get_current_doctor),
):
    case = await db.cases.find_one({"id": case_id, "doctor_id": doctor['id']}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    doctor_context = (body.doctor_context if body else None) or None

    # Run RAG + AI analysis pipeline (with optional doctor brainstorm context)
    result = await analyze_case_with_ai(case, doctor_context=doctor_context)
    ai_analysis = result["ai_analysis"]
    guidelines = result["guidelines"]
    rag_metadata = result["rag_metadata"]

    # Update case with AI analysis, guidelines, and RAG metadata
    now = datetime.now(timezone.utc).isoformat()
    await db.cases.update_one(
        {"id": case_id},
        {"$set": {
            "ai_analysis": ai_analysis,
            "guidelines": guidelines,
            "rag_metadata": rag_metadata,
            "updated_at": now
        }}
    )

    # Log AI interaction (includes RAG metadata for audit)
    log_doc = {
        "id": str(uuid.uuid4()),
        "case_id": case_id,
        "doctor_id": doctor['id'],
        "analysis": ai_analysis,
        "guidelines_count": len(guidelines),
        "rag_available": rag_metadata.get("rag_available", False),
        "doctor_context_provided": bool(doctor_context),
        "created_at": now
    }
    await db.ai_logs.insert_one(log_doc)

    # Return updated case
    updated_case = await db.cases.find_one({"id": case_id}, {"_id": 0})
    return CaseResponse(**updated_case)

# ============== REPORT ROUTES ==============

@api_router.post("/reports/generate")
async def generate_report(case_id: str, doctor: dict = Depends(get_current_doctor)):
    case = await db.cases.find_one({"id": case_id, "doctor_id": doctor['id']}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")

    if AWS_S3_BUCKET:
        # Generate PDF to a temp file, upload to S3, return presigned URL
        with tempfile.TemporaryDirectory() as tmpdir:
            pdf_path = generate_case_pdf(case, doctor['name'], output_dir=tmpdir)
            pdf_filename = Path(pdf_path).name
            s3_key = f"reports/{pdf_filename}"
            with open(pdf_path, 'rb') as f:
                upload_to_s3(f.read(), s3_key, 'application/pdf')
        presigned_url = get_presigned_url(s3_key)
        return {"pdf_url": presigned_url, "pdf_filename": pdf_filename}
    else:
        # Local fallback
        pdf_path = generate_case_pdf(case, doctor['name'])
        return {"pdf_url": f"/api/reports/download/{Path(pdf_path).name}"}

@api_router.get("/reports/download/{filename}")
async def download_report(filename: str):
    if AWS_S3_BUCKET:
        # Redirect to a fresh presigned URL
        s3_key = f"reports/{filename}"
        presigned_url = get_presigned_url(s3_key)
        return RedirectResponse(url=presigned_url)
    else:
        file_path = ROOT_DIR / "reports" / filename
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Report not found")
        return FileResponse(file_path, filename=filename, media_type="application/pdf")

# ============== ROOT ROUTE ==============

@api_router.get("/")
async def root():
    return {"message": "AI Clinical Co-Pilot API", "version": "1.0.0"}

# Include router and middleware
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
