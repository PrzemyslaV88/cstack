# Multiphase work, bounded loops and context recovery

Version 0.6 extends the existing four skills and local controller. It adds no
runtime dependency, second coding worker or external service.

## Prepare and freeze

For a rough request, the outer skill inspects the project and fills a local brief:

```sh
node src/cli.mjs intake "Observable outcome" --repo /project --out /private/intake
node src/cli.mjs intake compile --brief /private/intake/brief.json --repo /project --out /private/acceptance
```

The draft is deliberately non-executable. `outcomes` contains objects with:

- `criterion`: an existing supported independent probe, test or genuinely manual check.
- `source`: the requirement or independent specification establishing its expected result.
- `seam`: the public interface the check exercises.

`tasks` uses the existing `id`, `title`, `depends_on` and `criteria` fields. Each
task delivers a complete verifiable behavior. For work spanning interfaces, include
required whole-path checks in `integration_criteria`; their tasks depend on all
implementation tasks. Material unanswered `questions` block compilation. Compact
`non_goals`, `assumptions` and `decisions` accompany each new session.

The compiler validates structure; it does not establish that a requirement or
expected value is correct. Never derive expected results from the faulty source.
Use the compiled `acceptance.json` with existing `setup`, `plan` and `run` commands.
An automatically discovered supporting suite is assigned to the last supplied
task. Select the final integration task last when preparing a multitask brief.

New guided plans use plan schema 2 and a separate `workflow.json`, with the
workflow, preparation, runtime and guidance identities frozen by the plan digest.
The executable contract remains schema 3. Old schema-1 plans execute with their
legacy continuity behavior. Existing runs without workflow metadata remain legacy
runs. A runtime identity mismatch requires the original packaged runtime or a new
plan; it cannot silently change active run semantics.

## Phases and loops

Preparation establishes the outcome and reproduction. Planning maps the requested
behaviors to dependency tasks. One worker implements a ready slice; the controller
seals and verifies it. Integration criteria cover the complete path. Current human
review and delivery rules finish the work.

Planning resolves the next material unknown instead of repeatedly rewriting the
whole plan. Short work can combine preparation phases without separate model calls.
Implementation requests continue beyond a compiled brief into the repair workflow.
Frozen acceptance and task graphs cannot be edited in place. A revised scope needs
a new plan; consumed budgets must never be bypassed through new runs.

The repair loop retains existing attempt, time, usage, no-change and repeated-failure
stops. Integration failures remain required outcomes and prevent completion even
when earlier slices pass. Whole-project completion is never inferred from notes.
Once current required checks and review gates pass, unrelated improvement loops end.

## Sessions and context

The default `boundary-v1` policy starts a fresh thread for a new task, after a
recognized compaction event, during crash recovery and after two turns in the same
session. A short same-task correction can resume. The explicit `resume-v1` policy
retains continuity for comparison. `max_session_turns` is configurable from 1–10;
it is a bounded-continuation policy, not a measured model limit.

Rotation keeps the run ID, private worktree, attempts, usage, failures and review
gates. It clears the old thread/excerpt cache before selecting context. A fork
inherits history and is not used for refreshing context.

Starting packets are rebuilt from current controller state: root constraints,
task, unmet required outcomes, candidate/environment identities, remaining budget
and relevant advisory notes. Source excerpts are supplied again to a fresh thread.
The journal and prior handoffs stay out of the packet. Notes do not accumulate into
an ever-growing model summary. Required data that cannot fit fails preparation
visibly; it is never silently truncated to obtain completion.

Workflow prompts remain capped at 32,000 bytes. Their selected source excerpts use
up to 8,000 bytes; controller packets use up to 6,000 bytes and worker notes up to
4,096 bytes. Smaller packet/note allowances can be frozen in the workflow policy.
Byte limits are not token counts. Cumulative tokens and cached input counters do
not establish current context occupancy. Unsupported or unreported compaction
signals remain unknown; task boundaries and the turn ceiling provide the fallback.
The current transport does not promise mid-turn context-pressure intervention.

Curated diagnosis, behavioral testing and interface guidance enters through the
controller prompt. Plugins, delegation, hooks and apps remain disabled. Host test
dependencies may differ from the verifier image. Only claim tests or a test-first
cycle actually executed. Worker handoffs are validated, bounded and redacted;
unknown files, oversized notes and attempted authority fields are rejected. Missing
or invalid notes are reported and do not override independent evidence.

Selected convention documents remain hashed project data. The workflow uses
bounded goal-term matches to select later glossary/ADR entries. Matching is lexical,
not semantic understanding, and source limits still apply.

## Checkpoint and recover

Checkpoint artifacts contain controller facts, candidate/contract/workflow/environment
identities, task/evidence references, consumed budgets and advisory note records.
They live outside the worker repository. Files are written and synced before the
SQLite state/event transaction publishes their digest. An orphaned artifact cannot
become the current checkpoint. The SQLite run remains the authoritative state.

```sh
node src/cli.mjs checkpoint RUN_ID --format json
node src/cli.mjs checkpoint RUN_ID --out /private/checkpoint-export
node src/cli.mjs checkpoint recover RUN_ID --snapshot CURRENT_SOURCE_SHA256
node src/cli.mjs resume RUN_ID
```

Missing/corrupt artifacts block worker admission. Explicit recovery reconstructs a
checkpoint from the current controller record only when the supplied snapshot
matches the worktree and sealed candidate. Recovery invalidates conversation caches
and preserves every consumed attempt, usage counter and approval gate. Resume still
revalidates the environment and candidate; recovery awards no test pass or approval.
Source divergence requires inspection and a fresh plan, not overwriting user work.

## Review and investigations

`review RUN_ID --out DIR` adds before/after requirements coverage, copied and
hash-checked evidence, session/reset reasons, advisory standards signals and a local
`pr.md`. Reports retain stale-evidence and human-review distinctions. Standards
signals describe changed text; no independent semantic review is claimed. A PR
summary is a local artifact, not publication or an assessment that production
effects are safe.

`retro RUN_ID [RUN_ID ...]` inspects up to 20 selected recorded runs and proposes
environment/navigation/check improvements. It does not reverify candidates or modify
policy. `architecture --repo PATH [--focus FILE]` reports import evidence and
potential interface investigation targets. Graph degree and cycles are not proven
design defects. Read relevant glossary/ADR and caller tests before proposing a
refactor; execute an authorized refactor under a separate acceptance contract.

## Evidence and limits

Functional tests cover task-boundary resets, same-task continuation, recognized
compaction, legacy continuity, immutable policy, bounded notes, corruption/crash
boundaries, unmet integration checks, stale source and report exports. Scripted
workers plus real Docker verification establish controller behavior, not model
quality or usage savings. The historical 0.5 benchmarks remain unchanged. Compare
paired model runs and full preparation/review usage before claiming this workflow
improves model performance. A parent scheduler, app-server transport or platform
adapter is a separate extension when evidence warrants it.
