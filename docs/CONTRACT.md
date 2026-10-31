# Completion contracts — schema 2

Contracts live outside the target repository. `init` writes a draft that cannot execute. After reviewing it, set `draft=false` (or remove that field). `validate` performs structural checks. Contract changes require a new run; a worker cannot silently relax existing criteria.

```json
{
  "schema_version": 2,
  "type": "FIX",
  "goal": "Repair incorrect calculator addition",
  "policy": "lean",
  "runner": {"backend": "docker", "image": "node:22.16.0-bookworm-slim"},
  "attempt_limit": 2,
  "budget": {"max_attempts": 2, "max_active_ms": 600000, "worker_timeout_ms": 180000, "max_observed_tokens": 100000},
  "implementation_paths": ["calc.mjs", "settings.json"],
  "criteria": [{
    "id": "AC1", "text": "Addition works for positive and mixed-sign inputs", "kind": "probe",
    "argv": ["node", "calc-cli.mjs"],
    "cases": [{"stdin": "[4,2]", "expect_json": 6}, {"stdin": "[-5,3]", "expect_json": -2}]
  }]
}
```

The sample assumes a real `calc-cli.mjs` program that reads a JSON array on stdin and prints the computed sum as JSON. Do not copy an example oracle without implementing/binding its real application interface.

## Check types

**probe** invokes the candidate using a frozen argv array and input cases. The controller compares either parsed `expect_json` or exact `expect_stdout`. Each case uses a fresh isolated execution. No shell interpolation is performed by cStack; a deliberately supplied shell program still runs inside isolation. Nonzero exit, missing/malformed response, timeout and output overflow are not PASS. This proves the declared examples, not arbitrary correctness on unseen inputs.

**node-test** requires `argv:["node","--test","check.mjs"]` and `expected_tests:["exact test name"]`. A protected reporter filters child stdout and checks expected execution, failures, skips and stream completion. Test reports are supporting evidence: they cannot alone produce VERIFIED without a separate required probe, a manual criterion, or an explicit `outcome` approval. Candidate-controlled code can still compromise assertions inside its own process; cStack does not pretend otherwise.

**manual** requires an explicit `approve` command from the human operating cStack, with the current candidate digest and a meaningful note. Approval is recorded against the contract and candidate, then `resume` re-runs automatic checks. It cannot override a failing probe. Human approval assumes the host/operator is trusted; it is not a cryptographic identity service.

At least one criterion must be required. Every task must refer to a required outcome. Optional checks are reported but cannot establish completion by themselves. `critical` policy requires both a required external probe and a required manual criterion; it is no longer just an attempt-count label.

## Task graph and implementation artifacts

`tasks` may contain `{id,title,depends_on,criteria}` nodes. The dependency graph must be acyclic and account for every criterion. Current passing evidence can satisfy multiple tasks. A task does not have to make a new edit if another task already delivered its outcome.

`implementation_paths` is an optional list of relative paths or simple `*`/`**` patterns. Configuration, SQL, styles and templates can count as implementation. Without an explicit list, ordinary behavior-bearing artifacts count, while tests and documentation alone do not. Existing tests, direct node-test oracles and test/agent configuration changes require a snapshot-bound `change-review` approval.

If the baseline already satisfies every declared check, cStack returns `ALREADY_SATISFIED`, not “bug fixed.” This often means the contract needs a better reproduction.

## Explicit dependency inputs

```json
"workspace_inputs": [{
  "source": "/absolute/prepared/node_modules",
  "destination": "node_modules",
  "digest": "SHA256_FROM_CSTACK_INPUT_DIGEST"
}]
```

Only explicitly named bundles are read. They cannot overwrite existing worktree paths. Their manifests must match the pinned digest before and after copying. The baseline includes them, and later ignored-input changes invalidate evidence. Bundle sources and destinations must be safe paths; symlinks may not escape the bundle/candidate. No secrets, host home directories, Docker socket or networking are provided to verification.

## Budgets and outcomes

Each attempted worker invocation is reserved durably before launch. Per-task limits default to two in lean mode and three otherwise; run-wide defaults cap attempts at twelve. `max_active_ms` is cumulative active controller time, with conservative charging after interruption. `worker_timeout_ms` bounds each worker subprocess. `max_observed_tokens` stops admission of another turn; it cannot pre-price an ongoing provider request or report remaining ChatGPT allowance.

`VERIFIED`, `INVESTIGATED`, `ALREADY_SATISFIED`, `NEEDS_MANUAL_VERIFICATION`, `BLOCKED`, `STALLED` and `BUDGET_EXHAUSTED` are distinct. Resume revalidates current code and preserves reservations. Environment changes and exhausted limits require an explicitly reviewed new run, not a silent budget reset.

Schema-1 command-only contracts must be migrated. An arbitrary successful command is not sufficient proof. v0.1 databases and reports remain untouched and are never promoted to v0.2 evidence.
