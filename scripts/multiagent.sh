#!/usr/bin/env bash
set -euo pipefail
comparison_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$comparison_root"
comparison_python="$comparison_root/.bench-venv/bin/python"
if [[ ! -x "$comparison_python" ]]; then
  echo 'Benchmark Python environment unavailable. See docs/COMPARISON_LOCAL.md.' >&2
  exit 2
fi
export PATH="$comparison_root/.bench-venv/bin:$PATH"
if [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] && docker context inspect colima-cstack >/dev/null 2>&1; then
  export DOCKER_CONTEXT=colima-cstack
fi
exec "$comparison_python" -m bench.multiagent_test "$@"
