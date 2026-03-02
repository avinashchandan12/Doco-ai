#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
RELOAD="${RELOAD:-1}"

python3 -m pip install -r requirements.txt

if [[ "$RELOAD" == "1" ]]; then
  exec python3 -m uvicorn server:app --host "$HOST" --port "$PORT" --reload
else
  exec python3 -m uvicorn server:app --host "$HOST" --port "$PORT"
fi
