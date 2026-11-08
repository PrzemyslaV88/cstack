# Phases, loops and context recovery

Preparation establishes the outcome, reproduction and executable task graph.
Implementation works one dependency-ready behavior. Controller verification drives
bounded corrections. Integration checks the complete requested path. Review and
requested delivery finish the outcome. A small repair can combine preparation
steps; it need not spend a model call on every phase.

The worker receives curated diagnosis and behavioral-testing guidance directly
from the controller. Plugins, hooks, apps, delegation and billing fallbacks remain
disabled. Tests added by the worker support, but never replace, frozen probes.
Host dependencies can differ from the verifier image: claim a red/green cycle only
when the relevant tests actually ran. A missing native platform adapter is a stated
verification gap, not a reason to invent a test pass.

New workflow runs retain one private worktree and budget while changing sessions.
The default `boundary-v1` policy starts fresh at task boundaries, after known
compaction, during crash recovery and after a bounded same-task continuation.
`resume-v1` exists for explicit continuity comparisons. A fork copies old history;
it does not provide fresh context. Aggregate token expenditure is not occupancy.

Starting packets are rebuilt from frozen requirements and current controller
facts. Preserve the root outcome, current task, unmet criteria, constraints,
candidate identity, budget and relevant failure details. Selected source excerpts
are resent to a fresh thread. Worker notes are bounded, redacted and advisory;
they cannot set completion, approval, evidence, contract or budget state.

Use `checkpoint RUN_ID` to inspect the durable checkpoint and `status`, `report`
and `review` for current progress. Artifact publication precedes the transactional
state pointer, so an orphaned artifact cannot become the active checkpoint. Missing
or corrupt checkpoint artifacts block continuation. `checkpoint recover RUN_ID
--snapshot SHA256` explicitly rebuilds a checkpoint from controller state only when
the current sealed source matches; resume still revalidates all checks and budgets.

Planning ends when the next slice is executable. Repair ends on current accepted
checks or a recorded budget, no-change, repeated-failure or external blocker.
Integration failures return concrete feedback to the responsible task. Human
review gates remain explicit. Do not spin endlessly, add unrelated polish after
acceptance, or stop an implementation request at a successful planning step.

Reports include requirements coverage, before/after evidence, advisory standards
signals, session/reset reasons and a local `pr.md`. A semantic model review has not
occurred merely because a standards section exists. No report grants approval or
publishes a PR.
