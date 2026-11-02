# cStack upgrade: executable implementation specification

Status: **DESIGNED; NOT IMPLEMENTED**. Specification version: **1**. Written: **2026-11-01**.

Baseline: cStack **0.3.0**, Git commit `590c8263fb4ddd32365b99b892bd52fcdb7898e7`.
The companion [execution backlog](upgrade-backlog.json) defines task dependencies,
implementation files, test identifiers and required evidence. This document defines
behavior; the backlog defines execution order. Both must change together when a
design decision changes.

This is a plan for implementation, not evidence that these features exist or that
they improve performance. Creating this plan does not authorize paid benchmark
runs, publishing, pushing, deployment, deletion of user work, or fabricated human
approvals. Existing explicit authorization in the implementing session still applies.

## 1. Product objective and release boundaries

Reduce the effort between a user's bug report and an understood, checked, usable
change. Preserve the independent verifier and make its evidence easier to use.

Deliver in two releases, using the same sequential task backlog:

| Release | Required task IDs | Result |
| --- | --- | --- |
| **0.4.0** | C00–C17 | Complete clean-project workflow: setup, project profiles, environment planning, pytest/Vitest adapters, better context, impact analysis, review, progress, safe delivery, CI and measurement. |
| **0.5.0** | D01–D03, after C17 | Repair a snapshot of a project with existing edits and deliver only cStack's changes while preserving the user's staging and original edits. |

Do not ship working-copy repair accidentally as part of 0.4. Do not call 0.5
complete with only a dirty-repository bypass. It requires capture, provenance,
delivery, recovery and preservation tests together.

All tasks are required for their release. Priority controls order, not omission.
Model-performance studies and human usability studies have separate evidence gates;
unavailable account budget or participants must be reported as pending, never as a
passing experiment. A functionally validated release may ship without a new speed
claim. No release may claim the planned savings before measurement.

### 1.1 Scope coverage

| Critique item | Implementation tasks |
| --- | --- |
| Guided setup and reusable project knowledge | C06, C07, C09 |
| Clear human review with actual changes | C05 |
| Better repair context using errors, symbols and relationships | C10 |
| Practical change-impact graph | C11 |
| Preview/apply checked repairs | C13 |
| Ready-made Python/JavaScript verification and failed-first feedback | C08 |
| Missing token accounting | C02 |
| Readable progress and usable run navigation | C03, C12 |
| Distinguish application, tests and benchmark dependencies | C04 |
| Remove SQLite warning from read-only analysis | C03 |
| Exercise pinned Harbor integration in CI | C14 |
| Measure setup, review, delivery, failures and repeated fresh cases | C15 |
| Plugin discovery, documentation, installation and release validation | C16, C17 |
| Existing uncommitted work | D01–D03 |

### 1.2 Preserve these invariants

1. One coding worker by default. Do not enable helpers, plugins, hooks, apps, web
   search or API-key fallback in the controlled child. Experimental multi-agent
   benchmark adapters remain separate.
2. Freeze objective, required checks, expected outcomes, model, reasoning, budgets,
   relevant project configuration and context policy before admitting a worker.
3. Probe expectations originate in the user's intended behavior or a cited trusted
   specification. Never derive expected outputs solely by running the broken code.
4. A worker's test report is supporting evidence. At least one required external
   probe or real human outcome acceptance is necessary for `VERIFIED`.
5. Existing test/configuration changes retain the human review gate. Added tests
   do not waive it. Never use an AI-generated review note as human approval.
6. Approval and evidence identify the exact candidate and contract. A changed
   candidate invalidates them. Failed automated checks cannot be manually waived.
7. Verification remains offline and isolated, with a sealed read-only candidate,
   no credential mounts, no Docker socket and bounded writable scratch space.
8. Network dependency preparation is a distinct explicit operation. Analysis,
   setup discovery, planning and repair must not silently install or pull anything.
9. Preserve source files, Git index, HEAD, unrelated worktrees and user Git settings.
   No automatic stash, commit, reset, clean, merge, force apply or push.
10. Missing usage means unknown, never free. Attempts are reserved before launch;
    resume retains time, attempts and observed usage already consumed.
11. Do not weaken a final required check to improve speed. Faster intermediate
    feedback is not final verification.
12. Keep the shipped runtime free of new npm dependencies. Optional project test
    runners and benchmark dependencies live in their prepared environments.

## 2. Baseline observations and measurement limits

The source contains:

- CLI routing and basic `doctor`/draft `init` in `src/cli.mjs`.
- Contract normalization for schema 2 in `src/contracts.mjs`.
- Worker admission, evidence gates and review metadata in `src/core.mjs`.
- Filename-based seeds and import neighbors in `src/code-map.mjs`.
- Local graph/stack analysis and trace locations, separately from repair context.
- Probe, Node-test and manual verification in `src/verification.mjs`.
- A version-2 SQLite store with serialized contracts and run state.
- Export of a checked full candidate, without a patch/apply workflow.

The saved five-case single-agent follow-up took 329.000867 task seconds. The sum of
its run metrics was 257.245 seconds in the worker, 16.344 in baseline verification,
17.719 in post-edit verification and 0.196 in context preparation. Worker time
includes the worker's own tool calls, not just model generation. Other task overhead
accounts for the remainder. These figures predate 0.3 analysis, exclude provisioning
and private grading, and do not establish current large-repository performance.

Nine of ten follow-up single/multi-agent candidates needed existing-test review,
despite passing separate bug tests. Preserve that distinction in every new report.
The primary opportunity is better worker direction and less user effort; a persistent
graph cache is not a first-release requirement because the measured old context
preparation was already negligible.

Historical data and protocols are immutable. New experiments use a new directory,
new lock and distinct cohort. Never rewrite old results to make revisions comparable.

## 3. Execution protocol for the implementing AI

1. Read repository `AGENTS.md`, this specification, then `upgrade-backlog.json`.
2. Inspect `git status --short`. Preserve unrelated changes. Create an isolated
   implementation worktree when needed; do not silently clean the current checkout.
3. Complete C00 before changing runtime behavior. Record the actual starting HEAD
   and any divergence from the baseline above. Inspect differences rather than
   resetting the repository to the baseline.
4. Select the first incomplete task in backlog order whose dependencies are done.
   Use one implementation agent unless the user separately authorizes delegation.
5. Implement the full task, including its failure paths and tests. Do not implement
   a flag, UI control or skill whose underlying operation is still a placeholder.
6. Run targeted acceptance tests, then the task's specified integration checks.
   Update that task's evidence and status only after its acceptance criteria pass.
7. Do not opportunistically redesign unrelated modules. New modules below are
   bounded separations of responsibility, not a framework or service architecture.
8. Before committing, review the diff for private logs, secrets, task answers,
   generated environment state, machine paths and accidental version changes.
   Commit/push only within the authorization of the implementing session.
9. Stop a dependent task on an unresolved design conflict. Record the exact conflict,
   the affected requirement IDs and a proposed amendment. Continue independent
   authorized work. Do not silently replace a requirement with an easier behavior.
10. Do not run model-backed tests as part of ordinary `npm test` or CI. Use the
    explicit experiment gate in section 17.

### 3.1 Completion record

Use a local, gitignored evidence directory outside the source tree. Per task record:
task ID; source revision/diff digest; test command and exit code; pass/fail/skip counts;
artifact paths and SHA-256; environment identities; unresolved limitations.
Publish only a reviewed, sanitized validation summary. The backlog status vocabulary
is `planned`, `implementing`, `blocked`, `validated`; `validated` means task-level
acceptance passed, not that all downstream release gates passed.

## 4. Files and responsibilities

Existing files not listed for a task are not an invitation to refactor them.

| File | Responsibility |
| --- | --- |
| `src/cli.mjs` | Parse/validate arguments; lazy-load command modules; preserve legacy entry points. |
| `src/cli-output.mjs` (new) | Human-readable/JSON/JSONL formatting and exit-code mapping. No controller decisions. |
| `src/contracts.mjs` | Strict schema-2/schema-3 normalization; frozen contract validation. |
| `src/usage.mjs` (new) | Validate usage vectors, classify completeness, calculate admission totals. |
| `src/project-profile.mjs` (new) | Discover, validate, fingerprint and store local project profiles. |
| `src/environment-plan.mjs` (new) | Deterministic dependency/environment plans, explicit preparation and identity records. |
| `src/job-plan.mjs` (new) | Combine profile, goal and explicit acceptance checks into a runnable frozen plan. |
| `src/review.mjs` (new) | Snapshot comparison, review artifact generation and freshness validation. |
| `src/context.mjs` (new) | Deterministic evidence-based file ranking and bounded source excerpts. |
| `src/impact.mjs` (new) | Reverse-import traversal, affected files, test candidates, cycles and focused diagram. |
| `src/progress.mjs` (new) | User-facing progress projection from controller events; no completion authority. |
| `src/delivery.mjs` (new) | Patch creation, delivery preflight, apply journal, postconditions and guarded recovery. |
| `src/test-adapters.mjs` (new) | Adapter registry, arguments, normalized events and expected-test validation. |
| `src/runners/pytest-runner.py` (new) | Controller-mounted pytest wrapper and reporter. |
| `src/runners/vitest-runner.mjs` (new) | Controller-mounted Vitest invocation/configuration boundary. |
| `src/runners/vitest-reporter.mjs` (new) | Vitest lifecycle-to-event translation. |
| `src/source-capture.mjs` (new, 0.5) | Stable working-copy inventory and overlay capture, separate from delivery. |
| `src/core.mjs` | Orchestration, budget admission, revalidation and authoritative status. |
| `src/store.mjs` | Transactional run/event storage and bounded run listing. |
| `src/repository.mjs`, `src/imports.mjs`, `src/code-map.mjs` | Existing bounded inventory/import extraction; reusable graph construction. |
| `src/stack-analysis.mjs`, `src/analysis-report.mjs` | Scope-aware findings and their readable representation. |
| `src/snapshot.mjs`, `src/sandbox.mjs`, `src/verification.mjs` | Existing isolation/evidence primitives; narrow extensions required below. |
| `bench/journey.py` (new) | Deterministic experiment preparation, scheduling, execution and aggregation. |
| `scripts/test-bench-ci.py` (new) | Unittest execution with required integration/no-skip enforcement. |
| `scripts/validate-upgrade.mjs` (new) | Offline release artifact/manifest/compatibility validation. |

Every new runtime module must be included by the existing plugin collector. Every
new non-JavaScript runner must be included in the bundle and verifier identity.
Keep `src/core.mjs` exports needed by `bench/cstack_bridge.mjs` compatible.

### 4.1 Module interfaces

Use these exported function names so tasks can integrate without inventing separate
interfaces. Existing core functions keep their current public signatures; optional
new inputs must not break benchmark imports. Plain objects below are validated DTOs
(data records), not classes with hidden state.

| Module/export | Inputs | Output/side effects |
| --- | --- | --- |
| `usage.classifyUsage` | parsed completion events, source enum | Pure completeness/vector/diagnostic result. |
| `usage.accountingForRun` | attempts | Pure known totals, nullable totals, unknown IDs and admission decision. |
| `project-profile.discoverProfile` | bounded reader, explicit scope/adapter/image/convention choices | Draft profile plus diagnostic records; no writes/execution. |
| `project-profile.validateProfile` | profile, bounded reader | Validated profile and current-input matches; no writes. |
| `project-profile.storeProfile` | validated profile, canonical repo root, home | Immutable profile/pointer paths and digest; only controller-home writes. |
| `environment-plan.planEnvironment` | profile, recipe/base-image selection, inspected image metadata | Canonical plan and bounded context inputs; no install. |
| `environment-plan.prepareEnvironment` | plan path, expected digest, command runner, signal | Preparation receipt/image identity/new profile; explicit Docker execution. |
| `job-plan.createJobPlan` | repo, profile, acceptance, context hints, source mode, output, signal | Immutable plan/contract/report; isolated baseline execution. |
| `job-plan.validateJobPlan` | plan path, expected digest, current identities | Read-only validated plan or specific stale/input error. |
| `context.selectContext` | bounded reader, graph, frozen hints, current proofs, prior sent manifest | Read-only bounded selection/excerpt manifest from supplied reader; no model calls. |
| `impact.buildImpact` | current graph, seed paths, optional baseline graph, depth | Pure affected paths/evidence/tests/cycles; no source writes. |
| `review.buildReview` | loaded run, verified artifact handles | Canonical review data; no approval or candidate edits. |
| `review.exportReview` | review, new output directory | Escaped JSON/Markdown/HTML and local diff artifacts. |
| `progress.projectProgress` | authoritative event, run projection, elapsed clock | User-facing event DTO; no state transitions. |
| `delivery.createDelivery` | current verified run, new output directory | Patch/manifest/report with hashes; no target writes. |
| `delivery.checkDelivery` | run, target, expected snapshot, delivery manifest | Structured preflight result, no target writes. |
| `delivery.applyDelivery` | validated inputs, home, signal | Locked journaled target mutation and verified delivery receipt. |
| `delivery.recoverDelivery` | run/delivery IDs, home | Idempotent recovery under the same target/run locks. |
| `test-adapters.collectTests` | adapter, frozen profile, runner, snapshot, deadline | Exact collected IDs and version/collection evidence. |
| `test-adapters.executeSuite` | criterion, runner, snapshot, deadline, signal | Normalized proof with output hashes and `reported-tests` strength. |
| `source-capture.captureSource` | repo, source mode, policy, home | Stable origin/index/source capture; private writes only. |
| `source-capture.materializeCapture` | capture, owned worktree | Overlay whose manifest must equal capture; no original writes. |

Use the existing bounded `command` abstraction for subprocesses. Inject command,
clock and worker dependencies through function arguments in tests, never user-facing
flags that could bypass isolation or accounting. Pure projections do not read a
global database. CLI handlers call validated domain functions, not each other through
shell subprocesses. Separate artifact creation from application so a preview cannot
accidentally mutate the project.

## 5. Data contracts, compatibility and command conventions

### 5.1 Persisted state

Retain `state-v2.db`; do not change the existing SQL tables merely to add JSON state
fields. Add an explicit `run_state_version: 3` to newly created runs. Legacy runs
without that field are version 2. Never renormalize and rewrite an existing frozen
contract on load, and never recompute its hash using a new serializer.

Additive run fields:

- `origin`: repository identity, original HEAD, source mode, original inventory
  digest, index manifest digest and excluded-input summary.
- `plan_digest`, `profile_digest`: nullable immutable provenance identifiers.
- `accounting`: completeness, known totals, unknown attempt IDs and diagnostic codes.
- `context_records`: one content-addressed context manifest per attempted worker turn.
- `delivery`: separate delivery state, never a replacement for the verification status.
- `journey`: timestamped phase records with monotonic elapsed durations.

Old runs remain readable/reportable/exportable under their original rules. Current
verifier-identity mismatch still requires fresh verification; migration never turns
stale proof into current proof. Unknown usage in an old run prevents a new worker
turn under the new admission rule. Preserve the candidate and permit read-only review.

For new clean-mode runs, capture origin inventory before adding `workspace_inputs`:
tracked plus nonignored untracked project paths, bytes, executable bits and relevant
directory/file types, excluding `.git` internals. Separately capture normalized
index entries and HEAD. This source-selection rule is reused by D01; do not compare
the original checkout against a verifier snapshot that contains injected dependency
bundles. Bundles remain part of the candidate's verification identity and may not be
silently delivered as user source. A modified frozen dependency bundle blocks delivery.
Legacy runs lacking reliable origin provenance retain full export but cannot use the
new apply command; return `ORIGIN_PROVENANCE_MISSING`, never invent a captured origin.

### 5.2 Contract schema 3

Keep schema-2 behavior and canonical field order unchanged. New plan creation emits
schema 3. Version 3 retains existing field names and adds only:

| Field | Required/default | Validation |
| --- | --- | --- |
| `project` | Optional | Exact keys `profile_digest`, `environment_digest`; each lowercase 64-hex SHA-256. Both or neither. |
| `source_mode` | `clean` | Enum `clean`, `working-copy`; reject `working-copy` until D01 is implemented. |
| `context` | `{policy: "evidence-v1", files: [], symbols: [], frames: []}` | See section 12. |
| criterion `kind: "test-suite"` | Optional new kind | Exact schema in section 10. |

Schema-3 limits: goal 5–4096 Unicode characters; criterion description 1–2000;
maximum 100 criteria/tasks remains. Prompt serialization must reject an individual
task whose required descriptions exceed its fixed prompt budget; do not silently
drop or truncate required criteria. Existing schema-2 runs retain their parsing.

All new objects reject unknown properties, duplicate IDs, invalid integer values,
unsafe relative paths and malformed digests. Use explicit validators in code plus
published JSON Schemas under `docs/schemas/`; do not add a runtime schema library.
Schema tests must validate the same valid/invalid fixture corpus in both forms.
Use the already pinned `jsonschema==4.26.0` in the benchmark development environment
for the published-schema side of those tests; do not introduce a runtime npm
validator dependency. Root JSON Schema documents use draft 2020-12 and explicit
`additionalProperties: false` for new objects.

### 5.3 Deterministic representation

Use one new `canonicalJson` helper for new artifact identities: recursively sort
object keys by Unicode code point, preserve array order, UTF-8, no insignificant
whitespace, no non-finite numbers. Store a newline after serialized files but hash
the canonical bytes without that newline. Never change existing `json()` or old
hash rules. Sort unordered path sets by code point, not host locale. Use relative
POSIX paths in portable artifacts; machine paths stay in private local metadata.

Timestamps, host paths, display strings and temporary directory names are excluded
from content identities unless explicitly listed as an input. Plans include the
parser/selector versions so an algorithm change invalidates old derived plans.

### 5.4 CLI rules

Continue supporting all 0.3 commands. New commands:

```text
cstack setup --repo PATH [--scope RELATIVE_DIR] [--image IMAGE]
             [--adapter node-test|pytest|vitest] [--profile FILE] [--format markdown|json]
cstack profile show --repo PATH [--format markdown|json]
cstack profile validate --repo PATH --profile FILE [--format markdown|json]
cstack env plan --repo PATH --profile FILE --out NEW_DIRECTORY
                [--recipe existing-image|npm-lock|pip-hashes] [--base-image IMAGE]
cstack env prepare --plan FILE --expect-plan SHA256 [--format markdown|json]
cstack plan "GOAL" --repo PATH --profile FILE --acceptance FILE --out NEW_DIRECTORY
            [--trace FILE] [--source-mode clean|working-copy]
cstack run --plan FILE --expect-plan SHA256 [--format markdown|json|jsonl]
cstack review RUN_ID [--out NEW_DIRECTORY] [--format markdown|json]
cstack impact --repo PATH (--file RELATIVE_FILE | --since GIT_REV)
              [--depth 1..6] [--out NEW_DIRECTORY] [--format markdown|json]
cstack runs [--repo PATH] [--limit 1..100] [--format markdown|json]
cstack status RUN_ID [--watch] [--format markdown|json|jsonl]
cstack patch RUN_ID --out NEW_DIRECTORY
cstack apply RUN_ID --repo PATH --snapshot SHA256 [--check] [--format markdown|json]
cstack delivery recover RUN_ID --delivery DELIVERY_ID [--format markdown|json]
```

Defaults: Markdown for new interactive commands; preserve existing defaults of old
commands to avoid breaking scripts. JSON stdout is exactly one final JSON object;
progress goes to stderr. JSONL stdout contains structured events and one final result.
`--watch --format json` is invalid; use Markdown or JSONL. Disable color for redirected
output and when `NO_COLOR` is set. No ANSI escape bytes in artifacts or JSON values.

Validate options per command, not one permissive global allowlist. Reject extra
positionals, unknown flags, conflicting `--plan/--contract`, two impact selectors,
existing output destinations and paths escaping the project scope.

Exit codes for new commands: `0` completed operation (including an analysis marked
partial); `1` invalid input, internal/integrity error or failed prerequisite;
`2` valid operation requiring further work/review, a blocked repair, an unready setup,
or apply preflight conflict; `130` interruption. Include stable `code` and `next_action`
fields in error JSON. Preserve old command exit behavior except add documented SIGINT
130 behavior. `ALREADY_SATISFIED` is a completed diagnostic outcome, not a new fix;
for legacy `run` keep its existing non-success exit mapping.

### 5.5 Stable diagnostics

Use `run.stop_code` alongside the existing human-readable `reason` when a run stops.
CLI-only operations return the same code in their result. The following codes are
part of the documented interface; do not classify them with substring searches.

| Code | Meaning / required behavior |
| --- | --- |
| `USAGE_UNRESOLVED` | Another worker would be needed but earlier accounting is unknown/invalid; BLOCKED before reservation. |
| `PROJECT_SCOPE_AMBIGUOUS`, `TEST_ADAPTER_AMBIGUOUS` | Setup needs an explicit supported choice; draft result, exit 2. |
| `IMAGE_MISSING`, `PROJECT_DEPENDENCY_MISSING` | Setup/preparation prerequisite absent; no model admission. |
| `PROFILE_STALE`, `PLAN_STALE`, `PLAN_CHANGED`, `ENVIRONMENT_CHANGED` | Frozen identity does not match; return mismatch fields and require a new plan/version. |
| `TEST_RUNNER_VERSION_UNSUPPORTED` | Declared runner is outside compatibility fixtures; preserve project versions, no implicit install. |
| `TEST_COLLECTION_INVALID`, `TEST_STREAM_INVALID` | Missing/ambiguous/incomplete test evidence; criterion ERROR, never PASS. |
| `SCRATCH_CAPACITY`, `SOURCE_DEPENDENCY_TREE_CONFLICT` | Adapter cannot stage its execution workspace under current limits; explain a prepared-image/export alternative without changing source. |
| `REVIEW_REQUIRED`, `EVIDENCE_STALE` | Human gate pending or current candidate/evidence differs; apply refused. |
| `ORIGIN_PROVENANCE_MISSING` | Legacy run has no reliable apply baseline; retain full export. |
| `SOURCE_DIVERGED`, `DESTINATION_COLLISION` | Original source changed or a new path would overwrite existing data; delivery preflight conflict, exit 2. |
| `PATCH_INTEGRITY`, `DELIVERY_PATH_UNSUPPORTED` | Patch hash/path set invalid or special/colliding path type; no target writes. |
| `RECOVERY_REQUIRED` | Partial/interrupted delivery has data that cannot be restored automatically without overwriting a third value. |
| `SOURCE_CHANGED_DURING_CAPTURE` | Source/index/HEAD differed across the two capture inventories; no run admitted. |
| `GIT_OPERATION_IN_PROGRESS`, `GIT_INDEX_UNMERGED`, `GIT_SPARSE_UNSUPPORTED`, `GIT_SUBMODULE_UNSUPPORTED` | Working-copy capture cannot preserve the stated Git state; reject with affected paths. |

Result states such as `ALREADY_APPLIED`, setup readiness and delivery journal states
are not additional repair verification statuses. Keep `effectiveStatus` authoritative
for repairs. `--check` must return every preflight conflict it can discover without
unsafe traversal, in stable path/code order, rather than mutating to find the next one.

## 6. C02 — close the missing-usage admission gap

Implement before new repair orchestration.

### 6.1 Usage states

Each attempt has `usage_status: complete | unknown | invalid` and an optional
`usage_diagnostic`. A complete vector requires integer, nonnegative, safe-number
`input_tokens` and `output_tokens`. Optional `cached_input_tokens` and
`reasoning_output_tokens` must be valid and no greater than their containing input
or output count. Missing optional subsets remain `null`, not fabricated zero.

Keep `observed_total_tokens = input_tokens + output_tokens` for complete vectors.
At run level expose `known_total_tokens`, `total_tokens` (null if any unknown/invalid
attempt), `accounting_complete`, and `unknown_attempt_ids`. Preserve existing usage
fields as known observations for compatibility, explicitly label them lower bounds
when incomplete. Do not count cached input or reasoning output twice.

For the supported native single-worker JSON protocol, require exactly one
`turn.completed` for one `codex exec` invocation. A duplicate terminal event is a
protocol ambiguity, not a second charge to add or a duplicate to silently discard.
Capture any valid observed usage but mark admission blocked. Keep benchmark-native
accounting in `bench/native_usage.py` authoritative for its adapter; do not combine
its cumulative totals with CLI event totals. Add an explicit worker-result accounting
adapter so both sources provide the same completeness interface.

### 6.2 Admission and recovery

Before **every** new worker reservation, including after resume, require complete
accounting for all prior admitted attempts. Otherwise stop `BLOCKED` with code
`USAGE_UNRESOLVED`; preserve files, attempts and logs. The user cannot bypass this
by a human outcome approval. No manual numeric usage override in this release.

If a successful worker returns without usage, still verify its candidate. If the
candidate satisfies the verification/review gates, retain the appropriate result
(`VERIFIED` or pending review), clearly reporting unknown total usage. The unknown
count blocks another worker, not valid behavioral evidence. If another coding turn
would be necessary, stop before spending more. A provider/quota error keeps the
existing `BUDGET_EXHAUSTED` classification with incomplete usage separately shown.

A process interrupted before complete telemetry also consumes its reservation and
gets `unknown`. Do not automatically scan unrelated Codex history to guess usage.
The initial implementation deliberately fails closed rather than inventing a
reconciliation mechanism. Reports provide the attempt ID and known observations.

Scripted test workers must declare `accounting_source: "scripted"` and complete zero
usage in test fixtures. Reject that source from the native Codex adapter; it is an
injected test capability, not a user CLI option or a way to avoid billing accounting.

Tests `USAGE-01..08`: valid vectors/subsets; missing required fields; malformed and
negative counts; duplicate terminal events; absent usage on a changed failing patch
prevents retry; interrupted/resumed run prevents retry; verified candidate can report
unknown usage; native benchmark delta adapter still counts each turn exactly once.

## 7. C03/C04 — clean command loading and accurate stack scope

### 7.1 Lazy command loading

`help`, `map`, `analyze-stack` and `impact` must not import `src/core.mjs`,
`src/store.mjs`, `node:sqlite`, the Codex worker or the Docker runner. Split command
handlers or use dynamic imports after routing. Share pure utilities directly.
Do not hide the SQLite warning with `--no-warnings` or process-wide warning filters.

Tests `CLI-01..04`: all read-only commands run with invalid Codex/Docker paths and an
unwritable controller home; no state directory is created; stderr has no SQLite
warning on Node 22/24; legacy repair/help/JSON behavior remains covered.

### 7.2 Scope model

Add analysis schema version 2 while retaining existing schema-1 fields as a clearly
documented compatibility projection. New canonical findings are scoped.

Define a scope for each directory containing an application manifest (`package.json`,
`pyproject.toml`, `setup.cfg`, `Cargo.toml`, `go.mod`) and for a directory containing a
requirements file without a closer application manifest. Assign a source to its
nearest ancestor scope; ties among manifests in the same directory are one scope.
Root fallback scope is `.`. A lockfile belongs to its containing scope, not root
merely because root has a package manifest.

Classify scope by whole path segment, in this priority order:
`bench|benchmark|benchmarks` → `benchmark`; `examples|example|demo|demos` → `example`;
`test|tests|testing|spec|specs|__tests__` → `test`; otherwise `application`.
These are filename conventions, not statements about actual deployment. A root
package declaring a CLI remains application scope; do not invent a hosted service.

Each finding has `scope_id`, evidence and `dependency_relation`:
`declared-direct`, `declared-development`, `import-observed`, `lockfile-only`, or
`configuration-signal`. If one component has multiple evidence types, retain all
types; do not let lockfile evidence promote direct use. Scope-specific duplicates
must not be merged globally. A lock format with an explicit direct-dependency table
can support direct evidence only when that table is parsed and identified precisely.

Markdown presents root application first, then other application subprojects, tests,
examples and benchmark tooling; each group sorts by scope path. Put lockfile-only
findings in a collapsed/detail block or their own table. A scan of cStack must show
FastAPI/Starlette from `bench/requirements.lock` as benchmark lockfile-only findings.

Tests `SCOPE-01..06`: cStack regression; nested JS/Python monorepo; same dependency
in multiple scopes; lockfile-only distinction; unknown/malformed manifests;
stable ordering/partial coverage and compatibility projection.

## 8. C06 — reusable private project profiles

Store profiles outside the project at
`CSTACK_HOME/projects/<root-id>/profiles/<profile-digest>.json`, mode 0600; directories
0700. `root-id = SHA256(realpath(repository-root))`. Keep `current.json` as an atomic
pointer containing only a digest. Do not put profiles in the worker's repository.

Profile schema 1 has exact keys:

| Key | Definition |
| --- | --- |
| `schema_version` | Integer 1. |
| `scope` | Normalized relative project directory, `.` allowed. |
| `evidence` | Sorted unique `{path, sha256, role}` records for manifests, lockfiles, test config and selected convention files. |
| `runtime` | `{kind: node|python, declared_version: string|null}`; one runtime per profile. |
| `test` | `{adapter: node-test|pytest|vitest|none, roots: string[], expected_tests: string[], plugins: string[]}`. |
| `environment` | `{mode: existing-image|npm-lock|pip-hashes|manual, image: string|null, lockfiles: string[]}`. |
| `conventions` | Array of `{path, sha256}` for explicitly selected AGENTS.md or convention documents, maximum 8 files/16 KiB total. |
| `readiness` | `draft|ready`; readiness requires observed preflight, not just declarations. |
| `missing` | Sorted stable diagnostic codes and human-readable next actions. |

Machine root, Docker connection selection and timestamps go in a neighboring local
metadata file, excluded from portable profile identity. All evidence hashes refer
to exact bytes read through the bounded reader. Profile refresh creates a new
immutable version; never overwrite a profile used by an existing run.

Discovery is read-only. Use manifests and tool configs; never execute package
scripts, dynamic Python metadata or arbitrary shell to discover how a project works.
Choose one unambiguous adapter: configured Node test runner, pytest, or Vitest. If
multiple apply, return `TEST_ADAPTER_AMBIGUOUS` with options and leave a draft. If
multiple application scopes exist, require `--scope`; do not silently choose root.
The surrounding skill may supply the user's selection without another confirmation
when already clear from the session.
An explicit `--scope` or `--adapter` resolves the corresponding ambiguity only when
the selected value has supporting evidence. `setup --profile FILE` accepts a user-
edited copy of a draft, validates it, then stores a new immutable profile and pointer;
it never edits an existing stored profile. Reject conflicting explicit flags and
profile selections rather than choosing one silently.

Convention files are optional bounded context, not an authority to re-enable tools,
network, hooks or billing. Include only selected files; treat their text as project
conventions subordinate to the frozen contract and controller policy. Do not restore
blanket child rule loading or execute `.codex/config.toml`.

Invalidate readiness when any evidence file is changed/deleted/added in the relevant
manifest/config inventory, the scope changes, or the installed adapter algorithm
version changes. An image change invalidates environment readiness. Editing ordinary
source files invalidates derived code context but need not invalidate a profile.

Tests `PROFILE-01..07`: simple Node/Python discovery; ambiguous scope/runner; edited
manifest/lock/config invalidation; reproducible profile digest; source-only edits;
bounded conventions with malicious instructions inert; no host command/network or
source-file writes during discovery.

## 9. C07 — explicit environment preparation

`doctor` must distinguish `controller_ready`, `worker_ready`, and
`project_verifier_ready`. A successful `printf` in a generic image does not prove a
project's imports or test runner are available. Existing `doctor` without a profile
continues basic checks; project readiness is `not_checked`, not true.

`env plan` produces `environment-plan.json`, a readable explanation and a minimal
build context outside the project. The plan includes exact copied input hashes,
base image reference and locally resolved immutable image ID where available,
platform, template version, install argv, network requirement and output identity
rules. No timestamps in its digest. If a base image is absent, mark `IMAGE_MISSING`
and state the exact preparation action; do not falsely claim a resolved image ID.
An executable dependency-build plan requires the base image to be locally present
and pinned. If missing, return a non-runnable draft with the explicit `docker pull`
or build prerequisite; after that separately authorized operation, generate a new
plan. `env prepare` never resolves a mutable missing tag on its own. `--base-image`
is required for an npm/pip recipe and invalid for existing-image mode; an explicit
`--recipe` selects a supported recipe, otherwise use the unambiguous profile mode.

First-release recipes are deliberately bounded:

| Mode | Deterministic behavior |
| --- | --- |
| Existing image | Inspect explicitly selected local image; resolve to immutable ID; run offline runtime-version and dependency-import probes. Collection readiness is added by C08/C09. No pull or install. |
| npm lock | Require package.json plus package-lock.json (lockfile version 2 or 3), no workspaces, local/file/git dependencies or private registry credentials. Prepare with `npm ci --ignore-scripts --no-audit --no-fund` inside Docker. The locked dependency tree and exact image ID define readiness. |
| pip hashes | Require a complete pip requirements lock with exact versions and hashes; reject editable/VCS/path requirements. Install inside Docker with `python -m pip install --require-hashes --only-binary=:all: -r requirements.lock`. |
| Manual | Emit specific unsupported/missing reasons and accept an explicitly supplied prepared image after the same offline readiness checks. Do not invent a universal build recipe. |

Do not execute a repository Dockerfile as part of automatic discovery. Generated
contexts contain only needed manifests/locks, never the whole checkout, secrets,
Git metadata, private package credentials or model auth. Build scripts/postinstall,
native compilation, npm workspaces, pnpm/yarn and source-distribution Python builds
are manual-image cases in 0.4; show the limitation precisely.

`env prepare --expect-plan` is the explicit side-effecting operation. Revalidate all
input hashes before preparing. If network was required and the actual plan differs,
return `PLAN_CHANGED`; do not improvise a different install. Record executed recipe,
image ID, package/tool versions and success/failure. Never install into the host.
Do not change global Docker context or delete existing images on failure.

Dependency-image caching key is the canonical digest of template version, platform,
base immutable image ID, lockfile/manifests and install options. Reuse only a locally
present image with the matching recorded identity and a fresh offline readiness
probe. This is dependency-environment reuse, not reuse of old acceptance PASS.

Resolve dependency visibility explicitly. Python dependencies are installed into the
image's interpreter environment. Node dependencies live at `/opt/cstack-deps/node_modules`.
For Node test commands, construct a fresh disposable `/tmp/project` copy of the
sealed candidate and expose that exact dependency tree as its `node_modules` symlink;
run there. Never install or write to `/candidate`. Record the candidate-copy manifest
before/after staging; verification still binds to the sealed input and image identity.
Candidate execution can mutate its disposable working copy, so that copy is never
the exported candidate or evidence source of changed project files. Python tests
that require writable generated files use the same disposable execution workspace.
Existing raw probes/Node criteria keep their current `/candidate` mode unless a
schema-3 adapter explicitly selects disposable-copy execution.

The isolated runner already has 128 MiB scratch. Reject a copied execution workspace
whose sealed bytes plus dependency-link/adapter overhead exceed 96 MiB with
`SCRATCH_CAPACITY`; do not quietly raise limits. A later separately reviewed runner
limit feature is outside this release. Dependencies remain in the read-only image;
do not copy their full tree into scratch.

Worker readiness is separate: the host Codex worker does not inherit tools installed
only in the verifier image. State this in its prompt. It may use available host tools
without installing dependencies; controller verification supplies authoritative
project feedback. Do not falsely promise identical host and container environments.

C07 produces `environment_ready`; full `project_verifier_ready` additionally needs
the C08 collection probe, wired in C09. This avoids treating generic image readiness
as complete test readiness. The preparation receipt creates a new profile version
with the resolved image and later collection results; never mutate the draft.
Environment identities are based on selected inputs, recipe and output image, not
the profile digest, so profile/environment references cannot form a circular hash.
Keep the originating profile digest as provenance outside the environment hash.
Use a repository digest in a generated Dockerfile when available. For a local-only
base image, use an owned deterministic local tag, verify it resolves to the planned
image ID before and after preparation, and fail on drift. Cache identity does not
promise bit-for-bit rebuild reproducibility across registries or build engines.
Reject a candidate-owned `node_modules` path that collides with the adapter's dependency
link; do not overwrite a sealed source directory to make dependencies visible.

Tests `ENV-01..09`: existing-image readiness; deterministic lock invalidation; no
network during planning/verification; no host install; minimal context canaries;
unsupported recipes stop clearly; stale plan/image rejected; Node dependency
resolution and disposable-copy isolation; preparation failure preserves existing state.

## 10. C08 — test-runner adapters and faster feedback

### 10.1 Supported first-release compatibility fixtures

Pin test fixtures to **pytest 8.3.5** on Python 3.12 and **Vitest 4.0.18** on Node
22.16/24. These are reproducible compatibility targets, not claims to be the newest
versions. Registry availability was checked when this specification was written.
Commit exact dependency locks and image recipe inputs for these fixtures. Runtime
preflight reports unsupported versions explicitly; initial support is these exact
versions plus Node's already-supported built-in runner. Broaden only by adding
version-specific compatibility fixtures and release evidence. Do not auto-upgrade a
user's test runner to meet cStack's supported version.

### 10.2 New criterion shape

`test-suite` has the normal `id`, `text`, `required`, `timeout_ms` plus exact keys:
`adapter` (`pytest|vitest`), `roots` (1–32 existing relative directories/files),
`expected_tests` (1–10000 unique nonempty strings, at most 1024 characters each),
`plugins` (0–16 explicit pytest import names; empty for Vitest), and
`config` (null or one existing relative configuration file). Do not accept arbitrary
shell strings, user-selected reporters, watch mode, test filters, `passWithNoTests`,
skip overrides or adapter installation arguments.

Expected IDs are frozen before the worker starts. Pytest IDs use normalized
root-relative `nodeid`, including parameter IDs. Vitest IDs use canonical JSON of
`[relative test file, project name or "", full ancestor suite names, test name]`;
the suites component is an array, preventing separator collisions. Duplicate full
IDs during collection are an error; do not silently suffix unstable sequence numbers.

Collection runs project code inside the verifier boundary, not on the host. Collection
discovers IDs, not expected behavioral outputs. A run plan can add a supporting
suite criterion using those IDs; the independent behavior probe remains separate.

### 10.3 Event protocol

Each adapter emits prefixed JSONL to stdout: `CSTACK_TEST_EVENT ` followed by a
schema-1 object. Other output is bounded diagnostic text. Required event kinds:
`collection` with sorted collected IDs; `case` with ID and outcome; `error` for
collection/runtime/unhandled errors; `complete` with adapter version, outcome counts
and exit status. Exactly one collection and one final complete event are required.
Exactly one terminal case outcome per collected test ID; pytest's setup/call/teardown
reports are aggregated before that case event. A failing teardown is a failure.
The complete event must be the final protocol event; trailing ordinary logs are allowed.

Case outcomes: `passed`, `failed`, `skipped`, `todo`, `xfail`, `xpass`, `error`.
Required expected IDs must all be collected and actually pass. Expected-ID skip,
todo, xfail or xpass fails the criterion. Failures/errors in any executed test fail
the criterion. A skipped non-expected test is recorded and does not silently count
as a pass. Existing schema-2 Node behavior is unchanged.

Malformed/duplicate IDs, incomplete streams, empty collection, count disagreement,
unsupported versions, truncation, timeout or missing completion produce an error
or failed check, never PASS. Reporter output is not cryptographically trustworthy
against candidate code; label proof strength `reported-tests` and retain the external
probe/manual gate. Do not market structured output as independent proof.

Pytest wrapper uses controller-owned collection/report/session-finish hooks. Clear
`PYTEST_ADDOPTS`, disable automatic third-party plugin loading, explicitly load only
profile-pinned plugins, keep ordinary project conftest behavior, and keep all code
inside the isolated process. Cache writes go to scratch or are disabled.
Vitest wrapper forces run-once behavior and the controller reporter, captures
unhandled errors and uses scratch for caches. The image-pinned package is the runner;
a candidate-supplied fake executable must not replace it.

### 10.4 Feedback ordering

After a baseline exists, run required previously failing criteria first, then other
required criteria, then optional criteria. Preserve original contract order within
each group. A required FAIL can end that intermediate feedback pass immediately;
mark remaining checks `NOT_RUN`, never reuse previous PASS for this candidate.
Infrastructure ERROR stops the pass and blocks the run.

If the fast pass has no required failures, execute every remaining required check
on the same sealed candidate. Completion requires a full current set. If all required
checks passed, optional failures are reported under their existing non-blocking
semantics. A resume for final delivery still revalidates all required checks.
Do not add a separate mini model call for every failed test.

Tests `ADAPTER-01..12`: pytest pass/fail and teardown failure; Vitest pass/fail and
unhandled errors; expected skipped/missing/xfail cases; duplicate/empty collection;
early exit/forged PASS text; stream corruption/truncation; version mismatch; explicit
plugin loading; writable scratch/read-only source; failing-first order; final full
verification after focused success; reported tests alone cannot grant VERIFIED.

## 11. C09 — guided setup and frozen job plans

`setup` calls bounded discovery, selects or reports scope/adapter ambiguity, checks
tool availability and writes an immutable draft/ready profile. It prints a short
readiness table: repository; runtime declaration; verifier image; test runner;
dependencies; required next action. Missing dependencies are setup issues, not coding
failures. It does not need model authentication for read-only discovery.

`plan` requires an acceptance JSON file containing a complete, validated `criteria`
array and optional existing contract controls (model, reasoning, attempts, budgets,
type, policy). Reject unknown fields. The skill constructs it from the user's request
and code; the CLI itself does not call a model or fabricate behavioral expectations.
If a required behavior is genuinely ambiguous, the skill asks that specific question
while continuing independent setup. Existing task authorization is sufficient to
prepare and run an otherwise complete plan; no extra generic approval ritual.

`plan` output is a new directory with `plan.json`, `contract.json`, `plan.md` and any
sanitized trace-frame metadata. `plan.json` contains schema version 1, contract digest,
profile/environment digests, origin identity, current input fingerprints, model,
reasoning, context policy, code/adapter versions, and readiness diagnostics. The
contract is schema 3. Store machine paths privately. Do not copy the original trace
message/log into the plan or worker context.

Before reporting a plan ready, run baseline verification in an isolated snapshot.
For `FIX`, at least one required behavioral probe must reproduce the requested
failure, or an explicit manual reproduction criterion remains pending. If every
configured outcome already passes, return `ALREADY_SATISFIED`/not-reproduced with
evidence and spend no worker tokens. Missing runtime/dependency errors are not defect
reproduction. Keep baseline preparation timing in the journey record.

`run --plan --expect-plan` revalidates the plan hash, profile inputs, original source,
image and contract. It does not trust a plan-time PASS as final proof. If unchanged,
it may reuse the baseline as input only after checking candidate, image, verifier,
contract and artifact identities plus evidence hashes exactly; otherwise capture a
new baseline or return `PLAN_STALE`. Never edit the plan in place to adapt to drift.
The default conservative implementation re-runs the baseline; record that cost.

Fresh file-hint/trace information is frozen into the context manifest. A changed
goal, required probe, budget, model or profile creates a new plan/run, not an in-place
resume. Preserve old plan artifacts for audit.

Tests `PLAN-01..08`: ready simple Python/Node project; missing dependencies; ambiguous
scope; invalid/missing acceptance; already-passing baseline invokes no model; stale
source/manifest/image/contract; immutable plan hash and paths with spaces; installed
skill creates/runs a plan without authoring a manual-only substitute for an automatable check.

## 12. C10 — deterministic repair context

### 12.1 Inputs and ranking

Version the policy `evidence-v1`; preserve `filename-v1` for A/B measurement. Context
schema has `policy`, `files` (0–32 normalized known source paths), `symbols` (0–32
literal identifiers, maximum 128 characters), and `frames` (0–64 `{path, line}`
records already resolved by trace analysis). Raw error messages are not stored.

Build one bounded import graph for the current snapshot (up to 2000 supported files,
20 MB total reads under existing reader limits). Use explicit user file hints and
valid trace paths as scan priority before filename ranking. Partial coverage remains
visible; do not manufacture reverse edges for unscanned importers.

Assign each file the sum of the following once-per-signal weights:

| Signal | Score |
| --- | ---: |
| Explicit file hint | 1000 |
| Matched trace frame | 900 |
| File of an actually failing expected test | 800 |
| Exact case-sensitive requested symbol found as an identifier token | 300 |
| Direct import or importer neighbor of any above seed | 120 |
| Distance-two import/importer neighbor | 40 |
| Each distinct goal term in basename (max 5) | 10 |
| Each distinct goal term elsewhere in path (max 5, exclude basename matches) | 3 |
| File under src/ or selected application scope | 1 |

Tokenize goal terms using ASCII identifier chunks of length at least 3, lowercase,
deduplicate, excluding `the, and, for, with, this, that, from, fix, bug, error, test`.
Exact identifiers use the existing lexical tokenizer where supported. Never execute
source to extract symbols. Prefer actual declaration lines when available; otherwise
label a token occurrence rather than claiming a definition. Score ties sort by
normalized path code point.

Choose at most 12 files. Reserve up to 3 slots for failing/relevant tests when present
and up to 8 for implementation; remaining slots use overall ranking. Explicitly
named files/trace frames outrank these soft role reservations: fill their unique
paths first, up to 12, then fill available reservations. If more than 12 explicit
paths exist, take score/path order and report omissions. Always emit selection reasons.

### 12.2 Excerpts and prompt limits

For each selected file, choose line windows around a trace frame, exact identifier,
failing test declaration or first import; fallback first 20 nonblank lines. A window
is 8 lines before through 8 after, bounded to the file. Merge overlaps, keep at most
3 windows per file, priority trace > symbol > test > import > fallback.

Context section maximum: **16,000 UTF-8 bytes**, including labels; maximum per file
**2,000 bytes**, cut only at complete UTF-8/line boundaries. Rotate through selected
files in rank order to allocate one window each before extra windows. Include path,
line span, content hash and signal reasons. Excluded/credential files stay excluded.
Candidate text is quoted as untrusted data, not instructions.

Whole worker prompt maximum: **32,000 UTF-8 bytes**. Reserve up to 8,000 for immutable
instructions/goal/task criteria, 6,000 for current failure feedback, 16,000 for
context, 2,000 for metadata/prior-attempt summary. Reject oversized mandatory task
content during planning. Clip diagnostics/excerpts with explicit omission counts;
never slice the concatenated prompt and accidentally cut off required instructions.

On a resumed conversation, include current failure, changed selected-file hashes,
changed excerpts and a concise task reminder. Do not repeat identical excerpts
already sent to that thread. New thread means full context again. Compute context
from current bytes each attempt; never cache PASS. Store the emitted context manifest
privately and record its digest, bytes, files and reasons on the attempt.

If scans exceed limits, fall back to available explicit hints plus the old bounded
filename policy, mark partial and explain the fallback. Do not fail a repair only
because a full graph was too large. No vector database, embeddings, new LLM call or
persistent graph cache is required.

Tests `CONTEXT-01..09`: filename-decoy fixture; trace/symbol/test priority; reverse
neighbor discovery; stable ties across locales; exact limits and UTF-8 boundaries;
partial fallback; secret exclusions/inert source instructions; retry deltas and new
thread reset; unchanged legacy policy for comparison.

## 13. C11 — change-impact reports

Use current imports, not a call graph. `--file` selects one known inventoried file.
`--since` resolves a supplied Git revision once to an object ID, then obtains changed
tracked paths with `git diff --no-ext-diff --no-textconv --name-only -z REV --` plus
nonignored untracked paths. Never interpolate the revision into a shell command;
reject revision strings beginning with `-` and validate through `rev-parse`.

Default depth 2, maximum 6. Traverse reverse edges breadth-first with a visited set;
record shortest distance and one deterministic lexicographically smallest shortest
path per result. Report direct import dependencies separately; do not mix them with
downstream consumers. Sort downstream results by distance then path. Source coverage,
unresolved imports and truncation stay visible.

Test candidates: graph-reachable files classified as tests, then same-scope test
files with matching basename/identifier tokens. Label the basis `import-evidence`
or `name-heuristic`; do not claim complete coverage. For a deleted changed file,
merge its baseline graph edges from REV with current edges and label historical
edges explicitly. If baseline scanning is unavailable, report the missing coverage;
never imply that deletion has no consumers.

Detect strongly connected components in the scanned local graph using Tarjan's
algorithm. Report components of size >1 and self-loops; sort members/communities
by code-point path order. Do not call a cycle a defect by itself.

Output `impact.json`, `impact.md`, `impact.mmd`. Diagram maximum 30 nodes: changed
seeds first, then downstream by distance, then candidate tests, then direct imports.
Tie order is deterministic, duplicates removed. State omitted count and preserve
the bounded full result in JSON. No confidence percentage; use evidence labels.

Tests `IMPACT-01..08`: direct/transitive consumers; depth and cycles; unrelated file
exclusion; deleted-file baseline edges; heuristic test labels; partial scan; malicious
revision/escaping path; deterministic diagram limit.

## 14. C05/C12 — review and progress users can act on

### 14.1 Review artifacts

Compute a review from initial versus current sealed candidate manifests, not a
worker's summary. Validate artifact and proof identities first. Output separate
dimensions: `automated_checks`, `human_review`, `accounting`, `delivery`, plus existing
authoritative run status. No single green badge may hide pending human review.

`review.json` schema 1 includes run/candidate/contract IDs, baseline reproduction,
required-check rows, pending criteria, file-change rows, usage completeness, and
next actions. Each file row includes path, added/modified/deleted/mode-change kind,
before/after digest, added/deleted line counts where text, protected reason, and
whether a diff preview was truncated. Binary files show hashes/sizes only.

Generate unified diffs from controller-held copies, with 3 context lines. Limit
inline preview to 200 lines/file and 2000 lines/report; retain a complete patch as a
separate private artifact subject to delivery's 32 MiB patch limit. Text diff
heuristics may flag `assertion-lines-removed`, `expected-value-lines-changed`,
`test-skip-marker-added`, `test-file-deleted`, and `configuration-changed`. These
labels describe syntax differences; they cannot conclude semantic weakening or
auto-approve a candidate. New tests and edited existing tests are shown separately.

Provide Markdown and a self-contained HTML view with inline local CSS, no JavaScript,
network fonts, trackers, external resources or automatic browser opening. Use a
readable single-column layout, summary cards, status text/icons that do not rely on
color, expandable per-file diffs, evidence links and a visible next-action block.
Escape all user/source text; prohibit active `javascript:`/external artifact links.
An HTML review is a view, never an approval interface or server.

Existing `approve` remains the only approval operation and requires a real human
review plus snapshot and note. Show its exact command using the current run/snapshot;
the skill executes it only after actual human instruction. Reading/opening a report
does not mean approval. A stale report says so and cannot drive current approval.

Tests `REVIEW-01..09`: protected versus added tests; deletion/mode/binary changes;
truncated preview with full artifact; escaping malicious HTML/Markdown; stale
snapshot; explicit pending-review messaging; unknown usage; approval invalidation;
no automatic approval from report generation or helper text.

### 14.2 Progress and run navigation

Project controller events into plain language:

| Internal phase/event | Display |
| --- | --- |
| preflight | Checking project setup |
| baseline_started | Reproducing the problem |
| context_started | Finding relevant files |
| attempt_reserved / worker_started | Working on the fix — attempt N of M |
| verification_started | Checking the proposed fix |
| review_pending | Checks passed; your review is needed (only if checks passed) |
| stopped | Exact stop reason and one next action |
| delivery_started / delivery_completed | Applying the checked change / Change applied |

The worker's completion event means it stopped generating, not that the repair passed.
Do not display invented percentages, predicted finish times or live token counts not
provided by the source. Show elapsed time and last real phase. A 15-second heartbeat
may say the phase is still running; it must not claim new progress.

Persist phase transitions, not heartbeat spam. `status --watch` polls at most once
per second, emits only changes plus heartbeat, exits when the run becomes inactive
or interrupted. Closing a status watcher must not cancel the worker. `runs` returns
the last 20 runs by creation time then ID, default scoped to the supplied repository
when `--repo` is present; no directory crawl of unrelated state.

Tests `PROGRESS-01..07`: phase mapping; machine/human output separation; no false
completion; fake-clock heartbeat; cancellation semantics; run-list scope/order/limit;
resume retains budgets and phase history.

## 15. C13 — clean-project patch and delivery

### 15.1 Patch artifact

Only current `VERIFIED` repair results can be automatically applied. `INVESTIGATED`
may still use legacy export, but is not a repair to apply. Pending-review candidates
may have review diffs; `patch`/`apply` must not label them approved delivery artifacts.

Produce `candidate.patch`, `delivery.json`, and `report.md` in a new directory.
Patch represents initial-candidate → verified-candidate changes, including additions,
deletions, binary changes and executable-bit changes. Do not diff against an arbitrary
current HEAD. Use a controller-owned temporary Git repository/index to generate a
binary-capable full-index patch with rename detection off and external diff/textconv,
hooks, signing, filters and global Git configuration disabled. User .gitattributes
must not execute a clean/smudge filter; prepare objects from recorded bytes. Paths
are data, never shell text. Never use the user's index as scratch.

`delivery.json` records schema 1, run ID, source mode, base HEAD, original inventory
digest, candidate digest, contract/verifier/runner identities, patch hash, exact
changed-path preimages/postimages, and unsupported-path reasons. Max patch 32 MiB;
larger changes use existing full export with an explicit limitation. Initially deny
apply for changed symlinks, submodules, special files, case-colliding paths and file/
directory type transitions; ordinary binary regular files are supported.

### 15.2 Preflight and application

`apply --check` makes no project changes. For 0.4 require the original repo identity,
HEAD equal to the captured base, a clean index/worktree, no merge/rebase in progress,
and every changed-path preimage matching exactly. Reject ignored/untracked files
that would collide with additions and symlink parents that could redirect writes.
Validate the patch digest and ensure parsed paths exactly match the delivery manifest.
Run `git apply --check` with controlled Git environment, no shell expansion.
Use a controller-owned Git directory and private index for patch checking/application,
with the target selected only as its working tree. Do not let target-local filter
configuration execute during apply. Disable system/global Git configuration,
attributes-file overrides, autocrlf, hooks, fsmonitor, signing, external diff and
textconv; test malicious local filter configuration and .gitattributes explicitly.
If the host Git cannot satisfy those conditions, refuse automated apply and offer
the verified export. Read target HEAD/index through separate read-only Git calls.

Actual `apply` requires the caller-supplied candidate `--snapshot` to match current
verified evidence. Acquire a cStack delivery lock scoped to the canonical repo and
the run lock. Recheck all preconditions after locking. Save a private backup of
every touched preimage (bytes, mode, existence), the index manifest and HEAD; fsync
backup and journal before modifying the target. Do not stage or commit the patch.

Apply the complete patch with Git's default all-or-nothing hunk policy; do not use
`--reject`, `--3way`, `--force`, automatic conflict resolution or whitespace repair.
Afterward verify every changed-path postimage, unchanged HEAD/index, and untouched
tracked-file inventory. Record `APPLIED` only after all postconditions pass.

Git apply and the cStack lock do not exclude arbitrary editors or other processes.
Document that source files should not be edited concurrently during apply; do not
claim an OS-enforced multi-file transaction. Recheck as close to mutation as possible,
detect divergence, and preserve recovery evidence instead of blindly restoring over
someone else's concurrent edits.

### 15.3 Crash/failure recovery

Journal states: `PREPARED`, `APPLYING`, `APPLIED`, `ROLLING_BACK`, `ROLLED_BACK`,
`RECOVERY_REQUIRED`. Record each touched path's expected pre/post hashes and durable
backup location. A crash after writes but before success must be discoverable.

`delivery recover` inspects each path. If all match postimages and index/HEAD match,
finish verification of delivery postconditions and mark applied. If all match
preimages, mark rolled back. For a mixture containing expected pre/post images, stop
`RECOVERY_REQUIRED`, preserve every current byte and backup, and list the postimage
paths that need deliberate manual restoration. If any path has a third value, use the
same preserve-and-report behavior. Recovery never performs pathname writes or deletions
after an interrupted apply because the JavaScript runtime cannot anchor them with
descriptor-relative `openat`/`unlinkat` operations. A second recovery invocation is
idempotent. A repeated apply to an already matching delivery returns `ALREADY_APPLIED`
without changes.

Tests `DELIVERY-01..12`: text/add/delete/binary/mode changes; clean check no writes;
changed base/index/source conflict; ignored-file collision; symlink/submodule/path
escape rejection; stale verification; patch tampering; exact target/index preservation;
interruption before/after apply; mixture recovery; concurrent third-value preservation;
idempotent repeated apply/recovery.

## 16. C14/C16 — integration CI and plugin packaging

### 16.1 CI jobs

Preserve existing Node 22.16/24 Linux Docker checks. Add:

1. `analysis-portability`: Node 22.16/24 on Linux and macOS; run read-only/profile/
   context/report tests without Docker, Codex login or writable controller state.
2. `harbor-integration`: Python 3.12; explicitly install `bench/requirements.lock`,
   verify Harbor's installed VCS commit is
   `5eb713ff9500daced4e143b98765a7c732744a1b`, then run all benchmark regression tests.
   `scripts/test-bench-ci.py --require-harbor --fail-on-skip` fails if integration
   imports are unavailable or any intended integration test is skipped. Plain local
   offline test mode may retain documented skips.
3. `test-adapter-integration`: build pinned pytest/Vitest fixture images explicitly,
   run the real isolated adapters and error cases; no model calls or credentials.
4. `package-portability`: build a fresh bundle, relocate it to a path containing
   spaces, run all read-only helpers and scripted repair/review/delivery flows from
   the relocated bundle. Inspect manifests and verifier-resource hashes.

Use read-only repository permissions and no project secrets in these jobs. Pin new
dependencies in locks. Record exact image IDs and dependency versions in artifacts.
Do not publish full candidate traces or arbitrary HTML containing private source.
Keep CI under a stated 20-minute per-job timeout; split adapter jobs if needed rather
than disabling slow correctness tests. Live performance experiments never run on a
pull request or ordinary push.

### 16.2 Skills and docs

Keep the three existing skill IDs unchanged. Add one `impact-analysis` skill with a
relative helper invoking bundled `impact`. Extend the repair skill to use setup,
profile, plan, review, status and delivery. Do not add one skill per CLI command.

The repair skill must explain pending review in plain language, use existing intent
and authorization, ask only for missing behavior/scope facts, and never impersonate
the human approver. It may apply a verified fix when the user requested that delivery;
otherwise present the patch and next action. Analysis skills remain read-only.

Update `plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, `package.json` together
at release gates, not after every task. Build collector must include Python runner,
HTML/CSS templates if any, schemas actually used at runtime, and the new helper.
Extend `verifierIdentity` to hash every controller-owned adapter/launcher/report
parser affecting verdicts; an adapter change must invalidate old verdict evidence.

Update README, CONTRACT, CODEX_PLUGIN, PROJECT_ANALYSIS, SECURITY and VALIDATION;
add SETUP, REVIEW_AND_DELIVERY and IMPACT documentation. Distinguish shipped support
from planned 0.5 behavior and measured results from targets. No new speed/savings
badge without section-17 evidence. The analysis-only requirements remain Node and
project files; Docker/login are repair/environment requirements.

Tests `CI-01..05`: missing Harbor fails required CI mode; no unintended skips;
pinned adapter runtime tests; clean relocated bundle includes all resources;
native skill discovery infrastructure works in an isolated test profile. At C14
check the three existing skills; C16/PLUGIN-01 adds the impact skill and requires
exactly four intended cStack skill IDs at the release gate. This avoids a dependency
on a not-yet-created skill while implementing the CI job.
Tests `PLUGIN-01..04`: existing IDs preserved; relative helpers with spaces;
manifest/version/resource hash agreement; no unrelated plugin/config changes.

## 17. C15 — measurement that follows the user journey

### 17.1 Separate event streams

Record the following nonoverlapping phases, with start/end monotonic durations and
UTC timestamps for correlation: setup discovery, environment preparation, contract
planning, baseline reproduction, worker context, worker execution, final verification,
human-review wait, active human review when explicitly measured, delivery, external
grading. Mark failed/interrupted phases explicitly; never report their time as zero.
Accumulate leaf-phase durations only; an enclosing plan/run wall-clock span is a
separate metric and must not be added again. Persist completed segments before a
process restart and begin a new monotonic segment afterward; do not subtract clocks
from different processes. Human review wait ends when explicitly measured active
review begins, or at approval if active time was not measured. Unmeasured human
activity remains unknown rather than an estimated zero.

Define metrics precisely:

- `time_to_first_analysis`: start of setup/analysis invocation to usable report.
- `time_to_first_ready_plan`: start of setup through ready plan; distinguish cold and
  already-prepared environments.
- `time_to_verified_candidate`: request recorded through checks and required human
  approval; null while approval is pending.
- `time_to_applied_fix`: request recorded through verified delivery postconditions;
  null for an unapplied/pending-review candidate.
- `human_interventions`: actual requests for facts, review or conflict resolution;
  identify reason; automatic status updates do not count.
- `tokens_per_graded_pass`: sum known complete tokens across all scheduled attempts,
  including failures, divided by separate private-test passes. Null if usage is
  incomplete or denominator is zero. Also publish per-trial token distributions.
- `tokens_per_delivered_fix`: same numerator, denominator actually verified/applied
  candidates; null when no delivery or unknown usage. Never substitute test passes.
- `regression_rate`: candidates failing a frozen regression check / candidates graded.
- `accounting_completeness`: complete model-invoking trials / all model-invoking trials.

Worker time already includes its internal shell/tests; do not add those again.
Cached input is a subset. Task time and end-to-end time must have different fields.
Keep setup failure, model error, test failure, pending review and delivery conflict
as different outcome categories.
Record `token_scope` explicitly. The repair benchmark counts the controlled worker
and all of its descendants. Outer interactive Codex chat used to prepare a task is
not automatically observable; if its usage cannot be captured, mark it excluded
and do not call the resulting token metric the cost of the entire user journey.
The primary comparison uses pre-authored equivalent acceptance inputs for all arms.

### 17.2 Offline fixtures first

Create 12 small deterministic functional fixtures (6 Python, 6 JS/TS) covering:
trace-directed bug, misleading filename, cross-module dependency, existing-test
edit, missing dependency, and delivery conflict in each language family. Use
scripted workers for orchestrator assertions and label them scripted. They validate
product behavior, not AI quality. Keep private grader expectations outside worker
mounts. Every defect fixture needs unchanged-candidate fail and known-repair pass.

Use the following exact fixture specifications. Each implementation includes a
separate public probe, regression tests and private grader; keep reference repairs
out of the worker mount. The two missing-environment fixtures are prerequisite
tests, not defect-grade trials. JSON outputs below are exact expected values.

| ID | Files and deliberately broken behavior | Required outcome | Expected scripted journey result |
| --- | --- | --- | --- |
| PY01 | `stats/mean.py::mean` divides by list length without an empty-list branch; `tests/test_mean.py`; supplied trace ends at the division. | Inputs `[]`, `[2,4]` yield `0`, `3`. | VERIFIED; trace file selected; clean apply succeeds. |
| PY02 | `billing/rounding.py::round_amount` uses Decimal ROUND_DOWN; `billing/invoice.py` calls it; unrelated `billing/rounding_display.py` is a filename decoy. | String inputs `"1.005"`, `"-1.005"`, `"0"` yield `"1.01"`, `"-1.01"`, `"0.00"` using ROUND_HALF_UP. | VERIFIED; actual rounding module and related test selected. |
| PY03 | `mail/normalize.py` incorrectly lowercases the entire address; `mail/send.py` imports it; `tests/test_send.py` imports send. | `" User@EXAMPLE.COM "` yields `"User@example.com"`; local-part case preserved, surrounding whitespace removed. | VERIFIED; impact reaches send and its test by reverse imports. |
| PY04 | `sequence/stable_unique.py` sorts a set; existing test wrongly expects sorted output. | `["b","a","b"]` yields `["b","a"]`; first appearance order preserved. Scripted fix changes implementation and that existing test. | NEEDS_MANUAL_VERIFICATION; private grader passes; apply refused. |
| PY05 | Valid pytest project and locked pytest 8.3.5 declaration, but selected Python image lacks pytest. | Setup identifies missing runner; source remains unchanged. | Unready setup; zero worker invocations; no bug-grade claim. |
| PY06 | Bug repair modifies `calc.py` and adds `repair_helper.py`; original checkout already has ignored untracked `repair_helper.py` containing a user canary. | Arithmetic probe passes in private candidate; original canary is never overwritten. | VERIFIED candidate; delivery blocked by destination collision. |
| JS01 | `users/label.mjs::label` dereferences `.name` on null; `test/label.test.mjs`; supplied Node trace identifies that line. | Inputs `null`, `{"name":" Ada "}` yield `"Guest"`, `"Ada"`. | VERIFIED; trace-selected source; clean apply succeeds. |
| JS02 | `timer/duration.mjs::clampSeconds` uses absolute value; unrelated `timer/duration_display.mjs` is a decoy. | Inputs `-3`, `0`, `5` yield `0`, `0`, `5`. | VERIFIED; correct symbol source selected despite decoy. |
| JS03 | `http/path.mjs::joinPath` concatenates directly; `http/client.mjs` imports it; its test imports client. | Pairs `["/api/","/users"]`, `["/api","users"]` both yield `"/api/users"`. | VERIFIED; impact includes client and test. |
| JS04 | `lib/stable-unique.ts` sorts a set; existing Vitest test expects sorted output. | `["b","a","b"]` yields `["b","a"]`; scripted fix edits source and existing test. | NEEDS_MANUAL_VERIFICATION; private grader passes; apply refused. |
| JS05 | Valid npm-lock Vitest 4.0.18 project, selected Node image lacks that dependency. | Setup identifies missing runner; no npm install happens on host. | Unready setup; zero worker invocations; no bug-grade claim. |
| JS06 | Bug repair modifies `calc.mjs` and adds `repair-helper.mjs`; original has ignored untracked file at that name containing a user canary. | Probe passes in candidate; original canary survives preflight/apply attempts. | VERIFIED candidate; delivery blocked by destination collision. |

For collision fixtures, baseline calculator subtracts instead of adding: `[4,2]`
must produce `6` and `[-5,3]` must produce `-2`; the scripted repair delegates correct
addition to the new helper. The original ignored helper is not copied into the
private baseline. Fixtures assert the exact collision diagnostic, not any failure.
Every successful fixture must also pass an unrelated unchanged regression test;
scripted worker writes must be confined to the predeclared repair paths. Manual
approval is not synthesized to move PY04/JS04 into the delivered-success denominator.

Local graph/context workload: 100, 1000 and 2000 supported files generated with
fixed seed 104729; include deep imports, cycles, irrelevant files and one known
target. Run one cold invocation followed by 10 warm invocations on the same recorded
machine; publish cold and warm results separately. Record median/p95, bytes read,
peak RSS and coverage. Proposed context retrieval gate: target source present in
all applicable deterministic fixtures; at least 10/12 have the relevant test in
the selected set; no missing explicit hint within configured capacity.
Generate graph workload paths `src/m0000.mjs` through `src/mNNNN.mjs` plus a test
for the final module. Each module imports its predecessor when one exists and two
indices from a 32-bit LCG seeded 104729 (`x = (1664525*x + 1013904223) mod 2^32`,
target `x mod N`). Deduplicate edges; retain generated self-loops. Put the named
target identifier only in the final module and distractor goal terms in every tenth
module's comment body. Pad each module deterministically to 1024 UTF-8 bytes with comments.
Count the extra test separately from N. Publish the generator version/hash. Measure
the first cold invocation separately, then 10 warm invocations; do not silently
discard an additional measured outlier. Warm cache here means OS/file reuse, not
a persistent cStack graph cache.

### 17.3 Fresh model-backed comparison

Implement `python -m bench.journey prepare|validate|run|report` with a required fresh
work directory. `prepare` does not invoke a model. It freezes code/model/CLI/image/
prompt/check/adapter identities and an exact schedule. `run` requires the manifest
digest and a separate experiment budget file; absent authorization/budget is a
stop, never implicit permission to consume the account.

Primary arms: frozen cStack 0.3.0 baseline, new cStack single-worker, and plain Codex
single-worker. Use the same model `gpt-6.1-sol`, medium reasoning, project, issue,
available development tools and public reproduction. cStack criteria are equivalent;
plain Codex receives the equivalent instructions. Give each scheduled trial a 10-minute
active execution ceiling; cStack at most 2 worker attempts, 500,000 observed-token
admission ceiling. Report that a full turn can overshoot and that plain Codex's
internal iterations differ from cStack's controller attempts.
For acceptance equivalence, the old arm uses schema-2 public probes and the new arm
uses schema-3 probes with identical argv, input cases and expected outputs; the new
arm enables `evidence-v1` context. Do not add extra required adapter tests only to one
primary arm. Adapter/setup/review/delivery improvements have their separate journey
and integration measurements. Independent private grading is identical across arms.

Start with 2 fresh cases × 3 arms × 1 repetition = **6 smoke trials**. After all
environment/accounting gates pass and budget is authorized, run **12 fresh cases ×
3 arms × 3 repetitions = 108 scheduled trials**. The 12 must include 6 Python and 6
JS/TS tasks, with 4 single-module, 4 cross-module and 4 test/configuration-sensitive
repairs total. They must not reuse the five old benchmark bugs. Freeze selection
before looking at contender results. AI-authored synthetic tasks are labelled as
such and cannot alone establish real-project generality; include held-out real
project defects when available, with source/licensing and private checks reviewed.
For the full study require at least 8 real-project defects and at most 4 clearly
labelled synthetic tasks. If eligible cases cannot be sourced and validated, leave
the full study pending; do not relabel synthetic fixtures as real-project evidence.
"Fresh" means not previously used in this cStack comparison. Unless independently
established, do not claim that a public case was unseen during model training.

Use a balanced three-arm Latin rotation: for zero-based case index i and repetition
r, arm order is left-rotate `[old-cstack,new-cstack,plain-codex]` by `(i+r) mod 3`.
One trial at a time on the same machine class. Fresh worker conversation and candidate
per trial. Provider caches cannot be fully controlled; record cached-token subsets
and interpret accordingly. Never retry only failed paid trials outside the frozen
schedule. Infra failure pauses remaining admissions for diagnosis and preserves its row.

Budget manifest specifies authorized trial IDs, model, per-trial time/attempt/admission
limits, maximum cumulative observed tokens and approval provenance. Stop admitting
trials when known totals reach the cap or any trial's usage is unresolved. The default
template is unapproved and non-runnable; do not write invented approval text. All
parent/helper usage must reconcile; primary arms should have zero helper threads.

Report individual cases and medians, p95, pass counts, missing data, total tokens and
paired ratios. Compute 95% paired bootstrap intervals over task-level aggregates
(10,000 resamples, fixed seed 104729), not 36 independent task claims from repeated
runs of the same 12 tasks. No pstack superiority refresh from historical unmatched
data. A new pstack comparison requires an independently frozen matched arm and budget.
Bootstrap sampling unit is a case: resample 12 case IDs with replacement and carry
all three repetitions and all arms for each selected case. Recompute aggregate
tokens-per-graded-pass and each arm's median active task time for every resample;
use the ratio new/old and percentile endpoints 2.5/97.5. A resample with missing
usage or a zero pass denominator has an undefined efficiency ratio. If fewer than
90% of resamples are defined, report the interval unavailable with counts. Report
the paired per-case median time ratios separately. Record the random generator
algorithm (Python `random.Random`) and seed, nearest-rank p95, and median definition.

Proposed performance targets, **not promises or correctness-release gates**:
new cStack aggregate complete tokens per graded pass at least 15% below old on the
matched scheduled workload;
median active repair time at least 10% below old; no reduction in separate pass count.
If targets are missed, publish the result, inspect phase data and retain beneficial
usability features. Do not remove checks to hit these targets or claim improvement
from a wide interval spanning worse performance.

### 17.4 Human usability study

Measure real users separately: 5 participants unfamiliar with cStack, each completes
four tasks: a matched pair of distinct Python bugs and a matched pair of distinct
JS bugs, one task per pair using old cStack and the other using new cStack (20 human
journeys total). For zero-based even participant IDs use old then new on Python and
new then old on JS; reverse for odd IDs, and alternate the language-pair order.
Swap which bug variant receives which workflow with participant parity. Freeze
task pairs, instructions and assistance rules. Record
setup completion, time, assistance requests, review comprehension (which checks
passed and which approval remains) and delivery success. No credentials/traces in
published recordings. Report individual anonymized rows and medians; small sample,
no claim of population-wide exponential improvement.

When participants are unavailable, run scripted journey acceptance only and mark
human usability evidence `NOT_RUN`. An AI simulating a user does not count as a human
participant. Do not auto-approve benchmark candidates to manufacture delivery metrics.

Tests `BENCH-01..08`: frozen schedule/Latin rotation; no-op/gold validation; aggregate
failure accounting; incomplete usage yields null totals/ratios; pending review not
delivered; separate phase arithmetic; stable bootstrap; no automatic paid execution.

## 18. D01/D02 — existing uncommitted work, release 0.5

### 18.1 Source capture

`source_mode: working-copy` is explicit in the frozen plan. Keep `clean` as the default.
The unit of repair is the current working-copy content, not the staged snapshot.
Record staging separately so cStack can preserve it. Refuse merge/rebase/cherry-pick
in progress, unmerged index stages, sparse checkout, submodules, external symlinks,
special files and ambiguous case collisions. Return specific unsupported-state codes.

Capture original HEAD, branch/ref identity where applicable, normalized index
entries (`path, mode, object ID, stage`), and an inventory of tracked plus nonignored
untracked files. Include tracked files even when a current ignore pattern matches
them. Include tracked deletions. Do not copy ignored untracked dependencies, caches
or secrets. Report exclusion counts. Secret-looking included files retain the
existing exact reviewed-fixture policy; do not silently drop a tracked source file
needed to define the baseline.

Read without updating the user's index (`GIT_OPTIONAL_LOCKS=0`, hooks/fsmonitor off).
For each regular file record bytes hash and executable bit; validate internal
symlinks under the existing snapshot rules, but changed-symlink delivery remains
unsupported. Capture a second inventory/index/HEAD after copying. If any changed,
return `SOURCE_CHANGED_DURING_CAPTURE`; discard only owned temporary capture files.
Do not loop indefinitely trying to chase active edits.

Create the private detached worktree at captured HEAD. Overlay the captured working
files and removals into that worktree, then verify its selected-file manifest equals
the captured inventory. Do not commit the overlay anywhere, do not move original
HEAD, and do not stage/stash original edits. Existing `run.base` remains the original
commit; `initial_snapshot` is the overlaid working-copy baseline. The worker prompt
states that pre-existing edits are user work, lists their paths and requires keeping
them unless the requested fix explicitly needs a change there.

The original index manifest digest, original working-copy manifest and overlay
digest are separate fields. User staged/unstaged status is not reconstructed from
the final candidate and is never conflated with cStack's delta.

### 18.2 Delivery against a dirty origin

Generate the candidate patch from captured working-copy baseline to verified result.
Pre-existing user edits therefore do not appear as changes authored by cStack.
Before apply, require original HEAD/ref, index entries, and included working-copy
inventory still match capture. This first implementation rejects any intervening
included source change, even in an unrelated file; it does not attempt a three-way
merge. Ignored unrelated files may exist, but touched-path collisions still block.

Apply only cStack's delta to working files without `--index`. Existing staged bytes
remain staged exactly as before; cStack additions are unstaged. A file containing
both a user's pre-existing edit and cStack's repair must preserve both in the final
working copy. For an initially untracked file, apply the delta to its captured
preimage without adding it to the index. Preserve original deletions that cStack
does not intentionally change. Existing C13 journal/recovery rules apply.

Do not use a patch against original HEAD, automatic stash/restore, an implicit
temporary user commit, `git reset`, or best-effort conflict-marker writes. Return
`SOURCE_DIVERGED` and a current review artifact when preconditions changed.

Tests `DIRTY-01..12`: staged-only edit; unstaged-only edit; staged plus unstaged same
file; untracked file; tracked deletion; user change in same repaired file; unrelated
user changes preserved; ignored-file collision; source changes during capture;
index/HEAD drift before apply; symlink/submodule/sparse/unmerged refusal; interruption
and recovery preserve staging and any concurrent third-value file.

## 19. Acceptance, release gates and exact execution order

### 19.1 Task order

Execute the topological order in `upgrade-backlog.json`:

```text
C00 → C01 → C02 → C03 → C04 → C05 → C06 → C07 → C08 → C10
    → C09 → C11 → C12 → C13 → C14 → C15 → C16 → C17
    → D01 → D02 → D03
```

The JSON lists true dependencies; order above is the default single-implementer
sequence. Review/progress/analysis modules can be developed independently when
dependencies permit, but this specification does not itself authorize more agents.

### 19.2 C00 baseline gate

Record actual Node, Python, Git, Codex and Docker versions/context. Run existing
syntax/core/benchmark/offline-grader checks with the pinned environment. Preserve
results and clean-source archive/diff before modifications. Confirm the prior
90 core + 77 benchmark counts as historical expectations, not hardcoded future
totals; if current counts differ, investigate and record why. Do not delete tests to
force a count. No new model run is needed for baseline product validation.

### 19.3 Required commands at C17 and D03

After implementation provides the named new entry points, run:

```sh
npm run check
CSTACK_TEST_RUNNER=docker npm test
.bench-venv/bin/python scripts/test-bench-ci.py --require-harbor --fail-on-skip
.bench-venv/bin/python -m unittest discover -s test -p 'grader_offline_test.py' -v
node scripts/validate-upgrade.mjs --release 0.4.0
npm run plugin:build
```

For D03 use `--release 0.5.0`. Respect a caller-selected Docker connection; on the
recorded T7 host use a command-scoped `DOCKER_CONTEXT=colima-cstack` if it remains
available. Never change global context to make tests pass. The isolated native-plugin
test profile must not copy real auth; read-only discovery and scripted repair do not
need a live model account. Use actual native CLI discovery, not just finding SKILL.md
files in a directory.

Run the real adapter fixture images and apply/recovery fault-injection matrix as
part of `npm test` or an explicitly invoked required integration script. The release
validator checks their evidence; it must not invent pass results from file presence.
Verify a clean `git archive` export with only declared dependencies; then verify the
relocated installed bundle. Runtime must not depend on the developer checkout.

### 19.4 0.4 release pass/fail

Required: all C00–C16 acceptance IDs pass; required CI has zero unintended skips;
old schema-2 fixtures remain valid; no extra worker invocation after unresolved
usage; real pytest/Vitest isolation exercises pass; clean patch/apply/recovery tests
pass; plugin exposes four intended skills; no private data in Git diff; README
distinguishes new features from old benchmark evidence. All 12 scripted journeys
must finish with the exact expected state, including deliberately pending/conflict
cases. A pending-review fixture must not be forced to VERIFIED merely to be green.

Record performance and human-study evidence as `PASSED`, `FAILED`, or `NOT_RUN` with
its actual scope. These are claim gates separate from functional release readiness.
No claim of lower tokens, faster completion or better human usability without the
corresponding experiment. No routine live/multi-agent rerun is required to validate
the product's deterministic features.

### 19.5 0.5 release pass/fail

All 0.4 gates plus DIRTY-01..12, original index/HEAD/content preservation from every
working-copy scenario, verified patch excludes pre-existing user deltas, and native
plugin end-to-end exercise on a deliberately dirty fixture. Document strict drift
rejection and unsupported Git states. Keep clean mode as default.

### 19.6 Definition of done per task

A task is not done because its code exists, a mock passes, or an AI says it works.
Its specified behavior, failure cases, tests, docs and evidence must exist, be run
at the appropriate boundary, and be recorded. Do not mark future tasks validated.
Prefix executable test names with the backlog acceptance IDs, e.g. `USAGE-05`.
One requirement may have multiple tests; one test may cover multiple IDs only when
its assertions explicitly establish each requirement. The release validator reads
test-run results and verifies required IDs have at least one passing test and no
failure or unintended skip. IDs in a source file or an empty evidence record are
not proof. The 144 unique IDs in the initial backlog are requirements to implement,
not 144 tests already written or passed. D01/D02 intentionally share preservation
requirements that must be checked at both capture and delivery boundaries.
Release publication/install into the user's normal profile and Git push are separate
side effects subject to the implementing session's actual authorization.

## 20. Explicitly deferred work

These are excluded to keep this upgrade bounded, not forgotten requirements:

- Multi-agent default, automatic model routing or weaker verification for speed.
- Embedding/vector databases, persistent graph services or a hosted dashboard.
- Complete AST/call graph, runtime tracing, universal language/package-manager support.
- Automatic resolution of merge conflicts or arbitrary concurrent editor writes.
- Automatic approval of edits to existing tests based on syntax/AI review.
- Live hard token kill-switch without trustworthy in-turn usage telemetry.
- Automatic installation of arbitrary package hooks, private-registry credentials,
  platform SDKs or native build toolchains.

The simple HTML review is sufficient for this release. Add heavier UI, caches or
broader adapters only when measured user cases show a need.

## 21. Reference boundaries

Repository sources define the baseline; online references inform integrations, not
authority over user authorization. Recheck version-specific APIs when implementing
and pin the supported compatibility fixtures rather than silently following latest.

- [Git apply](https://git-scm.com/docs/git-apply): applicability checking and default
  failure behavior. It does not promise exclusion of concurrent editors.
- [pytest hooks](https://docs.pytest.org/en/stable/reference/reference.html#hooks):
  collection and result hooks used by the adapter.
- [pytest failed-first behavior](https://pytest.org/en/latest/how-to/cache.html):
  existing runner support; cStack still owns its required final-check policy.
- [Vitest 4 reporter API](https://v4.vitest.dev/api/advanced/reporters): lifecycle
  integration for the explicitly pinned 4.0.18 compatibility target.
- [Docker build practices](https://docs.docker.com/build/building/best-practices/):
  minimal contexts and image identity; installation is separate from verification.
- [SWE-bench Verified limitations](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/):
  motivation to add fresh held-out tasks; not proof that cStack's saved cases were
  contaminated or its measured workflow costs invalid.

## 22. Handoff instruction

An implementing AI should start with C00, then follow the backlog dependencies.
Do not ask the user to choose these already-decided implementation details again.
Ask only for required project behavior, unavailable resources or external actions
whose authorization is missing. Explain any material deviation before changing this
specification. Maintain source-backed verification, preserve user work, and report
measured outcomes plainly, including unmet targets.
