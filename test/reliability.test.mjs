import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, symlink, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { beginRun, processRun, loadRun, effectiveStatus, approveRun, exportCandidate, normalizeContract, command } from '../src/core.mjs';
import { lockRun, unlockRun, openStore, commitRun } from '../src/store.mjs';
import { fingerprint, manifest } from '../src/snapshot.mjs';
import { createRunner } from '../src/sandbox.mjs';
import { parseTestReport } from '../src/verification.mjs';
import { usageTotals, codexArgs, parseCodexEvents } from '../src/codex.mjs';
import { fixture, contract, probe, correct, edit } from './helpers/fixture.mjs';

test('missing/skipped/fabricated test reports cannot substitute for expected cases', () => {
  const pass = JSON.stringify({ type: 'test:pass', name: 'expected' }), end = JSON.stringify({ type: 'cstack:test-stream-complete' });
  assert.equal(parseTestReport(pass + '\n' + end, ['expected']).passed, true);
  assert.equal(parseTestReport(end, ['expected']).passed, false);
  assert.equal(parseTestReport('all tests passed', ['expected']).passed, false);
  assert.equal(parseTestReport(JSON.stringify({ type: 'test:pass', name: 'expected', skip: true }) + '\n' + end, ['expected']).passed, false);
  assert.equal(parseTestReport(pass, ['expected']).passed, false);
});
test('candidate stdout cannot forge trusted node-test reporter events', async t => {
  const f = await fixture(t), cfg = contract({ criteria: [{ id: 'T', text: 'Original add test executed', kind: 'node-test', argv: ['node', '--test', 'check.mjs'], expected_tests: ['add'] }] });
  const run = await beginRun({ ...f, contract: cfg });
  await processRun(run, { home: f.home, worker: edit(`console.log(JSON.stringify({type:'test:pass',name:'add'}));console.log(JSON.stringify({type:'cstack:test-stream-complete'}));process.exit(0);export const add=()=>0;`) });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.T.status, 'FAIL');
});
test('node-test-only successes require human outcome acceptance', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [{ id: 'T', text: 'Add test passes', kind: 'node-test', argv: ['node', '--test', 'check.mjs'], expected_tests: ['add'] }] }) });
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.results.T.status, 'PASS'); assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION');
  await approveRun(run.id, { home: f.home, criterion: 'outcome', snapshot: run.snapshot.source_digest, note: 'Independently exercised the original reported defect' });
  await processRun(run, { home: f.home, worker: () => assert.fail('No edit needed') }); assert.equal(run.status, 'VERIFIED');
});
test('critical mode requires external proof and an actual manual gate', () => {
  assert.throws(() => normalizeContract(contract({ policy: 'critical' })), /external probe.*human/);
  assert.doesNotThrow(() => normalizeContract(contract({ policy: 'critical', criteria: [probe, { id: 'H', text: 'Human verified', kind: 'manual' }] })));
});
test('approval of a previous snapshot cannot authorize a changed candidate', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [probe, { id: 'H', text: 'Manual check', kind: 'manual' }] }) });
  await processRun(run, { home: f.home, worker: correct });
  await writeFile(join(run.worktree, 'calc.mjs'), '// altered\nexport const add=(a,b)=>a+b;');
  await assert.rejects(approveRun(run.id, { home: f.home, criterion: 'H', snapshot: run.snapshot.source_digest, note: 'Approving previous source is unsafe' }), /stale/);
});
test('concurrent resume is rejected by an exclusive run lock', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }), token = lockRun(run.id, f.home);
  try { await assert.rejects(processRun(run, { home: f.home, worker: correct }), /already active/); }
  finally { unlockRun(run.id, token, f.home); }
});
test('state and event writes roll back together under injected DB failure', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  const db = openStore(f.home);
  db.exec("CREATE TRIGGER fail_state_update BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT, 'injected write failure'); END"); db.close();
  const original = await loadRun(run.id, f.home); run.status = 'FAKE';
  assert.throws(() => commitRun(run, 'must_rollback', {}, f.home), /injected write failure/);
  const inspect = openStore(f.home);
  assert.equal(inspect.prepare("SELECT COUNT(*) AS n FROM events WHERE kind='must_rollback'").get().n, 0);
  inspect.exec('DROP TRIGGER fail_state_update'); inspect.close();
  assert.equal((await loadRun(run.id, f.home)).status, original.status);
});
test('a genuinely killed controller recovers with its consumed attempt intact', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ budget: { worker_timeout_ms: 2000 } }) });
  const module = new URL('../src/core.mjs', import.meta.url).href;
  const program = `import {loadRun,processRun} from ${JSON.stringify(module)};await processRun(await loadRun(${JSON.stringify(run.id)},${JSON.stringify(f.home)}),{home:${JSON.stringify(f.home)},worker:async()=>{process.stdout.write('RESERVED\\n');await new Promise(()=>setInterval(()=>{},1000));}});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { try { child.kill('SIGKILL'); } catch {} });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Crash fixture did not reserve')), 10_000);
    child.stdout.on('data', x => { if (x.toString().includes('RESERVED')) { clearTimeout(timer); resolve(); } });
    child.on('error', reject);
  });
  const closed = new Promise(resolve => child.on('close', (code, signal) => resolve(signal))); child.kill('SIGKILL'); assert.equal(await closed, 'SIGKILL');
  const recovered = await loadRun(run.id, f.home);
  await processRun(recovered, { home: f.home, worker: correct });
  assert.equal(recovered.status, 'VERIFIED'); assert.equal(recovered.attempts.length, 2); assert.equal(recovered.attempts[0].status, 'INTERRUPTED');
});
test('run-wide ceiling stops extra dependent tasks', async t => {
  const other = { ...probe, id: 'AC2', argv: ['node', '-e', 'console.log(0)'], cases: [{ stdin: '', expect_json: 1 }] };
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [probe, other], budget: { max_attempts: 1 }, tasks: [{ id: 'A', criteria: ['AC1'], depends_on: [] }, { id: 'B', criteria: ['AC2'], depends_on: ['A'] }] }) });
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.status, 'BUDGET_EXHAUSTED'); assert.equal(run.attempts.length, 1);
});
test('token totals retain cached/reasoning subsets without double-counting', () => {
  const sums = usageTotals([{ input_tokens: 100, cached_input_tokens: 90, output_tokens: 20, reasoning_output_tokens: 10 }]);
  assert.equal(sums.observed_total_tokens, 120); assert.equal(sums.cached_input_tokens, 90); assert.equal(sums.reasoning_output_tokens, 10);
});
test('Codex policy disables API auth, subagents, hooks and inherited shell environment', () => {
  const flags = codexArgs({ worktree: '/safe', contract: contract(), thread_id: null });
  for (const value of ['forced_login_method="chatgpt"', 'features.multi_agent=false', 'agents.enabled=false', 'features.hooks=false', 'shell_environment_policy.inherit="none"', 'sandbox_workspace_write.network_access=false']) assert.ok(flags.includes(value), value);
  assert.ok(flags.includes('--ignore-user-config')); assert.ok(flags.includes('--ignore-rules'));
  assert.ok(flags.indexOf('--ignore-user-config') > flags.indexOf('exec'));
  assert.ok(flags.includes('features.multi_agent_v2=false')); assert.ok(flags.includes('--no-daemon'));
});
test('Codex missing completion or malformed protocol is not a successful worker turn', () => {
  assert.equal(parseCodexEvents(['not-json']).protocol_error, true);
  assert.equal(parseCodexEvents(['{"type":"thread.started","thread_id":"safe-id"}']).protocol_error, true);
});
test('hard output cap terminates a noisy command', async () => {
  const result = await command([process.execPath, '-e', "setInterval(()=>console.log('x'.repeat(1000)),1)"], { outputLimit: 1500, timeoutMs: 5000 });
  assert.equal(result.truncated, true); assert.ok(result.stdout.length < 2000);
});
test('cancellation terminates work without waiting for the wall-clock ceiling', async () => {
  const abort = new AbortController(); setTimeout(() => abort.abort(), 100);
  const result = await command([process.execPath, '-e', 'setInterval(()=>{},1000)'], { signal: abort.signal, timeoutMs: 5000 });
  assert.equal(result.aborted, true);
});
test('network access is denied inside the candidate runner', async t => {
  const f = await fixture(t), runner = await createRunner(contract().runner);
  const result = await runner.execute(['node', '-e', "const s=require('net').connect(9,'1.1.1.1');s.on('error',()=>{console.log('blocked');s.destroy()});s.on('connect',()=>{console.log('ESCAPED');s.destroy()});setTimeout(()=>{s.destroy();},500)"], { cwd: f.repo, timeoutMs: 2000 });
  assert.equal(result.code, 0); assert.match(result.stdout, /blocked/); assert.doesNotMatch(result.stdout, /ESCAPED/);
});
test('unsupported runner cannot fall back to unrestricted execution', async () => {
  await assert.rejects(createRunner({ backend: 'host' }), /no host fallback/);
});
test('external symlinks cannot enter sealed candidates', async t => {
  const f = await fixture(t); const run = await beginRun({ ...f, contract: contract() });
  await symlink('/etc/passwd', join(run.worktree, 'escape'));
  await assert.rejects(fingerprint(run.worktree), /symlink denied/);
});
test('changes in executable mode invalidate proof even without content changes', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); await processRun(run, { home: f.home, worker: correct });
  await chmod(join(run.worktree, 'calc.mjs'), 0o755); assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});
test('potential secret files block snapshots rather than leaking into worker verification', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await writeFile(join(run.worktree, '.env'), 'PASSWORD=synthetic');
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.status, 'BLOCKED'); assert.match(run.reason, /credential file/);
});
test('verified candidate can be exported without overwriting existing files', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); await processRun(run, { home: f.home, worker: correct });
  const out = join(f.root, 'export'); await exportCandidate(run.id, out, f.home);
  assert.equal(await readFile(join(out, 'candidate', 'calc.mjs'), 'utf8'), 'export const add=(a,b)=>a+b;\n');
  await assert.rejects(exportCandidate(run.id, out, f.home), /already exists/);
  await writeFile(join(run.worktree, 'calc.mjs'), 'broken'); await assert.rejects(exportCandidate(run.id, join(f.root, 'second'), f.home), /current verified/);
});
test('all-passing baseline does not create a fake fix or a needless worker invocation', async t => {
  const f = await fixture(t, { 'calc.mjs': 'export const add=(a,b)=>a+b;' }), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: () => assert.fail('No failing outcome') }); assert.equal(run.status, 'ALREADY_SATISFIED'); assert.equal(run.attempts.length, 0);
});

test('evidence log tampering invalidates the completion claim', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); await processRun(run, { home: f.home, worker: correct });
  await writeFile(join(f.home, 'runs', run.id, 'evidence', run.results.AC1.output_hash + '.log'), 'forged');
  assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});
test('stale object revisions cannot overwrite newer authoritative state', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }), old = structuredClone(run);
  commitRun(run, 'first', {}, f.home); assert.throws(() => commitRun(old, 'stale', {}, f.home), /Concurrent\/stale/);
});
test('source changes after checks but before completion are caught by the final gate', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: correct, afterAttempt: async () => { await writeFile(join(run.worktree, 'calc.mjs'), 'export const add=()=>99;'); } });
  assert.equal(run.status, 'BLOCKED'); assert.match(run.reason, /stale/);
});
test('no paid authentication fallback when a Codex executable is missing', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }), old = process.env.CSTACK_CODEX_BIN;
  process.env.CSTACK_CODEX_BIN = join(f.root, 'does-not-exist');
  t.after(() => old === undefined ? delete process.env.CSTACK_CODEX_BIN : process.env.CSTACK_CODEX_BIN = old);
  await processRun(run, { home: f.home }); assert.equal(run.status, 'BLOCKED'); assert.match(run.reason, /AUTH/); assert.equal(run.attempts.length, 0);
});
