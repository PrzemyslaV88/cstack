# Five bugs with actual delegated runs

This batch records private-grader correctness, task time and native Codex token
usage for five selected public bugs. Each case has one trial per arm. These are
descriptive results, not a general ranking or a claim about subscription savings.

| Case | Public behavior to repair |
|---|---|
| Flask 5014 | Empty Blueprint names must raise ValueError. |
| SymPy 12481 | Overlapping permutation cycles compose in left-to-right order. |
| SymPy 24539 | Polynomial expressions use explicitly supplied symbols. |
| pytest 7236 | A skipped unittest case must not run teardown under --pdb. |
| Sphinx 9230 | Parameter types containing spaces keep their type/name association. |

The immutable task refs, public probes, expected results, images and arm orders
are in `bench/batch_cases.json`. Public probes were derived from issue instructions
before reference patches were executed by the no-model validation gate.

## Five arms, 25 trials

- `plain-codex`: one ordinary Codex worker.
- `cstack-harbor`: the actual cStack controller with its single coding worker.
- `pstack-adapted-single-worker`: pinned pstack skills interpreted sequentially.
- `plain-codex-multiagent`: Codex parent with actual read-only helper agents.
- `pstack-codex-multiagent`: pinned pstack skills with the Codex tool mapping and
  actual helper-agent delegation.

cStack retains its single-worker design. The multi-agent arms enable the native
Codex delegation feature and require at least two observed child threads. The
configured concurrency ceiling permits two spawned threads alongside the parent.
Only the parent is instructed to edit the candidate; helper read-only roles are
instructions, not a new operating-system boundary. Children are instructed not to
delegate further. Codex V2 does not enforce the legacy max_depth setting, so no
native hard depth guarantee is claimed. Saved ancestry must be inspected.

Pstack uses upstream commit `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`, supplemented
with the installed 0.9.112 Codex mapping and the user's model sheet. Those files
are frozen in each prepared pstack tree. This exercises skills on Codex, not the
Cursor/Claude plugin runtime or its hooks. Delegates use GPT-6.1 Sol throughout;
the shared model family reduces review diversity. Parents and default helpers use
medium reasoning; pstack role-specific effort overrides are recorded in sessions.

Every arm has the same public issue/probes, model, task image, 30-minute task
ceiling, one trial, 1 CPU task allocation and separate final grader. Arm positions
rotate across the five cases. Multiple containers do not run contestant trials
concurrently. Provisioning and evaluator validation are outside reported task time.

## Validation and accounting

All five cases must pass the original-versus-known-repair public and private gates
before any contestant starts. The private grader is separate and has no outbound
network. Its build dependencies and exact upstream setup HTTP responses are cached
during explicit provisioning; the task tests and scoring functions are unchanged.

Token accounting uses the last native cumulative counters for each distinct
`session_meta.id`, once per thread. Parent and child counters are summed without
adding CLI or Harbor totals again. Shared V2 session_id values are not thread IDs.
Actual model identity, ancestry, completed-thread events and spawned-child records
are checked. Missing/ambiguous logs make full totals unknown while retaining
observed counters. Cached input and reasoning output remain subsets.

Independent grading, cStack controller status and pending human review are separate
fields. A grader pass does not approve a protected-file review. Failed trials and
their reported usage remain in the records. New runs cannot replace completed
experiment summaries.

Development-helper inference and benchmark engineering are excluded from trial
token tables. API prices and remaining subscription allowance are not inferred.
The benchmark checklist is used to inspect correctness, actual work, timing scope,
resources and limitations; no causal speedup claim follows from one run per case.

## Screening exclusions

Requests 5414 failed the known-repair private-grader gate because its HTTP fixtures
and networking were unavailable under this offline execution policy. Requests 2317
was removed from this batch's network-service category before contestant execution.
These are infrastructure exclusions, not model failures.

SymPy 23262 passed the upstream private grader with its known repair, but that
repair broke our already-frozen empty-tuple regression control. The case was
excluded rather than removing the control. Its original private/public evidence
remains in the screening directories. No contestant calls were made for exclusions.

## Local execution

The completed [results](BATCH_COMPARISON_RESULTS.md) contain 25 scheduled attempts:
24 private-test passes and one cStack Sphinx abort before model invocation. The
controller rejected `tests/certs/cert.pem`. The failure and paused checkpoint were
preserved; a reviewed continuation ran only the two remaining, never-started arms.
No contestant job was repeated and no fixture or controller guard was changed.

The active work directory is `/Volumes/CStack-Comparison/batch-20261101-v6`, backed
by the T7 runtime image. `.bench-work/batch-current` points there. Earlier setup
attempts remain separately preserved. The code/config snapshot is kept with the
batch, and each case locks its source, pstack, contract and Docker image identities.

For a new experiment, use a fresh work directory in the commands below. The
completed v6 directory preserves charged jobs and must not be reused for execution.

```sh
cd "/Volumes/T7 Shield/Projects/cstack-v0.2"
npm run bench:batch -- prepare --work /Volumes/CStack-Comparison/new-comparison
npm run bench:batch -- run --work /Volumes/CStack-Comparison/new-comparison
npm run bench:batch -- report --work /Volumes/CStack-Comparison/new-comparison
```

The completed v6 report uses `COMPLETED_WITH_EXECUTION_ERROR`. Its raw result files
can be read directly; `.bench-venv/bin/python .audit/analyze_batch.py` recomputes
the audited analysis and Markdown report without invoking models. The original
batch summary command predates the reviewed-continuation status, so use that
post-run analyzer for this particular preserved experiment.

`prepare` has no contestant calls. `run` consumes Codex allowance. Existing charged
or incomplete jobs are preserved rather than silently repeated. Final machine
records are `batch-results.json`/CSV plus each case's comparison and native session
evidence. Raw task answers, traces and credentials remain outside Git.
