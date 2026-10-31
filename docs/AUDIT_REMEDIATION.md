# v0.1 audit remediation

Baseline audited commit: `3bb752216c705f240f4b330890ca828bcbb3a8e2`.

The original 16 controller behavior categories remain tested, migrated to v2 contracts and explicit isolated verification. The separate audit regression suite covers the original counterexamples with the new proof semantics. Tests do not count a validation rejection as successful implementation; invalid contracts are rejected before work.

| Audit | Implemented repair | Executable coverage |
|---|---|---|
| R01 | External probe comparisons; missing output is failure; declared node cases required | audit-regressions R01; fabricated node stdout; test-stream validation |
| R02 | Candidate execution in Docker or Linux namespace runner; no inherited secrets/controller mounts/network | R02 actual canary/write test; actual network denial; readonly candidate tests; Docker protocol policy test |
| R03 | Required outcomes and task-level required evidence validated | R03; contract validation |
| R04 | Bounded expected/observed diagnostic packet, baseline and evidence reference | R04; corrective retry |
| R05 | Current outcomes satisfy dependent tasks without new edits | R05; dependency advancement |
| R06 | Behavior-bearing configuration and declared implementation artifacts accepted | R06 config-only fix |
| R07 | Blocked runs and human gates can safely resume without budget reset | R07; manual approval lifecycle; stale approval |
| R08 | SQLite state/events in one transaction; JSON exports non-authoritative; exclusive lock and revisions | R08; injected transactional failure; genuinely killed controller; concurrent/stale writers |
| R09 | Attempt reservation before worker launch, all exits charged, run-wide ceilings | R09; provider limit; run-wide budget; killed controller |
| R10 | Structured error-event classification, not prose keyword scanning | R10; synthetic CLI lifecycle |
| R11 | TERM/KILL escalation, bounded process settling, cancellation/output caps | R11; output cap; abort |
| R12 | Ignored inputs included in sealed identity; explicit pinned dependency bundles | R12; dependency bundle mutation |
| R13 | HEAD + complete manifest identity, after-step and final gates | R13; source/mode/evidence mutation; final-gate callback mutation |

Additional work: modular controller/process/contracts/store/snapshot/verifier/worker code; enforced critical policy; CLI doctor/draft/validation/evidence/approval/export; explicit offline inputs; no host execution fallback; usage field totals; a bounded, opt-in live Codex smoke command; CI Docker verification on Node 22/24.

## Release gates not fabricated as complete

- Authenticated real Codex session: separate `npm run test:live` gate; unavailable without an authenticated supported CLI.
- Docker engine integration: exercised by the configured CI suite only when the engine/image actually run. A transport-policy unit test is not equivalent.
- macOS Docker/Apple simulator/Swift/Firebase adapters: not validated here; specialized application adapters are not shipped.
- Real project outcomes and token savings: require controlled comparison; fixture success does not establish these claims.
- General dependency installation/build orchestration, UI agents, auto-delivery: intentionally not implemented. Explicit reviewed input bundles and candidate export are the current supported paths.
