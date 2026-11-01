# Set up a project

Analysis (`map`, `analyze-stack`, `impact`) needs Node 22.13+ and project files.
Repairs additionally need Git, an explicitly prepared Docker image, and an authenticated
Codex CLI. Setup checks the verifier; it does not call a model or install host packages.

```sh
node src/cli.mjs setup --repo /project --image local-prepared-image --format json
node src/cli.mjs profile show --repo /project
```

If several application directories or test runners are detected, select `--scope`
and/or `--adapter`. Profiles are private, immutable files under `CSTACK_HOME/projects`.
Changes to manifests, locks, test configuration or selected convention documents
invalidate them. Ordinary implementation edits do not change project configuration.
A user-edited draft can be accepted with `setup --repo /project --profile draft.json`.

For dependencies, create an explicit plan outside the project:

```sh
node src/cli.mjs env plan --repo /project --profile /private/profile.json \
  --recipe npm-lock --base-image node:22.16.0-bookworm-slim --out /private/new-environment
node src/cli.mjs env prepare --plan /private/new-environment/environment-plan.json \
  --expect-plan DIGEST_PRINTED_BY_PLAN
```

The base image must already exist locally. Preparation uses only copied manifests/locks,
a generated Dockerfile and pinned image identity. npm uses a v2/v3 package lock with
scripts disabled; pip needs exact versions and wheel hashes. Workspaces, local/private
packages, source compilation, other package managers and custom build scripts need a
manually prepared image. Planning and verification do not use the network. Explicit
preparation may download the dependencies shown in its frozen plan.

Supported compatibility targets: pytest 8.3.5 with Python 3.12, Vitest 4.0.18 with
Node 22.16/24, and the existing Node built-in test runner. These are tested pins,
not claims to support every release. Dependencies installed in an image are not
installed in the host coding worker. Adapter tests use a disposable scratch copy;
the sealed candidate remains read-only. Oversized scratch copies and a conflicting
candidate-owned node_modules are refused.

An acceptance file supplies real probe commands, inputs and expected outputs. See
[CONTRACT.md](CONTRACT.md). `plan` reproduces the baseline without a worker, freezes
source/profile/image/contract identities, and prints the exact digest for `run --plan`.
An already-satisfied baseline produces no new repair claim or worker tokens. Changed
inputs require a new plan. Resuming an existing run never resets its limits.

Version 0.5 supports explicit `plan --source-mode working-copy` for projects with
existing edits. Clean mode remains the default. Setup may inspect either state;
only the frozen plan selects the repair baseline. [Working-copy preservation and
strict drift checks](REVIEW_AND_DELIVERY.md#start-with-existing-edits-in-05) explain
what can be captured and applied safely.
