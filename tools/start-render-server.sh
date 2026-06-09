#!/usr/bin/env bash
# Local render server: /health + /render-v2 → ~/smartink-live + Blender PNG
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/server/.venv"

if [[ ! -d "$VENV" ]]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -r "$ROOT/server/requirements.txt"
fi

export SMARTINK_LIVE_DIR="${SMARTINK_LIVE_DIR:-$HOME/smartink-live}"
if [[ -z "${BLENDER:-}" && -x /Applications/Blender.app/Contents/MacOS/Blender ]]; then
  export BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
fi
export BLENDER="${BLENDER:-blender}"

echo "Live dir: $SMARTINK_LIVE_DIR"
echo "Blender:  $BLENDER"
echo "API:      http://127.0.0.1:8000  (set VITE_RENDER_URL=http://localhost:8000 in .env.local)"

exec "$VENV/bin/uvicorn" server.app:app --host 127.0.0.1 --port 8000 --app-dir "$ROOT"
