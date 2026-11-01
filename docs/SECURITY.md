# Security and trust boundaries

## What is untrusted

The candidate, its dependencies, package hooks, tests and stdout are untrusted. A test runner importing generated application code is also executing candidate code. The controller's installed source, operating system, Docker daemon/image, contract author and human approver are trusted.

## Verification boundary

Docker is the default: a locally available image is resolved to an immutable image ID and executed with `--pull=never`, no network, a read-only root and candidate mount, no capabilities, no-new-privileges, UID 65534, PID/memory/CPU limits and bounded scratch space. Only candidate bytes and controller-owned reporter code are mounted. No host home, credential environment, controller state or Docker socket enters the container. The entrypoint is explicitly set. Lifecycle cleanup attempts are mandatory and failures are reported.

The Linux alternative uses fresh user/mount/network/PID namespaces, a restricted root, read-only candidate/system-runtime mounts, an empty `/proc`, private scratch space, and dropped capabilities before candidate execution. It is explicitly selected, capability-probed and fails closed. It is not a portable substitute for Docker's cgroup resource controls: native CPU/file limits are per process, and the host toolchain remains part of the trusted environment. Use Docker for stronger resource containment and reproducible packaged environments. Neither backend protects against a host kernel/runtime vulnerability; hostile production workloads need a stronger, separately evaluated isolation boundary.

Snapshotting includes ignored files and mode/symlink identities, rejects escaping links and special files, and rejects common credential filenames. The only exception is an existing test fixture explicitly reviewed in the frozen contract by exact path and SHA-256 contents, with a review reason. It must be a regular file in the starting revision; new, changed, removed, renamed or symlink-substituted credential files remain blocked. Approval is a trust decision by the contract author, not proof that a file is harmless. Published test-only key material must never be confused with production credentials. This is conservative detection, **not a guarantee that no secret can exist in arbitrary source code**. Do not put real credentials/customer data in the candidate or a dependency image. Logs use limited pattern redaction, not universal secret detection. Keep the local state directory private and protect the host account.

## Worker boundary

The actual coding worker uses Codex workspace-write with network disabled, additional writable temporary roots disabled, shell environment inheritance disabled, and controlled configuration. ChatGPT login is forced; API-key variables are not forwarded. Required disabled features are capability-checked. Project Codex config/hooks are rejected rather than silently merged into policy.

cStack does not wrap the entire Codex application in its own VM. Codex owns authentication and its tool sandbox. Do not treat workspace-write as a guarantee that the worker cannot read every sensitive host file. Use a dedicated development account/machine for sensitive repositories. cStack does not promise an enforcement boundary against its own privileged host operator.

## Evidence and approvals

Probe comparisons occur in the controller, not inside candidate code. Node-test streams are supporting evidence, not independent proof by themselves. Every claim is bounded by the quality of the declared checks; a program can overfit examples. Use held-out or broader checks and meaningful manual acceptance for consequential changes.

Evidence is tied to candidate, artifact, contract, verifier and runner identities. Artifacts/logs are checksum-checked when reporting success. Snapshot copies are content-addressed; verification mounts them read-only. Human approval binds to exactly one candidate and cannot override a failed automated outcome.

## Recovery and process limits

State/event/attempt reservations are atomic SQLite transactions. Optimistic revisions and a per-run owner lock prevent concurrent resumes. A dead owner can be recovered; interrupted reservations remain consumed. JSON reports/journals are exports only. Worker/verifier subprocesses have termination escalation and parent-death guardians. Docker cleanup is explicit; failures are blockers, not silently successful cancellation. Operating-system process semantics, kernel scheduling and externally killed guardians remain operational considerations rather than absolute guarantees.

## External effects

No automatic image pull, network dependency installation, billable API fallback, Git push, merge or production deployment. Explicit export copies only a currently verified candidate to a new directory. cStack does not delete the original checkout or discard user work. Failed creation removes only its own newly created, not-yet-registered scratch worktree.

## Primary integration references

- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://docs.docker.com/engine/containers/run/
- https://nodejs.org/api/test.html
- https://git-scm.com/docs/git-worktree


## Upgrade boundaries

Dependency preparation uses explicit frozen Docker plans and never host installs.
Test adapters execute in disposable scratch copies with image-owned dependencies;
source snapshots remain read-only. Reporter output is not cryptographic proof against
hostile candidate code and cannot by itself grant VERIFIED.

Delivery uses a private Git directory/index, binary/full-index patches, frozen
preimages and durable backups. Target-local filter configuration is not used for
apply. Untracked/ignored collisions, unsupported path types, stale evidence and source
drift stop delivery. Recovery never automatically overwrites a third-value edit.
The delivery lock is cooperative; avoid concurrent editors during multi-file apply.
Review artifacts contain source and should be stored privately. HTML is escaped,
self-contained, has no scripts or remote resources, and is not an approval interface.
