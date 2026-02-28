# AI Clinical Co-Pilot: Backend Architecture

## Overview
The backend for the **AI Clinical Co-Pilot** is built using **FastAPI**, providing a high-performance, asynchronous REST API. It is designed to act as a clinical decision support system, assisting doctors in analyzing cases, securely managing patient records, and interacting with AI models for diagnosis suggestions based on clinical inputs.

## Technology Stack
- **Framework:** FastAPI (Asynchronous, Type-safe REST API)
- **Database:** MongoDB (using `motor` for async interactions)
- **Authentication:** JWT (JSON Web Tokens) with `bcrypt` for password hashing
- **AI Integration:** Google Gemini 3 Flash (via the `emergentintegrations` SDK)
- **PDF Generation:** ReportLab
- **Server/ASGI:** Uvicorn
- **Environment Management:** `python-dotenv`

## Directory Structure
The core backend lies within the `backend/` directory:
- `server.py`: The single entry point containing the full application logic, routing, schemas, and service integrations.
- `requirements.txt`: Python package dependencies.
- `reports/`: Directory dynamically created to store generated case report PDFs.
- `uploads/`: Directory dynamically created to handle uploaded prescription files and clinical images.
- `.env`: Environment variables configuration file (loaded on startup).

## Core Components & Modules

### 1. Data Models (Pydantic Schemas)
Validation and serialization are heavily enforced using Pydantic models.
- **Authentication:** `DoctorSignup`, `DoctorLogin`, `DoctorResponse`, `TokenResponse`
- **Clinical Cases:** `CaseCreate` (symptoms, vitals, duration), `CaseResponse`, `VitalsInput`
- **AI Analysis:** `AIAnalysisResult` (structured response for clinical summary, red flags, considerations, next steps)
- **Uploads:** `PrescriptionExtractResponse`

### 2. Authentication & Authorization
- **Mechanism:** Bearer HTTP token.
- **Implementation:** `get_current_doctor` dependency decoding JWT tokens and authenticating requests by verifying the doctor's record from MongoDB.
- **Security:** Passwords are hashed/salted via bcrypt before being stored in the `doctors` collection.

### 3. Services

#### AI Service (`analyze_case_with_ai`)
- Integrates with Google Gemini via `emergentintegrations.llm.chat`.
- System prompt restricts AI to non-diagnostic, decision-support mode only, aiming for conservative, medically responsible language.
- Enforces strict JSON responses containing `clinical_summary`, `considerations`, `red_flags`, `prescription_review`, and `next_steps`.

#### OCR Service (Mock)
- A placeholder mock function (`mock_ocr_extract`) simulates extracting text and medication details from uploaded prescription images.

#### PDF Generation Service (`generate_case_pdf`)
- Uses `ReportLab` to programmatically build an A4 formatted case report.
- Includes patient vitals, symptoms, doctor details, AI interpretations, and strict AI disclaimers into the final PDF.

### 4. API Routing
The application groups endpoints under the `/api` prefix.

| Prefix / Route | Method | Description |
|----------------|--------|-------------|
| **Auth Routes** | | |
| `/auth/signup` | POST | Register a new doctor. Returns a JWT token. |
| `/auth/login` | POST | Authenticate existing doctor. |
| **Doctor Routes** | | |
| `/doctor/profile`| GET | Fetch profile details of the authenticated doctor. |
| **Case Routes** | | |
| `/cases/create` | POST | Register a new case against the doctor. |
| `/cases/list` | GET | List all cases belonging to the doctor (latest first). |
| `/cases/{id}` | GET/PUT| Retrieve or update a specific case. |
| **Upload Routes** | | |
| `/cases/upload-prescription` | POST | Upload an Rx image and extract text (mock OCR). |
| `/cases/upload-image` | POST | Upload generic clinical imagery; returns relative URL. |
| `/uploads/{name}` | GET | Serve the uploaded file locally. |
| **AI Routes** | | |
| `/ai/analyse-case`| POST | Triggers AI case analysis and updates the specific case document. Logs interaction to `ai_logs`. |
| **Report Routes** | | |
| `/reports/generate`| POST | Generates the PDF case summary locally. |
| `/reports/download/{id}` | GET | Serves the generated PDF file from the `reports/` directory. |

## Data Persistence (MongoDB)
The database structure is primarily composed of three collections:
1. **`doctors`**: Stores physician accounts, credentials, and profile information.
2. **`cases`**: The central collection storing patient data, clinical notes, attached symptoms, vitals, prescription data, and the final extracted AI analysis.
3. **`ai_logs`**: An auditing collection that tracks all interactions and analyses performed by the LLM for compliance and history.

## Environment Variables required
To run the server correctly, you must specify the following in `.env`:
- `MONGO_URL`: MongoDB connection string.
- `DB_NAME`: Database name.
- `JWT_SECRET`: Secret key for JWT signing.
- `EMERGENT_LLM_KEY`: API Key for the AI service.
- `CORS_ORIGINS`: Allowed origins (e.g., frontend host URL).

## Architecture Flow
1. **Frontend App** sends a `POST /auth/login` request.
2. **FastAPI (`server.py`)** validates credentials with **MongoDB** and issues a JWT.
3. The Doctor uploads patient details (`POST /cases/create`) and optional imagery (`POST /cases/upload-image`).
4. The Doctor triggers AI analysis (`POST /ai/analyse-case`).
5. **AI Service** passes an aggressively prompted context to **Gemini 3 Flash**. The structured response is logged to `ai_logs` and attached to the case in `cases` collection.
6. The Doctor optionally requests a case report (`POST /reports/generate`), which invokes `ReportLab` to combine data and output a PDF to the `reports/` folder.
