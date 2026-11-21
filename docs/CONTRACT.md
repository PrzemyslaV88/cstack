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

`implementation_paths` is an optional list of relative paths or simple `*`/`**` patterns. Configuration, SQL, styles and templates can count as implementation. Without an explicit list, ordinary behavior-bearing artifacts count, while tests and documentation alone do not. Existing tests, direct node-test oracles and test/agent configuration changes require a snapshot-bound `change-review` approval, except additive Python test changes described below.

## Test changes (schema 3)

`test_change_policy` is `additive` (the schema 3 default) or `review`. Under `review`, every changed existing test or configuration file needs `change-review`. Contracts frozen before this field existed keep `review` semantics; schema 2 contracts always use `review`.

Under `additive`, the controller checks every sealed candidate whose required automated checks pass and whose tests changed. An edit to an existing Python test module needs no `change-review` only when all of these hold for that exact candidate:

1. **Static additivity.** A controller-owned script (`src/runners/test-changes.py`) parses the baseline and candidate modules inside the isolated verifier with that interpreter's `ast`; it never imports or runs them. Every baseline module statement must remain unchanged and in order. Comments and formatting are ignored, so a comment-only edit is not additive. Additions may only be `test*` functions, `Test*` classes, `test*` methods in an existing test class, and plain imports. Additions must not rebind an existing name or builtin; decorators must be `pytest.mark.*` from `import pytest`; defaults, annotations and class bases must not call or compute. At least one test must be added. Fixtures, xunit setup hooks, module assignments, `__future__` and star imports all need review.
2. **Original tests still pass.** Every required automated check is rerun on the candidate with all test files restored to their baseline bytes and new test files removed. Added tests therefore cannot be why the original checks pass.

Configuration and collection files (`conftest.py`, `pytest.ini`, `package.json` and so on), node-test oracle files, deleted or mode-changed files, approved fixtures and non-Python test files always need review. If classification or the rerun fails, times out or is malformed, review is required.

**Fail-to-pass evidence.** When a pytest `test-suite` check exists, added tests also run against the baseline implementation. Each one is recorded as `fail-to-pass` (fails on the baseline, passes on the candidate), `pass-to-pass`, `not-collected-on-baseline`, `not-run-on-baseline`, `not-passing-on-candidate` or `not-collected-on-candidate`. This is supporting evidence in `report`, `review` and `checks_for_snapshot.test_changes`. It never replaces a frozen probe or `outcome` approval, and it does not decide the exemption.

The record is bound to the candidate digest, artifact digest, contract hash, runner identity and verifier identity, and stored as hashed evidence. A changed candidate, verifier or record makes a `VERIFIED` result `STALE_EVIDENCE`. Resume recomputes the record.

Limits: JavaScript/TypeScript test edits still need review. Arguments to added `pytest.mark` decorators run at import. Added test bodies can still change shared state at run time; the original-tests rerun shows the current candidate does not depend on that, but cannot rule out future effects in the delivered file. The checks add one classifier run, one rerun of the required checks and one baseline suite run, and only when tests changed and the required checks pass.

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


## Additive schema 3

Schema 2 retains its original normalization and hash. New plans use schema 3 with
`source_mode` (`clean` by default; explicit `working-copy` in 0.5), optional paired project profile/environment
digests, and context settings: policy evidence-v1 or filename-v1, explicit files,
literal symbols and sanitized path/line frames. Raw trace messages are not frozen.

A test-suite criterion selects pytest or Vitest, relative roots, frozen expected
IDs, explicit pytest plugins and an optional relative configuration. It accepts
no arbitrary shell/reporters/watch flags. A required test must actually pass;
skips, xfail, xpass, todo and missing expected IDs do not satisfy acceptance.
Malformed/incomplete streams are errors. Reported tests remain supporting proof;
an external probe or actual human outcome review is still needed.

See [published schemas](schemas/contract-v3.schema.json) and [setup](SETUP.md).
Semantic checks additionally enforce content identities, existing inputs, frozen
versions and prompt budgets. Neither schema parsing nor project discovery runs code
from package scripts. Missing usage blocks further worker admission, including after
resume; a candidate may still be checked while its usage remains explicitly unknown.
