# Matched single-worker upgrade experiment

This harness is implemented but the new live-model experiment has not been run.
The twelve scripted fixtures test controller behavior; they do not measure AI quality
or human usability. Historical pstack results remain historical unmatched evidence.

Use the pinned Python environment in `requirements.lock`. The entry point is
`python -m bench.journey` with `prepare`, `validate`, `run` and `report` subcommands.
Each subcommand has `--help`. Preparation and reference validation invoke no model.

## Frozen case input

`prepare --cases FILE --old-runtime DIR --new-runtime DIR --stage smoke --out DIR`
accepts a JSON array of cases. Smoke requires two fresh cases, one Python and one
JavaScript. The full study requires twelve: six in each language, four in each
complexity class, and at least eight sourced from real projects. Each case has:

- `id`, `language` (`python` or `javascript`), `complexity` (`single-module`,
  `cross-module`, or `test-config`), and `source_kind` (`real-project` or `synthetic`).
- `source_url`, `license`, and a truthful `reviewed` boolean. Real-project cases need
  a source URL and license. The five historical benchmark case IDs are rejected.
- `repo`, a clean local Git repository; `gold_patch`, an external reference patch;
  `image`, an explicitly prepared local Docker image; and `goal`.
- Nonempty `public_criteria`, `private_criteria`, and `regression_criteria` arrays of
  frozen external probe criteria using the contract schema. IDs must be unique in
  each combined acceptance set. Private criteria and the gold patch remain outside
  worker mounts. Regression checks cover behavior the repair must preserve.

The same public and regression criteria reach old cStack, new cStack, and plain
Codex. All arms use GPT-6.1 (`gpt-6.1-sol`) at medium effort, the frozen CLI/image
identities, one worker, and the same per-trial limits. No helpers, hooks or plugins
are enabled in those workers. Old and new runtime paths must point to the exact
versions under comparison. Use a fresh output directory; inputs and schedules are
hashed. Three full-study repetitions use Latin rotation of arm order per case.

`validate --work DIR --expect-manifest DIGEST` runs real isolated no-op/gold checks.
Unchanged code must fail; the reference repair must pass both private defect and
regression checks. A grader timeout is an infrastructure error, not a bug failure.
Full-study preparation also requires a completed six-trial smoke report with actual
model calls, complete native accounting, no helpers and completed independent grading.

## Explicit run budget

Preparation writes `budget.template.json` with `approved: false`, no approval
provenance and no admitted trials. It cannot run as generated. A live experiment
needs the user's explicit approval, the exact manifest digest, allowed trial IDs,
model/limits, a positive cumulative token ceiling, and real approval provenance.
Do not invent that provenance or run a paid trial just to validate this code.

`run --work DIR --expect-manifest DIGEST --budget FILE` reserves each admitted trial
before launching it. Interrupted/unknown usage stops further admission. Completed
trial IDs are not selectively repeated. The ceiling controls admission; it cannot
pre-price or terminate an in-flight model response at an exact provider token count.

Native rollout reconciliation copies only the trial root and its descendants into
private evidence. It counts one cumulative vector per thread and feeds only deltas
across resumed turns to controller budgets. CLI totals are not added again. Missing
records, a different model/effort, or an unexpected helper stop the primary arm.
Undisclosed or unflushed provider usage cannot be reconstructed. Outer interactive
planning chat is excluded and is never presented as part of total journey cost.

## Report and interpretation

`report --work DIR` writes individual rows, medians, nearest-rank p95, pass counts,
regression rate, token efficiency, missing-data counts and paired comparisons.
Failures consume tokens too. Missing accounting makes aggregate token ratios null;
unmeasured regression outcomes and unknown model-invocation counts remain unknown.
Active task time excludes separate private grading. Pending human review and test
passes are not delivered fixes; these trial arms do not automatically apply repairs.

Bootstrap intervals use case-level resampling with all arms/repetitions, 10,000
samples and Python `random.Random` seed 104729. Fewer than 90% defined samples means
an unavailable interval. Missing timed trials cannot produce a complete time interval.
No new pstack superiority or human usability claim follows from this harness alone.
