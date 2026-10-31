# cStack 0.2

**One coding worker. Observable outcomes. No self-awarded completion.**

cStack is a local engineering controller around Codex. It reserves an attempt, sends a focused task and actual failure diagnostics, independently runs the candidate in isolation, and checks a frozen completion contract. A worker saying “done” is not proof.

This release repairs the v0.1 audit failures. It is still a hardening-stage tool, **not a proven substitute for human engineering review or a demonstrated way to increase a subscription allowance**. See [verification status](docs/VALIDATION.md) and [security boundaries](docs/SECURITY.md).

## Start

Requirements: Node 22.13 or newer, Git, and a separately installed/authenticated Codex CLI with the controlled-configuration capabilities checked by `doctor`. The default verifier uses Docker. Linux user namespaces are an explicit alternative. Use WSL2 rather than native Windows.

```sh
npm install -g .
# Explicit provisioning, not something cStack silently performs:
docker pull node:22.16.0-bookworm-slim
cstack doctor
cstack init "Fix the observable behavior" --out ../my-contract.json
# Edit the draft: define actual checks, then set draft=false.
cstack validate --contract ../my-contract.json
cstack run --repo /absolute/project --contract ../my-contract.json
```

The goal is not to make you write a huge specification. A small external probe with several meaningful input/output cases is a better starting point than ten vague requirements. [Example contract](examples/calculator-contract.json) and [contract guide](docs/CONTRACT.md) explain the fields.

On compatible Linux hosts, choose `"runner":{"backend":"linux"}` and run `cstack doctor --runner linux`. A failed isolation check stops the run; there is no unsandboxed fallback.

## What is enforced

- **External observation:** probe expectations are compared by the controller, outside the candidate process. Early exits, missing output and invented “PASS” messages do not satisfy a probe. Node test reports must include the declared cases; test reports alone require human outcome acceptance.
- **Snapshot identity:** evidence records source/HEAD, normalized artifact, contract, verifier and runner identities. Ignored inputs, file modes, commits and changed dependencies invalidate proof. Verification uses a read-only copy, not the mutable worktree.
- **Execution separation:** verification receives no host credentials, controller-state mount or outbound network. Docker also has resource/capability limits. The Linux runner uses fresh namespaces, a restricted root filesystem and dropped capabilities.
- **Durable accounting:** SQLite is authoritative. State and events commit together; attempts are reserved before launching work. Errors, quotas and crashes consume a reservation. Resuming never silently adds budget.
- **Outcome-based tasks:** already-satisfied dependent tasks do not require cosmetic edits. Configuration, templates and other declared artifacts can be genuine implementation.
- **Honest pauses:** blocked work can resume, and manual approvals are tied to one candidate. Protected test/config changes require human review. A failed automated check cannot be manually changed to PASS.

## Inspect, resume, approve and hand off

```sh
cstack status RUN_ID
cstack evidence RUN_ID --criterion AC1
cstack report RUN_ID
cstack resume RUN_ID
# Only after personally completing the specified manual check:
cstack approve RUN_ID --criterion UI --snapshot HASH_FROM_STATUS --note "What I exercised and observed"
cstack resume RUN_ID
cstack export RUN_ID --out /new/handoff-directory
```

`export` supplies the verified candidate, manifest and report. It never overwrites an existing directory and does not apply, commit, push, merge or deploy the change. The original repository checkout is left untouched. Keep your normal review and delivery process.

Controller state lives under `~/.cstack` (override with `CSTACK_HOME`, outside the target repository). The v0.2 database is `state-v2.db`. Old v0.1 state is preserved but its evidence is not silently upgraded; start a reviewed v0.2 run. JSON and JSONL files are regenerable exports, not editable authorities.

## Dependencies without hidden installation

A fresh Git worktree does not contain ignored dependencies. cStack never runs a networked `npm install` or an arbitrary lifecycle hook on your host. You can explicitly supply a reviewed, prebuilt dependency bundle with a pinned digest:

```sh
cstack input-digest /absolute/prepared/node_modules
```

Add it as `workspace_inputs` in the contract. Its files are copied before the baseline and included in every candidate identity. External symlinks and likely secret files are rejected. Larger/build-specific environments should use a reviewed Docker image. Automatic networked dependency provisioning, browser/device adapters and production deployment are not implemented.

## Budget, authentication and limits

ChatGPT authentication is required. cStack checks the installed CLI capabilities, forces `forced_login_method="chatgpt"`, disables subagents/hooks/plugins/apps/goals, and does not forward API-key environment variables. No API billing fallback exists. The coding worker still relies on Codex's own sandbox and installed CLI: this is not a new VM boundary around Codex itself.

Attempts, cumulative active time, worker wall time and observed tokens have explicit ceilings. Token usage can arrive only at turn completion; therefore the token ceiling is an **admission limit**, not a guarantee against a turn overshooting it. Input/cached/output/reasoning counters are reported separately. Remaining subscription allowance is **unknown**, not inferred from token counts.

## Verification

```sh
npm run check
npm test                         # Linux namespace fixtures on Linux
CSTACK_TEST_RUNNER=docker npm test # Docker engine/image must already be available
npm run test:live                 # Explicit opt-in: uses one bounded REAL Codex invocation
```

CI uses Docker and Node 22/24, with no API keys or live model calls. Tests include the 13 audit regressions, real isolated subprocesses, a genuinely killed controller, CLI protocol fixtures, human approval and input-bundle lifecycles. A synthetic Codex executable is not a live authenticated model test. Live account integration, macOS Docker execution and savings versus ordinary Codex must be measured separately.

Read [audit repair mapping](docs/AUDIT_REMEDIATION.md), [validation](docs/VALIDATION.md) and [evaluation protocol](docs/EVALUATION.md). The original architecture proposal remains in `docs/ARCHITECTURE.md` as a roadmap, not a list of shipped guarantees.

## Independent benchmark pilot

The [Harbor pilot](bench/README.md) compares matched Codex workflows using an existing
SWE-bench task and a separate grader. It includes a clearly labelled single-worker
pstack adaptation and the real cStack controller bridge. Live comparison remains
blocked in the build environment; see [the execution record](docs/BENCHMARK_EXECUTION.md).
