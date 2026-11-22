# Tooling incident reports — 10 November 2026

These reports document CStack behavior verified against the public source. They are submitted as a draft PR because the repository's Issues channel returned HTTP 410 (disabled). Reproductions use generic fixtures. Local mitigations mentioned below have not been submitted as implementation changes.

## 1. Schema 3 worker lifetime cannot use the remaining active budget because of the one-hour ceiling

### Observed
A long-running repair could not continue under its explicitly larger run-wide active budget because the worker timeout is independently capped at one hour.

The current public `src/contracts.mjs` normalizes `worker_timeout_ms` with an upper bound of `3_600_000`, while `max_active_ms` allows up to `86_400_000`. Omission uses a separate ten-minute default.

Source: https://github.com/PrzemyslaV88/cstack/blob/main/src/contracts.mjs

### Minimal reproduction
Starting from a valid schema-3 contract, configure:
```json
"budget": {
  "max_attempts": 1,
  "max_active_ms": 10800000,
  "worker_timeout_ms": 7200000,
  "max_observed_tokens": 100000
}
```
Normalization rejects the two-hour worker limit, despite the three-hour active budget. Configuring the maximum accepted worker value still ends that invocation at roughly one hour.

### Requested behavior
- For schema 3, let omitted/null worker timeout use the remaining active budget.
- Allow an explicitly requested larger worker timeout, always capped by remaining active budget.
- Keep schema-2 compatibility and every already-frozen run's limits unchanged.
- Preserve timed-out/interrupted attempts, unknown usage and fail-closed accounting; do not reset budgets or retry automatically.

A local mitigation and regression coverage were prepared, but have not been submitted as a PR. This report contains only generic CStack behavior, with no downstream project data or source.

---

## 2. Docker verifier has fixed 128 MiB /tmp with no bounded larger scratch option

### Observed
Valid offline verification was blocked by the verifier environment's available temporary storage, rather than a defect in the candidate. The Docker runner hardcodes:
```
--tmpfs=/tmp:rw,nosuid,nodev,size=134217728,mode=1777
```
The current contract has no explicit larger scratch-storage option.

Source: https://github.com/PrzemyslaV88/cstack/blob/main/src/sandbox.mjs

### Minimal reproduction
Use an explicitly prepared verifier image containing Python. Run a probe that requires 256 MiB of writable scratch:
```python
import os
s = os.statvfs("/tmp")
assert s.f_bavail * s.f_frsize >= 256 * 1024 * 1024
```
It cannot pass with the fixed 128 MiB mount, even on a host with sufficient disk. A workload writing more than the mount capacity also fails.

### Requested behavior
Provide an explicit, bounded per-contract scratch option, including disk-backed storage for disk-heavy checks. Keep the restrictive default.

Preserve:
- read-only candidate and runner mounts;
- network isolation, unprivileged UID, CPU/RAM/PID limits;
- controller-owned paths, no symlink/path escape;
- real filesystem identity/capacity checks, not simulated free space;
- fresh per-execution directories and safe cleanup after container removal;
- runner identity changes when storage identity/configuration changes.

Capacity/setup failures should be diagnosed as environment blockers rather than encouraging a coding worker to weaken production resource checks. A local bounded-storage mitigation and physical isolation/cleanup tests were prepared; no PR is included here.

This is a sanitized infrastructure report, with no downstream project data.

---

## 3. Read-only investigation may admit a coding worker when only human acceptance remains

### Observed
A schema-3 `INVESTIGATE` run can have all automated probes passing, no implementation changes, and a required manual criterion still pending. That should wait for the human without reserving a coding invocation.

In `deliveryDecision`, the manual-review terminal branch currently also requires `implementation.length`:
```js
if (automatedPass && implementation.length && missingManual.length) ...
```
With no implementation changes this falls through, allowing worker admission even though coding cannot satisfy the missing human acceptance.

Source: https://github.com/PrzemyslaV88/cstack/blob/main/src/core.mjs

### Reproduction
1. Create a small clean repository.
2. Use a critical-policy schema-3 `INVESTIGATE` contract with one passing external probe and one required manual review criterion.
3. Run with an injected worker that fails if invoked.
4. Assert automated PASS, manual NEEDS_MANUAL_REVIEW, zero reserved attempts and zero approvals.

The worker hook must never be called for that state.

### Requested behavior
- Return NEEDS_MANUAL_VERIFICATION whenever automated criteria pass and required human acceptance is missing, regardless of changed implementation count.
- Retain the human criterion; do not auto-approve or turn this into VERIFIED.
- Add an explicit verification-only path for existing or newly prepared candidates. Failed probes should remain BLOCKED without admitting a worker.
- A successful read-only investigation should retain INVESTIGATED semantics, distinct from implementation delivery.

Local regression coverage for manual-only admission and zero-worker verification was prepared, without submitting a PR.

### Separate operator/setup problems, not evidence of a CStack bug
We also encountered incomplete imports in a hand-curated verification copy, generated scratch/symlinks placed inside that copy, a malformed critical contract missing its required human criterion, and a detached WSL caller being interrupted by instance shutdown. These were corrected locally and should not be misattributed to CStack's model or candidate implementation.

No downstream project identities, source, data, credentials or raw logs are included.
