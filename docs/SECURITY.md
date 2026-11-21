# Security and trust boundaries

## What is untrusted

The candidate, its dependencies, package hooks, tests and stdout are untrusted. A test runner importing generated application code is also executing candidate code. The controller's installed source, operating system and its sandbox, host toolchain, the project's installed dependency folders, contract author and human approver are trusted.

## Verification boundary

There is one verifier backend, `host`: the project's own installed environment inside an OS sandbox. There is no image, daemon or unsandboxed fallback, and a contract that asks for Docker is refused with a migration message.

- **Linux:** fresh user/mount/network/PID namespaces, a minimal tmpfs root with read-only `/usr`, `/lib`, `/bin` and `/sbin`, the candidate read-only at `/candidate`, the controller's runner scripts and Node binary read-only, the project's declared dependency folders and the runtimes they need read-only at their real paths, an empty `/proc`, a loopback-only `/etc/hosts`, private `/tmp`, CPU/file/descriptor limits, and all capabilities dropped with `no_new_privs` before candidate code runs. Home directories, sockets, credentials and controller state are not mounted. The network namespace has no interfaces.
- **macOS:** Seatbelt (`sandbox-exec`) with a deny-by-default profile. Reads are allowed outside the home and temporary directories, and inside them only for the candidate, the scratch directory, the runner scripts, the dependency folders and runtime prefixes. Writes are allowed only in the scratch directory. All network access is denied, and `HOME`/`TMPDIR` point at the scratch directory.
- **Environment:** only `PATH`, `HOME`, `TMPDIR`, locale and `TZ`, plus the candidate/runner/scratch locations, reach candidate code. No API keys, cloud tokens, proxies or loader variables are passed.
- **Self-test:** before a runner is first used in a process, it must show on this machine that candidate code runs, cannot modify the candidate, cannot read a host file outside the allowed paths, cannot reach a listening loopback port, and can write its scratch space. Any failure refuses verification (`ISOLATION`).

Compared with the former Docker verifier, the host runner trusts the project's installed dependencies and the host toolchain: they are part of the environment being verified, as they already were for the coding worker. Per-process CPU, file and descriptor limits replace Docker's cgroup memory/PID limits. Neither design protects against a host kernel vulnerability; hostile production workloads need a separately evaluated isolation boundary. Use a dedicated machine or VM for code you would not run yourself.

## External effects

No image build or pull, dependency installation, billable API fallback (API-key worker auth only with an explicit `CSTACK_CODEX_AUTH=api-key`), Git push, merge or production deployment. Explicit export copies only a currently verified candidate to a new directory. cStack does not delete the original checkout or discard user work. Failed creation removes only its own newly created, not-yet-registered scratch worktree.

## Primary integration references

- https://learn.chatgpt.com/docs/non-interactive-mode
- https://learn.chatgpt.com/docs/config-file/config-reference
- https://man7.org/linux/man-pages/man7/user_namespaces.7.html
- https://nodejs.org/api/test.html
- https://git-scm.com/docs/git-worktree


## Upgrade boundaries

cStack never prepares or installs dependencies; it links the project's installed, git-ignored
dependency folders read-only and fingerprints them. Test adapters execute in disposable scratch copies;
source snapshots remain read-only. Reporter output is not cryptographic proof against
hostile candidate code and cannot by itself grant VERIFIED.

Delivery uses a private Git directory/index, binary/full-index patches, frozen
preimages and durable backups. Target-local filter configuration is not used for
apply. Untracked/ignored collisions, unsupported path types, stale evidence and source
drift stop delivery. Recovery never automatically overwrites a third-value edit.
The delivery lock is cooperative; avoid concurrent editors during multi-file apply.
Review artifacts contain source and should be stored privately. HTML is escaped,
self-contained, has no scripts or remote resources, and is not an approval interface.
