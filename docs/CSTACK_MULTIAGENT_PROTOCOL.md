# cStack multi-agent extension

This experiment adds a real multi-agent cStack benchmark arm and a refreshed
single-agent cStack control. It uses the same five tasks as the preserved
[original comparison](BATCH_COMPARISON_RESULTS.md). It does not replace that
comparison or change the installed plugin's single-worker default.

The [completed results](CSTACK_MULTIAGENT_RESULTS.md) record ten new trials with
passing independent bug tests and a combined report containing all 35 scheduled
attempts. Human review gates remain separate.

The intended claim is descriptive: report independent bug-test success, native
tokens and task time for the ten new trials beside the 25 saved trials. One trial
per mode per case cannot establish a general winner, repeatability or a causal
speedup. A previous controller version was used for the saved cStack results.

## Agent roles

`cstack-codex-multiagent` uses the actual cStack controller with a benchmark worker
that can spawn native Codex helpers. One parent owns source edits. Two helpers
provide diagnosis/reproduction and regression review. Helpers are instructed to
inspect and run checks, use `/tmp` for scratch reproductions, leave `/testbed`
unchanged and avoid further delegation. The parent waits for and closes them.
The concurrency limit allows two helpers alongside the parent. These role and
depth restrictions are instructions, not an operating-system read-only boundary;
native traces and ancestry must be inspected for deviations.

The benchmark explicitly maps the controller's single-worker prompt sentence to
the declared helper policy and preserves the rest of the prompt. Unknown prompt
formats fail before inference. Public issue information and reproduction checks
remain available to both modes. No helper can approve protected-file changes or
replace controller-owned checks. The standalone controller and plugin continue
to disable both native multi-agent features by default.

Every seat uses GPT-6.1 Sol, with medium reasoning requested. This reduces review
diversity. Actual native model, effort, parent identities and completed-thread
events are retained. At least two real child rollouts are required for the new
multi-agent arm; sequential role-playing is not accepted as delegation.

## Frozen inputs and execution

All five immutable worker, public-check and separate private-grader images are
reused from `/Volumes/CStack-Comparison/batch-20261101-v6`. Task trees and public
criteria are unchanged. The current controller source is separately frozen and
hashed. Only the two previously reviewed Flask/Sphinx test fixtures receive their
exact-path, exact-content approvals; these approvals do not cover arbitrary
credentials or changed fixture contents.

All five original-bug-fails/known-repair-passes public and private gates must pass
again before contestant inference. These gates make no model calls. Candidate
code runs inside Docker. Private grading uses a separate offline container.

The refreshed single-agent and multi-agent cStack modes alternate first position
across the five cases. Trials execute sequentially, with the original task CPU
allocation, Codex CLI 0.163.0 and ChatGPT sign-in. Each mode has the same 30-minute
task ceiling, at most three controller attempts and a 500,000 observed-token
admission ceiling. This is not a hard inference-compute cap: a complete turn can
overshoot it. The multi-agent controller charges the cumulative native tree's
delta after every completed turn, including helpers, before admitting a retry.
Missing or conflicting helper usage prevents controller continuation.

Host background work, model service variability, cache reuse and execution order
can affect time and token counts. The host has ten logical CPUs and had a load
average of approximately 2.9 before preparation; existing user applications were
left running. No result is a statistically established speedup. Task time covers
Harbor agent execution including controller checks and candidate delivery;
provisioning and final private grading are separate.

## Results and preservation

Native usage sums one final cumulative counter vector per distinct thread. It
does not add CLI totals to native totals or add cached input a second time.
Missing records leave total usage unknown. Token counts do not establish billed
cost or remaining subscription allowance. Failed attempts remain in the report.
Controller status and independent grading remain separate.

The new report combines labelled historical and current rows. The original
25 trials, their errors and their reports remain untouched. Completed or charged
jobs are never silently repeated. The two current cStack modes provide the most
direct comparison of delegation under the updated controller; comparisons with
saved pstack/plain runs remain historical comparisons.

```sh
npm run bench:multiagent -- prepare --work /Volumes/CStack-Comparison/fresh-cstack-multiagent
npm run bench:multiagent -- run --work /Volumes/CStack-Comparison/fresh-cstack-multiagent
npm run bench:multiagent -- report --work /Volumes/CStack-Comparison/fresh-cstack-multiagent
```

`prepare` performs no inference. `run` consumes real Codex allowance for ten
contestant trials. `report` only reads evidence. Use a fresh work directory for
each experiment. The source archive, locks, no-model gates, raw native sessions,
controller evidence, `combined-results.json`/CSV and `comparison.md` are saved in
the experiment directory.
