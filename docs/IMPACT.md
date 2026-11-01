# Change impact

```sh
node src/cli.mjs impact --repo /project --file src/engine.py
node src/cli.mjs impact --repo /project --since HEAD~1 --depth 3 --out /private/new-impact
```

Choose one file or one Git revision. cStack resolves the revision once, maps current
static imports and follows consumers backwards to depth two by default (maximum six).
Direct dependencies are shown separately from downstream consumers. For deleted files,
baseline imports can explain consumers that the current graph can no longer resolve.
Those historical edges are explicitly labelled.

Candidate tests carry either `import-evidence` or `name-heuristic`. Neither claims
complete test coverage. Import cycles are listed without calling them defects.
JSON retains bounded results; the Mermaid diagram shows at most 30 prioritized nodes
and states the omission count. Partial source coverage and unresolved imports remain
visible. No confidence percentage or runtime call-graph claim is produced.

The installed plugin exposes this as `$cstack:impact-analysis`. The graph-map skill
shows the wider dependency map, and stack-analysis identifies technology declarations
and matches sanitized Python/Node trace frames to local files.
