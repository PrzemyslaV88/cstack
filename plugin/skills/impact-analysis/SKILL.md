---
name: impact-analysis
description: Identify likely consumers and tests affected by a file or Git change using cStack's static import graph. Use for change impact and dependency cycles.
---

Resolve `scripts/impact.mjs` relative to this skill directory. This bundled helper
needs Node 22.13+ and project files. It does not need Docker, Codex login, or a repair
contract.

Run `node "$HELPER" --repo "$REPO" --file relative/source.py` for a known file, or
`node "$HELPER" --repo "$REPO" --since "$REVISION"` for changes since a Git revision.
Use one selector. Default consumer depth is two; `--depth` supports one through six.
Use `--out "$NEW_DIRECTORY"` outside the project for JSON, Markdown and Mermaid
artifacts, or `--format json` for structured output. Existing output directories
are preserved.

Explain which files import the selected code, which consumers are farther away,
and which tests are candidates. Keep import evidence and name-based suggestions
separate. Historical edges describe the baseline of deleted files. A dependency
cycle is not automatically a defect. This is a bounded static import map, not a
runtime call graph or a claim that every affected test has been found. Mention
partial scans, unresolved imports and omitted diagram nodes beside the findings.

For a full repository graph use graph-map; for technology inventory or error-frame
matching use stack-analysis. Impact analysis alone does not edit code, run tests,
approve a repair, or establish verified behavior.
