# Live Harbor pilot — 1 November 2026

All three contestants passed the separate private grader on
`swe-bench/sympy__sympy-20590`. This is one public task and one trial per arm;
it supports a successful integration smoke, not a general performance ranking.

| Contestant | Private reward | Task execution | Agent setup | Private grading |
|---|---:|---:|---:|---:|
| Plain Codex | 1 / pass | 41.887 s | 1.116 s | 20.845 s |
| cStack | 1 / pass | 55.965 s | 1.408 s | 20.955 s |
| pstack-adapted-single-worker | 1 / pass | 108.614 s | 1.510 s | 20.900 s |

Task execution is Harbor's `agent_execution` interval, including contestant
control logic and candidate handoff. It is not pure model latency. Infrastructure
provisioning and the initial evaluator validation are outside these intervals.
There were no trial execution exceptions, provider-limit events, or repeated
contestant trials. Each contestant completed one Codex invocation. Actual saved
Codex session records identify `gpt-6.1-sol` for every arm.

## cStack's controller decision

The independent private grader accepted cStack's candidate. Its own controller
reported `NEEDS_MANUAL_VERIFICATION` because the worker changed
`sympy/core/tests/test_symbol.py`. That protected-file review remains pending;
the external benchmark score does not approve it or convert the controller's
state into `VERIFIED`.

## Usage and completion claims

The original parser marked usage incomplete because each combined stream contained
the single non-JSON status line `Reading additional input from stdin...`.
Subsequent reconciliation found exactly one successful completion event per arm,
no provider-error events, and exact agreement between every reported token counter
and the saved native Codex session's final cumulative counters. The token totals
are recoverable without rerunning a model.

| Contestant | Input | Cached input (subset) | Output | Reconciled total |
|---|---:|---:|---:|---|
| Plain Codex | 121,408 | 112,256 | 1,093 | 122,501 |
| cStack | 148,316 | 118,912 | 1,184 | 149,500 |
| pstack adaptation | 411,520 | 384,256 | 3,249 | 414,769 |

Totals are input plus output. Cached input and reasoning output are already
subsets and are not added again. On this task cStack used 22.0% more total tokens
than plain Codex; the pstack adaptation used 3.39 times plain Codex's total.
Uncached input was 9,152, 29,404 and 27,264 tokens, respectively. Cache reuse
differed between arms, and task order was not counterbalanced in this single trial.
These counts do not establish billed cost or subscription-allowance consumption.

The original frozen-parser results in `comparison.json`/CSV retain their null
totals and incomplete flags. `token-reconciliation.json` supplies the corrected
totals, validation conditions and SHA-256 identities of both supporting logs.
Subscription-allowance consumption remains unknown. The final messages describe
the same parent-class fix and bound their validation claims; the raw
`false_completion` labels remain null pending human review. Reported in-worker
test counts are not substituted for the separate private grader.

## Fixed conditions and evidence

- Model: `gpt-6.1-sol`, medium reasoning, Codex CLI 0.163.0, ChatGPT authentication.
- Arms: real cStack controller, plain Codex, sequential adaptation of pinned
  pstack files. Native pstack reviewers/multiagent execution were not exercised.
- Execution order: cStack, plain Codex, pstack adaptation.
- Budget: up to 1,800 editing seconds per arm; cStack's internal attempts count.
- Harbor: `5eb713ff9500daced4e143b98765a7c732744a1b` (package 0.25.0).
- Pstack source: `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`.
- Harness digest: `649b0b4f5d4b35dce74f574fd0fca4dbc1bb47ddf776ce7cac86688d918835c9`.
- Prepared task digest: `92c7c752fcd7e924d2484a97d5e7ada7068470ac80c645d9909af6104c27b61e`.

Current experiment: `/Volumes/CStack-Comparison/pilot-live-20261101`, accessible
through the repository's `.bench-work/pilot` link.

- `comparison.json` and `comparison.csv`: final machine-readable results.
- `token-reconciliation.json`: recovered token totals cross-checked against native
  sessions, preserving the original parser output.
- `lock.json`: exact source, task, contract and image identities.
- `validation.json`: unchanged candidate scored 0; known repair scored 1;
  both used the separate grader with zero model calls.
- `jobs/<arm>/`: private grader output, candidate identity, Codex sessions,
  completion messages, usage events and controller evidence.

Before the first contestant launched, Harbor rejected adapter kwargs missing from
its declared options schema. This was repaired, real Harbor option/constructor
regression tests were added (55 benchmark tests passed), and a fresh experiment
was prepared and revalidated. The failed launch created no contestant job.
Earlier preparation records and setup failures are preserved separately.

The live pilot is complete. `npm run bench -- report` displays its results.
Do not rerun `run` in this experiment: completed jobs are preserved. Any new trial
needs a fresh work directory and its own preparation/validation. Raw logs and task
answers remain local and ignored by Git. There is no general winner from this run.
