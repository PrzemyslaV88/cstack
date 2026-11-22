# Set up a project

Analysis (`map`, `analyze-stack`, `impact`) needs Node 22.13+ and project files.
Repairs additionally need Git, an authenticated Codex CLI, and the project's own
dependencies installed the way you normally install them. There are no images to
build and nothing to download: setup checks your environment, it does not call a
model or install anything.

```sh
npm ci                      # or: python -m venv .venv && .venv/bin/pip install -r requirements.txt
node src/cli.mjs setup --repo /project --format json
node src/cli.mjs profile show --repo /project
```

## One environment for the worker and the verifier

Setup discovers installed dependency folders in the project scope (`node_modules`
for Node projects; `.venv` or `venv` containing `pyvenv.cfg` for Python projects) and
records them in the profile. Override discovery with
`--dependencies node_modules,.venv`. Each folder must be git-ignored and contain no
tracked files; a symbolic link needs a pattern without a trailing slash
(`node_modules`, not `node_modules/`), because git does not apply directory patterns
to links.

A run links those folders read-only into the coding worker's private worktree and
into every sealed candidate. The worker and the verifier therefore run the same
interpreter, test runner and packages, and the worker's shell `PATH` includes the
same `.venv/bin` and `node_modules/.bin` directories as the verifier. The links are
controller owned: replacing, retargeting or removing one blocks the run. Their
contents are never part of a candidate, a review diff or a delivered patch. A stat
fingerprint of each folder (paths, sizes, modes, modification times, link targets;
`__pycache__` and tool caches excluded) is part of the runner identity, so
reinstalling or upgrading dependencies makes earlier evidence `STALE_EVIDENCE`.

## The sandbox

Verification runs offline in an OS sandbox. On Linux it uses unprivileged user,
mount, network and PID namespaces with a minimal read-only root. On macOS it uses
the built-in Seatbelt (`sandbox-exec`) with a deny-by-default profile. In both, the
candidate is read-only, only a private scratch directory is writable, the home and
temporary directories (where controller state and credentials live) are hidden
except for the candidate, the runner scripts, the dependency folders and the
runtimes they need, and there is no network. Before first use in a process the
runner proves these properties with a self-test; if any check fails it refuses to
verify. See [SECURITY.md](SECURITY.md).

## Profiles and adapters

If several application directories or test runners are detected, select `--scope`
and/or `--adapter`. Profiles are private, immutable files under `CSTACK_HOME/projects`.
Changes to manifests, locks, test configuration or selected convention documents
invalidate them. Profiles made by cStack 0.5 (Docker images) are refused; rerun setup.
A user-edited draft can be accepted with `setup --repo /project --profile draft.json`.

Supported test runners are the project's own installed pytest 7–9, Vitest 4.x and
the Node built-in test runner. The exact version found is recorded with the evidence.
Adapter tests use a disposable scratch copy; the sealed candidate remains read-only.
A missing or unsupported runner is a setup problem (`PROJECT_DEPENDENCY_MISSING`,
`TEST_RUNNER_VERSION_UNSUPPORTED`), never a failed coding attempt.

## Plans

An acceptance file supplies real probe commands, inputs and expected outputs. See
[CONTRACT.md](CONTRACT.md). `plan` reproduces the baseline without a worker, freezes
source/profile/environment/contract identities, and prints the exact digest for
`run --plan`. An already-satisfied baseline produces no new repair claim or worker
tokens. Changed inputs, including changed dependencies, require a new plan. Resuming
an existing run never resets its limits.

`plan --source-mode working-copy` repairs projects with existing edits. Clean mode
remains the default. Setup may inspect either state; only the frozen plan selects the
repair baseline. [Working-copy preservation and strict drift
checks](REVIEW_AND_DELIVERY.md#start-with-existing-edits-in-05) explain what can be
captured and applied safely.

## Limits

- Dependencies must live in git-ignored folders inside the project. Global installs
  outside system directories are not linked; Yarn Plug'n'Play is not supported.
- The Linux runner needs unprivileged user namespaces (`unshare --user`); some
  container platforms disable them. Native Windows is unsupported; use WSL2.
- The macOS Seatbelt profile has not been exercised in this repository's automated
  tests, which run on Linux. Its self-test runs on every machine before use.
- Docker, image plans (`env plan`, `env prepare`) and `--image` were removed in 0.6.
