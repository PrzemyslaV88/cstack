---
name: stack-analysis
description: Identify a project's languages, frameworks, runtime declarations, build/test tools and deployment configuration with file evidence, or map Python/Node error frames to project files, using cStack.
---

Use `scripts/analyze.mjs` relative to this skill directory. The bundled Node
runtime performs read-only local analysis, including dirty projects. It requires
no Docker, login, package installation or coding-worker invocation.

```sh
node "$SKILL_DIRECTORY/scripts/analyze.mjs" --repo "$PROJECT" --out "$NEW_REPORT_DIRECTORY"
```

Use the current project when the intended repository is clear. Choose a new
output directory outside the project; existing outputs are preserved. The helper
writes `stack.md` and `stack.json`. Without `--out`, it prints Markdown;
`--format json` prints structured results. `--max-files` controls source-import
scanning (default 2000, maximum 10000); inventory and byte limits still apply.

Read the Markdown summary, then the JSON evidence needed for the user's question.
Explain the stack in plain language and cite file paths, line numbers and manifest
keys. Distinguish declared dependency versions, source-import signals and filename
conventions. A Dockerfile is configuration evidence; it does not establish that
Docker is running or a service is deployed. Declared versions are not verified
installed versions. Unknown frameworks remain dependency names rather than guesses.
Separate the application from test, example and benchmark/tooling subprojects by
manifest path. A lockfile entry alone does not prove direct application use.

Common JavaScript/TypeScript and Python manifests, Cargo.toml and go.mod have
dependency extraction. Other languages are counted by extension. Dynamic package
metadata and shell scripts are not executed. Package script names are reported,
but their commands and private source URLs are not exported. Review coverage and
warnings; state material gaps instead of claiming an exhaustive inventory.

When the user supplies an error trace, add `--trace "$TRACE_FILE"`. This maps
Python/Node frames to local files, including unambiguous container-path suffixes.
Trace text and error messages are not exported. Report matched locations as
investigation starting points, not proven root causes. Inspect the relevant code
when explanation is requested and label any inferred cause separately from a
reproduced failure. Do not search unrelated logs for traces or change code merely
because analysis found a component or frame.

Use the graph-map skill if relationships between modules are needed. Analysis
does not authorize edits or replace independent acceptance checks for a fix.
