import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, backend, scriptedUsage } from './helpers/fixture.mjs';
import { beginRun, processRun, effectiveStatus, reviewDetails, normalizeContract } from '../src/core.mjs';
import { createRunner } from '../src/sandbox.mjs';
import { assessTestChanges, currentExemptions, testChangePolicy } from '../src/test-changes.mjs';
import { buildReview } from '../src/review.mjs';

const runner = { backend };
let pythonReady, pytestReady;
async function inRunner(code) {
  try {
    const r = await createRunner(runner), cwd = await mkdtemp(join(tmpdir(), 'cstack-probe-'));
    try { return await r.execute(['python', '-I', '-c', code], { cwd, timeoutMs: 30000 }); } finally { await rm(cwd, { recursive: true, force: true }); }
  } catch (error) { return { code: 1, stdout: '', stderr: String(error.message || error) }; }
}
const needPython = () => pythonReady ??= inRunner('print("ok")').then(r => r.code === 0 && r.stdout.trim() === 'ok' ? null : 'Selected runner has no python: ' + r.stderr.slice(0, 200));
const needPytest = () => pytestReady ??= inRunner('import pytest;print(pytest.__version__)').then(r => r.code === 0 && /^(7|8|9)\./.test(r.stdout.trim()) ? null : 'Selected runner lacks pytest 7-9: ' + (r.stderr || r.stdout).slice(0, 200));

const driver = "import json,sys;sys.path.insert(0,'.');from calc import add;a,b=json.load(sys.stdin);print(json.dumps(add(a,b)))";
const baseTests = 'from calc import add\n\n\ndef test_zero():\n    assert add(0, 0) == 0\n';
const files = { 'calc.py': 'def add(a, b):\n    return a - b\n', 'tests/test_calc.py': baseTests };
const fixed = 'def add(a, b):\n    return a + b\n';
const additive = baseTests + '\n\ndef test_mixed_sign():\n    assert add(-5, 3) == -2\n\n\ndef test_identity():\n    assert add(5, 0) == 5\n';
const contract = (extra = {}) => ({ schema_version: 3, type: 'FIX', goal: 'Repair incorrect calculator addition', policy: 'lean', attempt_limit: 2, runner,
  criteria: [{ id: 'AC1', kind: 'probe', text: 'Addition returns the correct observable result', argv: ['python', '-I', '-B', '-c', driver],
    cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }, { id: 'negative', stdin: '[-5,3]', expect_json: -2 }] },
  { id: 'SUITE', kind: 'test-suite', text: 'Existing pytest suite', adapter: 'pytest', roots: ['tests'], plugins: [], config: null, expected_tests: ['tests/test_calc.py::test_zero'] }], ...extra });
const write = changes => async ({ run }) => {
  for (const [path, source] of Object.entries(changes)) { await mkdir(dirname(join(run.worktree, path)), { recursive: true }); await writeFile(join(run.worktree, path), source); }
  return { code: 0, ...scriptedUsage };
};

test('TESTCHANGE-01: v3 contracts default to the additive policy; frozen and legacy contracts keep change review', () => {
  assert.equal(normalizeContract(contract()).test_change_policy, 'additive');
  assert.equal(normalizeContract(contract({ test_change_policy: 'review' })).test_change_policy, 'review');
  assert.throws(() => normalizeContract(contract({ test_change_policy: 'skip-review' })), /review or additive/);
  assert.throws(() => normalizeContract({ type: 'FIX', goal: 'Repair addition', criteria: contract().criteria.slice(0, 1), test_change_policy: 'additive' }), /Unknown contract property/);
  assert.equal(testChangePolicy({ schema_version: 3 }), 'review', 'a v3 contract frozen before the field existed keeps review semantics');
  assert.equal(testChangePolicy({ schema_version: 2, test_change_policy: 'additive' }), 'review');
});

test('TESTCHANGE-02: the isolated static classifier separates additive tests from weakening edits', async t => {
  const why = await needPython(); if (why) return t.skip(why);
  const base = 'import pytest\nfrom calc import add\n\ndef test_add():\n    assert add(1, 2) == 3\n\nclass TestCalc:\n    def test_zero(self):\n        assert add(0, 0) == 0\n';
  const cases = [
    ['append a test', base + '\ndef test_negative():\n    assert add(-1, 1) == 0\n', 'additive', ['test_negative']],
    ['test method in existing class', base.replace('== 0\n', '== 0\n\n    def test_neg(self):\n        assert add(-2, 2) == 0\n'), 'additive', ['TestCalc::test_neg']],
    ['parametrized test', base + "\n@pytest.mark.parametrize('a', [1, 2])\ndef test_p(a):\n    assert add(a, 0) == a\n", 'additive', ['test_p']],
    ['insert before existing tests with an import', base.replace('\ndef test_add', '\nimport math\n\ndef test_first():\n    assert math.isfinite(add(1, 1))\n\ndef test_add'), 'additive', ['test_first']],
    ['reformat existing while adding', base.replace('add(1, 2) == 3', 'add(1,2)==3') + '\ndef test_more():\n    assert add(2, 2) == 4\n', 'additive', ['test_more']],
    ['weaken an assertion', base.replace('== 3', '== 4'), 'modified'],
    ['remove a test', base.replace('def test_add():\n    assert add(1, 2) == 3\n', ''), 'modified'],
    ['skip an existing test', base.replace('def test_add', '@pytest.mark.skip\ndef test_add'), 'modified'],
    ['shadow an existing test', base + '\ndef test_add():\n    assert True\n', 'modified'],
    ['shadow a builtin', base + '\nfrom calc import add as len\ndef test_x():\n    pass\n', 'modified'],
    ['import-time monkeypatch', base + '\nimport calc\ncalc.add = lambda a, b: 3\ndef test_x():\n    assert True\n', 'modified'],
    ['autouse fixture', base + '\n@pytest.fixture(autouse=True)\ndef patch():\n    pass\n', 'modified'],
    ['xunit setup hook', base + '\ndef setup_module():\n    pass\ndef test_z():\n    pass\n', 'modified'],
    ['import-time default', base + "\ndef test_y(x=__import__('os').getcwd()):\n    pass\n", 'modified'],
    ['non-marker decorator', base + '\nimport functools\n@functools.lru_cache\ndef test_c():\n    pass\n', 'modified'],
    ['future import', base + '\nfrom __future__ import annotations\ndef test_f():\n    pass\n', 'modified'],
    ['comment-only edit', base + '# reviewed\n', 'modified'],
    ['candidate syntax error', base + '\ndef test_bad(:\n', 'unparsable'],
  ];
  const r = await createRunner(runner), cwd = await mkdtemp(join(tmpdir(), 'cstack-classify-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const request = { files: [...cases.map(([, source]) => ({ path: 'tests/test_calc.py', baseline: Buffer.from(base).toString('base64'), candidate: Buffer.from(source).toString('base64') })),
    { path: 'tests/test_new.py', baseline: null, candidate: Buffer.from('def test_a():\n    pass\nclass TestB:\n    def test_c(self):\n        pass\n').toString('base64') }] };
  const out = await r.execute(['python', '-I', '/runner/test-changes.py'], { cwd, input: JSON.stringify(request), timeoutMs: 30000 });
  assert.equal(out.code, 0, out.stderr);
  const report = JSON.parse(out.stdout);
  for (const [i, [name, , status, tests]] of cases.entries()) {
    assert.equal(report.files[i].status, status, `${name}: ${JSON.stringify(report.files[i].reasons)}`);
    if (tests) assert.deepEqual(report.files[i].added_tests, tests, name);
    if (status !== 'additive') assert.ok(report.files[i].reasons.length > 0, name + ' must explain the review requirement');
  }
  assert.deepEqual(report.files.at(-1), { path: 'tests/test_new.py', status: 'added-file', added_tests: ['TestB::test_c', 'test_a'], reasons: [] });
});

test('TESTCHANGE-03: an additive regression test with a working fix reaches VERIFIED with fail-to-pass evidence', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: write({ 'calc.py': fixed, 'tests/test_calc.py': additive }) });
  assert.equal(run.status, 'VERIFIED', run.reason + ' ' + JSON.stringify(run.test_changes));
  assert.equal(await effectiveStatus(run), 'VERIFIED');
  const review = reviewDetails(run);
  assert.deepEqual(review.protected_changes, ['tests/test_calc.py']);
  assert.deepEqual(review.additive_test_changes, ['tests/test_calc.py']);
  assert.deepEqual(review.review_required_changes, []);
  assert.ok(!review.pending.some(p => p.criterion === 'change-review'));
  assert.equal(run.test_changes.original_tests.status, 'PASS');
  assert.deepEqual(run.test_changes.files.map(x => [x.path, x.status, x.added_tests]), [['tests/test_calc.py', 'additive', ['test_identity', 'test_mixed_sign']]]);
  const kinds = Object.fromEntries(run.test_changes.fail_to_pass.tests.map(x => [x.id, x.kind]));
  assert.deepEqual(kinds, { 'tests/test_calc.py::test_identity': 'pass-to-pass', 'tests/test_calc.py::test_mixed_sign': 'fail-to-pass' });
  assert.equal(run.test_changes.fail_to_pass.status, 'MEASURED');
  assert.ok(run.journey.some(p => p.phase === 'test_change_started'));
  const report = await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8');
  assert.match(report, /Additive test change \(no review needed/);
  assert.match(report, /1 fail-to-pass, 1 pass-to-pass/);
  const view = await buildReview(run), file = view.files.find(x => x.path === 'tests/test_calc.py');
  assert.equal(file.protected, true); assert.equal(file.review_required, false); assert.match(file.protected_reason, /Additive test change/);
  assert.equal(view.human_review, 'SATISFIED');

  // Resume revalidates and recomputes; no worker and no stale exemption carried forward.
  const measured = run.journey.filter(p => p.phase === 'test_change_started').length;
  await processRun(run, { home: f.home, worker: () => assert.fail('A verified candidate needs no further worker') });
  assert.equal(run.status, 'VERIFIED'); assert.equal(run.attempts.length, 1);
  assert.equal(run.journey.filter(p => p.phase === 'test_change_started').length, measured + 1, 'Resume must re-measure test changes');
  assert.equal(run.test_changes.fingerprint, run.snapshot.source_digest);

  // Tampering with the stored test-change evidence invalidates VERIFIED.
  const path = join(f.home, 'runs', run.id, 'evidence', run.test_changes.evidence_hash + '.json');
  await writeFile(path, (await readFile(path, 'utf8')).replace('"PASS"', '"PASS" '));
  assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});

test('TESTCHANGE-04: modifying an existing test still needs human change review', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: write({ 'calc.py': fixed, 'tests/test_calc.py': baseTests.replace('add(0, 0) == 0', 'add(0, 0) in (0, 1)') }) });
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION'); assert.match(run.reason, /Review protected/);
  assert.equal(run.results.AC1.status, 'PASS');
  assert.deepEqual(reviewDetails(run).pending.find(p => p.criterion === 'change-review').paths, ['tests/test_calc.py']);
  assert.equal(run.test_changes.files[0].status, 'review'); assert.equal(run.test_changes.original_tests, null);
});

test('TESTCHANGE-05: an added test that rescues a broken existing test is a false completion and needs review', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  // The fix satisfies the probe but breaks add(0, 0); an added test that runs first hides that.
  const broken = 'STRICT = True\n\n\ndef add(a, b):\n    if STRICT and a == 0 and b == 0:\n        return 1\n    return a + b\n';
  const rescue = baseTests.replace('\n\ndef test_zero', '\n\ndef test_configure():\n    import calc\n    calc.STRICT = False\n\n\ndef test_zero');
  await processRun(run, { home: f.home, worker: write({ 'calc.py': broken, 'tests/test_calc.py': rescue }) });
  assert.equal(run.results.SUITE.status, 'PASS', 'The candidate suite passes only because of the added test');
  assert.equal(run.test_changes.files[0].status, 'additive');
  assert.equal(run.test_changes.original_tests.status, 'FAIL');
  assert.equal(run.test_changes.original_tests.results.SUITE.status, 'FAIL');
  assert.deepEqual(run.test_changes.exempt_paths, []);
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION');
  assert.deepEqual(reviewDetails(run).review_required_changes, ['tests/test_calc.py']);
});

test('TESTCHANGE-06: tests-only and no-op patches cannot use the exemption to complete', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: write({ 'tests/test_calc.py': additive }) });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.AC1.status, 'FAIL'); assert.equal(run.test_changes, null);
  const other = await fixture(t, files), idle = await beginRun({ ...other, contract: contract() });
  await processRun(idle, { home: other.home, worker: async () => ({ code: 0, ...scriptedUsage }) });
  assert.equal(idle.status, 'STALLED'); assert.equal(idle.test_changes, null);
});

test('TESTCHANGE-07: a failed or malformed classifier falls back to human review', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: write({ 'calc.py': fixed, 'tests/test_calc.py': additive }) });
  assert.equal(run.status, 'VERIFIED');
  for (const output of [{ code: 1, stdout: '', stderr: 'interpreter missing' }, { code: 0, stdout: '{"schema_version":1,"python":"3","files":[{"path":"other.py"}]}', stderr: '' }, { code: 0, stdout: 'not json', stderr: '' }]) {
    const fake = { identity: run.runner_identity, execute: async () => output };
    const record = await assessTestChanges(run, fake, { home: f.home, protectedChanges: ['tests/test_calc.py'] });
    assert.equal(record.classifier.status, 'ERROR');
    assert.equal(record.files[0].status, 'review'); assert.deepEqual(record.exempt_paths, []);
    assert.equal(record.original_tests, null); assert.equal(record.fail_to_pass.status, 'NOT_MEASURED');
    assert.deepEqual(currentExemptions({ ...run, test_changes: record }, ['tests/test_calc.py']), []);
  }
  // Evidence measured for another candidate or contract never exempts the current one.
  for (const change of [{ fingerprint: '0'.repeat(64) }, { contract_hash: '1'.repeat(64) }, { runner_identity: 'other' }, { exempt_paths: [] }]) {
    assert.deepEqual(currentExemptions({ ...run, test_changes: { ...run.test_changes, ...change } }, ['tests/test_calc.py']), [], JSON.stringify(change));
  }
  assert.deepEqual(currentExemptions({ ...run, test_changes: { ...run.test_changes } }, ['tests/test_calc.py', 'tests/other.py']), []);
});

test('TESTCHANGE-08: a corrected retry is classified on its own candidate', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  let attempt = 0;
  await processRun(run, { home: f.home, worker: async x => write({ 'calc.py': ++attempt === 1 ? 'def add(a, b):\n    return abs(a) + b\n' : fixed, 'tests/test_calc.py': additive })(x) });
  assert.equal(attempt, 2); assert.equal(run.status, 'VERIFIED', run.reason);
  assert.equal(run.test_changes.fingerprint, run.snapshot.source_digest);
});

test('TESTCHANGE-09: the review policy keeps every existing test edit behind human review', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract({ test_change_policy: 'review' }) });
  await processRun(run, { home: f.home, worker: write({ 'calc.py': fixed, 'tests/test_calc.py': additive }) });
  assert.equal(run.status, 'NEEDS_MANUAL_VERIFICATION'); assert.equal(run.test_changes, null);
  assert.deepEqual(reviewDetails(run).review_required_changes, ['tests/test_calc.py']);
});

test('TESTCHANGE-10: a new test file in a new directory is measured against the baseline without needing review', async t => {
  const why = await needPytest(); if (why) return t.skip(why);
  const f = await fixture(t, files), run = await beginRun({ ...f, contract: contract() });
  const added = 'from calc import add\n\n\ndef test_mixed_sign_regression():\n    assert add(-5, 3) == -2\n';
  await processRun(run, { home: f.home, worker: write({ 'calc.py': fixed, 'tests/regression/test_signs.py': added }) });
  assert.equal(run.status, 'VERIFIED', run.reason);
  assert.deepEqual(reviewDetails(run).protected_changes, []);
  assert.deepEqual(run.test_changes.files.map(x => [x.path, x.status, x.added_tests]), [['tests/regression/test_signs.py', 'added-file', ['test_mixed_sign_regression']]]);
  assert.equal(run.test_changes.original_tests, null, 'No protected change means no exemption is needed');
  assert.deepEqual(run.test_changes.fail_to_pass.tests.map(x => [x.id, x.kind]), [['tests/regression/test_signs.py::test_mixed_sign_regression', 'fail-to-pass']]);
});
