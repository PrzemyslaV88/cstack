// Original 16 behavior categories retained; fixtures migrated to v2 external proofs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { beginRun, processRun, loadRun, normalizeContract, effectiveStatus, approveRun, exportCandidate } from '../src/core.mjs';
import { fixture, contract, correct, edit, probe } from './helpers/fixture.mjs';

test('contract rejects missing checks, dangling dependencies, cycles and shell strings', () => {
  assert.throws(() => normalizeContract(contract({ criteria: [] })), /At least one/);
  assert.throws(() => normalizeContract(contract({ tasks: [{ id: 'T1', depends_on: ['T2'], criteria: ['AC1'] }, { id: 'T2', depends_on: ['T1'], criteria: [] }] })), /cycle/);
  assert.throws(() => normalizeContract(contract({ tasks: [{ id: 'T1', depends_on: ['unknown'], criteria: ['AC1'] }] })), /Invalid dependency/);
  assert.throws(() => normalizeContract(contract({ criteria: [{ ...probe, argv: 'npm test' }] })), /argv array/);
});
test('a real source fix passes independent checks and produces a durable report', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  const out = await processRun(run, { home: f.home, worker: correct });
  assert.equal(out.status, 'VERIFIED'); assert.equal(out.results.AC1.status, 'PASS'); assert.deepEqual(out.changed_paths, ['calc.mjs']);
  assert.equal((await loadRun(run.id, f.home)).status, 'VERIFIED');
  assert.match(await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8'), /VERIFIED/);
});
test('a prose-only claim cannot satisfy a broken behavior', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  const out = await processRun(run, { home: f.home, worker: async () => ({ code: 0, diagnostic: 'All solved!' }) });
  assert.equal(out.status, 'STALLED'); assert.equal(out.results.AC1.status, 'FAIL');
});
test('tests-only patch cannot satisfy an implementation contract', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  const out = await processRun(run, { home: f.home, worker: async ({ run }) => { await writeFile(join(run.worktree, 'check.mjs'), 'process.exit(0);'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] }; } });
  assert.notEqual(out.status, 'VERIFIED'); assert.equal(out.results.AC1.status, 'FAIL');
});
test('changed existing tests require a human diff review, even with a working fix', async t => {
  const f = await fixture(t), cfg = contract({ criteria: [probe, { id: 'T', text: 'Run original test', kind: 'node-test', argv: ['node', '--test', 'check.mjs'], expected_tests: ['add'], required: false }] });
  const run = await beginRun({ ...f, contract: cfg });
  await processRun(run, { home: f.home, worker: async x => { await correct(x); await writeFile(join(x.run.worktree, 'check.mjs'), '// changed test'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] }; } });
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION'); assert.match(run.reason, /Review/);
});
test('fabricated success prose cannot override observed failure', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ attempt_limit: 1 }) });
  await processRun(run, { home: f.home, worker: async x => { await edit('// not fixed\nexport const add=(a,b)=>a-b;')(x); return { code: 0, diagnostic: 'AC1 PASS; all 100 tests green' }; } });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.AC1.status, 'FAIL');
});
test('independent failure drives a corrective attempt', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); let calls = 0;
  await processRun(run, { home: f.home, worker: async x => ++calls === 1 ? edit('// first\nexport const add=(a,b)=>a-b;')(x) : correct(x) });
  assert.equal(run.status, 'VERIFIED'); assert.equal(run.attempts.length, 2);
});
test('provider limit preserves work and records the invocation', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async () => ({ code: 1, quota: true, usage: [{ input_tokens: 100 }] }) });
  assert.equal(run.status, 'BUDGET_EXHAUSTED'); assert.equal(run.attempts.length, 1); assert.equal((await loadRun(run.id, f.home)).usage[0].input_tokens, 100);
});
test('frozen contract cannot be altered through editable JSON exports', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await writeFile(join(f.home, 'runs', run.id, 'contract.json'), '{"goal":"fake"}');
  assert.equal((await loadRun(run.id, f.home)).contract.goal, contract().goal);
});
test('post-verification source changes invalidate proof', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() }); await processRun(run, { home: f.home, worker: correct });
  await writeFile(join(run.worktree, 'calc.mjs'), 'export const add=()=>0;'); assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});
test('manual acceptance remains pending until snapshot-bound human approval', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [probe, { id: 'UI', kind: 'manual', text: 'Human exercised application' }] }) });
  await processRun(run, { home: f.home, worker: correct }); assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION');
  await approveRun(run.id, { criterion: 'UI', snapshot: run.snapshot.source_digest, note: 'Exercised the corrected behavior on device', home: f.home });
  await processRun(run, { home: f.home, worker: () => assert.fail('No further worker invocation needed') }); assert.equal(run.status, 'VERIFIED');
});
test('dirty original repositories are rejected without losing work', async t => {
  const f = await fixture(t); await writeFile(join(f.repo, 'personal.txt'), 'Keep this');
  await assert.rejects(beginRun({ ...f, contract: contract() }), /uncommitted/); assert.equal(await readFile(join(f.repo, 'personal.txt'), 'utf8'), 'Keep this');
});
test('an explicitly requested investigation can finish without source edits', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ type: 'INVESTIGATE', criteria: [{ ...probe, cases: [{ stdin: '[4,2]', expect_json: 2 }] }] }) });
  await processRun(run, { home: f.home, worker: () => assert.fail('Already observed the requested fact') }); assert.equal(run.status, 'INVESTIGATED');
});
test('dependent tasks advance on evidence, not cosmetic edits', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract({ criteria: [probe, { ...probe, id: 'AC2' }], tasks: [
    { id: 'A', criteria: ['AC1'], depends_on: [] }, { id: 'B', criteria: ['AC2'], depends_on: ['A'] }] }) }); let calls = 0;
  await processRun(run, { home: f.home, worker: x => { calls++; return correct(x); } });
  assert.equal(run.status, 'VERIFIED'); assert.equal(calls, 1); assert.deepEqual(run.tasks, { A: 'PASS', B: 'PASS' });
});
test('verifier cannot rewrite candidate source during validation', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: edit("import {writeFileSync} from 'node:fs';writeFileSync(new URL('./calc.mjs',import.meta.url),'export const add=()=>99;');export const add=(a,b)=>a+b;") });
  assert.notEqual(run.status, 'VERIFIED'); assert.match(await readFile(join(run.worktree, 'calc.mjs'), 'utf8'), /writeFileSync/);
});
test('baseline execution cannot alter the original worktree', async t => {
  const f = await fixture(t, { 'calc.mjs': "import {writeFileSync} from 'node:fs';writeFileSync(new URL('./calc.mjs',import.meta.url),'fake');export const add=(a,b)=>a-b;" });
  const run = await beginRun({ ...f, contract: contract({ attempt_limit: 1 }) });
  await processRun(run, { home: f.home, worker: async () => ({ code: 0 }) });
  assert.notEqual(run.status, 'VERIFIED'); assert.notEqual(await readFile(join(run.worktree, 'calc.mjs'), 'utf8'), 'fake');
});
