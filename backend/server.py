from fastapi import FastAPI, APIRouter, HTTPException, Depends, UploadFile, File, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from fastapi.responses import FileResponse
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta
import jwt
import bcrypt
import json
import re

# Load environment
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Config
JWT_SECRET = os.environ.get('JWT_SECRET', 'clinical-copilot-secret')
JWT_ALGORITHM = os.environ.get('JWT_ALGORITHM', 'HS256')
JWT_EXPIRATION_HOURS = int(os.environ.get('JWT_EXPIRATION_HOURS', 24))

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

class DoctorLogin(BaseModel):
    email: EmailStr
    password: str

class DoctorResponse(BaseModel):
    id: str
    name: str
    email: str
    qualification: str
    location: str
    created_at: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    doctor: DoctorResponse

class VitalsInput(BaseModel):
    temperature: Optional[str] = None
    bp: Optional[str] = None
    pulse: Optional[str] = None

class CaseCreate(BaseModel):
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

class CaseResponse(BaseModel):
    id: str
    doctor_id: str
    symptoms: List[str]
    duration: str
    vitals: dict
    clinical_notes: Optional[str]
    prescription_data: Optional[dict]
    image_url: Optional[str]
    ai_analysis: Optional[dict]
    created_at: str
    updated_at: str

class PrescriptionExtractResponse(BaseModel):
    medications: List[dict]
    raw_text: str
    confidence: float

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

async def analyze_case_with_ai(case_data: dict) -> dict:
    """Use Gemini 3 Flash to analyze clinical case"""
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    
    api_key = os.environ.get('EMERGENT_LLM_KEY')
    if not api_key:
        logger.error("EMERGENT_LLM_KEY not found")
        raise HTTPException(status_code=500, detail="AI service not configured")
    
    system_prompt = """You are a senior experienced physician assisting a rural general practitioner.
You are NOT diagnosing patients.
You provide clinical decision support only.
Use conservative, medically responsible language.
Never provide definitive diagnoses.
Always present possibilities, considerations, and safety-oriented red flags.
Maintain professional doctor-to-doctor tone.

IMPORTANT: You MUST respond with ONLY valid JSON in this exact format, no additional text:
{
  "clinical_summary": "Brief summary of the case presentation",
  "considerations": ["Consideration 1", "Consideration 2"],
  "red_flags": ["Red flag 1 if any"],
  "prescription_review": ["Review point 1 if prescription provided"],
  "next_steps": ["Recommended next step 1", "Recommended next step 2"]
}"""

    symptoms_str = ", ".join(case_data.get('symptoms', []))
    vitals = case_data.get('vitals', {})
    vitals_str = f"Temperature: {vitals.get('temperature', 'N/A')}, BP: {vitals.get('bp', 'N/A')}, Pulse: {vitals.get('pulse', 'N/A')}"
    
    prescription_info = ""
    if case_data.get('prescription_data'):
        prescription_info = f"\nPrescription: {json.dumps(case_data['prescription_data'])}"
    
    user_prompt = f"""Please analyze this clinical case:

Symptoms: {symptoms_str}
Duration: {case_data.get('duration', 'Not specified')}
Vitals: {vitals_str}
Clinical Notes: {case_data.get('clinical_notes', 'None provided')}{prescription_info}

Generate a clinical decision support response in the exact JSON format specified."""

    try:
        chat = LlmChat(
            api_key=api_key,
            session_id=f"case-{uuid.uuid4()}",
            system_message=system_prompt
        ).with_model("gemini", "gemini-3-flash-preview")
        
        user_message = UserMessage(text=user_prompt)
        response = await chat.send_message(user_message)
        
        # Parse JSON from response
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            result = json.loads(json_match.group())
            # Validate structure
            return {
                "clinical_summary": result.get("clinical_summary", "Analysis completed"),
                "considerations": result.get("considerations", []),
                "red_flags": result.get("red_flags", []),
                "prescription_review": result.get("prescription_review", []),
                "next_steps": result.get("next_steps", [])
            }
        else:
            logger.error(f"Failed to parse AI response: {response}")
            return {
                "clinical_summary": "AI analysis completed. Please review the case details.",
                "considerations": ["Manual clinical review recommended"],
                "red_flags": [],
                "prescription_review": [],
                "next_steps": ["Continue standard clinical evaluation"]
            }
            
    except Exception as e:
        logger.error(f"AI analysis error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")

# ============== OCR SERVICE (Mock) ==============

def mock_ocr_extract(filename: str) -> dict:
    """Mock OCR extraction for prescription images"""
    # Simulated prescription extraction
    mock_medications = [
        {"name": "Amoxicillin", "dosage": "500mg", "frequency": "3x daily", "duration": "7 days"},
        {"name": "Paracetamol", "dosage": "650mg", "frequency": "As needed", "duration": "PRN"}
    ]
    
    return {
        "medications": mock_medications,
        "raw_text": f"Extracted from {filename}: Rx - Amoxicillin 500mg TID x 7 days, Paracetamol 650mg PRN",
        "confidence": 0.85
    }

# ============== PDF SERVICE ==============

def generate_case_pdf(case_data: dict, doctor_name: str) -> str:
    """Generate PDF report for a case"""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
    
    # Create reports directory
    reports_dir = ROOT_DIR / "reports"
    reports_dir.mkdir(exist_ok=True)
    
    filename = f"case_report_{case_data['id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.pdf"
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
        created_at=doctor['created_at']
    )

# ============== CASE ROUTES ==============

@api_router.post("/cases/create", response_model=CaseResponse)
async def create_case(data: CaseCreate, doctor: dict = Depends(get_current_doctor)):
    case_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    
    case_doc = {
        "id": case_id,
        "doctor_id": doctor['id'],
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
    # Save file temporarily
    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    
    file_path = uploads_dir / f"{uuid.uuid4()}_{file.filename}"
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Mock OCR extraction
    result = mock_ocr_extract(file.filename)
    
    return PrescriptionExtractResponse(**result)

@api_router.post("/cases/upload-image")
async def upload_image(file: UploadFile = File(...), doctor: dict = Depends(get_current_doctor)):
    uploads_dir = ROOT_DIR / "uploads"
    uploads_dir.mkdir(exist_ok=True)
    
    file_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    file_path = uploads_dir / f"{file_id}{file_ext}"
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    # Return relative URL
    return {"image_url": f"/api/uploads/{file_id}{file_ext}", "filename": file.filename}

# Serve uploaded files
@api_router.get("/uploads/{filename}")
async def get_upload(filename: str):
    file_path = ROOT_DIR / "uploads" / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

# ============== AI ROUTES ==============

@api_router.post("/ai/analyse-case")
async def analyse_case(case_id: str, doctor: dict = Depends(get_current_doctor)):
    case = await db.cases.find_one({"id": case_id, "doctor_id": doctor['id']}, {"_id": 0})
    if not case:
        raise HTTPException(status_code=404, detail="Case not found")
    
    # Run AI analysis
    ai_result = await analyze_case_with_ai(case)
    
    # Update case with AI analysis
    now = datetime.now(timezone.utc).isoformat()
    await db.cases.update_one(
        {"id": case_id},
        {"$set": {"ai_analysis": ai_result, "updated_at": now}}
    )
    
    # Log AI interaction
    log_doc = {
        "id": str(uuid.uuid4()),
        "case_id": case_id,
        "doctor_id": doctor['id'],
        "analysis": ai_result,
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
    
    # Generate PDF
    pdf_path = generate_case_pdf(case, doctor['name'])
    
    return {"pdf_url": f"/api/reports/download/{Path(pdf_path).name}"}

@api_router.get("/reports/download/{filename}")
async def download_report(filename: str):
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
