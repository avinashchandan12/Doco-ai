# AI Clinical Co-Pilot: System Architecture

## Overview
The **AI Clinical Co-Pilot** is a cloud-native clinical decision support platform. It assists rural general practitioners in analyzing patient cases, extracting prescriptions via OCR, and generating AI-powered clinical insights using Google Gemini. The system is fully deployed on AWS with a serverless frontend and containerized backend.

---

## Deployed AWS Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER (Browser)                          │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              AWS Amplify (Frontend Hosting)                      │
│  URL: https://main.d1mrd385bumfov.amplifyapp.com                │
│  • React SPA (static build served via CDN)                      │
│  • CI/CD via GitHub (main branch auto-deploys)                  │
│  • Build config: amplify.yml (appRoot: frontend)                │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS API calls
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              AWS CloudFront (HTTPS Termination)                  │
│  URL: https://d1715vumfk0ih3.cloudfront.net                     │
│  • Provides HTTPS to the browser (mixed-content fix)            │
│  • Cache policy: CachingDisabled (API bypass)                   │
│  • Origin request policy: AllViewer                             │
│  • Origin: EB backend via HTTP on port 80                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP (AWS internal)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│         AWS Elastic Beanstalk (Backend — FastAPI)               │
│  URL: http://doco-ai-be-env.eba-aavdds9g.ap-south-1.            │
│         elasticbeanstalk.com                                     │
│  • Python 3.14 on Amazon Linux 2023                             │
│  • Uvicorn ASGI server on port 8000                             │
│  • Nginx reverse proxy (EB-managed)                             │
│  • Procfile: uvicorn server:app --host 0.0.0.0 --port 8000      │
│  • Deployed via backend_deploy.zip                              │
└─────────┬────────────────────────────────────┬──────────────────┘
          │                                     │
          ▼                                     ▼
┌──────────────────────┐          ┌─────────────────────────────┐
│  MongoDB Atlas       │          │  AWS S3 (File Storage)       │
│  (Cloud Database)    │          │  • Prescription images        │
│  • Cluster: ap-south │          │  • Clinical photos            │
│  • Collections:      │          │  • Generated PDFs             │
│    - doctors         │          └─────────────────────────────┘
│    - cases           │
│    - ai_logs         │          ┌─────────────────────────────┐
│  • Network Access:   │          │  Google Gemini API           │
│    0.0.0.0/0         │          │  Model: gemini-3-flash-preview│
│    (whitelist EB IP  │          │  • Clinical case analysis     │
│    in production)    │          │  • Structured JSON output     │
└──────────────────────┘          └─────────────────────────────┘
```

---

## Technology Stack

### Frontend
| Layer | Technology |
|---|---|
| Framework | React (CRA + CRACO) |
| Routing | React Router v6 |
| Styling | Tailwind CSS |
| HTTP Client | Axios |
| Hosting | AWS Amplify |

### Backend
| Layer | Technology |
|---|---|
| Framework | FastAPI (async) |
| Runtime | Python 3.14 on Amazon Linux 2023 |
| ASGI Server | Uvicorn |
| Reverse Proxy | Nginx (EB-managed) |
| Database Driver | Motor (async pymongo) |
| Authentication | JWT + bcrypt |
| AI | Google Gemini 3 Flash Preview |
| PDF Generation | ReportLab |
| File Storage | AWS S3 (boto3) |

### Infrastructure
| Component | Service | Role |
|---|---|---|
| Frontend Hosting | AWS Amplify | CI/CD + CDN for React SPA |
| Backend Hosting | AWS Elastic Beanstalk | Managed Python platform |
| HTTPS Layer | AWS CloudFront | TLS termination for EB backend |
| Database | MongoDB Atlas | Managed NoSQL cloud DB |
| File Storage | AWS S3 | Blob storage for uploads & PDFs |
| AI | Google Gemini API | Clinical LLM analysis |

---

## API Endpoints

| Route | Method | Auth | Description |
|---|---|---|---|
| `/api/auth/signup` | POST | ❌ | Register a new doctor |
| `/api/auth/login` | POST | ❌ | Authenticate, receive JWT |
| `/api/doctor/profile` | GET | ✅ | Fetch doctor profile |
| `/api/cases/create` | POST | ✅ | Create new patient case |
| `/api/cases/list` | GET | ✅ | List all doctor's cases |
| `/api/cases/{id}` | GET/PUT | ✅ | Get or update case |
| `/api/cases/upload-prescription` | POST | ✅ | Upload & extract Rx image |
| `/api/cases/upload-image` | POST | ✅ | Upload clinical image to S3 |
| `/api/ai/analyse-case` | POST | ✅ | Trigger Gemini AI analysis |
| `/api/reports/generate` | POST | ✅ | Generate PDF case report |
| `/api/reports/download/{id}` | GET | ✅ | Download generated PDF |

---

## Data Flow

```
Doctor fills case form
        │
        ▼
POST /cases/create → MongoDB (cases collection)
        │
        ▼
POST /cases/upload-image → S3 bucket → URL stored in case doc
        │
        ▼
POST /ai/analyse-case
        │
        ├── Fetch case from MongoDB
        ├── Build clinical prompt with vitals, symptoms, notes
        ├── Call Gemini 3 Flash Preview API
        ├── Parse structured JSON response
        ├── Update case doc with AI analysis
        └── Log to ai_logs collection
        │
        ▼
POST /reports/generate → ReportLab PDF → S3 upload → download URL
```

---

## Environment Variables (EB Configuration)

| Variable | Description |
|---|---|
| `MONGO_URL` | MongoDB Atlas connection string |
| `DB_NAME` | Database name (`doco_ai`) |
| `JWT_SECRET` | JWT signing secret |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRATION_HOURS` | `24` |
| `GEMINI_API_KEY` | Google Gemini API key |
| `CORS_ORIGINS` | Allowed frontend origin (Amplify URL) |
| `AWS_ACCESS_KEY_ID` | S3 access key |
| `AWS_SECRET_ACCESS_KEY` | S3 secret key |
| `AWS_REGION` | `ap-south-1` |
| `S3_BUCKET_NAME` | S3 bucket for uploads |

---

## Planned: RAG (Retrieval-Augmented Generation) Module

### Goal
Augment Gemini's clinical analysis with **domain-specific medical knowledge** — clinical guidelines, drug interactions, ICD-10 codes, and WHO protocols — retrieved in real-time from a vector database.

### Proposed Architecture

```
Doctor triggers AI analysis
        │
        ▼
RAG Pipeline
  ├── 1. EMBED: Convert case query → vector embedding
  │         (via Google text-embedding-004 model)
  │
  ├── 2. RETRIEVE: Search vector DB for top-K relevant docs
  │         • Medical guidelines (WHO, ICMR)
  │         • Drug interaction databases
  │         • ICD-10 / symptom reference sheets
  │
  ├── 3. AUGMENT: Inject retrieved context into Gemini prompt
  │
  └── 4. GENERATE: Gemini 3 Flash produces grounded response
```

### Proposed Stack

| Component | Technology | Hosting |
|---|---|---|
| Vector Database | **AWS OpenSearch** (with k-NN plugin) | AWS managed |
| Embedding Model | Google `text-embedding-004` | Gemini API |
| Document Ingestion | Python script (chunking + embedding) | Lambda / one-time job |
| Knowledge Base | WHO guidelines, ICMR protocols, drug DBs | S3 → OpenSearch |
| RAG Orchestration | **LangChain** or direct pymongo vector search | EB backend |

### Alternative: MongoDB Atlas Vector Search
MongoDB Atlas natively supports vector search — meaning **no new infrastructure** is needed. We can store embeddings directly in the `cases` or a new `knowledge_base` collection and query using Atlas Vector Search.

**Recommended approach (lower cost):**
1. Add `vector_embedding` field to `knowledge_base` collection in MongoDB Atlas
2. Enable **Atlas Vector Search** index on the collection
3. Embed medical documents using Google `text-embedding-004`
4. At query time, embed the case context and run `$vectorSearch` against the knowledge base
5. Inject top-5 retrieved chunks into the Gemini prompt

### Implementation Plan (Phases)

| Phase | Task | Effort |
|---|---|---|
| **Phase 1** | Build knowledge base ingestion script (PDF → chunks → embeddings → Atlas) | 2-3 days |
| **Phase 2** | Enable Atlas Vector Search index on `knowledge_base` collection | 1 hour |
| **Phase 3** | Add RAG retrieval function to `server.py` (embed query → $vectorSearch → augment prompt) | 1 day |
| **Phase 4** | Test with WHO clinical guidelines and ICMR protocols | 1 day |
| **Phase 5** | Add admin endpoint to upload new knowledge base documents | 1 day |
