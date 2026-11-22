# cStack

cStack checks that an AI coding agent's "done" is really done. It runs frozen acceptance
checks itself, offline in an OS sandbox with your project's own installed dependencies, and
answers `done`, `failed` or `needs_you`. No model judges another model's work.

## Skills

- `/cstack:verify` checks a change that is already in your working copy, made by any agent or
  workflow (Claude Code, Codex, Cursor, pstack). Checks committed before the change are read
  from the base revision, so the change cannot weaken them. No model is called.
- `/cstack:cstack` runs a checked repair. `cstack fix "GOAL"` drafts probe checks, proves they
  fail today, asks you to approve the expected behavior, then fixes against exactly those
  checks with a Claude Code or Codex worker; optional parallel alternates are chosen by evidence.
- `/cstack:graph-map`, `/cstack:stack-analysis`, `/cstack:impact-analysis` map dependencies,
  stacks and change impact without a model.

## Requirements

Node.js 22.13+, Git, and your project's dependencies installed in git-ignored folders such as
`node_modules` or `.venv`. Repairs need a signed-in Claude Code or Codex CLI. Linux needs
unprivileged user namespaces; macOS uses the built-in `sandbox-exec`. cStack never installs
dependencies, never pushes and never falls back to API-key billing.

Documentation: https://github.com/PrzemyslaV88/cstack
