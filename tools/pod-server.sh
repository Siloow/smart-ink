#!/usr/bin/env bash
# Manage the render server on the Pod, inside tmux so it outlives the SSH
# connection that started it.
#
#   export POD="root@213.1.2.3 -p 40022"
#   ./tools/pod-server.sh start|stop|status|logs|attach
#
# Why tmux: a render started over a plain `ssh <cmd>` is a child of that SSH
# session, so closing the laptop SIGHUPs it and a long render dies with it.
# Under tmux the server -- and anything it is rendering -- keeps going, and a
# dropped tunnel costs you only the HTTP response, not the work.
set -euo pipefail

POD="${POD:-}"
REMOTE_DIR="${REMOTE_DIR:-/workspace/smart-ink}"
SESSION="${TMUX_SESSION:-render}"
PORT="${RENDER_PORT:-8000}"
CMD="${1:-status}"

if [[ -z "$POD" ]]; then
  echo 'error: set POD, e.g. export POD="root@213.1.2.3 -p 40022"' >&2
  exit 1
fi

# POD carries its own -p flag, so it must stay unquoted.
# shellcheck disable=SC2086
ssh_pod() { ssh -o BatchMode=yes $POD "$@"; }

ensure_tmux() {
  ssh_pod 'command -v tmux >/dev/null 2>&1 || {
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq && apt-get install -y -qq tmux >/dev/null
  }'
}

case "$CMD" in
  start)
    ensure_tmux
    # -d so it starts detached; the `has-session` guard keeps this idempotent.
    ssh_pod "tmux has-session -t '$SESSION' 2>/dev/null && {
        echo 'already running in tmux session: $SESSION'; exit 0;
      }
      cd '$REMOTE_DIR' &&
      tmux new-session -d -s '$SESSION' \
        'tools/start-render-server.sh 2>&1 | tee -a /workspace/render-server.log'
      echo 'started tmux session: $SESSION'"
    # First run builds a venv and pip-installs FastAPI and uvicorn, which took
    # well over a minute on the Pod. Later starts answer in a second or two.
    echo "Waiting for the server to answer (first run installs deps, ~2 min)..."
    for i in $(seq 1 120); do
      if ssh_pod "curl -fsS -m 3 http://localhost:$PORT/health >/dev/null 2>&1"; then
        echo "Server is up on the Pod (port $PORT) after ${i}s."
        echo "Open the tunnel with: ./tools/pod-sync.sh"
        exit 0
      fi
      # Fail fast if the session died rather than waiting out the full timeout.
      if ! ssh_pod "tmux has-session -t '$SESSION' 2>/dev/null"; then
        echo "tmux session '$SESSION' exited. Check: $0 logs" >&2
        exit 1
      fi
      sleep 3
    done
    echo "Server did not answer in 6 min. Check: $0 logs" >&2
    exit 1
    ;;
  stop)
    ssh_pod "tmux kill-session -t '$SESSION' 2>/dev/null && echo stopped || echo 'not running'"
    ;;
  status)
    ssh_pod "tmux has-session -t '$SESSION' 2>/dev/null && echo 'tmux session $SESSION: running' || echo 'tmux session $SESSION: not running'
      curl -fsS -m 3 http://localhost:$PORT/health 2>/dev/null && echo || echo 'health: no answer'
      echo '--- blender ---'
      ps -eo pid,etime,comm | grep -i blender | grep -v grep || echo 'no blender process'
      echo '--- gpu ---'
      nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader"
    ;;
  logs)
    ssh_pod "tail -n '${LINES:-60}' /workspace/render-server.log 2>/dev/null || echo 'no log yet'"
    ;;
  attach)
    # -t for a real TTY; this one is meant to be interactive.
    # shellcheck disable=SC2086
    exec ssh -t $POD "tmux attach -t '$SESSION'"
    ;;
  *)
    echo "usage: $0 start|stop|status|logs|attach" >&2
    exit 1
    ;;
esac
