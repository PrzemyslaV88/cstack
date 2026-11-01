# Five-case bug-fix comparison results

Executed locally on 1 November 2026 using GPT-6.1 Sol and Codex CLI 0.163.0. Five selected SWE-bench bugs, one attempt per workflow per case: 25 scheduled attempts. Preparation and original/known-repair validation used no contestant model calls.

| Workflow | Private passes | Total tokens | Cached input subset | Task seconds, sum | Helpers |
|---|---:|---:|---:|---:|---:|
| Plain Codex | 5/5 | 914,058 | 809,088 | 288.1 | 0 |
| cStack | 4/5 | 816,457 | 737,408 | 291.7 | 0 |
| pstack sequential | 5/5 | 2,051,785 | 1,852,032 | 485.3 | 0 |
| Plain Codex multi-agent | 5/5 | 2,996,134 | 2,679,424 | 402.9 | 10 |
| pstack multi-agent | 5/5 | 7,205,517 | 6,582,656 | 630.1 | 10 |

Total tokens = input + output. Cached input is already included in input; it is not added again. Totals include each parent and helper thread once, using its final native cumulative counters. These counts do not measure subscription credits or remaining allowance. cStack aborted on Sphinx before invoking Codex, so its token aggregate covers four model-invoking trials and one confirmed zero-invocation abort. Its total is not an equal-five-model-run comparison.

Across the four cases on which both invoked Codex, cStack used 816,457 tokens and plain Codex used 690,460 (1.18× as many for cStack). Among the workflows that invoked models on all five cases, plain Codex had the lowest native token total. All four of those workflows passed all five private grades, so this selected batch observed additional multi-agent token volume without an additional private-test pass. One trial per case does not establish a general efficiency or quality ranking.

| Case | Workflow | Private grade | Tokens | Task seconds | Helpers | Controller status |
|---|---|---:|---:|---:|---:|---|
| flask-5014 | Plain Codex | 1 | 81,196 | 29.5 | 0 | — |
| flask-5014 | cStack | 1 | 69,968 | 26.4 | 0 | BLOCKED |
| flask-5014 | pstack sequential | 1 | 146,210 | 43.9 | 0 | — |
| flask-5014 | Plain Codex multi-agent | 1 | 373,521 | 51.2 | 2 | — |
| flask-5014 | pstack multi-agent | 1 | 1,098,743 | 74.8 | 2 | — |
| sympy-12481 | cStack | 1 | 395,538 | 116.6 | 0 | NEEDS_MANUAL_VERIFICATION |
| sympy-12481 | pstack sequential | 1 | 556,754 | 138.8 | 0 | — |
| sympy-12481 | Plain Codex multi-agent | 1 | 580,480 | 74.5 | 2 | — |
| sympy-12481 | pstack multi-agent | 1 | 1,266,572 | 128.1 | 2 | — |
| sympy-12481 | Plain Codex | 1 | 262,061 | 77.4 | 0 | — |
| sympy-24539 | pstack sequential | 1 | 265,362 | 83.2 | 0 | — |
| sympy-24539 | Plain Codex multi-agent | 1 | 560,035 | 73.6 | 2 | — |
| sympy-24539 | pstack multi-agent | 1 | 974,780 | 94.9 | 2 | — |
| sympy-24539 | Plain Codex | 1 | 96,979 | 36.6 | 0 | — |
| sympy-24539 | cStack | 1 | 91,691 | 51.9 | 0 | NEEDS_MANUAL_VERIFICATION |
| pytest-7236 | Plain Codex multi-agent | 1 | 767,482 | 121.5 | 2 | — |
| pytest-7236 | pstack multi-agent | 1 | 1,825,759 | 159.8 | 2 | — |
| pytest-7236 | Plain Codex | 1 | 250,224 | 81.8 | 0 | — |
| pytest-7236 | cStack | 1 | 259,260 | 90.9 | 0 | VERIFIED |
| pytest-7236 | pstack sequential | 1 | 766,197 | 133.6 | 0 | — |
| sphinx-9230 | pstack multi-agent | 1 | 2,039,663 | 172.5 | 2 | — |
| sphinx-9230 | Plain Codex | 1 | 223,598 | 62.8 | 0 | — |
| sphinx-9230 | cStack | not graded | 0 (pre-worker abort) | 5.9 | 0 | PRE_WORKER_ABORT |
| sphinx-9230 | pstack sequential | 1 | 317,262 | 85.9 | 0 | — |
| sphinx-9230 | Plain Codex multi-agent | 1 | 714,616 | 82.1 | 2 | — |

## Controller outcomes

- flask-5014: `BLOCKED` — SECRET: Potential credential file tests/test_apps/.env: remove it from the candidate; no secret mounts are supported
- sympy-12481: `NEEDS_MANUAL_VERIFICATION` — Review protected/test/configuration changes: sympy/combinatorics/tests/test_permutations.py
- sympy-24539: `NEEDS_MANUAL_VERIFICATION` — Review protected/test/configuration changes: sympy/polys/tests/test_rings.py
- pytest-7236: `VERIFIED` — All required outcomes have current evidence against the sealed candidate
- sphinx-9230: `PRE_WORKER_ABORT` — Credential-file guard rejected tests/certs/cert.pem before Codex invocation; preserved as an execution failure.

Private grading and controller approval answer different questions. A private pass does not resolve a controller block or approve protected/test-file changes.

## Delegation and evidence

Reconciled 44 distinct native threads across 24 model-invoking trials. Complete native usage records: 24/24. Separately confirmed pre-worker aborts: 1 (zero invocations). Actual models: gpt-6.1-sol. Observed reasoning efforts: high, medium, xhigh. Maximum observed delegation depth: 1.

The native audit recomputes every saved usage record, checks unique thread identities and ancestry, and hashes the session files. Missing or conflicting records remain explicit errors. Helper source-edit behavior requires inspection of the saved tool traces; the read-only role is an instruction, not an operating-system boundary.

The original cStack Sphinx row retains its execution error and missing-native-root telemetry diagnostic. Zero inference is established separately by the saved turn_attempts=0 metadata and the bridge failing before its worker callback. The paused checkpoint and a reviewed continuation script are retained. Only never-started arms were continued; the failed attempt and every completed job were preserved.

## Limits

This is a selected five-case descriptive batch with one trial per arm per case. It cannot establish a general winner or a reliable speedup. Position rotates across cases; cache state, model variability and task selection remain limitations. All seats use the same model family, reducing review diversity. Pstack exercises pinned skills and a Codex tool mapping with real delegation, rather than the Cursor/Claude plugin runtime.

Task seconds cover Harbor agent execution, including the workflow’s local checks and candidate delivery. Environment/agent provisioning and separate private grading are excluded. Workflow setup, tool choices, context and reasoning effort can differ. The 30-minute ceiling is a time limit, not an equal token or inference-compute budget. cStack additionally uses a 500,000 observed-token admission ceiling and at most three worker attempts; a completed turn can overshoot that ceiling. Other arms do not have an equivalent controller-enforced token ceiling.

All selected cases passed unchanged-fail/known-repair-pass public and private gates. Screening exclusions, offline grader provisioning and the full protocol are documented in [BATCH_COMPARISON_PROTOCOL.md](BATCH_COMPARISON_PROTOCOL.md). Failed no-model setup attempts and the earlier single-task pilot are retained separately. Development-helper and benchmark-engineering inference is excluded from contestant totals.

## Local artifacts

Runtime evidence: `/Volumes/CStack-Comparison/batch-20261101-v6` (T7-backed APFS image).

- `batch-results.json` and `batch-results.csv`: all 25 rows.
- `aggregate-results.csv` and `analyzed-results.json`: aggregates and native evidence audit.
- `<case>/jobs/<arm>/<trial>/agent/`: candidate identity, output, controller records and parent/helper sessions.
- `<case>/jobs/<arm>/<trial>/verifier/`: independent private grading evidence.
- `harness-source.tar.gz`, per-case `lock.json` and `validation.json`: frozen inputs and no-model gates.

No push or deployment was performed. Raw answers, traces and authentication remain outside Git.

## Observed protocol deviations

- pytest-7236 / pstack multi-agent: Helper authored two temporary test_skips.py reproductions inside TemporaryDirectory(prefix=.diagnosis-, dir=/testbed); each was automatically removed. No project source patch was observed in that helper trace. This deviates from the literal parent-only workspace-writing instruction; the helper role was not enforced by the operating system. Preserved original trial; all helper usage included; private grade unchanged. Not rerun.
- sphinx-9230 / pstack multi-agent: Helper authored temporary Sphinx configuration/document reproductions in three automatically cleaned TemporaryDirectory(prefix=.diagnosis-, dir=/testbed) scopes. No project source patch was observed in that helper trace. This deviates from the literal parent-only workspace-writing instruction; the helper role was not enforced by the operating system. Preserved original trial; all helper usage included; private grade unchanged. Not rerun.
