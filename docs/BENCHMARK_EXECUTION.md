# Benchmark execution record — 31 October 2026

This is the historical build-environment attempt. The subsequent authenticated Mac
[pilot](COMPARISON_RESULTS.md) and [five-case batch](BATCH_COMPARISON_RESULTS.md)
have completed; those documents contain the current execution results.

## Outcome

**Live comparison BLOCKED. Zero live contestant runs. No model allowance consumed
by this pilot attempt. No winning arm, success rates or token-efficiency claim.**

The execution environment has no Docker, Harbor or Codex executable and no saved
Codex authentication file. A direct package-registry request also failed with a DNS
resolution error. The runner's `doctor` and `run` were actually invoked; both exited
2, and `run` persisted a blocked report with unknown (`null`) metrics for all arms.
This is a prerequisite failure, not a failed coding attempt by any contestant.

Existing cStack v0.2 was already pushed at `023125b373a4f20d96df5d7b85badba248794cbc`.
The local starting source exactly matched its Git tree
`e13ea2b5cb798258596614ab6c19b55f03dcf081`. No change to `src/` is included in this
benchmark integration. It uses the actual existing controller through a JSONL
worker bridge rather than substituting a similar prompt or new pseudo-controller.

## Implemented and tested locally

| Check | Observed result |
|---|---|
| Existing cStack tests, four independently bounded suites | 60 passed: 13 audit + 6 CLI/input + 16 controller + 25 reliability |
| New benchmark tests, final run | 50 passed |
| New benchmark tests, repeated final run | 50 passed |
| Existing JavaScript syntax check | 20 modules passed |
| Bridge syntax and Python compilation | Passed |
| Actual Node-controller bridge with scripted edit + isolated verifier | Correct edit verified; no-op success claim rejected |
| Live benchmark preflight and launch | BLOCKED before any model invocation |

An earlier all-in-one cStack test invocation hit the outer 200-second tool timeout
after reporting 33 passes. It was not counted as a full pass. Each original suite
was subsequently rerun independently with bounded execution and all 60 passed.
No original test or production source was modified to obtain this result.

The new tests cover archive traversal/links/duplicates, immutable identity,
credential environment filtering, unknown vs zero usage, cached-token accounting,
structured quota errors, separate phase timings, private reward authority,
no-model validation gates, pinned run configuration, genuine controller bridging,
and contract-shaped Harbor adapter doubles. Doubles are clearly labelled: they
do **not** validate real Harbor imports, Docker recipes, authentication, native
agent tool execution, network policies or third-party runtime compatibility.

## Concrete experiment prepared in code

- Existing task: `swe-bench/sympy__sympy-20590`, resolved once then content-locked.
- Infrastructure: Harbor commit `5eb713ff9500daced4e143b98765a7c732744a1b`.
- pstack files: cursor/plugins commit `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`.
- Contestants: ordinary Codex, **pstack-adapted-single-worker**, **cstack-harbor**.
- Same explicitly selected model, pinned Codex version, medium reasoning and
  public reproduction. Native multiagent pstack is **not** represented.
- Maximum editing phase: 1,800 seconds per arm; one run per arm; sequential seeded
  order; no automatic outer retries. cStack's internal repair turns count.
- First gate: unchanged source fails and the known upstream repair passes the
  private grader, without model calls. If that fails, no contestant is launched.
- No invented model ID, no API-key billing fallback, no copied user credential,
  no model job triggered by CI or by pushing this branch.

The preparer provisions pinned task/Node/Codex images, flattens worker Git history,
keeps reference repairs/private checks outside model environments, and routes final
candidate snapshots to Harbor's separate verifier. These Docker paths are coded but
**not executed in this environment**. Any incompatible upstream setup is a blocker,
not permission to weaken grading. Official benchmark checks are not a general proof
against malicious code in the test runner.

## Remaining acceptance gates

1. Provision the pinned Harbor installation and Docker on an authenticated local
   machine; confirm supported network enforcement and image recipes.
2. Run no-op/gold validation on the actual task image.
3. Run all three real arms and inspect telemetry completeness and private grades.
4. Review final completion claims manually before assigning false-completion labels.
5. Only then expand to repeated trials on multiple validated task families.

This one-task public smoke cannot establish comparative coding superiority or
subscription savings even when it succeeds. Results must remain descriptive.

See `bench/README.md` for exact setup/run commands. Raw tasks, gold patches, logs,
auth files and experiment working directories are not committed.
