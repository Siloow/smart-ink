#!/usr/bin/env bash
# Keep repo smartink-live/ and ~/smartink-live in sync via a home-dir symlink.
# Contains sceneImporter.py, watch_dev.py, body meshes, and runtime contract/ink drops.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_LIVE="$ROOT/smartink-live"
HOME_LIVE="${SMARTINK_LIVE_HOME:-$HOME/smartink-live}"

if [[ ! -d "$REPO_LIVE" ]]; then
  echo "error: missing repo live dir: $REPO_LIVE" >&2
  exit 1
fi

mkdir -p "$REPO_LIVE/renders" "$REPO_LIVE/assets"

if [[ -L "$HOME_LIVE" ]]; then
  target="$(readlink "$HOME_LIVE")"
  if [[ "$(cd "$HOME_LIVE" && pwd -P)" == "$(cd "$REPO_LIVE" && pwd -P)" ]]; then
    echo "Already synced: $HOME_LIVE -> $REPO_LIVE"
    exit 0
  fi
  echo "Replacing stale symlink ($target) with $REPO_LIVE"
  rm "$HOME_LIVE"
elif [[ -d "$HOME_LIVE" ]]; then
  backup="${HOME_LIVE}.bak.$(date +%Y%m%d%H%M%S)"
  echo "Migrating existing $HOME_LIVE -> $REPO_LIVE (backup: $backup)"
  rsync -a --ignore-existing "$HOME_LIVE/" "$REPO_LIVE/"
  mv "$HOME_LIVE" "$backup"
elif [[ -e "$HOME_LIVE" ]]; then
  echo "error: $HOME_LIVE exists and is not a directory" >&2
  exit 1
fi

ln -sfn "$REPO_LIVE" "$HOME_LIVE"
echo "Synced: $HOME_LIVE -> $REPO_LIVE"
