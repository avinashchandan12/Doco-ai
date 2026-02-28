# Doco-ai AWS Deployment Guide

Deployment stack:
| Layer | Service |
|---|---|
| Frontend | AWS Amplify |
| Backend | AWS Elastic Beanstalk (FastAPI + uvicorn) |
| Database | MongoDB Atlas |
| File Storage | AWS S3 |

---

## Prerequisites

- AWS Account with Amplify + Elastic Beanstalk + S3 access
- MongoDB Atlas cluster running
- IAM user with S3 read/write permissions
- Node.js + yarn (for frontend build)
- Python 3.11 (for backend)

---

## Step 1 — MongoDB Atlas Setup

1. Create a free cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas)
2. Create a database user and note the credentials
3. Whitelist  `0.0.0.0/0` (or your EB IP range) in Network Access
4. Copy the connection string — you'll need it as `MONGO_URL`
5. Set `DB_NAME` to `doco_ai` (or your preferred database name)

---

## Step 2 — AWS S3 Bucket Setup

1. Create an S3 bucket (e.g., `doco-ai-files`)
2. **Block all public access** (the app uses pre-signed URLs)
3. Create an IAM user with the following inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::doco-ai-files/*"
    }
  ]
}
```

4. Generate **Access Key ID** and **Secret Access Key** for that IAM user
5. Note your bucket name and region

---

## Step 3 — Backend Deployment (Elastic Beanstalk)

### 3a. Create the deployment zip

```bash
# From the repo root:
bash backend/create_backend_zip.sh
```

This creates `backend_deploy.zip` in the repo root (excludes venv, .env, uploads, reports).

### 3b. Create an Elastic Beanstalk environment

1. Go to **AWS Elastic Beanstalk Console**
2. Create Application → name it `doco-ai`
3. Create Environment:
   - Platform: **Python 3.11**
   - Application code: Upload `backend_deploy.zip`
4. Wait for environment to launch (green health)

### 3c. Set Environment Variables

In the EB Console → **Configuration → Software → Environment Properties**, add:

| Key | Value |
|---|---|
| `MONGO_URL` | `mongodb+srv://...` |
| `DB_NAME` | `doco_ai` |
| `JWT_SECRET` | a long random string |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRATION_HOURS` | `24` |
| `EMERGENT_LLM_KEY` | your API key |
| `AWS_S3_BUCKET` | `doco-ai-files` |
| `AWS_ACCESS_KEY_ID` | from IAM user |
| `AWS_SECRET_ACCESS_KEY` | from IAM user |
| `AWS_REGION` | e.g. `ap-south-1` |
| `CORS_ORIGINS` | your Amplify URL (set after Step 4) |

> [!IMPORTANT]
> After adding env vars, click **Apply** and wait for the environment to update.

### 3d. Note your backend URL

It will look like:
```
http://doco-ai-env.eba-xxxxxxxx.ap-south-1.elasticbeanstalk.com
```

---

## Step 4 — Frontend Deployment (AWS Amplify)

### 4a. Connect repo

1. Go to **AWS Amplify Console** → **New app → Host web app**
2. Connect your Git repository (GitHub / GitLab / Bitbucket)
3. Select the branch to deploy (e.g., `main`)
4. Amplify will auto-detect `amplify.yml` — confirm the build settings

### 4b. Set Environment Variables

In **Amplify Console → App Settings → Environment Variables**:

| Variable | Value |
|---|---|
| `REACT_APP_BACKEND_URL` | the EB URL from Step 3d (no trailing slash) |

### 4c. Deploy

Click **Save and deploy**. Amplify will:
1. Install dependencies (`yarn install`)
2. Build (`yarn build`)
3. Serve the build output from `frontend/build/`

Your app URL will look like:
```
https://main.d1abc123.amplifyapp.com
```

### 4d. Update CORS

Go back to **EB Console → Configuration → Software → Environment Properties** and update:

```
CORS_ORIGINS=https://main.d1abc123.amplifyapp.com
```

---

## Step 5 — Verification Checklist

- [ ] `GET <EB_URL>/api/` returns `{"message": "AI Clinical Co-Pilot API", "version": "1.0.0"}`
- [ ] Doctor signup `/api/auth/signup` returns a JWT token
- [ ] Image upload stores file in S3 and returns an `https://` URL
- [ ] PDF report generation returns a pre-signed S3 URL
- [ ] Frontend loads at the Amplify URL
- [ ] Frontend login/signup works (no CORS errors)

---

## Local Development

```bash
# Backend
cd backend
cp .env.example .env        # fill in your values
pip install -r requirements.txt
uvicorn server:app --reload --port 8080

# Frontend (new terminal)
cd frontend
cp .env.example .env        # set REACT_APP_BACKEND_URL=http://localhost:8080
yarn install
yarn start
```

When `AWS_S3_BUCKET` is not set in `.env`, uploaded files and reports are saved locally to `backend/uploads/` and `backend/reports/`.
