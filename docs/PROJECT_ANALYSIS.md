# Project mapping and stack analysis

cStack 0.3.0 adds two read-only Codex skills alongside the existing repair skill.
They use the bundled Node runtime and run locally without a model invocation,
Docker, authentication, package installation or execution of project code.

## Use the plugin

In a new Codex chat in the intended project:

```text
$cstack:graph-map Map this project and explain which files depend on each other.
$cstack:stack-analysis Explain this project's languages, frameworks and build/test tools.
```

For an error trace, ask the stack-analysis skill to inspect the supplied trace
file. The helper recognizes Python and Node.js frames and matches project paths,
including unambiguous container-prefix differences. It reports exception types
and frame locations without exporting the original error messages. A frame is
an investigation starting point, not proof of the cause.

The original `$cstack:cstack` skill still runs isolated, independently checked
repairs. Analysis accepts dirty projects and does not require a completion
contract; repair keeps its clean-source and review requirements.

## What mapping provides

- A file dependency graph for Python, JavaScript and TypeScript.
- Python absolute/relative imports, packages, common `src/` layouts, aliases and
  multiline import declarations.
- JavaScript/TypeScript imports, re-exports, literal require/import calls, common
  extension resolution and local tsconfig/jsconfig path aliases.
- File and line evidence for resolved edges; computed, ambiguous and unresolved
  imports remain explicit.
- Incoming/outgoing import counts to identify useful review targets.
- Markdown, JSON and a Mermaid diagram. The diagram shows up to 60 files, with
  omitted counts; the JSON retains the broader inventoried graph.

Arrows mean **imports**. This is a heuristic static file graph, not a complete
function-call graph or runtime trace. Python runtime path manipulation, computed
imports, conditional package exports and inherited TypeScript configuration can
remain unresolved. Graph confidence is not a claim that a change is safe.

The controller also uses this import resolver for focused repair context, so
Python relationships can now contribute to its file selection. That is a code
change; no new token-saving or benchmark-quality claim is inferred from it. The
earlier benchmark reports describe their frozen source versions.

## What stack analysis provides

The report counts source languages and extracts dependency/runtime declarations
from package.json, pyproject.toml, common Python requirements files, setup.cfg,
Cargo.toml and go.mod. It identifies known frameworks and tools from those
declarations and actual source imports. Other languages are counted by extension
without claiming complete ecosystem dependency parsing.

Package-manager lockfiles, Docker/Compose files, CI workflows and Terraform files
provide labelled configuration signals. Script names and candidate entrypoints
are listed without running scripts. Version ranges are declared values, not
verified installed versions. A workflow or Dockerfile does not prove that CI or
a deployment is working. Application declarations, development tools, examples
and benchmark dependency snapshots should be interpreted separately by path;
lockfile entries do not prove direct application use.

Private dependency URLs and script bodies are omitted. Unknown frameworks remain
dependency names. Dynamic setup.py/package metadata and included requirement
paths are not evaluated or followed.

## Direct commands and exported files

From this source checkout:

```sh
node src/cli.mjs map --repo /absolute/project --out /outside/project/new-map-report
node src/cli.mjs analyze-stack --repo /absolute/project --out /outside/project/new-stack-report
node src/cli.mjs analyze-stack --repo /absolute/project --trace /path/error.log --format json
```

The installed skills have relocatable helpers under their own `scripts/`
directories; they do not import the source checkout or require a global cstack
binary. The graph helper inserts the `map` command; the stack helper inserts
`analyze-stack`.

| Command | Exported files |
|---|---|
| map | graph.json, graph.md, graph.mmd |
| analyze-stack | stack.json, stack.md |

Without `--out`, Markdown goes to stdout; `--format json` selects structured
output. `--focus relative/file.py` prioritizes a graph file and its diagram
neighbours. `--max-files` accepts 1–10000 supported source files (default 2000).
Output must be a new directory outside the project; existing directories and
project files are preserved, including through symlinked output parents.

## Bounds and provenance

Git projects include tracked and non-ignored untracked files. Other directories
use a bounded walk. Credential-named files and common dependency/generated folders
are excluded. Symlink files and paths resolving outside the project are skipped.
Scans inventory up to 20000 entries, read at most 512 KB per file and 20 MB in
total, and report partial coverage when source files or byte limits are skipped.
The existing focused worker context retains its smaller file/byte budget.

Each report contains the inventory method, scanned counts, skipped-file warnings
and a digest of read file contents. File changes detected during a read are
flagged. The scan is not an atomic whole-project snapshot, and it never awards a
repair `VERIFIED` status. Error traces are limited to regular UTF-8 files of at
most 512 KB. No network requests, automatic dependency installs, provider fallback
or human approvals are part of analysis.


## Scoped inventories and impact

Stack reports separate application, test, example and benchmark scopes. A package
mentioned only in a lockfile is labelled lockfile-only. Declarations and lexical
imports do not prove execution or production use. The impact-analysis skill follows
reverse imports and reports candidate tests, historical deletion edges and cycles;
see [IMPACT.md](IMPACT.md). Analysis stays bounded and reports partial coverage.
