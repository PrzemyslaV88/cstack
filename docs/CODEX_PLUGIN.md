# cStack for Codex

cStack 0.3.0 is packaged as a local Codex plugin. It includes the controller runtime
and three skills. Repairs use the existing ChatGPT Codex sign-in, Git and Docker;
there is no separate service or automatic API-key billing fallback.

## Use it

Open a new Codex chat in a clean Git project and invoke:

```text
$cstack:cstack Fix this bug and independently check that the fix works.
```

Codex discovers this exact namespaced skill as `cstack:cstack`. You can also ask
"Use cStack to fix and verify this bug." Restart the app if the newly installed
workflow is not visible in a new chat.

Two read-only skills are also included:

```text
$cstack:graph-map Map this project and show the main file dependencies.
$cstack:stack-analysis Explain the languages, frameworks and build/test tools in this project.
```

These use the bundled local analyser without Docker or authentication, accept
dirty projects, and export reports outside the project. Stack analysis can also
map a supplied Python/Node error trace. See [analysis capabilities and limits](PROJECT_ANALYSIS.md).

The workflow defines concrete checks, starts a single coding worker in a private
worktree, and reports the independently checked candidate. Existing tests and
configuration stay protected. A current verified candidate can be exported;
export is a handoff and does not merge into the original repository. Pending human
review stays explicit. The skill never invents a human approval.

The initial Git revision must be clean. The plugin does not stash, commit, clean
or delete existing work to satisfy that condition. Node 22.13+, an authenticated
Codex CLI and a functioning Docker engine with the selected runtime image are
required. Installation does not automatically install dependencies or images.

On this Mac the available verification context is `colima-cstack`. When needed,
set `DOCKER_CONTEXT=colima-cstack` for cStack commands; this does not change the
global Docker context. The plugin's doctor command checks the chosen setup.

## Build and install

From the repository root:

```sh
npm run plugin:build
npm run plugin:install
```

The builder copies only the authored `plugin/` files, the controller's `src/`
runtime, minimal package metadata and contract documentation. No benchmark cases,
credentials, task caches or repository Git history are bundled. Content-identified
bundles are stored under `dist/cstack-marketplace/plugins/`, with a local catalog
at `dist/cstack-marketplace/.agents/plugins/marketplace.json`.

The installer uses native `codex plugin marketplace add` and `codex plugin add`
commands, verifies that cStack is enabled and checks the installed build identity.
The installed ID is `cstack@cstack-local`. Other plugins are preserved. Existing
generated bundles are reused only if their contents match; altered or unexpected
files are preserved and the build stops instead of overwriting them.

The registered local marketplace lives in the T7 checkout. Keep that source
available for marketplace refreshes and rebuilding. The installed cache contains
its own controller runtime, so its command does not import the source checkout.
When preparing a later installed release, update the package and both plugin
manifest versions together before building and reinstalling.

## Implementation

- `plugin/plugin.json`: portable manifest.
- `plugin/.codex-plugin/plugin.json`: Codex compatibility manifest and UI metadata.
- `plugin/skills/cstack/SKILL.md`: workflow and boundaries.
- `plugin/skills/cstack/scripts/cstack.mjs`: relative, relocatable runtime launcher.
- `plugin/skills/graph-map/`: read-only import graph skill and helper.
- `plugin/skills/stack-analysis/`: technology inventory/error-frame skill and helper.
- `scripts/build-plugin.mjs`: bounded package build and catalog.
- `scripts/install-plugin.mjs`: native CLI installation and verification.

The controller's child worker disables plugins, hooks, apps and both delegation
backends. It does not recursively load cStack or inherit the outer plugin set.
CLI compatibility was corrected for Codex 0.163.0: controlled-config flags belong
to `codex exec`; feature checks use an empty temporary config home. Authentication
stays in its existing home, and no credentials are copied into the package.

Format references: [official plugin packaging](https://developers.openai.com/plugins/build/plugins)
and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

## Original 0.2.0 installation validation

On 1 November 2026:

- All 76 core/package tests passed, including relocation without the source checkout,
  repeatable builds, preservation of altered output and rejection of unexpected
  bundle files. The existing isolated Docker checks remain enabled.
- All 70 benchmark tests passed. Their bridge launcher now selects Docker by
  default on macOS instead of trying Linux namespaces. Syntax checks passed for
  27 JavaScript modules, and the skill frontmatter validator passed.
- The native Codex CLI installed and enabled the plugin in an isolated test profile
  and in the normal user profile. The app-server `skills/list` method discovered
  `cstack:cstack` from the installed cache.
- A deliberately broken calculator was run from the installed package with a real
  GPT-6.1 Sol worker. Baseline checks failed, the candidate's positive, mixed-sign
  and zero cases passed in the offline Docker verifier, and the controller ended
  `VERIFIED`. Native telemetry confirms one completed parent thread and no helpers.
- Status and verified export also succeeded from the normal installed cache.
- Reinstallation was repeatable, installed package hashes matched the build, and
  all 46 previously installed plugins kept their versions and enabled state.

Evidence: `/Volumes/CStack-Comparison/plugin-20261101/`. The live run used 76,225
native tokens, including cached input. This is an integration smoke test, not a
new benchmark comparison or an estimate of subscription credits.

## Version 0.3.0 analysis validation

On 1 November 2026, the updated plugin was installed in an isolated Codex profile
and the normal user profile. Native `skills/list` discovery confirmed the enabled
`cstack:cstack`, `cstack:graph-map` and `cstack:stack-analysis` skills from the 0.3.0
cache. All 31 installed file hashes matched the built package. Reinstallation
succeeded, the previous immutable release bundle on T7 was retained, and the
other 46 plugins retained their recorded versions and enabled states. Codex
refreshes its installed cache when updating; it removed the old 0.2.0 cache.

All 90 core/package tests and 77 benchmark regression tests passed. Syntax checks
passed for 35 JavaScript modules and all three skills passed frontmatter validation.
Tests cover Python neighbours reaching repair context, TS aliases, comment/string
and regex decoys, unresolved/ambiguous imports, skipped binary/oversized files,
secret exclusions, non-execution of project scripts, outside-project export and
relocation without Docker, Codex or source-checkout access.

The installed helpers mapped a six-module Python/TypeScript sample with three
known file relationships, identified its declared technologies, matched a
synthetic Python trace frame and preserved every sample source file. Secret and
trace-message markers were absent from reports. They also mapped cStack itself:
52 supported source modules and 110 resolved local import relationships at scan
time, including Python benchmark modules. Both helpers ran successfully from the
normal installed cache with unavailable Docker/Codex endpoints.

Evidence: `/Volumes/CStack-Comparison/plugin-analysis-20261101/`, including
`plugin-analysis-results.json`, the installed/discovered skill metadata, test logs
and generated reports. These analysis exercises launched no model workers; they
do not establish a new repair-quality or token-efficiency benchmark result.
