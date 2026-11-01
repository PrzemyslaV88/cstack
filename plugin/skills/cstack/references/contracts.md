# Job contracts

Write the contract in a private directory outside the target Git repository. The
controller freezes it before starting. Supply expected behavior from the user's
requirements or a trusted public specification, not from the worker's proposed fix.

A complete example for a repository exposing `add` from `calc.mjs` is:

```json
{
  "schema_version": 2,
  "type": "FIX",
  "goal": "Repair calculator addition for positive and mixed-sign inputs",
  "model": "gpt-6.1-sol",
  "reasoning": "medium",
  "attempt_limit": 2,
  "runner": { "backend": "docker", "image": "node:22.16.0-bookworm-slim" },
  "budget": { "max_attempts": 2, "max_active_ms": 180000, "worker_timeout_ms": 120000, "max_observed_tokens": 500000 },
  "criteria": [{
    "id": "ADD",
    "kind": "probe",
    "text": "Addition returns the expected result for each input pair",
    "argv": ["node", "--input-type=module", "-e", "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';console.log(JSON.stringify(add(...JSON.parse(readFileSync(0,'utf8')))))"],
    "cases": [
      { "stdin": "[9,4]", "expect_json": 13 },
      { "stdin": "[-2,3]", "expect_json": 1 }
    ]
  }]
}
```

Adapt the goal, command, cases and existing runtime image to the actual project.
Probe commands execute against the sealed candidate in an offline, read-only
container. Their JSON output is compared by the controller. Dependencies must
already be in the selected image, or supplied through reviewed `workspace_inputs`;
do not install dependencies into the host or enable network access during checks.

Use `node-test` with exact `expected_tests` for Node's structured test stream, and
add a behavioral probe for independent outcome evidence. A `manual` criterion is
appropriate when human acceptance is genuinely necessary. Do not replace a
testable requirement with a manual-only check merely to obtain a pass.

Existing test/configuration edits stay protected. Extra tests are supporting
evidence and do not replace the frozen checks. Reviewed `approved_test_fixtures`
need an exact relative path, SHA-256 digest and review reason; only existing regular
test files with those unchanged contents qualify. Production credentials must
never be approved. Keep genuine secrets out of the candidate and dependency image.

`CSTACK_HOME` optionally selects controller state outside the source repository.
Without it, state is under `~/.local/state/cstack`. Use the same home for status,
resume, evidence and export. A failed check does not reset budgets or authorize
changing expected results. A clean already-passing baseline is reported as
`ALREADY_SATISFIED`, not as a newly demonstrated fix.

For guided plans, write an acceptance file containing `criteria` and optional
`model`, `reasoning`, `attempt_limit`, `budget`, `type`, `policy`,
`implementation_paths`, `tasks`, `context` and `approved_test_fixtures`.
The plan supplies the goal, schema version, runner image and project identities.
Do not copy a complete legacy contract's runner/workspace fields into acceptance.
Concrete public probes stay independent of edits; discovered project tests are
additional supporting checks. Private grader expectations never belong in worker
context. See the bundled runtime CONTRACT.md for schema details.
