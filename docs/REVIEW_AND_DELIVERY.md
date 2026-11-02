# Review and safely deliver a repair

`review RUN_ID --out /private/new-review` creates Markdown, JSON, a full diff and a
self-contained HTML page. Reports include private source; choose a private destination.
No server, JavaScript, remote fonts or automatic browser opening is involved.

The report separates automated checks, human review, token accounting and delivery.
Existing test/configuration edits may need review even when checks pass. Text labels
such as removed assertion lines describe syntax, not whether a change is correct.
A source or evidence change makes the report stale. Reading a report never approves it.

After actual human review, use the existing `approve` command with the exact run,
criterion, snapshot and the person's explanatory note, then resume to recheck.
Never synthesize approval to complete a benchmark.

```sh
node src/cli.mjs patch RUN_ID --out /private/new-patch
node src/cli.mjs apply RUN_ID --repo /project --snapshot CANDIDATE_DIGEST --check
node src/cli.mjs apply RUN_ID --repo /project --snapshot CANDIDATE_DIGEST
```

Only a current VERIFIED repair is eligible. Apply checks original HEAD/index/source,
preimages, ignored-file collisions, patch integrity and target identity. It uses a
private Git directory/index and does not stage or commit the user's files. Binary
files and executable-bit changes are supported on compatible filesystems. Changed
symlinks, case collisions, submodules and file/directory transitions require export.
A pending-review candidate may be inspected but is not an approved delivery artifact.

Each actual apply has a durable backup and journal. If interrupted:

```sh
node src/cli.mjs delivery recover RUN_ID --delivery DELIVERY_ID
```

Recovery recognizes the known preimages and postimages. A complete postimage can be
confirmed and a complete preimage can be marked rolled back. A mixed state is preserved
and its remaining postimage paths are reported for deliberate manual restoration from
the durable backups or candidate patch. cStack never performs automatic pathname writes
or deletions after an interrupted apply. Third-value edits are likewise preserved and
reported. Repeated recovery is idempotent after successful postcondition checks. Avoid
editing source concurrently: cStack's lock coordinates cStack operations, not every
editor on the computer. This is not an OS-level multi-file transaction. Never delete
recovery artifacts to bypass a conflict.

## Start with existing edits in 0.5

Clean source remains the default. To repair the current working copy explicitly:

```sh
node src/cli.mjs plan "Repair the observed bug" --repo /project \
  --profile /private/profile.json --acceptance /private/acceptance.json \
  --source-mode working-copy --out /private/new-plan
```

The captured baseline includes tracked and nonignored untracked files as they exist
on disk, including deletions. The staged index is recorded separately. cStack copies
that baseline into its own detached worktree without staging, stashing or committing
anything in the original repository. Ignored untracked dependencies and credentials
are excluded. Tracked files remain included even if an ignore rule matches them;
the existing exact reviewed-fixture policy still applies to credential-looking paths.
Two content inventories and a post-copy comparison detect changes during capture.

The delivered patch contains only changes made after that baseline. Your earlier
edits do not appear as cStack's additions. Staged content stays byte-for-byte intact;
cStack's repair is left unstaged, including when both edits affect the same file.
An initially untracked repaired file stays untracked.

Any intervening included file change, index change, HEAD move or branch switch causes
`SOURCE_DIVERGED`. This includes changes to unrelated included source files. A fresh
private review is written beside the run and its path is returned with the error.
Inspect the candidate and make a new plan; this release does not perform a three-way
merge. Unrelated ignored files may coexist, but a touched-path collision still blocks
application. Recovery follows the same preservation rules as clean mode.

Merge/rebase/cherry-pick/revert operations, unmerged index entries, sparse checkouts,
submodules, external symlinks, special files and ambiguous case collisions are refused
with specific source-state errors. Internal symlinks may be captured, but changes to
them require export. If Git records `core.filemode=false`, automatic delivery refuses
executable-bit changes and new files whose mode cannot be trusted; use a compatible
filesystem or inspect a full export. This is relevant to ExFAT external drives.
