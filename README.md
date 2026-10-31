# cStack

**Finish the requested implementation. Prove what works. Stop wasting agent turns.**

cStack is a local-first, budget-aware engineering harness for Codex. One coding agent by default; a deterministic controller owns acceptance contracts, verification evidence, bounded repair attempts and honest completion states.

## Working capabilities (v0.1)

- Creates a separate, detached Git worktree and refuses to overwrite a dirty source checkout.
- Freezes a typed acceptance contract in state outside the agent worktree (SHA-256 integrity checked on reload).
- Captures baseline test results; runs independent `argv`-based checks after each coding turn.
- Detects documentation-only/no-op and tests-only implementations; prevents unsupported VERIFIED claims.
- Tracks attempt-by-attempt evidence, SHA-256 worktree fingerprint, unchanged retries, usage events and blocking conditions.
- Bounds Codex retries to two or three by default and never spawns parallel agents.
- Stores SQLite indexes, JSONL events, evidence logs and a human-readable report in `~/.cstack`.
- Supports `run`, `status`, `report`, `resume`, `doctor`, and an illustrative file-level import/code map.
- Does **not** push, deploy, approve real-world tests or automatically switch to a paid API.

## Requirements

Node.js 22.13+, Git, and the [Codex CLI](https://learn.chatgpt.com/docs/cli/reference) installed and authenticated for real agent execution. No npm runtime dependencies.

```bash
npm install -g .
cstack doctor
```

Create `contract.json` **outside** the worker worktree:

```json
{
  "type":"FIX",
  "goal":"Fix the broken addition function",
  "policy":"lean",
  "criteria":[
    {"id":"AC1","text":"Adding 4 and 2 produces 6","kind":"command","argv":["node","--test","test/add.test.mjs"]}
  ]
}
```

```bash
cstack run "Fix the broken addition function" --repo /path/to/project --contract /path/to/contract.json
cstack status <run-id>
cstack report <run-id>
cstack resume <run-id>
```

**IMPORTANT:** a `VERIFIED` result only means the configured checks passed against the changed worktree, not that every real-world behaviour was proven. A manual required check produces `NEEDS_MANUAL_VERIFICATION`, never false success. cStack leaves changes in its isolated worktree, not your original checkout.

## Design boundaries

See [contract schema](docs/CONTRACT.md) and [architecture proposal](docs/ARCHITECTURE.md). The first version is intentionally smaller than the proposal. There is **no** semantic symbol graph, automatic requirements-generation model, GUI, approval UI, Playwright integration or independent malicious-worker OS sandbox in v0.1. These need further engineering and acceptance tests before they can be claimed.

## Development

```bash
npm test
npm run check
```

Runs are indexed in `~/.cstack/state.db`; evidence logs, status JSON and reports are under `~/.cstack/runs/<run-id>/`. Protect this directory and use trusted contract files: verifier `argv` commands run on your machine.
