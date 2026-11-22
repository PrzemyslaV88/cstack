import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, contract, scriptedUsage } from './helpers/fixture.mjs';
import { beginRun, processRun, normalizeContract } from '../src/core.mjs';
import { git } from '../src/snapshot.mjs';

const wrong = 'export const add=(a,b)=>Math.abs(a)+b;\n', right = 'export const add=(a,b)=>a+b;\n';
const withAlternates = (extra = {}) => contract({ schema_version: 3, alternates: { count: 2, workers: ['codex', 'claude'] }, ...extra });
// A scripted worker: `plan` maps the main attempt number or `alt<N>` to the files it writes.
function scripted(plan, log = []) {
  return async ({ run, alternate, prompt }) => {
    const key = alternate ? 'alt' + alternate.index : 'main' + (run.attempts.filter(a => !a.alternate).length);
    log.push({ key, worktree: run.worktree, worker: alternate?.worker || run.contract.worker, prompt, at: Date.now() });
    if (plan[key]?.delay) await new Promise(r => setTimeout(r, plan[key].delay));
    for (const [p, s] of Object.entries(plan[key]?.write || {})) { await mkdir(join(run.worktree, p, '..'), { recursive: true }); await writeFile(join(run.worktree, p), s); }
    return { code: 0, ...scriptedUsage };
  };
}

test('ALT-01: after a failed attempt, parallel alternates on different workers run and the passing one is adopted', async t => {
  const f = await fixture(t), log = [];
  const run = await beginRun({ ...f, contract: withAlternates() });
  await processRun(run, { home: f.home, worker: scripted({ main1: { write: { 'calc.mjs': wrong } }, alt1: { write: { 'calc.mjs': wrong }, delay: 300 }, alt2: { write: { 'calc.mjs': right }, delay: 300 } }, log) });
  assert.equal(run.status, 'VERIFIED', run.reason);
  assert.deepEqual(log[0].key, 'main1');
  assert.deepEqual(Object.fromEntries(log.slice(1).map(l => [l.key, l.worker])), { alt1: 'codex', alt2: 'claude' }, 'alternates rotate across the listed workers');
  assert.deepEqual(run.alternates_summary.selected.worker, 'claude'); assert.deepEqual(run.alternates_summary.selected.changed_paths, ['calc.mjs']);
  assert.deepEqual(run.attempts.map(a => [a.alternate || 0, a.decision]), [[0, 'REPAIR_READY'], [1, 'ALTERNATE_FAIL'], [2, 'ALTERNATE_SELECTED']]);
  const [, a1, a2] = log;
  assert.ok(Math.abs(a1.at - a2.at) < 250, 'alternates start in parallel');
  assert.notEqual(a1.worktree, run.worktree); assert.notEqual(a1.worktree, a2.worktree);
  for (const l of [a1, a2]) await assert.rejects(access(l.worktree), 'alternate worktrees are removed');
  assert.ok(!(await git(f.repo, 'worktree', 'list')).includes('-alt'));
  assert.match(a1.prompt, /Independent verification feedback[\s\S]*AC1: FAIL/, 'alternates see the verifier feedback from the failed attempt');
});

test('ALT-02: when no alternate passes, normal correction continues in the main worktree', async t => {
  const f = await fixture(t), log = [];
  const run = await beginRun({ ...f, contract: withAlternates({ attempt_limit: 2 }) });
  await processRun(run, { home: f.home, worker: scripted({ main1: { write: { 'calc.mjs': wrong } }, alt1: { write: { 'calc.mjs': '// nothing\nexport const add=()=>0;\n' } }, alt2: { write: { 'calc.mjs': wrong } }, main2: { write: { 'calc.mjs': right } } }, log) });
  assert.equal(run.status, 'VERIFIED', run.reason); assert.equal(run.alternates_summary.selected, null);
  assert.deepEqual(log.map(l => l.key).filter(k => k.startsWith('main')), ['main1', 'main2']);
});

test('ALT-03: among passing alternates the smallest change wins', async t => {
  const f = await fixture(t);
  const run = await beginRun({ ...f, contract: withAlternates() });
  await processRun(run, { home: f.home, worker: scripted({ main1: { write: { 'calc.mjs': wrong } }, alt1: { write: { 'calc.mjs': right, 'extra.mjs': 'export const x=1;\n' } }, alt2: { write: { 'calc.mjs': right } } }) });
  assert.equal(run.status, 'VERIFIED', run.reason); assert.equal(run.alternates_summary.selected.worker, 'claude');
  assert.deepEqual(run.changed_paths, ['calc.mjs']);
});

test('ALT-04: alternates respect the run budget and never run when the first attempt passes', async t => {
  const f = await fixture(t), log = [];
  const run = await beginRun({ ...f, contract: withAlternates() });
  await processRun(run, { home: f.home, worker: scripted({ main1: { write: { 'calc.mjs': right } } }, log) });
  assert.equal(run.status, 'VERIFIED'); assert.equal(log.length, 1); assert.equal(run.alternates_summary, undefined);
  const g = await fixture(t), glog = [];
  const tight = await beginRun({ ...g, contract: withAlternates({ budget: { max_attempts: 2 } }) });
  await processRun(tight, { home: g.home, worker: scripted({ main1: { write: { 'calc.mjs': wrong } }, alt1: { write: { 'calc.mjs': right } }, alt2: { write: { 'calc.mjs': right } } }, glog) });
  assert.equal(glog.filter(l => l.key.startsWith('alt')).length, 1, 'only one alternate fits the remaining budget');
  assert.equal(tight.attempts.length, 2); assert.equal(tight.status, 'VERIFIED');
  assert.equal(normalizeContract(withAlternates()).budget.max_attempts, 4, 'the default budget makes room for alternates');
  assert.throws(() => normalizeContract(withAlternates({ alternates: { count: 5 } })), /alternates.count/);
  assert.throws(() => normalizeContract(withAlternates({ alternates: { count: 1, workers: ['gpt'] } })), /alternates.workers/);
});

test('ALT-05: an adopted alternate still faces protected-change review', async t => {
  const f = await fixture(t, { 'tests/add.test.mjs': "import test from 'node:test';test('existing',()=>{});\n" });
  const run = await beginRun({ ...f, contract: withAlternates() });
  await processRun(run, { home: f.home, worker: scripted({ main1: { write: { 'calc.mjs': wrong } },
    alt1: { write: { 'calc.mjs': right, 'tests/add.test.mjs': '// rewritten test\n' } }, alt2: { write: { 'calc.mjs': wrong } } }) });
  assert.equal(run.alternates_summary.selected.changed_paths.includes('tests/add.test.mjs'), true);
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION'); assert.match(run.reason, /Review protected/);
});
