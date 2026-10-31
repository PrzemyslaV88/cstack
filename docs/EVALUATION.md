# Does cStack actually improve delivery?

The current regression suite establishes particular safeguards. It does not measure comparative coding effectiveness or subscription savings.

Before promoting this harness for unattended use, collect 12–20 genuine tasks with clean starting commits, observable acceptance criteria and independently held-out checks. Include configuration fixes, multi-file changes, dependencies, tests-only false completions, interrupted runs and at least one user-facing integration. Avoid only choosing tasks the harness already handles well.

Run ordinary Codex and cStack against isolated copies of the same tasks with the same model, reasoning setting, authentication route and comparable total attempt/time budgets. Randomize order to reduce systematic ordering bias. Do not silently give the harness more retries or a different model. Keep the held-out evaluator separate from both workers.

Record per task: starting and final candidate identity, actual observed success, false-completion incidents, regressions, input/cached/output/reasoning usage, elapsed time, manual interventions and provider-limit events. Unknown subscription usage remains unknown. Compare verified completion per measured usage without treating cached tokens as additional input charges. Report uncertainty and failures, not only a single productivity score.

Acceptance for broader rollout: materially better verified outcomes per constrained usage without unacceptable extra user effort or regressions. If not demonstrated, simplify the harness. Do not add agents, a dashboard or a larger graph engine to obscure missing effectiveness evidence.

`npm run test:live` is a bounded plumbing check using one real Codex invocation after explicit execution by the user. It is neither an A/B benchmark nor an automatic CI task. A successful live smoke still does not establish commercial reliability or savings.
