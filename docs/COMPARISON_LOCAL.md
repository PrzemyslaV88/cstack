# Comparison on the T7 Mac

The first live pilot has completed. See [results](COMPARISON_RESULTS.md).
Use `npm run bench -- report` to inspect it; prepare a fresh work directory before
starting another experiment. The launch commands below document the lifecycle.

This checkout uses `comparison/mac-setup`, based on the Harbor comparison pilot.
The three arms are plain Codex, **pstack-adapted-single-worker**, and the real cStack
controller. The pstack arm uses the pinned upstream files sequentially in Codex;
native pstack multiagent operation is outside this experiment.

## Locations and dependencies

- Repository: `/Volumes/T7 Shield/Projects/cstack-v0.2`.
- Runtime disk: `/Volumes/T7 Shield/cstack-runtime/CStack-Comparison.sparsebundle`.
- Mounted runtime: `/Volumes/CStack-Comparison` (APFS, physically stored on T7).
- Python environment: `.bench-venv` links into that runtime.
- Experiment: `.bench-work/pilot` links to the prepared runtime directory.
- Docker context: `colima-cstack`. The wrapper selects it without changing the
  machine's default context. Explicit `DOCKER_HOST`/`DOCKER_CONTEXT` take precedence.

The runtime uses APFS because the T7's ExFAT filesystem produced VM-disk and Python
installation errors. Temporary experiment files retain normal Unix permissions on
APFS. Do not detach the runtime disk or unplug T7 while Colima is running.

Python 3.12, Node 24.7.0, Codex CLI 0.163.0, Colima and Docker Buildx are installed.
Harbor is pinned to the commit in `bench/pilot.json`; its actual package version is
0.25.0. `bench/requirements.lock` records the Python dependencies installed here.
The selected comparison model is `gpt-6.1-sol`, available in the local Codex model
cache, with medium reasoning for every arm. Availability in a live invocation has
not been tested by preparation.

## Restore the local environment after a restart

```sh
hdiutil attach -nobrowse "/Volumes/T7 Shield/cstack-runtime/CStack-Comparison.sparsebundle"
COLIMA_HOME="$HOME/.local/state/cstack/apfs-colima" colima -p cstack start
cd "/Volumes/T7 Shield/Projects/cstack-v0.2"
npm run bench -- doctor
```

Skip `hdiutil attach` if `/Volumes/CStack-Comparison` is already mounted. The guest
fstab has the space in `T7 Shield` escaped so Docker can bind the repository path.

## Check, validate, then run

```sh
cd "/Volumes/T7 Shield/Projects/cstack-v0.2"
npm run bench -- doctor
npm run bench -- test
```

`test` runs source syntax checks, the 60 cStack tests, benchmark protocol/bridge
tests and Python compilation. It uses real Docker verification with scripted
workers; it makes no model calls. `validate` exercises Harbor's private grading:
the unchanged task must fail and the known upstream repair must pass. Successful
validation of the current locked inputs is required before any contestant runs.

Validation has already passed for this prepared experiment; see
[the execution record](COMPARISON_RESULTS.md). Do not rerun `validate` in the
same directory: it preserves completed jobs and refuses to overwrite them. A new
experiment must run its own validation, as shown below.

After that gate passes, the explicit comparison command is:

```sh
npm run bench -- run
npm run bench -- report
```

`run` uses the saved ChatGPT Codex login and consumes account allowance. It runs one
trial per arm, sequentially, with a 30-minute editing ceiling per arm. It refuses
to repeat existing jobs, silently add retries, or use API billing as a fallback.
One task with one trial per arm yields descriptive pilot results only.

Prepared experiments are immutable. To prepare a new experiment after changes to
the harness or task, use a fresh APFS work directory:

```sh
CSTACK_BENCH_WORK=/Volumes/CStack-Comparison/next-pilot npm run bench -- prepare --model gpt-6.1-sol --codex-version 0.163.0
CSTACK_BENCH_WORK=/Volumes/CStack-Comparison/next-pilot npm run bench -- validate
```

The upstream SymPy task declares its prebuilt image in `environment/Dockerfile`.
The preparer recognizes that reviewed recipe and pins the pulled digest. It also
warms the upstream grader's dependencies during explicit image provisioning, then
disables network package resolution during grading. The private grader and known
repair remain outside the worker image.

Logs and task answers stay under `.bench-work` on the runtime disk and are ignored
by Git. Do not publish that directory. See the preparation record beside this file
for checks actually completed and any remaining blocker.

## Stop the runtime

```sh
COLIMA_HOME="$HOME/.local/state/cstack/apfs-colima" colima -p cstack stop
hdiutil detach /Volumes/CStack-Comparison
```
