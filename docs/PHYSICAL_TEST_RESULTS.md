# Physical test of the benchmark improvements

Executed on the T7 Mac on 1 November 2026. The improved controller passed the targeted physical exercise using real Docker containers, real GPT-6.1 Sol invocations and separate private graders. The original 25-attempt comparison remains preserved.

| Exercise | Real Codex turns | Controller attempts | Private grade | Controller result | Native tokens | Agent seconds |
|---|---:|---:|---:|---|---:|---:|
| flask-5014 | 1 | 2 | 1 | VERIFIED | 69,367 | 37.0 |
| sphinx-9230 | 1 | 1 | 1 | NEEDS_MANUAL_VERIFICATION | 158,618 | 57.0 |

## What changed in actual operation

- **Flask:** its approved sample dotenv file stayed in the starting snapshot and passed through every later check. A deliberately ineffective first edit was rejected by the real public probe. A subsequent real Codex invocation received the failure feedback, repaired the bug and reached `VERIFIED`. The separate private grader passed it.
- **Sphinx:** its exact published localhost certificate/test-key bundle was admitted under the reviewed contract. Codex repaired the bug, and both public checks and the separate private grader passed. The existing test-file change is explicitly listed for human review, so the controller remains `NEEDS_MANUAL_VERIFICATION`.
- **Recovery:** Flask recorded two controller attempts with public outcomes `FAIL` then `PASS`. The first edit was scripted and used no model. This demonstrates the real feedback/correction path; it is not evidence that an AI recovered from its own naturally occurring first mistake.
- **Usage:** both model-invoking turns have complete native logs, the expected GPT-6.1 Sol model identity and zero child agents. Scripted work is labelled separately. Agent time excludes setup and final private grading.

## Regression checks

| Check | Result |
|---|---|
| Core suite, with real Docker checks | 73 passed, zero failed or skipped |
| Newly added focused regressions (included above) | 13 passed |
| Benchmark protocol/adapter suite | 70 passed |
| JavaScript syntax | 23 modules passed |
| Original/known-repair public and private gates | Both cases: original fails, known repair passes |
| Source, task and Docker-image identities | Current locks matched; original task/grader images and criteria unchanged |
| Diff whitespace check | Passed |

The focused tests exercise fixture alteration, removal, renaming, symlink substitution, additional unapproved credential files, incorrect or missing approvals, test-only patches, `testing` folder recognition, new `conftest.py` protection, snapshot-bound approval/export and a wrong implementation corrected after real failed checks.

## Limits and safeguards

An approved file is an explicit trust decision by the contract author. Its test-folder name or digest alone does not prove it harmless. The Sphinx bundle includes a published test private key; its known contents were reviewed for this exercise. Production credentials must never be approved. Any additional or changed credential file remains blocked.

The controller supplies at most 12 focused paths and records prompt/context sizes and phase timings. Smaller prompts for an actual resumed conversation are tested, but these two live cases do not establish a general token saving or a new ranking against pstack/plain Codex. The controlled Flask first edit has no prior model conversation, so its subsequent real turn correctly receives the full objective and the failed-check feedback.

Existing test changes still require human approval, and supporting new tests do not replace the original acceptance checks. No Sphinx review approval was fabricated to obtain a final `VERIFIED` status.

## Files and reproduction

- [Design and contract policy](BENCHMARK_IMPROVEMENT_DESIGN.md)
- Physical result data: `/Volumes/CStack-Comparison/improvements-20261101/live/physical-results.json`
- Controller reports, attempt proofs, private grading and native sessions: `/Volumes/CStack-Comparison/improvements-20261101/live/<case>/jobs/`
- Core/benchmark/syntax logs: `/Volumes/CStack-Comparison/improvements-20261101`
- The new source snapshot is `live/source.tar.gz`; `live/physical-inputs.json` records the source digest and original benchmark input identities.

For a fresh explicitly authorised exercise, choose a new empty work directory and run:

```sh
cd "/Volumes/T7 Shield/Projects/cstack-v0.2"
PATH="$PWD/.bench-venv/bin:$PATH" DOCKER_CONTEXT=colima-cstack .bench-venv/bin/python -m bench.physical_test prepare --work /Volumes/CStack-Comparison/new-physical-exercise
PATH="$PWD/.bench-venv/bin:$PATH" DOCKER_CONTEXT=colima-cstack .bench-venv/bin/python -m bench.physical_test run --work /Volumes/CStack-Comparison/new-physical-exercise
```

Preparation invokes no models. The run action consumes real Codex allowance. Existing preparation/jobs are preserved instead of overwritten. A report-only action reads completed evidence without invoking a model.
