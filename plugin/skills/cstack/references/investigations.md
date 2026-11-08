# Explicit investigations

`architecture --repo PROJECT [--focus FILE] --out NEW_DIRECTORY` produces a local
Markdown/JSON/HTML investigation with static import evidence and candidate public
interfaces. Import counts and cycles are navigation clues, not design defects.
Inspect callers, tests, the glossary and relevant ADRs before recommending a deep
module: useful behavior behind a small interface. Explain concrete caller friction
and the improvement in testability. Do not refactor merely because a graph has a
busy node. An authorized refactor uses a separate frozen behavioral contract.

`retro RUN_ID [RUN_ID ...] --out NEW_DIRECTORY` inspects only the selected recorded
runs. It proposes improvements to reproduction, navigation, context selection,
accounting and regression checks. It does not reverify outcomes or silently change
code, policy, tests, project instructions or external services. Prefer a meaningful
deterministic check for repeated mechanical mistakes over another prose rule.

Use standalone issue-management/planning skills alongside Cstack when requested.
Do not turn local investigations into automatic issue publication, parallel coding
agents or production actions.
