#!/usr/bin/env bash
# Render all tattoo-format fixtures at --preview and assemble a contact sheet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES="$ROOT/tools/fixtures"
OUT="$FIXTURES/renders"
BLENDER="${BLENDER:-blender}"
IMPORTER="$ROOT/public/blender-scripts/sceneImporter.py"
mkdir -p "$OUT"

for json in dramatic_uv.json; do
  name="${json%.json}"
  echo "Rendering $name..."
  cp "$IMPORTER" "$FIXTURES/sceneImporter.py"
  "$BLENDER" -b -P "$FIXTURES/sceneImporter.py" -- "$FIXTURES/$json" --preview
  if [[ -f "$FIXTURES/renders/output.png" ]]; then
    mv "$FIXTURES/renders/output.png" "$OUT/${name}.png"
  fi
done

if command -v montage >/dev/null 2>&1; then
  montage "$OUT"/*.png -tile 2x -geometry +4+4 "$OUT/contact-sheet.png"
  echo "Contact sheet: $OUT/contact-sheet.png"
else
  echo "Rendered PNGs in $OUT (install ImageMagick montage for contact sheet)"
fi
