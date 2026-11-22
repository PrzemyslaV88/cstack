# Draft post: "Done" should be a fact, not a feeling

*Draft for a blog post or thread. Replace the bracketed parts once real benchmark results exist.
Do not publish numbers that have not been measured.*

---

Coding agents are good at saying "done". They say it when the build is green, when they believe
they are finished, and sometimes after quietly editing the test that was failing. Workflows like
pstack respond with better instructions: prove it works, verify before you land. That helps, but
an instruction to a model is still something the model can skip.

cStack moves the decision out of the agent.

- **Checks run by cStack, not by the agent.** It runs frozen acceptance checks itself, first on
  your current code (they must fail, which proves they detect the problem) and then on the
  change.
- **Your real environment, in a sandbox.** Offline, read-only candidate, your project's own
  installed dependencies, home directory and credentials hidden. The sandbox tests itself before
  every use.
- **The change cannot move the goalposts.** Checks committed before the change are read from the
  base revision. Editing them, or existing tests, needs a person's review.
- **Evidence is bound to the exact files.** `cstack verify --check` re-confirms right before
  commit or merge.

It works with whatever agent you already use:

```sh
cstack verify --repo . --checks .cstack/checks.json   # exit 0 done, 2 failed, 3 needs you
```

And it can do the fix too, in Claude Code or Codex:

```sh
cstack fix "Orders over 100 should get 10% off" --worker claude
```

`fix` drafts small probe checks and proves at least one fails today. It shows you the expected
behavior (input, expected, today) to approve, then fixes against exactly those checks. If the
first attempt fails, optional alternates try again in parallel, even across vendors, and the
smallest change that passes every check wins.

**Try it without a model:** `npm run demo` shows an agent claiming a wrong fix, then rewriting the
checks, and cStack refusing both. It takes about seven seconds.

**Install:** in Claude Code, `/plugin install cstack --marketplace PrzemyslaV88/cstack`. For Codex,
clone the repository and run `npm run plugin:install`.

**What we measured:** [results from bench/fc.mjs: false completions per arm, share caught by
verify, good fixes blocked, with intervals. Include plain Claude Code, plain Codex, pstack in
Cursor (imported), cStack with each worker.]

**Limits, stated plainly:**
- `done` means the declared checks pass on this change, so good checks matter most.
- Overfitting the visible checks is caught only by hidden cases.
- The macOS sandbox is [verified on macOS version …].
- Linux needs unprivileged user namespaces.
