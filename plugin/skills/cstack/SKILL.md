---
name: cstack
description: Prepare and run a bounded coding repair with cStack's single worker, independent checks, review reports and safe delivery; inspect or resume an existing repair.
---

Resolve `scripts/cstack.mjs` relative to this skill directory and use that bundled
controller as `CSTACK`. Read [references/contracts.md](references/contracts.md) when
writing acceptance criteria. The controller's frozen contract, snapshots and
current evidence determine completion.

For a new repair:

1. Use the user's requested project and observable outcome. Run `setup --repo`.
   It discovers the project's installed, git-ignored dependency folders
   (`node_modules`, `.venv`); pass `--dependencies` only to override. Discovery
   does not need model authentication. Resolve reported scope/adapter ambiguity
   from session context; ask only when the missing choice affects the outcome.
   Missing dependencies (`PROJECT_DEPENDENCY_MISSING`) are setup problems, not
   failed coding attempts: tell the user which install command to run. Never
   install dependencies yourself or ask for Docker; cStack 0.6 has no images.
2. Write an acceptance JSON file outside the project with concrete independent
   probe inputs and expected outputs. Use the user's model choice (default
   `gpt-6.1-sol`) and applicable budgets. Do not replace an automatable outcome with
   manual-only acceptance. `plan "GOAL" --repo --profile --acceptance --out` freezes
   the request and reproduces the baseline. It does not fabricate expected outputs
   or call a model. `ALREADY_SATISFIED` means the supplied checks already pass; do
   not describe it as a new fix. Ask a specific behavior question only when needed.
3. Run a ready plan with `run --plan FILE --expect-plan SHA256`. Existing repair
   authorization is sufficient; do not add a generic confirmation ritual. Preserve
   the same `CSTACK_HOME` across commands. Never modify the linked dependency
   folders or the worktree's dependency links. Clean source is the default; do not commit,
   stash or discard existing edits to bypass it. When the repair includes existing edits, select `plan --source-mode working-copy`
   explicitly. It preserves staging and rejects any intervening included source
   change with `SOURCE_DIVERGED`; inspect the returned review and create a new plan.
4. Let the controller edit its private worktree. Do not modify that worktree from
   the outer session, weaken frozen checks, forge events or increase budgets on
   resume. `status --watch`, `runs`, `report`, `review`, and `evidence --criterion`
   expose progress and results. An interrupted run can use `resume RUN_ID`.
   Missing usage blocks further worker admission while retaining the candidate.
5. Present the actual result in plain language: automated checks, pending human
   review, token completeness, and whether the change was applied. `review --out`
   writes a private self-contained HTML view; opening it is not approval. Existing
   test/configuration edits can require review even when every check passed.
6. A current VERIFIED repair can use `patch RUN_ID --out` and `apply RUN_ID --repo
   --snapshot SHA256 --check`. If the user's task includes applying the repair,
   run apply without `--check` after successful preflight. Otherwise present the
   patch and next action. Do not push, commit or publish without authorization.
   Do not edit original files concurrently with delivery. A conflict preserves
   work; `delivery recover RUN_ID --delivery ID` can complete or roll back known
   pre/post images and refuses to overwrite a third-value user edit.

`NEEDS_MANUAL_VERIFICATION` means review is still pending, not a final verification.
Use `approve` only after an actual human has reviewed the exact snapshot and
instructed that approval; record their note. Do not supply approval on their behalf
just to finish a test or benchmark. A report is not an approval interface.

The worker disables plugins, hooks and delegation. Keep those controls intact.
Provider/account limits are recorded stops; no API-key billing fallback (API-key
worker auth only when the user set `CSTACK_CODEX_AUTH=api-key`). Token counts are
observed worker usage, not remaining subscription credits or necessarily the outer
chat's total cost. The worker and the sandboxed verifier share the project's
installed dependencies. Lead results with the `outcome` (`done`, `needs_you`,
`failed`) and its reason. Credential-looking files remain
blocked except exact previously reviewed and frozen test fixtures.

Legacy explicit contracts still use `validate`, `run --repo --contract`, and
`export`. Export copies the verified candidate into a new directory. For read-only
analysis use this plugin's graph-map, stack-analysis or impact-analysis skill. To
check a change that another workflow already made, use the verify skill.
