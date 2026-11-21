import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, rm, symlink, readdir, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, scriptedUsage } from './helpers/fixture.mjs';
import { beginRun, processRun, effectiveStatus } from '../src/core.mjs';
import { createRunner } from '../src/sandbox.mjs';
import { resolveDependencies, treeDigest, sandboxPath } from '../src/environment.mjs';
import { codexArgs } from '../src/codex.mjs';
import { applyRun } from '../src/delivery.mjs';
import { git } from '../src/snapshot.mjs';

// A project whose behavior depends on packages that exist ONLY in its installed dependencies.
const files = { '.gitignore': 'node_modules/\n', 'calc.mjs': "import {offset} from 'offset-lib';export const add=(a,b)=>a-b+offset;\n" };
const probe = { id: 'AC1', kind: 'probe', text: 'Addition uses the installed library', argv: ['node', '--input-type=module', '-e', "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';const [a,b]=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(add(a,b)))"],
  cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }, { id: 'negative', stdin: '[-5,3]', expect_json: -2 }] };
const contract = (extra = {}) => ({ schema_version: 3, type: 'FIX', goal: 'Repair incorrect calculator addition', policy: 'lean', attempt_limit: 2,
  runner: { backend: 'host', dependencies: ['node_modules'] }, criteria: [probe], ...extra });
async function project(t) {
  const f = await fixture(t, files);
  await mkdir(join(f.repo, 'node_modules', 'offset-lib'), { recursive: true });
  await writeFile(join(f.repo, 'node_modules', 'offset-lib', 'package.json'), JSON.stringify({ name: 'offset-lib', type: 'module', exports: './index.js' }));
  await writeFile(join(f.repo, 'node_modules', 'offset-lib', 'index.js'), 'export const offset=0;\n');
  return f;
}
const fix = async ({ run }) => { await writeFile(join(run.worktree, 'calc.mjs'), "import {offset} from 'offset-lib';export const add=(a,b)=>a+b+offset;\n"); return { code: 0, ...scriptedUsage }; };

test('ENVHOST-01: worker and verifier share the project dependencies through a controller-owned link', async t => {
  const f = await project(t), run = await beginRun({ ...f, contract: contract() });
  const link = run.environment.links[0];
  assert.deepEqual([link.path, link.kind], ['node_modules', 'node-modules']);
  assert.equal(link.target, join(f.root, 'repo', 'node_modules'));
  assert.ok(run.initial_snapshot.entries.some(e => e.path === 'node_modules' && e.type === 'symlink' && e.environment));
  assert.ok(!run.initial_snapshot.entries.some(e => e.path.startsWith('node_modules/')), 'dependency contents are not candidate content');
  let workerSaw = null;
  await processRun(run, { home: f.home, worker: async x => {
    workerSaw = await readFile(join(x.run.worktree, 'node_modules', 'offset-lib', 'index.js'), 'utf8'); return fix(x);
  } });
  assert.equal(workerSaw, 'export const offset=0;\n', 'the worker sees the same installed dependency');
  assert.equal(run.baseline.AC1.status, 'FAIL'); assert.equal(run.results.AC1.status, 'PASS', run.reason);
  assert.equal(run.status, 'VERIFIED', run.reason);
});

test('ENVHOST-02: the worker shell PATH matches the verifier dependency bins', async t => {
  const f = await project(t), run = await beginRun({ ...f, contract: contract() });
  const args = codexArgs(run), setting = args[args.indexOf('shell_environment_policy.set={ PATH = ' + JSON.stringify(sandboxPath(run.environment.links)) + ' }')];
  assert.ok(setting, 'worker PATH includes ' + sandboxPath(run.environment.links));
  assert.ok(sandboxPath(run.environment.links).startsWith(join(f.repo, 'node_modules', '.bin')));
});

test('ENVHOST-03: replacing or retargeting a dependency link blocks the run', async t => {
  for (const tamper of ['replace', 'retarget', 'remove']) {
    const f = await project(t), run = await beginRun({ ...f, contract: contract() });
    await processRun(run, { home: f.home, worker: async x => {
      const path = join(x.run.worktree, 'node_modules');
      await rm(path, { force: true });
      if (tamper === 'replace') { await mkdir(join(path, 'offset-lib'), { recursive: true }); await writeFile(join(path, 'offset-lib', 'index.js'), 'export const offset=2;\n'); }
      if (tamper === 'retarget') { await mkdir(join(f.root, 'evil'), { recursive: true }); await symlink(join(f.root, 'evil'), path); }
      return fix(x);
    } });
    assert.equal(run.status, 'BLOCKED', tamper); assert.match(run.reason, /Dependency link|replaced|changed or removed/, tamper);
  }
});

test('ENVHOST-04: only git-ignored, untracked dependency folders can be shared', async t => {
  const f = await fixture(t, { 'calc.mjs': 'export const add=(a,b)=>a-b;\n' });
  await assert.rejects(resolveDependencies(f.repo, ['node_modules']), { code: 'PROJECT_DEPENDENCY_MISSING', message: /never installs them/ });
  await mkdir(join(f.repo, 'node_modules'));
  await assert.rejects(resolveDependencies(f.repo, ['node_modules']), { code: 'ENVIRONMENT_UNSAFE', message: /git-ignored/ });
  const g = await fixture(t, { 'vendor/lib.js': 'x', '.gitignore': 'vendor/\n' });
  await assert.rejects(resolveDependencies(g.repo, ['vendor']), { code: 'ENVIRONMENT_UNSAFE', message: /tracked files/ });
  const { normalizeContract } = await import('../src/contracts.mjs');
  for (const bad of ['../outside', '/abs', '.git', 'node_modules/']) assert.throws(() => normalizeContract(contract({ runner: { backend: 'host', dependencies: [bad] } })), bad);
  assert.throws(() => normalizeContract(contract({ runner: { backend: 'host', dependencies: ['a', 'a/b'] } })), /nested/);
});

test('ENVHOST-05: a dependency change after verification makes the evidence stale; delivery excludes the link', async t => {
  const f = await project(t), run = await beginRun({ ...f, contract: contract() });
  await processRun(run, { home: f.home, worker: fix });
  assert.equal(await effectiveStatus(run), 'VERIFIED', run.reason);
  const result = await applyRun(run.id, { repo: f.repo, snapshot: run.snapshot.source_digest, home: f.home });
  assert.equal(result.status, 'APPLIED');
  assert.equal(await readFile(join(f.repo, 'node_modules', 'offset-lib', 'index.js'), 'utf8'), 'export const offset=0;\n', 'delivery never touches dependencies');
  assert.deepEqual((await git(f.repo, 'status', '--porcelain')).split('\n').filter(Boolean).map(x => x.slice(3)), ['calc.mjs']);
  const before = await treeDigest(join(f.repo, 'node_modules'));
  await writeFile(join(f.repo, 'node_modules', 'offset-lib', 'index.js'), 'export const offset=1;\n');
  const later = new Date(Date.now() + 5000); await utimes(join(f.repo, 'node_modules', 'offset-lib', 'index.js'), later, later);
  assert.notEqual(await treeDigest(join(f.repo, 'node_modules')), before);
  assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
  const runner = await createRunner(run.contract.runner, { environment: run.environment });
  assert.notEqual(runner.identity, run.runner_identity, 'a dependency change is a different environment');
});

test('ENVHOST-06: a Python virtual environment provides the interpreter and packages to the verifier', async t => {
  const f = await fixture(t, { '.gitignore': '.venv/\n', 'calc.py': 'from offset_lib import OFFSET\n\ndef add(a, b):\n    return a - b + OFFSET\n' });
  const created = await (await import('../src/process.mjs')).command(['python3', '-m', 'venv', '--without-pip', join(f.repo, '.venv')], { timeoutMs: 60000 });
  if (created.code !== 0) return t.skip('python3 venv unavailable: ' + created.stderr.slice(0, 200));
  const lib = join(f.repo, '.venv', 'lib'), version = (await readdir(lib)).find(x => x.startsWith('python'));
  await writeFile(join(lib, version, 'site-packages', 'offset_lib.py'), 'OFFSET = 0\n');
  const c = { ...contract(), runner: { backend: 'host', dependencies: ['.venv'] }, criteria: [{ id: 'AC1', kind: 'probe', text: 'Addition uses the venv library',
    argv: ['python', '-I', '-B', '-c', "import json,sys;sys.path.insert(0,'.');from calc import add;a,b=json.load(sys.stdin);print(json.dumps(add(a,b)))"],
    cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }] }] };
  const run = await beginRun({ ...f, contract: c });
  assert.equal(run.environment.links[0].kind, 'python-venv');
  await processRun(run, { home: f.home, worker: async ({ run }) => { await writeFile(join(run.worktree, 'calc.py'), 'from offset_lib import OFFSET\n\ndef add(a, b):\n    return a + b + OFFSET\n'); return { code: 0, ...scriptedUsage }; } });
  assert.equal(run.baseline.AC1.status, 'FAIL'); assert.equal(run.results.AC1.status, 'PASS', JSON.stringify(run.results.AC1.diagnostic));
});
