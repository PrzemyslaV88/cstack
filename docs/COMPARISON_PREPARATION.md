# Local comparison preparation — 1 November 2026

Historical no-model preparation record. A subsequent authenticated pilot completed;
see [live comparison results](COMPARISON_RESULTS.md) for the active experiment and
measured outcomes. The evidence below describes the earlier preparation stage.

The T7 Mac checkout is prepared for the three-arm, one-task Harbor pilot.
The real private-grader handoff passed without invoking any model.
There are zero live contestant runs and no comparative performance result.

## Verified preparation

| Check | Observed result |
|---|---|
| JavaScript syntax | 21 modules passed |
| cStack regression suite | 60 passed; zero failed, skipped or cancelled |
| Benchmark protocol and bridge suite | 52 passed; real Docker bridge with scripted workers |
| Python compilation and wrapper shell syntax | Passed |
| Actual pinned Harbor agent constructors | All three loaded successfully |
| Docker network-policy kernel probe | Supported |
| Upstream unchanged candidate, separate private grader | Reward **0**, no execution exception |
| Upstream known repair, separate private grader | Reward **1**, no execution exception |
| Live model invocations during preparation | **0** |

The private grading phases took approximately 24.5 seconds for the unchanged
candidate and 20.4 seconds for the known repair. These are evaluator validation
timings, not coding-agent performance measurements.

## Locked experiment

- Branch: `comparison/mac-setup`, based on comparison commit `15ad537` plus the
  local preparation changes.
- Work directory: `/Volumes/CStack-Comparison/pilot-mac-20261101`, reached from
  the repository through `.bench-work/pilot`.
- Task: `swe-bench/sympy__sympy-20590`.
- Model: `gpt-6.1-sol`; reasoning: medium; Codex CLI: 0.163.0.
- Editing limit: 1,800 seconds per arm; one trial each; sequential execution.
- Order: cStack, plain Codex, pstack single-worker adaptation.
- Harbor commit: `5eb713ff9500daced4e143b98765a7c732744a1b` (package 0.25.0).
- Pstack commit: `4dd1d05818d19792e7cd6e818f1667f95f7e1dbe`.
- Implementation digest: `5983dae6bf5a2eab60a289c21b0ccd4cf5631e28e53372fab364abe1e7c8dbcb`.
- Prepared task digest: `373c5c84f059e8c04adf0274adef49f8dd492e2b4e057ec597e68fab6d949fee`.

`lock.json` records the immutable worker/grader/public image identities, public
contract hash and pinned task/pstack contents. `validation.json` records both
independent rewards, absence of execution errors, and `model_calls: 0`. Source or
input changes invalidate readiness and require a new prepared experiment.

## Preparation changes

- Added the `npm run bench -- ...` entry point and a local operating guide.
- Installed pinned Harbor/Python dependencies and recorded their exact versions.
- Provisioned a dedicated Colima engine and APFS runtime stored on T7, with
  Buildx/Compose available to Docker and the drive's space-containing path mounted.
- Resolved symbolic candidate paths before Docker mounts and preserved explicit
  Docker connection settings without forwarding API keys to verification commands.
- Excluded Mac metadata from syntax checking and harness-source hashing.
- Recognized the reviewed upstream SymPy Dockerfile's prebuilt image and pinned
  its digest; warmed grader dependencies during explicit provisioning so the
  actual grader works without network package resolution.
- Kept the networking helper native on Apple Silicon while retaining amd64 task
  images, and checked Compose/Buildx during preflight.

Earlier prerequisite failures are preserved in other runtime experiment folders.
They are setup failures, not contestant results. Original tests and private
acceptance checks were not weakened.

## Start the pilot

```sh
cd "/Volumes/T7 Shield/Projects/cstack-v0.2"
npm run bench -- doctor
npm run bench -- run
npm run bench -- report
```

The explicit `run` command consumes ChatGPT Codex allowance. It has not been run.
Saved ChatGPT authentication was confirmed on the host; a real authenticated
worker turn and live telemetry remain to be exercised. The pstack arm is the
labelled sequential adaptation, not native pstack multiagent execution. One task
with one trial per arm cannot establish a general winner or subscription savings.

The local changes are uncommitted. [Local setup and restart instructions](COMPARISON_LOCAL.md)
describe the runtime lifecycle. Raw logs, task answers and credentials stay out of
Git; the preparation evidence is under `.bench-work`.
