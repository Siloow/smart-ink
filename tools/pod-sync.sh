#!/usr/bin/env bash
# Push smartink-live/ to the Pod, then hold open an SSH tunnel to its render
# server so both the app and tools/render-remote.sh can reach it at
# http://localhost:8000 without the Pod exposing a port to the internet.
#
#   export POD="root@213.1.2.3 -p 40022"      # from the RunPod SSH panel
#   ./tools/pod-sync.sh                        # sync, then tunnel (blocks)
#   ./tools/pod-sync.sh --no-tunnel            # sync only
#
# The Pod's server binds 127.0.0.1, so the tunnel is the only way in. Keep this
# running in its own terminal while you work.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
POD="${POD:-}"
REMOTE_DIR="${REMOTE_DIR:-/workspace/smart-ink}"
PORT="${RENDER_PORT:-8000}"
TUNNEL=1
[[ "${1:-}" == "--no-tunnel" ]] && TUNNEL=0

if [[ -z "$POD" ]]; then
  cat >&2 <<'EOF'
error: set POD to the Pod's SSH target, e.g.
    export POD="root@213.1.2.3 -p 40022"
Copy it from the RunPod dashboard's "Connect" panel.
EOF
  exit 1
fi

# POD carries its own -p flag, so it must stay unquoted here.
# shellcheck disable=SC2086
ssh_pod() { ssh $POD "$@"; }

echo "Syncing to $POD:$REMOTE_DIR ..."
ssh_pod "mkdir -p '$REMOTE_DIR'"

# rsync needs the port as part of its -e command, not as a trailing arg.
host="${POD%% *}"
sshport="$(printf '%s\n' "$POD" | sed -n 's/.*-p[[:space:]]*\([0-9]\{1,\}\).*/\1/p')"
RSH="ssh${sshport:+ -p $sshport}"

# Meshes and .blend files are large and rarely change; --update skips
# re-sending anything the Pod already has a newer copy of. Renders and
# __pycache__ are outputs, not inputs.
rsync -az --update --info=progress2 -e "$RSH" \
  --exclude 'renders/' \
  --exclude '__pycache__/' \
  --exclude '.DS_Store' \
  "$ROOT/smartink-live/" "$host:$REMOTE_DIR/smartink-live/"

rsync -az --update -e "$RSH" \
  "$ROOT/server/" "$host:$REMOTE_DIR/server/" \
  --exclude '.venv/' --exclude '__pycache__/'
rsync -az --update -e "$RSH" \
  "$ROOT/tools/" "$host:$REMOTE_DIR/tools/" --exclude '__pycache__/'

echo "Synced."

if [[ "$TUNNEL" -eq 0 ]]; then
  echo "Start the server on the Pod with:"
  echo "  ssh $POD 'cd $REMOTE_DIR && tools/start-render-server.sh'"
  exit 0
fi

cat <<EOF

Tunnel: http://localhost:$PORT -> Pod:$PORT
Start the server on the Pod in another terminal if it is not already up:
  ssh $POD 'cd $REMOTE_DIR && tools/start-render-server.sh'

Ctrl-C closes the tunnel.
EOF

# -N: no remote command, just forward. ExitOnForwardFailure so a port already
# in use fails loudly instead of silently tunnelling nowhere.
# shellcheck disable=SC2086
exec ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
  -L "$PORT:localhost:$PORT" $POD
