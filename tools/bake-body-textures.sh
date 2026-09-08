#!/usr/bin/env bash
# Rebuild the tone-neutral skin mask set in assets/derived/ for every body mesh.
# Run after changing a body sculpt; the renderer reads these at every render.
#   ./tools/bake-body-textures.sh [--size 4096] [--maps cavity,curvature]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
SCRIPT="$ROOT/tools/bake_body_textures.py"
OUT="$ROOT/assets/derived"

if [[ ! -x "$BLENDER" ]]; then
  BLENDER="blender"
fi

# bodyMeshId -> source .blend, matching BODY_MESH_ASSETS in sceneImporter.py.
BODIES=(
  "body_male_realistic:$ROOT/smartink-live/body_full.blend"
  "body_female_realistic:$ROOT/smartink-live/body_full_female.blend"
)

for entry in "${BODIES[@]}"; do
  prefix="${entry%%:*}"
  blend="${entry#*:}"
  if [[ ! -f "$blend" ]]; then
    echo "skip $prefix: missing $blend" >&2
    continue
  fi
  echo "=== $prefix ($(basename "$blend"))"
  "$BLENDER" -b "$blend" -P "$SCRIPT" -- --prefix "$prefix" --out "$OUT" "$@"
done

echo "Baked into $OUT"
