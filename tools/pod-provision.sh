#!/usr/bin/env bash
# Run ON the RunPod instance, once, to make it able to render.
#   ssh root@<ip> -p <port> 'bash -s' < tools/pod-provision.sh
#
# Installs headless Blender and the X libraries it links even with -b, then
# proves Cycles can see the GPU through OptiX. Anything that gets us to a
# working `blender` is fine; the OptiX check at the end is the real test.
set -euo pipefail

BLENDER_SERIES="${BLENDER_SERIES:-4.2}"
BLENDER_VERSION="${BLENDER_VERSION:-4.2.1}"
PREFIX="${PREFIX:-/opt}"
TARBALL="blender-${BLENDER_VERSION}-linux-x64"
URL="https://download.blender.org/release/Blender${BLENDER_SERIES}/${TARBALL}.tar.xz"

if command -v blender >/dev/null 2>&1; then
  echo "blender already present: $(command -v blender)"
else
  echo "Installing system libraries..."
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  # Headless Blender still links these; without them it dies with an opaque
  # loader error rather than anything mentioning X.
  apt-get install -y -qq --no-install-recommends \
    libxrender1 libxi6 libxkbcommon0 libsm6 libxxf86vm1 libxfixes3 libgl1 \
    xz-utils wget rsync >/dev/null

  echo "Installing Blender ${BLENDER_VERSION}..."
  wget -qO- "$URL" | tar -xJ -C "$PREFIX"
  ln -sfn "${PREFIX}/${TARBALL}/blender" /usr/local/bin/blender
fi

blender --version | head -1

echo
echo "=== GPU ==="
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader || {
  echo "nvidia-smi failed: this Pod has no visible GPU." >&2
  exit 1
}

echo
echo "=== Cycles OptiX devices ==="
# --factory-startup so a stray user preference cannot mask the real answer.
blender -b --factory-startup -noaudio --python-expr "
import bpy
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = 'OPTIX'
prefs.get_devices()
names = [d.name for d in prefs.devices if d.type == 'OPTIX']
print('OPTIX_DEVICES=' + (', '.join(names) if names else 'NONE'))
" 2>/dev/null | grep '^OPTIX_DEVICES=' || {
  echo "Could not query Cycles devices." >&2
  exit 1
}

echo
echo "Done. If OPTIX_DEVICES lists your card, sync assets with tools/pod-sync.sh."
