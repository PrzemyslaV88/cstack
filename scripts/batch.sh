#!/usr/bin/env bash
set -euo pipefail
batch_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$batch_root"
export PATH="$batch_root/.bench-venv/bin:$PATH"
if [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] && docker context inspect colima-cstack >/dev/null 2>&1; then
  export DOCKER_CONTEXT=colima-cstack
fi
exec "$batch_root/.bench-venv/bin/python" -m bench.batch "$@"
