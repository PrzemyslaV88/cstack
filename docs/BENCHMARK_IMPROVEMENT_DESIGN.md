# Improvements from the five-case run

The first batch exposed two fixture blocks and inconsistent treatment of changed
Python tests. All four cStack trials that invoked Codex passed the private grader
on their first coding attempt; that batch did not exercise recovery from a bad
first implementation. Its frozen results remain unchanged.

## Reviewed test inputs

Contracts may declare `approved_test_fixtures`, a bounded list of exact relative
paths, SHA-256 content digests and human-readable review reasons. Only
credential-named files in recognised test paths qualify. Each must already exist
in the starting Git revision as a regular file. The same path and bytes are checked
when sealing, verifying, approving and exporting the candidate.

This is an explicit trust decision by the contract author. A filename, test folder
or certificate header does not prove a file harmless. In the physical exercise,
the reviewed inputs come from the pinned public task images. Flask's sample dotenv
file contains example variables; Sphinx's published localhost certificate bundle
contains a test private key as well as its certificate. Its exact published bytes
are approved only for this test. Production keys must never be approved.

Changes, removal, renaming, symlink substitution and additional credential files
remain blocked. A worker cannot change its frozen contract. Approval of a test
fixture is not approval of arbitrary files or future contents.

For the pinned Flask exercise, the existing contract receives this exact field:

```json
{
  "approved_test_fixtures": [
    {
      "path": "tests/test_apps/.env",
      "sha256": "3739562018bb8d8aeddbb540fb4c53e61af5385fb4d3b613e784057c3129ccc0",
      "reason": "Reviewed published Flask test fixture containing sample variables."
    }
  ]
}
```

That is a field to add to a reviewed contract, not a complete runnable contract.
The digest is specific to that published fixture. Other files require their own
content review and exact digest. Input bundles retain their existing strict
credential checks; this exception covers fixtures in the starting revision.

## Consistent review

One shared file policy recognises `testing`, ordinary test directories, Python
`test_*.py`/`*_test.py` files, Go/Ruby test filenames and existing JS test patterns.
Pytest's `conftest.py` is protected configuration. Changes to existing tests,
acceptance files or configuration still need snapshot-bound human approval.
New supporting tests do not substitute for the original acceptance checks.

Status JSON and reports show the recorded checks for their sealed snapshot,
specific pending reviews, added supporting tests and approved unchanged fixtures.
"Checks passed, human review required" remains distinct from final `VERIFIED`.
Existing status names, approval requirements and export restrictions remain intact.

## Focus and measurement

The controller supplies at most 12 focused paths, rather than 40. On a real resumed
Codex conversation, repair prompts retain the latest independent failure and avoid
repeating the full objective/history. A fresh conversation always receives the
full objective. Per-attempt prompt length, context size, worker time and cumulative
baseline/check/context/worker timings are recorded. Token savings must be measured;
smaller prompts alone do not establish lower usage or better fixes.

The default remains one coding worker. The previous five-case sample did not show
an additional private-test pass from automatic multi-agent work.

## Physical acceptance exercise

1. Run the core regression suite against real, read-only, offline Docker runners.
   Include fixture-substitution attempts, changed `testing` files, unapproved
   secrets, tests-only patches and a wrong implementation followed by correction.
2. Revalidate the original and known-repair public/private gates using the same
   frozen task and grader images for Flask and Sphinx.
3. Run the improved cStack on Sphinx with real authenticated GPT-6.1 Sol.
4. Run Flask with an explicitly scripted ineffective first edit. Real public
   checks must reject it; a subsequent real Codex invocation receives that failure
   and must produce a passing candidate. The scripted edit is labelled zero-model
   work and is not presented as an AI's failed attempt.
5. Preserve candidates, controller checks, private grades, native token logs and
   source identity in a new experiment directory. Human-review requirements are
   retained. These are targeted regression exercises, not a new five-arm ranking.

The benchmark transport must track every bounded snapshot file when constructing
the controller baseline, including ignored test inputs. It uses `git add -f` in
that temporary snapshot repository; it never stages files in the user's repository.
