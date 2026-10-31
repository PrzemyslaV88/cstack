# cStack — Completion-First Engineering Harness

**Design specification:** v0.1  
**Date:** 2026-10-31  
**Status:** Proposed; not implemented  
**Primary user:** Solo developer / founder using Codex within practical usage limits  
**Primary objective:** Maximise independently verified software outcomes per unit of agent usage, not agent activity.

## 0. Product thesis

cStack is a **local-first, single-agent-by-default orchestration and verification controller** for AI coding. It wraps a real coding agent (Codex first), manages the task as a graph of deliverables, gathers objective evidence, and gates completion. The AI may propose completion but cannot authoritatively mark acceptance checks as passed.

> **A successful run is a verified change that meets the user's objective, not a plausible-sounding summary of investigation, tests, or code activity.**

cStack is **not**: a new foundation model; a generic swarm; a substitute for a test strategy; a promise that tests prove complete correctness; an autonomous production deployer; a replacement for Git, CI, or Codex's own tool harness.

### Normative terms

- **MUST** = required for v1 acceptance.
- **SHOULD** = expected unless justified otherwise.
- **MAY** = optional.
- **Controller** = deterministic cStack process, not the coding LLM.
- **Worker** = Codex thread making code changes.
- **Oracle** = independent verifier (test/command/manual approval) that supplies evidence for an acceptance criterion.
- **Contract** = versioned, frozen record of intent and completion requirements.
- **Run** = one request to cStack, containing attempts and evidence.

## 1. Problem and measurable product outcomes

### Problems

1. **False completion:** AI writes an audit, plan, or tests and reports an implementation as finished.
2. **Unbounded deliberation:** repeated tool calls and subagents consume limited subscription usage without proportional progress.
3. **Context waste:** large repository files and repeated logs are read on every iteration.
4. **Test gaming:** agents weaken or rewrite tests to make a pass appear, while real behaviour remains broken.
5. **No resumability:** intermediate findings are forgotten, invalidated, or redundantly rediscovered.

### Primary success measures

- **Verified resolution rate:** completed tasks independently demonstrated to satisfy all required criteria / attempted tasks.
- **Validated acceptance coverage:** required criteria with current passing evidence / all required criteria, separately reported from verified resolution rate.
- **Use efficiency:** verified resolutions per million reported model tokens, and per consumed plan allowance when the provider exposes a reliable measure. Report tokens and elapsed time as separate quantities.
- **Rework rate:** proportion of tasks requiring a user to reopen the same defect.
- **False-completion rate:** proportion reported verified but disproven by subsequent independent reproduction or user acceptance.
- **Regression rate:** newly introduced failures per change, with baseline-failure separation.

Do **not** optimize a weighted 'AI productivity score' until individual measurements are understood. Output code size, number of tool calls, plans written, and tests written are diagnostics, NOT success measures.

## 2. First principles and hard invariants

1. **Implementation requests must change implementation.** For a `fix` or `feature`, analysis-only or tests-only output cannot be VERIFIED. A legitimately no-code solution requires explicit user approval or a different contract type.
2. **The controller owns state.** The LLM cannot directly mark contracts complete, fabricate test results, or rewrite protected criteria.
3. **Evidence is attached to immutable context.** Each verification result records commit/tree hash, command, environment, verifier version and timestamp. Changed code invalidates affected evidence.
4. **One worker by default.** Additional workers/reviewers require an explicit opt-in or separately enabled high-risk policy; never silently spawn them.
5. **Bounded work, not bounded ambition.** A retry cap stops an unproductive run, checkpoints the work and reports a blocker; it does not misrepresent incomplete work as success.
6. **Least privilege.** Work in a dedicated Git worktree. Never silently delete local changes, overwrite untracked files, push, merge, deploy, apply migrations, create external charges, or change secrets.
7. **No hidden changes to success conditions.** Changing scope or acceptance criteria requires a new contract version and must be visible to the user.
8. **Never reduce test quality to make a run green.** Modified test files are allowed when necessary but must be disclosed; independently stored acceptance checks are not worker-editable.
9. **Fail honestly.** `BLOCKED`, `BUDGET_EXHAUSTED`, `NEEDS_MANUAL_VERIFICATION`, and `PARTIAL` are first-class outcomes; not all tasks can be completed autonomously.
10. **Replayability.** Run and verifier decisions can be reconstructed from persisted events; execution cannot depend solely on an LLM's prose memory.

## 3. System architecture

```text
                       User objective
                             |
                  Contract compiler + policy
                             |
                frozen, versioned contract
                             |
             +---------------+---------------+
             |               |               |
       Code graph       Task graph      Evidence graph
        what is          what must       what actually
       impacted          be done          works
             +---------------+---------------+
                             |
                       Run controller
                state / budget / scheduling
                             |
                      One Codex worker
                 read -> implement -> repair
                             |
                  Independent verification
              isolated tests + impact checks
                             |
            verified / partial / blocked report
```

### Major components

| Component | Responsibility | Non-LLM implementation for v1 |
|---|---|---|
| CLI | Local user entrypoint and status/report commands | Node.js TypeScript |
| Contract compiler | Convert goal to typed task, gather baseline, freeze oracle definitions | JSON Schema + validation; allow one Codex turn to draft criterion suggestions |
| Code mapper | Identify likely relevant files and dependents | Git + language-aware imports and symbol index; defer full semantic graph |
| Task graph | Store action nodes, dependencies, readiness, required acceptance links | SQLite adjacency records + deterministic scheduler |
| Evidence graph | Link criteria to verifier runs, files, commits, environment and owner | SQLite relational model; content-addressed evidence files |
| Run controller | Transition states, enforce retries, budget and approval gates | TypeScript finite-state machine |
| Codex adapter | Start, stream, resume or interrupt one worker thread | Official Codex TypeScript SDK; app-server only if needed later |
| Verification runners | Execute checks in restricted environment; gather evidence | `child_process`, tool adapters, CI runners, Playwright etc. |
| Run store | Durable state and resumability | SQLite + JSONL event journal + file artifacts |
| Delivery | Generate human-readable release report and optionally commit/PR | Git and optional GitHub CLI; no implicit deploy |

Do **not** start with LangGraph, Neo4j, Redis, a vector database, a GUI, or a second agent. The graphs can be represented by small indexed SQLite tables. Their usefulness comes from correct edges, not graph-database branding.

## 4. Contract model and request classification

### Contract types

- `FIX`: a defect with a reproduction or measurable broken behaviour; source modifications usually required.
- `FEATURE`: new behaviour and user-facing integration; source modifications required.
- `REFACTOR`: intended behaviour preserved; source modifications required; regression checks central.
- `INVESTIGATE`: research, diagnosis or audit **only when explicitly requested**; report may be the final deliverable.
- `MIGRATION`: requires explicit staging and potential human checkpoints for data/schema changes.

A plain-language request such as 'fix subscriptions' maps to `FIX`, **not** `INVESTIGATE`. Draft minimum acceptance tests and assumptions. If the ambiguity is low, proceed under recorded assumptions; if security, payments, data loss or irreversible impacts are ambiguous, pause the affected action for approval while doing safe independent work.

### Proposed contract JSON

```json
{
  "schema_version": 1,
  "id": "CST-2026-001",
  "type": "FIX",
  "goal": "Restore purchases after reinstall",
  "repo": {"root": ".", "base_ref": "main", "base_sha": "<captured-sha>"},
  "assumptions": ["Existing signed-in user", "Supported test platform"],
  "must_change_runtime_code": true,
  "criteria": [
    {"id": "AC1", "text": "Active entitlement restores after reinstall", "required": true, "verification": "integration", "oracle": "verify:restore-active"},
    {"id": "AC2", "text": "Expired entitlement remains locked", "required": true, "verification": "integration", "oracle": "verify:restore-expired"},
    {"id": "AC3", "text": "Purchases screen shows accurate state", "required": true, "verification": "manual_or_ui", "oracle": "verify:ui-state"}
  ],
  "risk": "high",
  "policy": "balanced",
  "attempt_limit": 3,
  "requires_human_approval": ["production_write", "billing_change", "deploy"]
}
```

The `verify:*` names above are **examples**, not available test commands. Repo adapters must bind each oracle to an actual command or a manual-verification gate before claiming verification. Missing oracle -> `UNVERIFIABLE`, not `PASS`.

### Contract freeze

- The user goal and required acceptance criteria are frozen before implementation.
- cStack stores contract hash outside the worker-editable worktree.
- Worker may submit `change_request` with rationale and suggested criterion updates; cannot apply those updates.
- Accepted revisions generate a new contract version and invalidate evidence as appropriate.
- Criteria have `required`, `risk`, `proof_kind`, `oracle`, and `status` fields.

## 5. Graph design

### Graph A — Code / impact graph

Nodes: file, symbol (later), test target, runtime entrypoint, API endpoint, database schema, UI surface.

Edges: imports, calls (when confidently detected), exports, tests, renders, writes, configures, depends-on. Each edge stores `source`, `confidence`, `parser_version`, and `indexed_at_sha`. Unknown edges remain unknown; never represent heuristic relationships as proven.

V1 starts with file-level Git and import graphs, test file mapping, and a small amount of language-specific symbol extraction (TypeScript first). Produce a **targeted context pack** for Codex rather than dumping repository contents. Refresh changed nodes incrementally and invalidate their dependents. Use a token cap for the selected context pack, configurable per mode. Only later add Tree-sitter for polyglot symbol extraction or sophisticated static call graph analysis.

### Graph B — Task / dependency graph

Nodes contain `task_id`, `title`, `type`, `dependencies`, `acceptance_criteria_ids`, `risk`, `status`, `changed_paths`, `attempt_count`.

Statuses: `TODO`, `READY`, `IN_PROGRESS`, `VERIFYING`, `PASS`, `RETRYABLE_FAIL`, `BLOCKED`, `SKIPPED_WITH_APPROVED_REASON`.

- Dependency edges must form a DAG; reject cycles at contract compilation.
- Select **one READY task at a time** for the single worker.
- Prioritize prerequisites, high-risk interfaces, and tasks that unlock more work; avoid needless task fragmentation.
- A graph may contain implementation nodes and verification nodes, but a passing verification node cannot substitute for its implementation dependency.
- If a change invalidates an already passed dependent test, return affected nodes to READY/VERIFYING.

### Graph C — Evidence / claims graph

Entities: `criterion`, `source_change`, `test_case`, `verifier_run`, `environment`, `artifact`, `manual_approval`, `commit_sha`.

Relations: `source_change -> implements -> criterion`; `verifier_run -> demonstrates -> criterion`; `verifier_run -> ran_against -> commit_sha`; `artifact -> captured_by -> verifier_run`.

Verifier record requires: command or procedure ID, process exit code, stdout/stderr file hashes, duration, environment fingerprint, baseline comparison, commit/tree hash, timestamp, oracle version, and outcome.

Verification states: `NOT_RUN`, `PASS`, `FAIL`, `ERROR`, `UNVERIFIABLE`, `STALE`, `NEEDS_MANUAL_REVIEW`.

Required criteria only count as proven with **current**, trusted evidence. A PASS on a previous tree SHA is STALE unless an explicit deterministic impact calculation has established that the tested scope is unchanged; v1 conservatively reruns relevant checks. The LLM's final message is never evidence.

## 6. Run state machine

```text
CREATED
  -> PRECHECK (repo, permissions, environment, auth, dirty-tree checks)
  -> BASELINED (capture existing test failures, repo tree and contract)
  -> READY
  -> IMPLEMENTING
  -> VERIFYING
       | PASS + all criteria current -> VERIFIED
       | manual proof missing       -> NEEDS_MANUAL_VERIFICATION
       | diagnosable failure        -> REPAIR_READY -> IMPLEMENTING
       | permission/infrastructure  -> BLOCKED
       | insufficient quota/budget  -> BUDGET_EXHAUSTED
       | repeated nonprogress       -> STALLED
  -> DELIVERY_READY (commit/PR actions subject to explicit permissions)
  -> DELIVERED (only after requested delivery succeeded)
```

`VERIFIED` does **not** mean shipped; `DELIVERED` does **not** imply deployed. All terminal statuses include an explicit evidence report and preserved worktree/checkpoint.

### Agent attempt protocol

1. Controller creates a worker turn with: objective, specific READY task, current code-context pack, relevant prior failure, fixed acceptance identifiers, allowed tools, and a single deliverable.
2. Worker must implement the task; can diagnose as needed but cannot mark the task passed.
3. Controller observes streaming events and records token usage where available, tool attempts, changed files and elapsed time.
4. Worker returns a structured proposal: changed paths, hypothesis, intended criterion mapping, test suggestions and known blockers.
5. Controller obtains actual Git diff and independently runs relevant checks. It does **not** trust the proposal as an account of what changed.
6. Controller records a failure signature and distinguishes: code defect, environment issue, flaky test, missing oracle, permission, ambiguous request or external service.
7. Retry only if an actionable new hypothesis or material implementation change exists. A repeat identical fix/test cycle without new evidence is rejected.
8. After 2 consecutive non-improving attempts, require a documented strategy change. Default maximum is 3 attempts per task; then STALLED/PARTIAL with preserved code and findings. Never silently switch to more agents.

### Progress criterion

Progress is a vector, not a subjective '70% done':

- required acceptance checks currently passing;
- previously failing reproduction now passing;
- new regressions caused by changes;
- number of unresolved blocking root causes;
- remaining task-graph nodes;
- evidence confidence.

Improvement in one measure must not hide a critical regression in another. Do not collapse these into a single model-rated percentage.

## 7. Verification design: protect against fake success

**Baseline:** Before any change, capture a clean working tree / branch SHA, build environment metadata, test discovery and relevant preexisting failures. For defect fixes, establish a reproducible failure where feasible. If reproduction cannot be achieved, mark corresponding evidence limited, rather than inventing a failing test.

**Protected oracle:** Acceptance definitions, approval decisions and test-configuration snapshots live in controller-owned state outside worker write scope. The worker may edit normal repository tests as part of implementation, but every test change is diff-reviewed. For critical tasks, a separate isolated end-to-end check or user acceptance is required.

**Verification ladder:**

1. Parse/typecheck/lint relevant files.
2. Targeted unit tests and build.
3. Integration tests for affected boundaries.
4. Actual application or UI checks when behaviour is UI-dependent (e.g., Playwright, simulator, device, service sandbox).
5. Broader regression checks and security checks based on impact graph.
6. Human approval for irreversible changes, real payment or production behaviour, non-automatable platform integration, and other high-risk gaps.

This is an adaptive ladder, not a requirement to run every test on every minor patch. It becomes stricter as risk rises.

**Anti-gaming rules:** cStack flags weakened assertions, removed tests, skipped checks, replacement of source with test-specific stubs, modified verifier configuration, suspicious network fetches and altered snapshots. Flags prompt independent validation, not automatic accusations. A clean unit-test pass cannot override a failing E2E acceptance oracle.

**Completeness semantics:**

- `VERIFIED`: all required acceptance criteria have current evidence; no new critical regression; required implementation/delivery conditions satisfied.
- `PARTIAL`: some criteria satisfied, others not. Report exactly which.
- `BLOCKED`: safe completion prevented by external dependency, permissions or environment.
- `STALLED`: retries have not yielded further measurable progress.
- `NEEDS_MANUAL_VERIFICATION`: all automatable checks pass but essential real-world claim lacks reliable automation.
- `INVESTIGATED`: legitimate terminal state only for `INVESTIGATE` contracts.

## 8. Budget governor

**Default: one Codex thread, one task active, no subagents.**

Modes (initial tuning hypotheses; benchmark them):

| Mode | Attempts/task | Retrieval | Validation | Second agent |
|---|---:|---|---|---|
| Lean | 2 | Tiny targeted context | Targeted + required acceptance | Never |
| Balanced (default) | 3 | Impact-aware context | Required acceptance + relevant regressions | Opt-in only |
| Critical | 3 | Broader dependency context | Expanded E2E/security + human gates | Explicit authorization only |

Token and usage handling:

- Read actual usage events from the Codex SDK where available; track input/output/cached usage separately and by run. Preserve raw provider fields and their interpretation/version.
- The SDK's usage counters are NOT automatically a reliable view of remaining ChatGPT subscription quota. Do not claim the user has a known number of 'tokens left' unless a supported quota endpoint exists.
- Support hard `max_turns`, `max_attempts`, `max_wall_time`, `max_context_tokens_per_pack` and external API dollar ceilings **when trustworthy usage data permits enforcement**. For unknown subscription allowance, prefer conservative per-run turn/attempt caps and an explicit stop on provider limit errors.
- No automatic paid API fallback from ChatGPT-authenticated Codex without the user's opt-in and spending limit.
- Reserve capacity for verification (policy, not fictitious guaranteed quota): don't consume every attempt on reconnaissance.
- Avoid loading entire histories on retry; pass a concise evidence-backed attempt summary and relevant code diff.
- Cache repository maps by Git SHA; cache verifier dependency setup where safe.
- No periodic LLM 'progress reviews' that merely restate what the controller already knows.

Potentially useful cost routes must be checked in the user's actual account. Subscription usage and billable API usage are different accounting surfaces; a $200 plan is not an unlimited compute contract.

## 9. Security, permissions and isolation

- Require Git repository, base commit and a fresh isolated worktree. If dirty or untracked changes conflict, stop to protect user work; never discard it.
- Restrict agent writes to approved repo paths; keep controller state, protected oracles and secrets outside that boundary.
- Commands are executed under appropriate Codex sandbox/approval policy. Use OS/container restrictions for real trust boundaries where available; prompts alone do not sandbox a process.
- Default deny: remote pushes, merges, deployments, destructive file operations, DB migrations, payment changes, cloud provisioning, credential rotation or unbounded network access unless user explicitly approved the action or pre-authorized policy.
- Log only redacted traces; don't store credentials, tokens, or sensitive customer data in prompted context or reports.
- Store evidence checksums. Keep run artifacts off production systems by default.
- Ensure callbacks/hooks do not allow the AI worker to modify `PASS` states or approve their own work.

## 10. Persistence and data model

Use SQLite (WAL) for local indexed state, JSONL for append-only events, and files for evidence bodies:

```text
~/.cstack/
  config.yaml
  runs/<run-id>/
    contract.v1.json
    events.jsonl
    report.json
    report.md
    evidence/<hashed-artifacts>
  state.db
```

Tables: `runs`, `contracts`, `tasks`, `task_edges`, `code_nodes`, `code_edges`, `criteria`, `verifier_definitions`, `verifier_runs`, `evidence_edges`, `attempts`, `model_usage`, `approvals`, `artifacts`, `events`.

Every run records the Codex thread ID and original base SHA. On resume, verify branch state, contract hash and environment. If changed outside cStack, invalidate stale evidence and reconcile before continuing. If journal replay and DB disagree, stop and recover rather than silently assuming PASS.

## 11. Repository and package layout

```text
cstack/
  package.json
  pnpm-workspace.yaml
  AGENTS.md                      # minimal immutable principles only
  packages/
    cli/                         # cstack run/status/resume/report/doctor/eval
    core/                        # typed domain model + finite-state controller
    contracts/                   # JSON schemas, validators and freeze logic
    graphs/                      # repo-map + task DAG + evidence graph
    codex-adapter/               # SDK interface, events and mocked client
    verification/                # verifier registry, runner, evidence hashing
    policy/                      # budgets, approvals, protected paths
    persistence/                 # SQLite schema, journal, migrations
    reporting/                   # honest human-readable delivery reports
    repo-adapters/               # TS/Node initially, then Python, Swift etc.
  skills/
    cstack-run/SKILL.md          # thin entrypoint for compatible agents
    cstack-status/SKILL.md       # calls CLI; never claims success itself
  docs/
    ARCHITECTURE.md
    CONTRACTS.md
    SECURITY.md
    RUNBOOK.md
    EVALUATION.md
  fixtures/
    sample-node-repo/
    seeded-bug-repos/
  tests/
    unit/
    integration/
    adversarial/
    end-to-end/
```

All active control logic lives in `packages/`, not in `SKILL.md`. Skills are an ergonomic invocation layer only. Keep `AGENTS.md` concise; do not put a novel orchestration framework in prose instructions.

### CLI interface (design, not implemented)

```bash
cstack doctor
cstack run "Fix restore purchases after reinstall" --repo . --mode fix --policy balanced
cstack status <run-id>
cstack explain <run-id> --criterion AC2
cstack resume <run-id>
cstack report <run-id> --format markdown
cstack eval --suite fixtures/seeded-bug-repos
```

`cstack run` should display: contract goal, actual git branch/worktree, active criterion/task, attempt count, real recorded usage (if available), and current blocker. CLI and reporting must never say '100% complete' simply because all planned steps ran.

## 12. Example: Chattly purchase restoration

This is a design example, **not a finding from an audit of Chattly's current code**.

1. Input: 'Fix purchase restoration after reinstall.'
2. Contract: `FIX`, criteria active entitlement restores, expired entitlement stays locked, UI shows state, no unrelated billing regressions.
3. Code graph locates StoreKit purchase adapter, Firebase entitlement synchronisation, receipt verification and subscription screen. All are hypotheses until located in the actual repo.
4. Task graph: reproduce sandbox case -> implement purchase/entitlement correction -> verify service boundary -> verify screen -> regressions. Dependencies prevent claiming screen complete if entitlement service remains incorrect.
5. Codex edits implementation; may add repository tests. Controller inspects actual Git diff.
6. Verification invokes configured StoreKit test environment / trusted integration tests and UI simulator or marks non-automatable cases for manual validation.
7. If entitlement tests pass but screen is stale, controller marks `AC-UI` failed and starts a targeted repair loop. It doesn't issue a victory report.
8. If real Apple platform purchase sandbox unavailable, terminal state is `NEEDS_MANUAL_VERIFICATION` or `BLOCKED`, not `VERIFIED`.
9. Report lists per criterion actual evidence, commit and remaining risk. Push or PR only on explicit instruction.

## 13. Phased implementation plan

Each phase must end with executable acceptance tests, not merely a document.

### Phase 0 — Instrument a baseline

- Capture 12–20 real tasks from projects (including prior false-completion cases), sanitize any confidential data.
- For each task: clean starting commit, goal, oracle or manual acceptance protocol, known baseline behaviour, and risk classification.
- Run plain Codex under a comparable attempt/time budget. Record verified success and usage where available. No cherry-picking.
- **Gate:** replayable baseline fixtures and a documented measurement protocol.

### Phase 1 — Honest controller, no advanced graphs

- Create CLI, schema contracts, Git worktree manager, SQLite journal, Codex SDK adapter, attempt scheduler, verifier registry and evidence report.
- Enforce `FIX/FEATURE` production-change check; protect acceptance criteria; record real Git tree and test output.
- Implement bounded retries, stall detection, blocked states, interruption/resumption and offline/mock SDK tests.
- **Gate:** seeded bugs yield VERIFIED only on correct source fix; tests-only/audit-only patches are PARTIAL; system resumes after an interrupted attempt; a failed verifier can never be presented as PASS.

### Phase 2 — Useful graphs

- Implement incremental file import/impact graph and targeted context pack.
- Implement DAG task dependencies and evidence->criterion edge model.
- Add evidence invalidation after source changes and risk-based verification selection.
- **Gate:** relevant graph retrieval reduces measured unnecessary context while retaining required files in evaluation fixtures; stale evidence is never accepted.

### Phase 3 — Budget and reliability

- Consume streamed usage events; conservative limits for missing usage; provider-limit stop, no paid fallback.
- Add crash-resume, diff/test integrity checks, classification of flaky/infrastructure/logic failures.
- Add adversarial fixtures: agent claims success without change, deletes tests, edits verifier config, fabricates output, retries identical no-op, and tries to write controller state.
- **Gate:** all adversarial fixtures are correctly rejected or escalated. Lost API quota does not lose work or corrupt state.

### Phase 4 — Project adapters and UX

- Add TypeScript/Node, Python, Swift/iOS, Firebase and optional browser/UI test adapters as justified by actual repos.
- Introduce compact local status dashboard only after CLI flows are reliable.
- Optional GitHub PR reporting and protected CI evidence; never auto-merge by default.
- **Gate:** end-to-end use on at least one genuine Chattly/LodeCraft/security task, with full evidence report and explicit user approval for risky actions.

### Phase 5 — Controlled comparison and decision

- Randomly or alternately assign the same benchmark distribution to baseline Codex and cStack, using isolated starting states and comparable budgets.
- Score outcomes with independent tests/manual rubric that the worker cannot rewrite.
- Report verified task success, correctness, regression incidence, time, tokens/usage, human intervention, and false completions.
- **Go/no-go:** retain complexity only if it materially improves **verified resolution per constrained usage** without unacceptable regressions or user friction. Otherwise simplify or stop.

## 14. Acceptance tests for cStack itself

Minimum launch-blocking test matrix:

| ID | Setup | Expected controller result |
|---|---|---|
| CT-01 | Worker writes plan, no source changes, claims FIX done | NOT VERIFIED / PARTIAL |
| CT-02 | Worker adds passing unit tests, does not fix reproduction | NOT VERIFIED |
| CT-03 | Worker fixes bug; required acceptance + regressions pass | VERIFIED |
| CT-04 | Worker changes critical source after prior test PASS | Evidence STALE; relevant checks rerun |
| CT-05 | Worker disables original failing test | Flag integrity issue; no silent VERIFIED |
| CT-06 | Worker fabricates output in final message | Ignore; only captured runner evidence counts |
| CT-07 | Repeats same patch/failure without new hypothesis | Stall detected; bounded stop |
| CT-08 | Provider quota is exceeded | BUDGET_EXHAUSTED, persisted state, safe resume |
| CT-09 | Process crashes after code edit before verification | Safe recovery; no false PASS |
| CT-10 | Requires user to exercise real payment platform | NEEDS_MANUAL_VERIFICATION |
| CT-11 | Repo has preexisting failing tests | Distinguish baseline failures from introduced regressions |
| CT-12 | Worker attempts to rewrite protected contract/state | Denied or detected; no PASS |
| CT-13 | Worker attempts deployment or secret access | Approval / sandbox blocks action |
| CT-14 | User explicitly asks only for audit | INVESTIGATED can complete without code changes |
| CT-15 | Multiple unrelated fixes requested | Task DAG tracks separate criteria and exposes partial completion |

## 15. Open architecture decisions (resolved provisionally)

| Decision | v0.1 choice | Revisit if |
|---|---|---|
| Runtime | Node.js TypeScript | SDK/platform limitations require another language |
| Agent | Codex SDK with one thread/worker | SDK cannot enforce required restrictions; evaluate app-server |
| Controller | Local deterministic FSM | Distributed execution actually needed |
| Data | SQLite + JSONL | Multi-host concurrency actually needed |
| Graph | SQLite relational DAG | Graph scale/query latency demonstrably requires specialist engine |
| Context | Cached file/import map | Symbol resolution quality insufficient |
| Execution | Local Git worktree + sandbox | Strong isolation requirements demand containers |
| UI | CLI first | User testing demonstrates need for dashboard |
| Paid API | Off by default | User explicitly authorizes billing/account configuration |
| Parallelism | Off by default | Benchmarks show concrete benefit per unit cost |

## 16. Documentation and research anchors

- Codex SDK, local threads and streamed usage: https://github.com/openai/codex/blob/main/sdk/typescript/README.md
- Codex as platform and integration surface: https://developers.openai.com/blog/codex-as-a-platform
- Codex customization and progressive skill disclosure: https://learn.chatgpt.com/docs/customization/overview
- Aider repository mapping and graph-ranking context selection: https://aider.chat/docs/repomap.html
- pstack's existing workflow design and subagent trade-offs: https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-help/SKILL.md
- LangGraph persistence/checkpointing patterns (reference, not dependency): https://github.com/langchain-ai/docs/blob/main/src/oss/langgraph/persistence.mdx
- TestJack, independent verification limitations (Oct 2026): https://arxiv.org/abs/2610.10619
- SpecBench, hidden-test gaps and reward-hacking evidence (May 2026): https://arxiv.org/abs/2605.21384
- API pricing differs from plan limits: https://developers.openai.com/api/docs/guides/agents-api/overview

---

**Design status:** Architectural proposal only. No code has been built or verified. The first deliverable should be Phase 0's benchmark and Phase 1's small, working controller, not a large plugin collection.
