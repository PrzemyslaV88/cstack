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
# Use the dedicated Mac engine when available, without changing Docker defaults.
if [[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] && docker context inspect colima-cstack >/dev/null 2>&1; then
  export DOCKER_CONTEXT=colima-cstack
fi
comparison_action="${1:-doctor}"
if [[ $# -gt 0 ]]; then shift; fi
if [[ "$comparison_action" == test ]]; then
  export CSTACK_TEST_RUNNER=docker
  npm run check
  npm test
  "$comparison_python" -m unittest discover -s bench -t . -p 'test_*.py' -v
  "$comparison_python" -m py_compile bench/lab.py bench/protocol.py bench/harbor_agents.py
else
  exec "$comparison_python" -m bench.lab "$comparison_action" --work "${CSTACK_BENCH_WORK:-$comparison_root/.bench-work/pilot}" "$@"
fi
