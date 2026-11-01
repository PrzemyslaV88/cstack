---
name: graph-map
description: Map local file dependencies in a project, show imports and incoming connections, or export a dependency diagram with cStack. Use for codebase maps and change-impact exploration.
---

Use `scripts/map.mjs` relative to this skill directory. The bundled Node runtime
reads current files on disk; it does not execute the project, install packages,
start a coding worker or require Docker/authentication. Dirty projects are allowed.

Resolve the requested project, using the current project when clear. Run:

```sh
node "$SKILL_DIRECTORY/scripts/map.mjs" --repo "$PROJECT" --out "$NEW_REPORT_DIRECTORY"
```

Choose a new report directory outside the project; existing directories are
preserved. If the user named a file, add `--focus relative/file.py`. Without
`--out`, the helper prints Markdown; `--format json` prints the structured map.
`--max-files` accepts 1–10000 source files (default 2000). The scanner also has
inventory, per-file and total-byte limits.

Read `graph.md` first. For detailed investigation, filter `graph.json` to relevant
paths before loading a large map into context. `graph.mmd` is the exported
Mermaid diagram. Show the diagram when useful and link the saved report.

Explain the important modules and who imports them, with file/line evidence from
the edges. Arrows mean **imports**, not function calls. The diagram displays at
most 60 files and states how many it omits; the JSON retains the broader map.
Distinguish observed import declarations, heuristic path resolution and inferred
change impact. Incoming imports suggest review targets; they do not prove what
will break.

Python absolute/relative imports and common `src/` layouts are supported.
JavaScript/TypeScript supports static imports, re-exports, literal require/import
calls, common extensions and local tsconfig/jsconfig path aliases. Dynamic Python
path changes, computed imports and inherited configuration can remain unresolved.
Inspect coverage, skipped-file warnings and ambiguous imports before calling a
map complete. If limits are reached, state that and narrow to a subproject when
appropriate. Do not invent missing edges or describe this as a runtime call graph.

The scanner excludes credential-named files, dependency/generated folders and
file symlinks. Do not bypass those exclusions to include secrets. Analysis does
not authorize edits; the repair skill remains available for a requested fix.
