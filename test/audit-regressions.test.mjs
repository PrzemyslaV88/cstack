// Regression gates derived from the independently reproduced R01–R13 audit failures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { beginRun, processRun, loadRun, normalizeContract, effectiveStatus, command } from '../src/core.mjs';
import { parseCodexEvents } from '../src/codex.mjs';
import { git } from '../src/snapshot.mjs';
import { fixture, contract, correct, edit, probe } from './helpers/fixture.mjs';

test('R01 successful early exit cannot satisfy an unexecuted behavior', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ attempt_limit: 1 }) });
  await processRun(run, { home: f.home, worker: edit('process.exit(0);export const add=(a,b)=>a-b;') });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.AC1.status, 'FAIL'); assert.match(run.results.AC1.diagnostic, /Missing or malformed/);
});
test('R02 candidate cannot read host files, inherit secrets or write outside isolation', async t => {
  const f = await fixture(t), secret = join(f.root, 'host-canary'), marker = join(f.root, 'host-marker');
  await writeFile(secret, 'HOST-ONLY-CANARY'); process.env.CSTACK_SYNTHETIC_SECRET = 'not-a-real-secret'; t.after(() => delete process.env.CSTACK_SYNTHETIC_SECRET);
  const run = await beginRun({ ...f, contract: contract({ attempt_limit: 1 }) });
  const worker = edit(`import {writeFileSync,readFileSync} from 'node:fs';let s;try{s=readFileSync(${JSON.stringify(secret)},'utf8')}catch{};if(s||process.env.CSTACK_SYNTHETIC_SECRET)throw Error('host secret was visible');try{writeFileSync(${JSON.stringify(marker)},'ESCAPED')}catch{};export const add=(a,b)=>a+b;`);
  await processRun(run, { home: f.home, worker }); assert.equal(run.status, 'VERIFIED');
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});
test('R03 all-optional checks are rejected before any worker launch', () => {
  assert.throws(() => normalizeContract(contract({ criteria: [{ ...probe, required: false }] })), /REQUIRED/);
});
test('R04 corrective turn receives expected/observed behavior and evidence identity', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); const prompts = [];
  await processRun(run, { home: f.home, worker: async x => { prompts.push(x.prompt); return prompts.length === 1 ? edit('// wrong approach\nexport const add=(a,b)=>a-b;')(x) : correct(x); } });
  assert.match(prompts[1], /Expected 6; observed 2/); assert.match(prompts[1], /Baseline: FAIL/); assert.match(prompts[1], /Evidence artifact:/); assert.equal(run.status, 'VERIFIED');
});
test('R05 already-satisfied dependent outcomes do not spend another turn', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [probe, { ...probe, id: 'NEXT' }], tasks: [{ id: 'first', criteria: ['AC1'], depends_on: [] }, { id: 'next', criteria: ['NEXT'], depends_on: ['first'] }] }) }); let calls = 0;
  await processRun(run, { home: f.home, worker: x => { calls++; return correct(x); } }); assert.equal(calls, 1); assert.equal(run.status, 'VERIFIED');
});
test('R06 a verified configuration-only fix counts as implementation', async t => {
  const f = await fixture(t, { 'settings.json': '{"offset":1}', 'calc.mjs': "import {readFileSync} from 'node:fs';const {offset}=JSON.parse(readFileSync(new URL('./settings.json',import.meta.url)));export const add=(a,b)=>a+b+offset;" });
  const run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async ({ run }) => { await writeFile(join(run.worktree, 'settings.json'), '{"offset":0}'); return { code: 0 }; } }); assert.equal(run.status, 'VERIFIED');
});
test('R07 resolving a temporary worker failure permits bounded resume', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async () => ({ code: 1, diagnostic: 'Temporary failure' }) }); assert.equal(run.status, 'BLOCKED');
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.status, 'VERIFIED'); assert.equal(run.attempts.length, 2);
});
test('R08 stale/truncated exports cannot corrupt authoritative transactional state', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await writeFile(join(f.home, 'runs', run.id, 'run.json'), '{"event_seq":999999');
  await writeFile(join(f.home, 'runs', run.id, 'events.jsonl'), '{"seq":999999}\n');
  await processRun(await loadRun(run.id, f.home), { home: f.home, worker: correct });
  assert.equal((await loadRun(run.id, f.home)).status, 'VERIFIED');
});
test('R09 quota-ending invocations consume the reservation exactly once', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ attempt_limit: 1 }) }); let calls = 0;
  const worker = async () => { calls++; return { code: 1, quota: true, usage: [{ input_tokens: 1000, output_tokens: 100 }] }; };
  await processRun(run, { home: f.home, worker }); await processRun(run, { home: f.home, worker });
  assert.equal(calls, 1); assert.equal(run.attempts.length, 1); assert.equal(run.usage.length, 1);
});
test('R10 ordinary quota-related prose is not a provider-limit event', () => {
  const out = parseCodexEvents([JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Fixed the quota limiter' } }), JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10 } })]);
  assert.equal(out.quota, false); assert.equal(out.protocol_error, false);
  assert.equal(parseCodexEvents([JSON.stringify({ type: 'turn.failed', error: { code: 'usage_limit_reached', message: 'Limit' } })]).quota, true);
});
test('R11 uncooperative process is killed within timeout plus bounded grace', async () => {
  const started = Date.now();
  const result = await command([process.execPath, '-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { timeoutMs: 150, graceMs: 50 });
  assert.equal(result.timedOut, true); assert.ok(Date.now() - started < 450, 'Timeout did not settle within bound');
});
test('R12 ignored runtime configuration invalidates previous proof', async t => {
  const f = await fixture(t, { '.gitignore': 'runtime-cache.json\n' }), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.status, 'VERIFIED');
  await writeFile(join(run.worktree, 'runtime-cache.json'), '{"offset":99}'); assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});
test('R13 changed committed state cannot reuse dirty-file evidence', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); await processRun(run, { home: f.home, worker: correct });
  await git(run.worktree, 'add', 'calc.mjs'); await git(run.worktree, 'commit', '-qm', 'external commit');
  assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
  await processRun(run, { home: f.home, worker: () => assert.fail('HEAD moved') }); assert.equal(run.status, 'BLOCKED'); assert.match(run.reason, /HEAD moved/);
});
