# pstack model configuration

These overrides preserve the user's GPT6.1 choice for every pstack role. The
session's `spawn_agent` tool supports `gpt-6.1-sol`. In that identifier, `sol` is
part of the GPT6.1 model name. It does not select the older `gpt-6-sol` model.

Codex loads the role rows and default effort from the matching block in
`~/.codex/AGENTS.md`. Keep the two copies equal. Codex does not support an `@`
include. The pstack plugin reads the session hook setting directly from this file.

A role without an effort suffix uses the session's effort. Panel entries select
separate agents. These panels use one model family, so report reduced model
diversity. Separate agents provide engineering review, not independent scientific
validation. Dispatch only the seats required by the invoked workflow.

feature, refactoring: gpt-6.1-sol
bug-fix: gpt-6.1-sol
perf-issue: gpt-6.1-sol
hillclimb: gpt-6.1-sol
judgment and prose: gpt-6.1-sol
strongest judgment: gpt-6.1-sol
how explorer: gpt-6.1-sol
how explainer: gpt-6.1-sol
why investigators: gpt-6.1-sol
why synthesizer: gpt-6.1-sol
reflect tooling: gpt-6.1-sol
reflect judgment, divergent, synthesizer: gpt-6.1-sol
arena runners: gpt-6.1-sol @high, gpt-6.1-sol @xhigh
arena cross-judge pool: gpt-6.1-sol @xhigh
swarm workers: gpt-6.1-sol
architect runners: gpt-6.1-sol @high, gpt-6.1-sol @xhigh
interrogate reviewers: gpt-6.1-sol @high, gpt-6.1-sol @xhigh

default effort: session
session hook: on
