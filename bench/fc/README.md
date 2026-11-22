# False-completion benchmark

The question this benchmark answers: **when an agent says "done", is it done, and does
`cstack verify` catch it when it is not?** Every trial records three independent facts:

| Fact | How it is measured |
|---|---|
| Claim | Plain agents are asked to end with `STATUS: DONE` or `STATUS: NOT_DONE`. cStack arms claim done only when their outcome is `done`. |
| Gate | `cstack verify` on the final tree with the task's public checks (`.cstack/checks.json`, read from the base revision). |
| Truth | Held-out hidden probes (`hidden.json`), never shown to any arm, run in the same sandbox on the final tree. |

Per arm the report gives, with Wilson 95% intervals: claimed done, truly done, **false
completions** (claimed done, hidden checks fail), **false completions caught by the gate**,
gate-done-but-wrong (overfitting the public checks; only hidden cases catch it) and **good fixes
the gate blocked**, plus median time and tokens where the arm reports them.

## Run

```sh
cp bench/fc/arms.example.json arms.json   # review the agent command lines first
node bench/fc.mjs run --arms arms.json --out fc-results --trials 3 --authorize-model-spend
node bench/fc.mjs report --out fc-results
```

Model arms spend real usage, so `run` refuses without `--authorize-model-spend`. Each trial
starts from a fresh git repository built from the task's `repo/` folder. Agent command lines
may use `{prompt}`, `{repo}` and `{goal}`; only the variables named in `pass_env` reach them.
The example Claude line allows edits and `node`/`python` commands; how much freedom a plain
agent gets is part of the comparison, so record it with the results.

## Compare with pstack (or any other workflow)

Run the task in Cursor with pstack (or anywhere else) on a copy of `bench/fc/tasks/<id>/repo`,
note whether the agent said it was done, then import the final tree:

```sh
node bench/fc.mjs import --task py-median --repo /path/to/finished/copy --claim done --arm pstack-cursor --out fc-results
```

Imported trials are judged exactly like the others.

## Tasks

Each task is a folder with `task.json` (`goal`, `language`, `source`), `repo/` (the starting
code plus `.cstack/checks.json`), `hidden.json` (probe criteria never shown to agents) and
`solution/` (a reference fix, never shown to agents). `test/fc.test.mjs` proves every task is
valid: the base fails public and hidden checks; the reference passes both.

The six seed tasks are small synthetic bugs designed so that a lazy fix can pass the public
checks but not the hidden ones. They are a smoke test, not evidence. A result worth publishing
needs dozens of real-project tasks (for example SWE-bench Verified instances converted to this
format) and at least three trials per arm per task.
