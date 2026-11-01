# Benchmark review — 1 November 2026

Scope: the comparison driver, Codex adapters, token parser, configuration and
completed three-arm pilot. This is a targeted engineering review, not an
exhaustive security audit. No model calls were made and no benchmark source was
changed during the review. Reproductions used disposable files and short-lived
local helper processes; the completed experiment was preserved.

## Confirmed findings

| ID | Priority | Finding | Evidence and practical consequence | Required correction |
|---|---|---|---|---|
| B01 | High | Repeat runs can overwrite completed summaries | `bench/lab.py:332` writes `comparison.json` before checking existing jobs. A disposable reproduction changed `COMPLETED_SMOKE` with one result row into `BLOCKED` with zero rows. Preflight failure can also replace the summary with a zero-run report. Original job artifacts survive, but the main summary becomes misleading. | Check experiment state before writing; preserve completed results; write launch failures separately. Make report recovery read existing job results without launching models. |
| B02 | Medium | Parent timeout does not reliably stop descendants | `bench/lab.py:50` uses `subprocess.run(timeout=...)`. A controlled helper process survived its parent's timeout and wrote a marker afterward. This proves host process-tree cleanup is incomplete; it does not establish that this pilot left Docker containers behind. | Terminate process groups with a grace period, invoke Harbor cleanup, verify trial containers are gone, and record cleanup failures explicitly. Test host and Docker cleanup without model calls. |
| B03 | Medium | Token parser is both too strict about diagnostics and too permissive about duplicate completions | `bench/protocol.py:128` marks a harmless stdin status line as incomplete. Conversely, repeating an identical completion event produced complete usage and doubled its input count from 100 to 200. Current real logs contain exactly one completion per arm; the saved reconciliation remains valid. | Separate diagnostics from JSON events or narrowly recognize documented status lines; require the expected completion structure; reject duplicate/ambiguous completions; cross-check native totals when available. |
| B04 | Medium | Declared trial settings are not actually applied | `bench/pilot.json` declares reasoning, duration and repetitions, but `bench/lab.py:276` and `bench/harbor_agents.py:94` hard-code one attempt, 1,800 seconds and medium reasoning. Setting duration to 7 and repetitions to 4 still generated 1,800 seconds and one attempt in a disposable reproduction. | Apply supported configuration consistently and lock it, or reject unsupported values explicitly. Implement repetition and order balancing before presenting a broader experiment. |
| B05 | Medium | Machine-readable results hide cStack's review requirement | `bench/protocol.py:180` maps private reward 1 to `VERIFIED`, but omits the controller decision. Actual cStack evidence says `NEEDS_MANUAL_VERIFICATION` for a modified test file, while its comparison row only says `VERIFIED`. The private score is correct; the row lacks an important delivery-state distinction. | Record independent grading, controller status and human-review requirements as separate fields. Preserve the pending review unless explicitly approved. |

The token report has been reconciled for the completed run, but B03's source-code
bug is still present. The other findings above are also unresolved by this review.

## Limits of the experiment

- One public SymPy task, one trial per arm, and one execution order cannot support
  a general performance ranking. Broader evaluation needs multiple task families,
  repeats and balanced execution order.
- The pstack contestant uses its pinned files sequentially through Codex. It is
  not a native pstack multiagent runtime comparison.
- Cache reuse differed between contestants. Token counts are supported by saved
  completion events and native sessions, but billed cost and consumed subscription
  allowance remain unknown.
- The live run used one coding invocation per contestant. Real multi-turn repair,
  quota interruption, resume and live timeout cleanup were not exercised by that
  task, although some paths have scripted regression fixtures.

## Interpretation and next work

The current evidence supports three private-grader passes and the reconciled token
totals in `COMPARISON_RESULTS.md`. It does not supply a broad winner or resolve
cStack's pending protected-file review. Repair result preservation first, then
cleanup and token accounting, then configuration and separate delivery statuses.
Use no-model regression tests for these repairs before another paid pilot.
