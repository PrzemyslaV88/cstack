# Release and distribution checklist

Steps that need the maintainer's own machines and accounts are marked **(you)**.

## Before announcing

1. **(you)** On a Mac: `npm run demo`, then `node src/cli.mjs doctor`. The macOS Seatbelt
   sandbox has not been executed yet; its self-test must pass.
2. **(you)** One real `cstack fix` with each worker on a small project:
   `--worker claude` (Claude Code 2.1.259+, subscription login; on Linux install `bubblewrap`
   and `socat` for its bash sandbox) and `--worker codex`. Confirm both reach `done`.
3. **(you)** Run the false-completion benchmark on real models:
   `node bench/fc.mjs run --arms arms.json --out fc-results --trials 3 --authorize-model-spend`,
   import pstack-in-Cursor runs with `node bench/fc.mjs import`, add real-project tasks, and
   publish `fc-results/report.md` with its intervals.
4. Cut the release: version, release notes and a validation record from the full test suite.

## Distribution

5. **Claude Code:** the repository root is already a marketplace (`/plugin install cstack
   --marketplace PrzemyslaV88/cstack`). Both the repository and the built bundle pass
   `claude plugin validate --profile directory`. **(you)** Submit to the Claude plugin directory
   through the developer portal. The first submission fixes the listing icon
   (`.claude-plugin/icon.png`). The validator also asks plugins to declare the network hosts
   they reach under `network.hosts`; cStack itself reaches none, but the worker CLIs it launches
   reach their providers, so decide how to declare that before submitting.
6. **Codex:** `npm run plugin:install` registers a local marketplace. **(you)** List it wherever
   Codex plugins are shared.
7. **(you)** Record the 30-second demo (`npm run demo`) and a real `cstack fix` in Claude Code.
8. **(you)** Publish the post in `docs/launch/POST.md` once the benchmark numbers are in.
