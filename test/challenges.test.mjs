import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, contract, correct } from './helpers/fixture.mjs';
import { beginRun, processRun, outcomeOf, stateNames } from '../src/core.mjs';
import { preflightCodex, codexArgs, workerAuth } from '../src/codex.mjs';

test('OUTCOME-01: every status maps to one of three answers', () => {
  const expected = { VERIFIED: 'done', INVESTIGATED: 'done', NEEDS_MANUAL_VERIFICATION: 'needs_you', ALREADY_SATISFIED: 'needs_you',
    BLOCKED: 'failed', STALLED: 'failed', BUDGET_EXHAUSTED: 'failed', STALE_EVIDENCE: 'failed', CREATED: 'running', READY: 'running', IMPLEMENTING: 'running', VERIFYING: 'running' };
  for (const status of [...stateNames, 'STALE_EVIDENCE']) assert.equal(outcomeOf(status), expected[status], status);
});

test('OUTCOME-02: reports lead with the three-way outcome', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: correct });
  assert.match(await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8'), /^Outcome: \*\*done\*\* \(VERIFIED\)$/m);
});

test('CONTEXT-NONE-01: the none context policy sends no controller-selected excerpts', async t => {
  const f = await fixture(t);
  let prompt = '';
  const run = await beginRun({ ...f, contract: contract({ schema_version: 3, context: { policy: 'none' } }) });
  await processRun(run, { home: f.home, worker: async x => { prompt = x.prompt; return correct(x); } });
  assert.equal(run.status, 'VERIFIED', run.reason);
  assert.equal(run.attempts[0].context_files, 0); assert.equal(run.attempts[0].context_bytes, 0);
  assert.ok(!prompt.includes('export const add'), 'no source excerpts are injected');
  assert.match(prompt, /Context policy: none/);
});

async function fakeCodex(t, f, loginStatus) {
  const path = join(f.root, 'codex');
  await writeFile(path, `#!/bin/sh
for a in "$@"; do last="$a"; done
case "$*" in
  *"exec --help"*) echo "--ignore-user-config --ignore-rules"; exit 0;;
  *"features list"*) printf 'multi_agent  stable  false\\nmulti_agent_v2  stable  false\\nhooks  stable  false\\nplugins  stable  false\\napps  stable  false\\ngoals  stable  false\\n'; exit 0;;
  *"login status"*) echo "${loginStatus}"; exit 0;;
esac
exit 1
`);
  await chmod(path, 0o755);
  const previous = { bin: process.env.CSTACK_CODEX_BIN, auth: process.env.CSTACK_CODEX_AUTH };
  t.after(() => { for (const [k, v] of [['CSTACK_CODEX_BIN', previous.bin], ['CSTACK_CODEX_AUTH', previous.auth]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.CSTACK_CODEX_BIN = path;
}

test('AUTH-01: API-key worker auth is used only when explicitly selected, never as a fallback', async t => {
  const f = await fixture(t);
  await fakeCodex(t, f, 'Logged in using an API key - sk-proj-***');
  delete process.env.CSTACK_CODEX_AUTH;
  await assert.rejects(preflightCodex(), { code: 'AUTH', message: /ChatGPT Codex login is required/ }, 'an API-key login is not silently accepted');
  process.env.CSTACK_CODEX_AUTH = 'api-key';
  const auth = await preflightCodex();
  assert.equal(auth.authentication, 'api-key'); assert.match(auth.allowance, /billed/);
  const run = await beginRun({ ...f, contract: contract() });
  assert.ok(codexArgs({ ...run, auth }).includes('forced_login_method="api"'));
  assert.ok(codexArgs(run).includes('forced_login_method="chatgpt"'), 'without an explicit preflight result the worker stays on ChatGPT auth');
  process.env.CSTACK_CODEX_AUTH = 'automatic';
  assert.throws(() => workerAuth(), { code: 'AUTH' });
});

test('AUTH-02: an explicit API-key selection without a stored key fails instead of falling back', async t => {
  const f = await fixture(t);
  await fakeCodex(t, f, 'Logged in using ChatGPT');
  process.env.CSTACK_CODEX_AUTH = 'api-key';
  await assert.rejects(preflightCodex(), { code: 'AUTH', message: /never reads or forwards keys/ });
  delete process.env.CSTACK_CODEX_AUTH;
  assert.equal((await preflightCodex()).authentication, 'chatgpt');
});
