#!/bin/bash
# ============================================================
# create_backend_zip.sh
# Packages the backend into a deployment-ready zip for
# AWS Elastic Beanstalk.
#
# Usage:
#   cd /path/to/Doco-ai
#   bash backend/create_backend_zip.sh
#
# Output:
#   backend_deploy.zip  (in the repo root)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_ZIP="$REPO_ROOT/backend_deploy.zip"

echo "📦  Packaging backend for Elastic Beanstalk..."

# Remove old zip if present
rm -f "$OUTPUT_ZIP"

cd "$SCRIPT_DIR"

zip -r "$OUTPUT_ZIP" . \
  --exclude "*.pyc" \
  --exclude "__pycache__/*" \
  --exclude ".DS_Store" \
  --exclude "venv/*" \
  --exclude ".venv/*" \
  --exclude "uploads/*" \
  --exclude "reports/*" \
  --exclude ".env" \
  --exclude "*.egg-info/*" \
  --exclude "*.log"

echo ""
echo "✅  Done! Created: $OUTPUT_ZIP"
echo ""
echo "Contents:"
unzip -l "$OUTPUT_ZIP" | head -40
echo ""
echo "Next steps:"
echo "  1. Go to AWS Elastic Beanstalk Console"
echo "  2. Create / open your environment"
echo "  3. Upload & deploy  backend_deploy.zip"
echo "  4. Set all required environment variables in"
echo "     Configuration → Software → Environment Properties"
echo "     (see backend/.env.example for the full list)"
