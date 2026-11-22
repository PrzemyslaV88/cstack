import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './helpers/fixture.mjs';
import { verifyChange, verifyCheck } from '../src/verify.mjs';
import { captureOrigin, git } from '../src/snapshot.mjs';
import { applyRun, patchRun } from '../src/delivery.mjs';
import { command, cleanEnv } from '../src/process.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const driver = "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';console.log(JSON.stringify(add(...JSON.parse(readFileSync(0,'utf8')))))";
const probe = { id: 'ADD', kind: 'probe', text: 'Addition is correct for positive and mixed-sign inputs', argv: ['node', '--input-type=module', '-e', driver],
  cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }, { id: 'negative', stdin: '[-5,3]', expect_json: -2 }] };
const checks = (extra = {}) => JSON.stringify({ goal: 'Repair calculator addition', criteria: [probe], ...extra }, null, 2) + '\n';
const fixed = 'export const add=(a,b)=>a+b;\n';
async function project(t, extra = {}, files = {}) {
  // fixture() commits calc.mjs (buggy: a-b), check.mjs and the given files as the base revision.
  const f = await fixture(t, { '.cstack/checks.json': checks(extra), ...files });
  return { ...f, checks: join(f.repo, '.cstack', 'checks.json') };
}
const verify = (f, options = {}) => verifyChange({ repo: f.repo, checks: f.checks, home: f.home, ...options });

test('VERIFY-01: a correct change in the working copy is verified without a model and without touching the repository', async t => {
  const f = await project(t);
  await writeFile(join(f.repo, 'calc.mjs'), fixed);
  await writeFile(join(f.repo, 'notes.txt'), 'untracked file written by the agent\n');
  const before = await captureOrigin(f.repo), index = await readFile(join(f.repo, '.git', 'index'));
  const r = await verify(f);
  assert.equal(r.outcome, 'done', r.reason); assert.equal(r.status, 'VERIFIED');
  assert.equal(r.baseline_reproduced, true); assert.deepEqual(r.checks.ADD, { required: true, kind: 'probe', baseline: 'FAIL', change: 'PASS' });
  assert.equal(r.model_invoked, false); assert.deepEqual(r.checks_file, { path: '.cstack/checks.json', source: 'base-revision', modified: false });
  assert.deepEqual(r.changed_paths, ['calc.mjs', 'notes.txt'], 'untracked, non-ignored files are part of the change');
  assert.deepEqual(await captureOrigin(f.repo), before, 'the working copy is unchanged');
  assert.deepEqual(await readFile(join(f.repo, '.git', 'index')), index, 'the index is unchanged');
  assert.match(await readFile(r.report, 'utf8'), /^Outcome: \*\*done\*\* \(VERIFIED\)$/m);
});

test('VERIFY-02: an agent claiming done with a wrong fix is reported as failed with the failing check', async t => {
  const f = await project(t);
  await writeFile(join(f.repo, 'calc.mjs'), 'export const add=(a,b)=>Math.abs(a)+b;\n// done: all tests pass\n');
  const r = await verify(f);
  assert.equal(r.outcome, 'failed'); assert.match(r.reason, /Required checks fail on this change: ADD \(FAIL\)/);
  assert.equal(r.failing[0].id, 'ADD'); assert.match(r.failing[0].diagnostic, /Expected -2/);
  assert.match(r.next_action, /Do not report done/);
});

test('VERIFY-03: no change, or checks that already pass on the base, are not completion', async t => {
  const idle = await project(t);
  const none = await verify(idle);
  assert.equal(none.outcome, 'failed'); assert.match(none.reason, /no changes relative to the base revision/);
  const weak = await project(t, { criteria: [{ ...probe, cases: [{ id: 'zero', stdin: '[0,0]', expect_json: 0 }] }] });
  await writeFile(join(weak.repo, 'calc.mjs'), fixed);
  const r = await verify(weak);
  assert.equal(r.outcome, 'needs_you'); assert.equal(r.status, 'ALREADY_SATISFIED'); assert.match(r.reason, /already pass on the base revision/);
});

test('VERIFY-04: a tests-only change cannot pass as an implementation', async t => {
  const f = await project(t, { criteria: [{ ...probe, cases: [{ id: 'zero', stdin: '[0,0]', expect_json: 0 }] }], type: 'REFACTOR' });
  await mkdir(join(f.repo, 'tests'), { recursive: true });
  await writeFile(join(f.repo, 'tests', 'extra.test.mjs'), "import test from 'node:test';test('extra',()=>{});\n");
  const r = await verify(f);
  assert.notEqual(r.outcome, 'done'); assert.match(r.reason, /Only tests, documentation or configuration changed/);
});

test('VERIFY-05: the change cannot weaken its own checks; editing them needs review', async t => {
  const weakened = await project(t);
  // The agent rewrites the expected outputs to match its broken implementation.
  await writeFile(weakened.checks, checks({ criteria: [{ ...probe, cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 2 }] }] }));
  const r = await verify(weakened);
  assert.equal(r.outcome, 'failed', 'the base version of the checks was used'); assert.equal(r.checks_file.modified, true);
  const edited = await project(t);
  await writeFile(join(edited.repo, 'calc.mjs'), fixed);
  await writeFile(edited.checks, checks({ goal: 'Repair calculator addition (edited)' }));
  const e = await verify(edited);
  assert.equal(e.outcome, 'needs_you'); assert.ok(e.review.pending.some(p => p.criterion === 'change-review' && p.paths.includes('.cstack/checks.json')));
});

test('VERIFY-06: checks inside the repository must be committed at the base revision', async t => {
  const f = await fixture(t);
  await mkdir(join(f.repo, '.cstack')); await writeFile(join(f.repo, '.cstack', 'checks.json'), checks());
  await assert.rejects(verifyChange({ repo: f.repo, checks: join(f.repo, '.cstack', 'checks.json'), home: f.home }), { code: 'CHECKS_NOT_FROZEN' });
  // Checks kept outside the repository are read as given.
  await rm(join(f.repo, '.cstack'), { recursive: true });
  const outside = join(f.root, 'checks.json'); await writeFile(outside, checks());
  await writeFile(join(f.repo, 'calc.mjs'), fixed);
  const r = await verifyChange({ repo: f.repo, checks: outside, home: f.home });
  assert.equal(r.outcome, 'done', r.reason); assert.equal(r.checks_file.source, 'outside-repository');
});

test('VERIFY-07: verify --check accepts only the exact verified tree with current evidence, including after commit', async t => {
  const f = await project(t);
  await writeFile(join(f.repo, 'calc.mjs'), fixed);
  const r = await verify(f); assert.equal(r.outcome, 'done', r.reason);
  assert.equal((await verifyCheck(r.id, { home: f.home })).outcome, 'done');
  await writeFile(join(f.repo, 'calc.mjs'), fixed + '// later edit\n');
  const drift = await verifyCheck(r.id, { home: f.home });
  assert.equal(drift.outcome, 'failed'); assert.equal(drift.tree_matches, false);
  await writeFile(join(f.repo, 'calc.mjs'), fixed);
  await git(f.repo, 'add', '-A'); await git(f.repo, 'commit', '-qm', 'agent change');
  const committed = await verifyCheck(r.id, { home: f.home });
  assert.equal(committed.outcome, 'done', committed.reason); assert.notEqual(committed.head, r.base);
  await rm(join(f.home, 'runs', r.id, 'evidence'), { recursive: true, force: true });
  assert.equal((await verifyCheck(r.id, { home: f.home })).status, 'STALE_EVIDENCE');
});

test('VERIFY-08: an already committed change is verified against an explicit base revision', async t => {
  const f = await project(t);
  const base = await git(f.repo, 'rev-parse', 'HEAD');
  await writeFile(join(f.repo, 'calc.mjs'), fixed); await git(f.repo, 'commit', '-qam', 'fix');
  const r = await verify(f, { base: 'HEAD~1' });
  assert.equal(r.outcome, 'done', r.reason); assert.equal(r.base, base);
  await assert.rejects(verify(f, { base: '--upload-pack=evil' }), { code: 'INVALID' });
  await assert.rejects(verify(f, { base: 'no-such-rev' }), { code: 'INVALID' });
});

test('VERIFY-09: a behavior-preserving refactor is verified when the preservation checks pass before and after', async t => {
  const f = await project(t, { type: 'REFACTOR', criteria: [{ ...probe, cases: [{ id: 'zero', stdin: '[0,0]', expect_json: 0 }] }] });
  await writeFile(join(f.repo, 'calc.mjs'), 'export function add(a, b) {\n  return a - b;\n}\n');
  const r = await verify(f);
  assert.equal(r.outcome, 'done', r.reason); assert.equal(r.checks.ADD.baseline, 'PASS');
});

test('VERIFY-10: a verify run has nothing to patch or apply', async t => {
  const f = await project(t);
  await writeFile(join(f.repo, 'calc.mjs'), fixed);
  const r = await verify(f);
  await assert.rejects(patchRun(r.id, join(f.root, 'patch'), { home: f.home }), { code: 'DELIVERY_NOT_APPLICABLE' });
  await assert.rejects(applyRun(r.id, { repo: f.repo, snapshot: 'x', home: f.home }), { code: 'DELIVERY_NOT_APPLICABLE' });
});

test('VERIFY-11: the CLI returns 0 for done, 2 for failed and 3 for needs-you', async t => {
  const run = async (f, args) => {
    const r = await command([process.execPath, cli, 'verify', '--repo', f.repo, ...args, '--format', 'json'], { env: cleanEnv({ CSTACK_HOME: f.home }), timeoutMs: 120000 });
    return { code: r.code, body: JSON.parse(r.stdout) };
  };
  const good = await project(t); await writeFile(join(good.repo, 'calc.mjs'), fixed);
  const done = await run(good, ['--checks', good.checks]); assert.equal(done.code, 0); assert.equal(done.body.outcome, 'done');
  const recheck = await run(good, ['--check', done.body.id]); assert.equal(recheck.code, 0);
  const bad = await project(t); const failed = await run(bad, ['--checks', bad.checks]); assert.equal(failed.code, 2);
  const weak = await project(t, { criteria: [{ ...probe, cases: [{ id: 'zero', stdin: '[0,0]', expect_json: 0 }] }] });
  await writeFile(join(weak.repo, 'calc.mjs'), fixed);
  assert.equal((await run(weak, ['--checks', weak.checks])).code, 3);
});

test('VERIFY-12: installed dependency folders are discovered and shared with the checks', async t => {
  const f = await project(t, {}, { '.gitignore': 'node_modules\n', 'calc.mjs': "import {offset} from 'offset-lib';export const add=(a,b)=>a-b+offset;\n" });
  await mkdir(join(f.repo, 'node_modules', 'offset-lib'), { recursive: true });
  await writeFile(join(f.repo, 'node_modules', 'offset-lib', 'package.json'), JSON.stringify({ name: 'offset-lib', type: 'module', exports: './index.js' }));
  await writeFile(join(f.repo, 'node_modules', 'offset-lib', 'index.js'), 'export const offset=0;\n');
  await writeFile(join(f.repo, 'calc.mjs'), "import {offset} from 'offset-lib';export const add=(a,b)=>a+b+offset;\n");
  const r = await verify(f);
  assert.deepEqual(r.dependencies, ['node_modules']); assert.equal(r.outcome, 'done', r.reason);
  assert.deepEqual(r.changed_paths, ['calc.mjs']);
});
