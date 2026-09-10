#!/usr/bin/env bash
# Same contract in, same PNG out as tools/render-local.sh -- but rendered by
# the render server instead of local Blender. With tools/pod-sync.sh holding
# the tunnel that server is the Pod's GPU.
#
#   ./tools/render-remote.sh smartink-live/contract.json
#   RENDER_URL=http://localhost:8000 ./tools/render-remote.sh path/to/c.json
#
# Uses the same /render-v2 endpoint the app posts to, so a render fired from
# here exercises exactly the path a user's render takes.
set -euo pipefail

JSON="${1:-}"
if [[ -z "$JSON" || ! -f "$JSON" ]]; then
  echo "usage: $0 path/to/contract.json" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$(cd "$(dirname "$JSON")" && pwd)"
RENDER_URL="${RENDER_URL:-http://localhost:8000}"

# The server takes the ink layer as a separate upload. Prefer one sitting
# beside the contract, as sceneImporter expects locally.
INK="$DIR/ink.png"
[[ -f "$INK" ]] || INK="$ROOT/smartink-live/ink.png"
if [[ ! -f "$INK" ]]; then
  echo "error: no ink.png beside $JSON or in smartink-live/" >&2
  exit 1
fi

if ! curl -fsS -m 10 "$RENDER_URL/health" >/dev/null 2>&1; then
  cat >&2 <<EOF
error: no render server at $RENDER_URL

If you meant the Pod, check that:
  - tools/pod-sync.sh is running (it holds the tunnel), and
  - start-render-server.sh is up on the Pod.
EOF
  exit 1
fi

OUT_DIR="$DIR/renders"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/output.png"

echo "Rendering $(basename "$JSON") via $RENDER_URL ..."
start=$SECONDS
code=$(curl -sS -o "$OUT.part" -w '%{http_code}' \
  --max-time "${RENDER_TIMEOUT:-1800}" \
  -F "contract=@$JSON" \
  -F "ink_layer=@$INK" \
  "$RENDER_URL/render-v2") || { rm -f "$OUT.part"; exit 1; }

if [[ "$code" != "200" ]]; then
  echo "render failed (HTTP $code):" >&2
  head -c 2000 "$OUT.part" >&2; echo >&2
  rm -f "$OUT.part"
  exit 1
fi

mv "$OUT.part" "$OUT"
echo "Rendered in $((SECONDS - start))s -> $OUT"
open "$OUT" 2>/dev/null || true
