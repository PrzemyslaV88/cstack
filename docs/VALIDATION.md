# v0.2 validation record

Date: 31 October 2026. Audited base: `3bb752216c705f240f4b330890ca828bcbb3a8e2`.

## Executed locally

Environment: Linux x86_64; Node 22.16.0; Git 2.47.3. Verification used real Linux user/mount/PID/network namespaces and real temporary Git repositories. No production repository or service was exercised.

- Original v0.1 suite: 16/16 passed before changes, reproducing the review's starting point.
- v0.2 full suite: **60/60 passed; zero failed, skipped or cancelled**. This includes 16 migrated controller behaviors, 13 audit regressions, 25 reliability/security cases and 6 CLI/input/transport cases.
- `npm run check`: syntax checks passed for 20 runtime/test/script modules.
- CLI lifecycle: real CLI, persistence, worktrees, isolated candidate execution, report and export; **synthetic Codex executable**, not a model call.
- Isolation: real host-file/environment canaries, outside-write rejection, read-only candidate and network-denial checks. Canary values were synthetic.
- Recovery: real controller termination plus restart, transactional-write fault injection, stale revision and concurrent-resume tests.
- Offline dependency input: a real imported module supplied through a pinned input bundle, and ignored-input mutation detection.
- `doctor --runner linux`: isolation available; Codex unavailable. No API fallback was attempted.

The tests are deterministic regression fixtures. Passing them does not establish production readiness, hidden-case correctness, real-model effectiveness or cost superiority.

## Not validated locally

- A real authenticated Codex session. Run the explicitly authorized `npm run test:live` only after `doctor` confirms supported CLI/authentication. This consumes the operator's Codex allowance.
- A real Docker engine. Its command policy and cleanup were tested with a fake transport; `.github/workflows/ci.yml` runs the actual suite with Docker when GitHub Actions executes. Do not infer a green remote run from this file.
- Native macOS, Windows, iOS/StoreKit, Firebase or a genuine Chattly/LodeCraft task.
- Measured subscription savings or improved completion against ordinary Codex. See EVALUATION.md.

## Changed contract and storage format

This version intentionally rejects weak v0.1 command-only contracts. Use schema 2 probes, named node-test expectations, and manual outcomes. The v1 database is not migrated into trusted proof; v2 uses `state-v2.db`. No earlier user work is overwritten. The historical ARCHITECTURE.md remains a proposal, not a statement that every roadmap component has shipped.

## Release decision

Keep these changes on a review branch until real Docker CI and an authenticated Codex smoke test have been inspected. No automatic merge, deployment or publication is authorized by a passing fixture suite. The source archive and separate validation evidence accompany the implementation handover.
