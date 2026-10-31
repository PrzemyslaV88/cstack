# cStack contract format

A contract is a JSON file outside the worker's Git worktree. It explicitly binds a user objective to independent acceptance checks. cStack refuses to infer a passing check from Codex prose.

```json
{
  "type": "FIX",
  "goal": "Repair incorrect calculator addition",
  "policy": "lean",
  "attempt_limit": 2,
  "criteria": [
    {"id":"AC1", "text":"Calculator returns the right sum", "kind":"command", "argv":["node","--test","check.mjs"]},
    {"id":"AC2", "text":"User confirmed purchase restoration on device", "kind":"manual"}
  ],
  "tasks": [
    {"id":"T1", "title":"Repair calculation", "depends_on":[], "criteria":["AC1","AC2"]}
  ]
}
```

* The CLI's quoted goal must match the contract `goal` exactly.
* `type` is one of `FIX`, `FEATURE`, `REFACTOR`, `INVESTIGATE`.
* `policy` is `lean` (two attempts), `balanced` (three), or `critical` (three). An explicit `attempt_limit` between 1 and 10 overrides it.
* `criteria` cannot be empty. A `command` criterion requires an `argv` array (no shell strings or shell expansion); its test must exit zero. `manual` remains unverified and requires external approval; there is no self-approval command in v0.1.
* `tasks` are an optional dependency DAG. Every criterion must be assigned to at least one task, and task IDs must be unique.
* `required:false` marks optional criteria; failed optional checks appear in the report, but do not block required acceptance.
* Never point a required check at a meaningless command like `echo success`. An oracle can only prove what it really exercises.
* cStack captures baseline results and independently executes required checks after each Codex attempt. For high-risk tasks, provide sandbox/integration tests plus a manual check.
* Contract changes after a run starts require creating a NEW run. The frozen contract is hashed and checked on resume.

## Launch

```bash
npm install -g .
cstack doctor
cstack run "Repair incorrect calculator addition" --repo /absolute/project/path --contract /absolute/contract.json
cstack status <run-id>
cstack report <run-id>
cstack resume <run-id>
```

By default `~/.cstack` stores SQLite metadata, frozen contracts, JSONL events, reports, and isolated Git worktrees. Override with `CSTACK_HOME`.

## Current limitations

This is a working first implementation, not the full planned platform. It uses the Codex CLI (not an SDK dependency), a heuristic file-level code map, and a one-worker bounded loop. SQLite stores run/event/evidence indexes; run documents are JSON snapshots. Manual approvals are not executable in v0.1. cStack does not add shell-level isolation to arbitrary user-configured verifier commands; **only execute contracts you trust**. Codex must be separately installed and authenticated, and local sandbox guarantees depend on the host OS/Codex configuration. No automatic push, merge, deploy or billable API fallback. A passing declared check alone does not prove unspecified user behaviour.
