#!/usr/bin/env bash
# Usage: ./tools/render-local.sh path/to/contract.json
set -euo pipefail
JSON="$1"; shift || true
DIR="$(cd "$(dirname "$JSON")" && pwd)"
SCRIPT="$DIR/sceneImporter.py"
BLENDER="${BLENDER:-blender}"

if [[ ! -f "$SCRIPT" ]]; then
  ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  if [[ -f "$ROOT/smartink-live/sceneImporter.py" ]]; then
    SCRIPT="$ROOT/smartink-live/sceneImporter.py"
  else
    SCRIPT="$ROOT/public/blender-scripts/sceneImporter.py"
  fi
fi

"$BLENDER" -b -P "$SCRIPT" -- "$JSON" "$@"
open "$DIR/renders/output.png" 2>/dev/null || true
