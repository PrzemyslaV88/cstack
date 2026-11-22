---
name: verify
description: Independently check a code change that is already in the working copy before claiming it is done, using frozen acceptance checks run by cStack in an offline sandbox. Use as the completion and merge gate for any workflow, including pstack's poteto-mode.
---

Resolve `scripts/verify.mjs` relative to this skill directory as `VERIFY`. It needs
Node 22.13+, Git and the project's own installed dependencies. It never calls a
model, never installs anything and never modifies the repository.

Checks are a JSON file with `criteria` (see the cstack skill's
`references/contracts.md`; use `probe` criteria with concrete inputs and expected
outputs). Prefer a file committed before the change, for example
`.cstack/checks.json`: verify then reads it from the base revision, so the change
cannot weaken its own checks, and any edit to it needs human review. A file outside
the repository is used as given. Never edit the checks to obtain a pass.

1. When the change is ready, run
   `node "$VERIFY" --repo "$REPO" --checks "$CHECKS" --format json`.
   Add `--base REV` when the change is already committed (default `HEAD`).
2. Read `outcome`:
   - `done` (exit 0): you may report the work as done. Quote the run `id`.
   - `failed` (exit 2): do not report done. Use `failing` and `reason`, fix the
     change (not the checks), and run verify again.
   - `needs_you` (exit 3): checks pass but a person must review the named items,
     or the checks do not demonstrate the change. Tell the user exactly that.
3. Right before commit, push or merge, run `node "$VERIFY" --check RUN_ID`; it
   passes only if the tree is exactly the verified one and the evidence is current.

Report the outcome, the reason, and which checks failed on the base revision and
passed on the change. A green build, your own test run or your own judgment is not a
substitute for a `done` outcome.
