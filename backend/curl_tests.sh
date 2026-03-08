#!/usr/bin/env bash
# Curl commands to test the API locally. Replace TOKEN and CASE_ID as needed.
# Backend must be running: cd backend && uvicorn server:app --reload --port 8000

BASE="http://localhost:8000/api"

# 1) API root
curl -s "$BASE/" | jq .

# 2) Signup (get a token)
# curl -s -X POST "$BASE/auth/signup" \
#   -H "Content-Type: application/json" \
#   -d '{"name":"Test Doctor","email":"test@example.com","password":"test123","qualification":"MBBS","location":"Mumbai"}'

# 3) Login (get token for other requests)
# curl -s -X POST "$BASE/auth/login" \
#   -H "Content-Type: application/json" \
#   -d '{"email":"test@example.com","password":"test123"}'
# Copy access_token from response → set TOKEN="<that value>"

TOKEN="YOUR_JWT_TOKEN_HERE"

# 4) Doctor profile (requires auth)
# curl -s "$BASE/doctor/profile" -H "Authorization: Bearer $TOKEN" | jq .

# 5) Create a case (requires auth)
# curl -s -X POST "$BASE/cases/create" \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"symptoms":["fever","cough"],"duration":"3 days","vitals":{},"clinical_notes":"Mild fever"}' | jq .
# Copy "id" from response → set CASE_ID="<that value>"

CASE_ID="YOUR_CASE_ID_HERE"

# 6) List cases
# curl -s "$BASE/cases/list" -H "Authorization: Bearer $TOKEN" | jq .

# 7) Get one case
# curl -s "$BASE/cases/$CASE_ID" -H "Authorization: Bearer $TOKEN" | jq .

# 8) Test RAG only (no AI analysis)
# curl -s -X POST "$BASE/ai/test-rag" \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d "{\"case_id\":\"$CASE_ID\"}" | jq .

# 9) Test RAG with inline case data (no case in DB needed)
# curl -s -X POST "$BASE/ai/test-rag" \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{"case_data":{"symptoms":["fever","cough"],"duration":"3 days","vitals":{},"clinical_notes":"Mild fever"}}' | jq .

# 10) Run AI analysis on a case
# curl -s -X POST "$BASE/ai/analyse-case?case_id=$CASE_ID" \
#   -H "Authorization: Bearer $TOKEN" \
#   -H "Content-Type: application/json" \
#   -d '{}' | jq .
