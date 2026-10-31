# Independent comparison pilot

**Status: implemented integration scaffold; local protocol/bridge tests pass. Live
Harbor/Docker/Codex runs have NOT been completed. No comparative result exists.**

This directory does not add another coding framework. It connects the existing
Harbor evaluator to ordinary Codex, a labelled single-worker pstack adaptation,
and the actual cStack controller. The first upstream task is
`swe-bench/sympy__sympy-20590`. One public task is an integration smoke, not evidence
that one system is generally better. It may already appear in model training.

## Run on an authenticated machine

Requirements: Node >=22.13, Git, Python >=3.12, a functioning Docker engine, Codex
CLI, and network access for explicit provisioning. Run in a dedicated development
environment with no unrelated production credentials. A Mac uses Docker Desktop
and linux/amd64 images; native Apple Silicon compatibility has NOT been validated.

From this branch's repository root:

```sh
# Install pinned infrastructure. This does not call a model.
uv venv .bench-venv --python 3.12
. .bench-venv/bin/activate
uv pip install -r bench/requirements.txt

# Authenticate locally. Never upload auth.json or paste tokens into a chat.
codex login
codex login status
codex --version
python -m bench.lab doctor

# Select a model you can actually access and the printed concrete CLI version.
# Replace these two values; they are deliberately not guessed by the benchmark.
python -m bench.lab prepare --model YOUR_MODEL --codex-version YOUR_CLI_VERSION

# NO MODEL: unchanged candidate must fail; upstream known repair must pass.
python -m bench.lab validate

# Uses your Codex account allowance: ONE sequential run per arm, <=30 minutes each.
python -m bench.lab run
python -m bench.lab report
```

All provisioning is explicit. There is no paid-API fallback or cloud provisioning.
A missing dependency, login, image, schema capability or successful validation gate
stops execution. `prepare` may fail when an upstream image needs additional trusted
test dependencies. Fix and revalidate the image; do not relax isolation or call that
failure an agent loss. Network allowlists must be supported by the selected Harbor
Docker provider; unsupported policies are blockers, not a reason to enable public
web access during a trial.

Use a new `--work /absolute/path` for a new experiment. Existing charged jobs are
never overwritten or silently repeated. `latest` is resolved only during task
preparation: subsequent operations enforce content and Docker-image locks. Model,
CLI version, code, public contract, task, pstack source and evaluator are recorded.

## What each arm actually measures

| Arm | Meaning |
|---|---|
| plain-codex | Harbor's Codex runtime with matched model/reasoning and limits |
| pstack-adapted-single-worker | Full pinned pstack files, interpreted sequentially by Codex; no Cursor/Claude plugin runtime, reviewers or multiagent execution |
| cstack-harbor | Real `src/core.mjs` controller on the host, remote Codex worker in the same Harbor task environment |

**This does not compare native multiagent pstack.** That practical-product track
needs its supported runtime, complete child-agent accounting and separate labels.
Do not rename the adapted arm to pstack in a chart or announcement.

All three get the same issue and explicit public reproduction. The native Codex
features for delegation, hooks, plugins and web search are disabled. Host and model
process telemetry cannot prove that arbitrary hostile code never launched another
client; this is a controlled workflow test, not an adversarial billing sandbox.

The comparison is **time-matched**, not token-matched. Each arm has a 30-minute
editing ceiling; cStack has up to three outer repair attempts within that ceiling.
All of its attempts count. Plain Codex's one invocation can perform many internal
tool calls. cStack also retains its conservative 500k observed-token admission cap;
that is not a universal live token kill-switch. Costs/remaining subscription quota
are unknown; input + output is reported, cached input is not added again.

## Trusted evaluation boundaries

- Worker image contains only the starting repository and ordinary development
  tests; Git history is flattened before any model sees it.
- Task private checks and reference repair remain on the host. No model gets
  `/tests`, `/solution`, the grader image or a Docker socket.
- Candidate source is transferred as bounded regular-file data. Traversal, links,
  special files, duplicate paths and candidate Git metadata are rejected.
- Final scoring is performed in Harbor's **separate fresh verifier container**,
  using the upstream checks, never using cStack's claimed status as the grade.
- cStack's own public probes run in additional read-only/no-network Docker
  containers. The coding worker never gets nested-Docker privileges.
- Candidate files are restored onto the grader's original Git baseline, not the
  worker's flattened Git metadata. No-op/gold tests exercise this handoff.
- The official benchmark evaluator remains an upstream trusted component, not a
  proof of arbitrary malicious-code resistance. This code has NOT completed a
  real Docker boundary validation; do not call it production hardened.

The grader's upstream test setup must work offline. The current preparer deliberately
refuses to invent a task image when no prebuilt image or expected Python exists.
The smoke adapter is specific to this SymPy task, not a universal Python adapter.

## Logs and honest results

`.bench-work/comparison.json` and `.csv` contain final independent reward, distinct
execution status, observed usage, telemetry completeness and phase timings. Per-arm
Harbor job directories retain trajectories, per-turn Codex JSONL, cStack reports
and exact candidate identity. Setup, editing and private grading are timed separately.

Missing usage is `null`, never free work. Failure/timeout usage remains in the record.
An execution error stops the remaining pilot before more allowance is spent. Final
completion claims are retained for manual false-completion review; they are not
classified by a brittle keyword search. The report never declares a general winner
from one task/one trial per arm.

Raw traces can contain user text, source code and accidentally exposed secrets.
They remain local and are gitignored. Review and redact before sharing. Do not upload
saved auth, the entire task cache, reference repairs or private grader content to a
public results site.

## Validation available without account access

```sh
python -m unittest discover -s bench -t . -p 'test_*.py' -v
python -m py_compile bench/*.py
node --check bench/cstack_bridge.mjs
```

The bridge tests exercise the **real** cStack controller and real isolated Node
verification with a **scripted worker**. They verify plumbing, not AI effectiveness.
Harbor is intentionally not imported by offline protocol tests; tests cannot prove
that the third-party runtime APIs, Docker image recipes or account login work.

Current execution record: `../docs/BENCHMARK_EXECUTION.md`.

## Upstream references

- Harbor pinned source: https://github.com/harbor-framework/harbor/tree/5eb713ff9500daced4e143b98765a7c732744a1b
- Custom agents: https://www.harborframework.com/docs/agents
- Task and verifier isolation: https://www.harborframework.com/docs/tasks
- pstack pinned source: https://github.com/cursor/plugins/tree/4dd1d05818d19792e7cd6e818f1667f95f7e1dbe/pstack
- Task: https://hub.harborframework.com/tasks/swe-bench/sympy__sympy-20590/latest
- Codex saved authentication: https://learn.chatgpt.com/docs/auth
