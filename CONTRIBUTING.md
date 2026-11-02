# Contributing to cStack

cStack is a local Codex plugin. Start with the [README](README.md), the
[setup guide](docs/SETUP.md), and the contributor rules in [AGENTS.md](AGENTS.md).

## Work locally

Use Node.js 22.13+ and Git. Repair and isolation tests also require Docker with
prepared images; benchmark tests require Python 3.12 and the pinned dependencies
in [bench/requirements.lock](bench/requirements.lock). Project dependencies and
images are prepared explicitly; see [benchmark setup](bench/README.md).

```sh
npm run check
CSTACK_TEST_RUNNER=docker npm test
# With the pinned Python benchmark environment active:
python -m unittest discover -s bench -t . -p 'test_*.py' -v
npm run plugin:build
```

GitHub CI is disabled. Run the checks relevant to your change locally and include
commands, results, environment requirements and any skipped checks in your pull
request. Live model benchmarks consume account allowance and need explicit operator
authorization; ordinary contribution checks do not require a live benchmark.

Keep changes focused. Add regression coverage for behavior changes, preserve
existing user work, and keep acceptance checks independent of the coding worker.
Do not weaken checks or synthesize human approval to obtain a successful result.

## Report a problem

For ordinary bugs, open an issue with the cStack version, operating system,
Node/Codex versions, reproduction steps, expected behavior and actual result.
Include sanitized diagnostics only. Repair logs and HTML reports can contain
private source; review them before sharing. Never attach credentials, full model
traces, customer data or private repository snapshots.

For a security issue, follow [SECURITY.md](SECURITY.md) instead of posting an
exploit or secret in a public issue. Contributions are distributed under the
repository's [MIT license](LICENSE).
