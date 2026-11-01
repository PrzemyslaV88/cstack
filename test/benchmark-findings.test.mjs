import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { beginRun, processRun, effectiveStatus, approveRun, exportCandidate, normalizeContract, reviewDetails, promptFor } from '../src/core.mjs';
import { testPath } from '../src/file-policy.mjs';
import { hash } from '../src/util.mjs';
import { fixture, contract, correct, edit } from './helpers/fixture.mjs';

const sample = 'TEST_ONLY=published-synthetic-fixture\n';
const approval = (path = 'tests/data/.env') => ({ path, sha256: hash(sample), reason: 'Reviewed synthetic fixture; contains no production credentials' });

test('only exact reviewed fixtures are accepted; path-wide exceptions are rejected', () => {
  for (const path of ['.env', '../tests/.env', 'tests/../.env', 'tests/*/.env', 'tests//.env', '.git/tests/.env']) {
    assert.throws(() => normalizeContract(contract({ approved_test_fixtures: [approval(path)] })), /fixture|Fixture|relative|recognised/i);
  }
  assert.throws(() => normalizeContract(contract({ approved_test_fixtures: [{ ...approval(), sha256: 'wrong' }] })), /SHA-256/);
  assert.throws(() => normalizeContract(contract({ approved_test_fixtures: [approval(), approval()] })), /Duplicate/);
});

test('reviewed fixture survives real isolated verification, approval and export', async t => {
  const f = await fixture(t, { 'tests/data/.env': sample });
  const run = await beginRun({ ...f, contract: contract({ approved_test_fixtures: [approval()] }) });
  await processRun(run, { home: f.home, worker: correct });
  assert.equal(await effectiveStatus(run), 'VERIFIED');
  assert.equal(run.review.approved_test_fixtures[0].sha256, hash(sample));
  await exportCandidate(run.id, join(f.root, 'exported'), f.home);
  assert.equal(await readFile(join(f.root, 'exported/candidate/tests/data/.env'), 'utf8'), sample);
  const report = await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8');
  assert.match(report, /Unchanged approved test fixture/);
  assert.ok(run.metrics.baseline_ms > 0 && run.metrics.verification_ms > 0);
  assert.ok(run.attempts[0].prompt_chars > 0 && run.attempts[0].context_files <= 12);
});

test('a fixture approval cannot admit a different, missing or additional secret file', async t => {
  const f = await fixture(t, { 'tests/data/.env': sample, 'tests/data/private.key': 'synthetic-private-key' });
  await assert.rejects(beginRun({ ...f, contract: contract({ approved_test_fixtures: [approval()] }) }), /credential file/);
  const other = await fixture(t, { 'tests/data/.env': 'unreviewed contents' });
  await assert.rejects(beginRun({ ...other, contract: contract({ approved_test_fixtures: [approval()] }) }), /fixture changed/);
  const missing = await fixture(t);
  await assert.rejects(beginRun({ ...missing, contract: contract({ approved_test_fixtures: [approval()] }) }), /fixture missing/);
});

for (const action of ['change', 'remove', 'rename', 'symlink']) {
  test(`worker cannot ${action} an approved fixture`, async t => {
    const f = await fixture(t, { 'tests/data/.env': sample });
    const run = await beginRun({ ...f, contract: contract({ approved_test_fixtures: [approval()] }) });
    await processRun(run, { home: f.home, worker: async x => {
      await correct(x);
      const p = join(x.run.worktree, 'tests/data/.env');
      if (action === 'change') await writeFile(p, 'NEW_SECRET=not-reviewed');
      else {
        await rename(p, join(x.run.worktree, 'tests/data/original.txt'));
        if (action === 'rename') await writeFile(join(x.run.worktree, 'tests/data/renamed.key'), sample);
        if (action === 'symlink') await symlink('original.txt', p);
      }
      return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] };
    } });
    assert.equal(run.status, 'BLOCKED');
    assert.match(run.reason, /fixture|credential file/);
  });
}

test('Python testing folders and filename conventions all count as tests', () => {
  for (const path of ['tests/test_add.py', 'testing/test_unittest.py', 'test_add.py', 'calc_test.py', 'pkg/calc_test.go', 'calc.test.mjs']) assert.equal(testPath(path), true, path);
  assert.equal(testPath('src/calculator.py'), false);
});

test('a working fix with changes under testing requires review and current human approval', async t => {
  const f = await fixture(t, { 'testing/test_unittest.py': '# original test\n' });
  const run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async x => {
    await correct(x); await writeFile(join(x.run.worktree, 'testing/test_unittest.py'), '# proposed regression test\n'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] };
  } });
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION');
  assert.equal(run.results.AC1.status, 'PASS');
  assert.deepEqual(reviewDetails(run).pending[0].paths, ['testing/test_unittest.py']);
  assert.match(await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8'), /fix passed its automated checks/);
  await assert.rejects(exportCandidate(run.id, join(f.root, 'premature'), f.home), /current verified/);
  await approveRun(run.id, { home: f.home, criterion: 'change-review', snapshot: run.snapshot.source_digest, note: 'Reviewed the proposed test changes against the original checks' });
  await processRun(run, { home: f.home, worker: () => assert.fail('Review must not require another coding attempt') });
  assert.equal(await effectiveStatus(run), 'VERIFIED');
});

test('a testing-only patch is not an implementation, and a new conftest is protected', async t => {
  const f = await fixture(t, { 'testing/test_math.py': '# original\n' });
  const run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async ({ run }) => {
    await writeFile(join(run.worktree, 'testing/test_math.py'), '# all tests removed\n'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] };
  } });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.AC1.status, 'FAIL');
  const other = await fixture(t), fixed = await beginRun({ ...other, contract: contract() });
  await processRun(fixed, { home: other.home, worker: async x => {
    await correct(x); await writeFile(join(x.run.worktree, 'conftest.py'), '# new collection configuration\n'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] };
  } });
  assert.equal(fixed.status, 'NEEDS_MANUAL_VERIFICATION');
});

test('new supporting tests do not replace frozen acceptance checks', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: async x => {
    await correct(x); await mkdir(join(x.run.worktree, 'testing'));
    await writeFile(join(x.run.worktree, 'testing/test_extra.py'), '# additional proposed coverage\n'); return { code: 0, accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}] };
  } });
  assert.equal(run.status, 'VERIFIED');
  assert.deepEqual(run.review.added_tests, ['testing/test_extra.py']);
  assert.equal(run.results.AC1.strength, 'external-observation');
});

test('failed first implementation drives real checks and a corrective second attempt', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: contract() });
  const prompts = [];
  await processRun(run, { home: f.home, worker: async x => {
    prompts.push(x.prompt);
    return prompts.length === 1 ? edit('export const add=(a,b)=>a*b;\n')(x) : correct(x);
  } });
  assert.equal(run.status, 'VERIFIED'); assert.equal(run.attempts.length, 2);
  assert.equal(run.attempts[0].proof.AC1.status, 'FAIL');
  assert.match(prompts[1], /Expected 6; observed 8/);
  assert.match(prompts[1], /Revise your diagnosis/);
  assert.equal(run.attempts[1].proof.AC1.status, 'PASS');
});

test('resumed repair prompt retains current failure without repeating the full goal', () => {
  const cfg = normalizeContract(contract({ goal: 'Repair incorrect addition. ' + 'Detailed requirement. '.repeat(100) }));
  const run = { contract: cfg, attempts: [], changed_paths: [], results: {}, baseline: {}, thread_id: null };
  const task = cfg.tasks[0], context = { files: ['calc.mjs'], edges: [] };
  const initial = promptFor(run, task, context);
  run.thread_id = 'test-existing-thread';
  run.attempts = [{ task_id: task.id, number: 1, reason: 'Incorrect result' }];
  run.results.AC1 = { status: 'FAIL', fingerprint: 'snapshot', diagnostic: 'Expected 6; observed 8' };
  const repair = promptFor(run, task, context);
  assert.match(repair, /Expected 6; observed 8/); assert.match(repair, /same frozen objective/);
  assert.ok(repair.length < initial.length);
});
