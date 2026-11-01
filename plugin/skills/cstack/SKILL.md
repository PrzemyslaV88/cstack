---
name: cstack
description: Run a bounded coding fix through cStack's single worker and independent checks, or inspect/resume an existing cStack repair run. Use for cStack's evidence-gated repair workflow.
---

Use the bundled controller. Its worktree, checks and result records are the source
of completion evidence. The outer Codex session plans the job and presents results;
the controller starts the coding worker and checks its candidate.

For a read-only project map or technology inventory, use this plugin's graph-map
or stack-analysis skill. Those analyses do not need a repair contract or Docker.

## Locate and check the runtime

The executable is `scripts/cstack.mjs` relative to this skill directory. Resolve its
absolute path from this `SKILL.md` location, rather than searching for a globally
installed cstack binary. All examples below use `CSTACK` for that absolute path.

Run `node "$CSTACK" doctor`. Node 22.13+, Git, an authenticated Codex CLI and an
existing Docker engine/image are required. The plugin installs no dependencies or
images automatically. If Docker's current context is unavailable, inspect existing
contexts and use an available one via `DOCKER_CONTEXT` on these commands; do not
change the user's global context. Preserve explicitly selected connection settings.

## Carry out a job

1. Establish the target Git repository and expected observable behavior from the
   user's request and code. Read [references/contracts.md](references/contracts.md)
   when preparing a new job. Build a complete contract outside the target repo,
   with concrete input/expected-output cases. Use the user's chosen model; default
   to `gpt-6.1-sol` when no model was specified. Keep checks independent of edits.
   Existing authorization to fix the bug is sufficient to proceed. Ask only for
   facts necessary to define the intended result that cannot be inferred.
2. Run `node "$CSTACK" validate --contract "$CONTRACT"`, then
   `node "$CSTACK" run --repo "$REPO" --contract "$CONTRACT"`. Preserve the same
   `CSTACK_HOME` and Docker settings for later commands. The source revision must
   be clean; never commit, stash, clean or discard the user's changes to satisfy
   this requirement. Explain a dirty-source block with the exact affected files.
3. Record the returned run ID. Let the controller edit and verify its private
   worktree. Do not edit that worktree from this outer session, forge worker
   events, weaken checks, or change its frozen contract after a failure. Monitor a
   long process until it completes. An interrupted run can use `resume RUN_ID`;
   resume preserves consumed attempts and budgets.
4. Read `status RUN_ID` and `report RUN_ID`. For a specific failed check, use
   `evidence RUN_ID --criterion ID`. Report the controller status, tests for the
   named snapshot, pending review files, worktree path and observed token usage.
   Tokens are not remaining subscription credits.
5. For a current `VERIFIED` result, `export RUN_ID --out "$NEW_DIRECTORY"` delivers
   the checked candidate and report. Show that location. Export does not merge it
   into the original repository. Apply a candidate back to the project only when
   that is within the user's request and its original work remains protected.

`NEEDS_MANUAL_VERIFICATION` can mean the fix passed automated checks but changed
protected tests/configuration. Present the exact pending review. Do not call
`approve` or write a human approval note on the user's behalf without actual human
review of that snapshot. Do not describe pending review as final verification.

Credential-looking files remain blocked unless an exact existing test fixture was
reviewed and pinned in the starting contract. Do not approve a file merely because
it is in a test folder. New/changed files do not inherit fixture approval.

The child worker disables plugins, hooks and delegation. Do not re-enable them or
route the job to another coding framework to bypass a controller stop. A provider
limit is a recorded stop; do not switch to API-key billing automatically.
