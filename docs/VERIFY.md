# Verify a change before calling it done

`cstack verify` is a completion gate for any coding workflow. An agent (or a person)
makes a change however it likes: pstack's `/poteto-mode`, Claude Code, Cursor, Codex,
or by hand. Before anyone says "done", cStack runs frozen checks itself and answers
`done`, `failed` or `needs_you`. It never calls a model, never installs anything and
never modifies your repository.

```sh
cstack verify --repo . --checks .cstack/checks.json --format json   # exit 0 done, 2 failed, 3 needs you
cstack verify --check RUN_ID                                       # right before commit/push/merge
```

In Claude Code (`/plugin install cstack --marketplace PrzemyslaV88/cstack`) it is the
`/cstack:verify` skill, and `cstack` is on the Bash tool's PATH. In Codex it is the
`$cstack:verify` skill.

## What it proves

1. **The checks detect the problem.** A private worktree is created at the base
   revision (`--base`, default `HEAD`) and the checks run there first. For a `FIX`
   they should fail. If they already pass, the result is `needs_you`: the checks do
   not show that the change does anything. Use `"type": "REFACTOR"` for
   behavior-preserving changes, whose checks are expected to pass before and after.
2. **The change passes them.** The working copy is imported exactly as it is
   (tracked and untracked, non-ignored files) and checked in the same OS sandbox:
   offline, read-only candidate, home directory and credentials hidden, with the
   project's own installed dependencies. See [SETUP.md](SETUP.md).
3. **It is a real change.** No change, or a change to tests, docs or configuration
   only, is not completion.
4. **The checks were not weakened.** A checks file inside the repository is read from
   the base revision, so the change cannot edit its own expected outputs. Editing that
   file, existing tests or test configuration needs a person's review (additive Python
   tests are exempt when they are proven harmless; see
   [CONTRACT.md](CONTRACT.md#test-changes-schema-3)).
5. **The evidence is about this exact tree.** Results are bound to the candidate's
   content digest, the checks, the verifier code, the sandbox and the dependency
   fingerprints. `verify --check` passes only if the current tree is byte-for-byte the
   verified one (committing it is fine) and that evidence is still current.

`done` means the declared checks pass on this change, not that every possible behavior
is right. Strong checks matter more than anything else here.

## Checks file

```json
{
  "goal": "Repair calculator addition",
  "type": "FIX",
  "criteria": [{
    "id": "ADD",
    "kind": "probe",
    "text": "Addition is correct for positive and mixed-sign inputs",
    "argv": ["node", "--input-type=module", "-e", "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';console.log(JSON.stringify(add(...JSON.parse(readFileSync(0,'utf8')))))"],
    "cases": [{"stdin": "[4,2]", "expect_json": 6}, {"stdin": "[-5,3]", "expect_json": -2}]
  }]
}
```

Allowed keys: `goal`, `type` (`FIX`, `FEATURE`, `REFACTOR`), `policy`, `criteria`,
`tasks`, `implementation_paths`, `context`, `approved_test_fixtures`,
`test_change_policy`, `dependencies` and `timeout_ms`. Criteria are the same as in
[CONTRACT.md](CONTRACT.md): `probe` (independent behavioral evidence), `node-test`,
`test-suite` (pytest or Vitest) and `manual`. Test suites alone are supporting
evidence; add a probe, or the result is `needs_you`.

Commit the checks before the change (for example as `.cstack/checks.json`), or keep
them outside the repository. Checks inside the repository that are not committed at
the base revision are refused (`CHECKS_NOT_FROZEN`).

## Reading the result

| `outcome` | Exit | Meaning | What the agent should do |
|---|---:|---|---|
| `done` | 0 | Checks failed on the base (for a fix) and pass on this change, with current evidence and nothing to review. | Report done and quote the run ID. Run `verify --check` before commit/merge. |
| `failed` | 2 | Checks fail, nothing changed, only tests changed, or an environment/isolation problem. | Do not report done. Fix the change, not the checks; rerun. |
| `needs_you` | 3 | Checks pass but a person must review protected edits, or the checks do not demonstrate the change. | Tell the user exactly what needs review. |

The JSON also lists each check's baseline and change status, the failing checks with
diagnostics, changed paths, pending reviews and the report path. Every verify run is
an ordinary cStack run: `status`, `report`, `review` and `evidence` work on its ID.
`patch` and `apply` are refused because the change is already in your working copy.

## Use it with pstack

pstack's `/poteto-mode` tells agents to "prove it works" against the real artifact
before declaring done, and its shipping and autopilot playbooks verify before
landing. Those rules are instructions to the model. `cstack verify` is a check the
model cannot skip or argue with, and it composes with pstack without changing it:

1. Commit `.cstack/checks.json` for the task (ideally reviewed by a person; pstack's
   `tdd` or bug-fix reproduction step is a good source of probe cases).
2. Add a rule your host loads with pstack. For Cursor, a project rule in
   `.cursor/rules/`; for Claude Code, `CLAUDE.md`; for Codex, `AGENTS.md`:

   ```text
   Before declaring any task done, opening a PR or landing a stack, run
   `cstack verify --repo . --checks .cstack/checks.json --format json`.
   Report done only if `outcome` is `done`; on `failed`, fix the change (never the
   checks) and rerun; on `needs_you`, stop and tell me what needs review.
   Before every commit or merge, run `cstack verify --check <id>`.
   ```

   If you use `/automate-me` to build your own mode, put the same step in it.
3. Make it mandatory outside the model with a hook or CI step (below). The rule makes
   the gate likely; the exit code makes it binding.

## Make it binding: hooks and CI

A git pre-push hook (`.git/hooks/pre-push`, executable) that refuses to push an
unverified change:

```sh
#!/bin/sh
exec cstack verify --repo "$(git rev-parse --show-toplevel)" \
  --checks .cstack/checks.json --base "@{upstream}" --format json >/dev/null
```

`--base` is the revision the change is measured against: here, what the remote
already has. verify checks the working copy, so push from a clean tree; then the
verified content is exactly what you push. In CI, run the same command against the target branch (for example
`--base origin/main`) after installing the project's dependencies; a non-zero exit
fails the job.

CI and hook runners need Node 22.13+, Git and, on Linux, unprivileged user
namespaces. Some distributions restrict them; if `cstack doctor` reports `ISOLATION`,
verification refuses to run rather than running unsandboxed.
