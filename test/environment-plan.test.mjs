import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers/fixture.mjs';
import { repository } from '../src/repository.mjs';
import { discoverProfile, profileShape } from '../src/project-profile.mjs';
import { checkEnvironment, discoverDependencies } from '../src/environment-plan.mjs';
import { setupProject } from '../src/setup.mjs';
import { captureOrigin } from '../src/snapshot.mjs';
import { command } from '../src/process.mjs';

async function venvProject(t, pytestSource) {
  const f = await fixture(t, { '.gitignore': '.venv\n', 'pyproject.toml': '[project]\nname = "calc"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n', 'calc.py': 'def add(a, b):\n    return a + b\n',
    'tests/test_calc.py': 'from calc import add\n\n\ndef test_add():\n    assert add(4, 2) == 6\n' });
  const made = await command(['python3', '-m', 'venv', '--without-pip', '--system-site-packages', join(f.repo, '.venv')], { timeoutMs: 60000 });
  if (made.code !== 0) { t.skip('python3 venv unavailable: ' + made.stderr.slice(0, 200)); return null; }
  if (pytestSource !== undefined) {
    // An isolated venv whose only "pytest" is the module given here.
    await writeFile(join(f.repo, '.venv', 'pyvenv.cfg'), (await (await import('node:fs/promises')).readFile(join(f.repo, '.venv', 'pyvenv.cfg'), 'utf8')).replace('include-system-site-packages = true', 'include-system-site-packages = false'));
    const lib = join(f.repo, '.venv', 'lib'), version = (await readdir(lib)).find(x => x.startsWith('python'));
    if (pytestSource) { await mkdir(join(lib, version, 'site-packages', 'pytest'), { recursive: true }); await writeFile(join(lib, version, 'site-packages', 'pytest', '__init__.py'), pytestSource); }
  }
  return f;
}

test('ENV-01 ENV-03: host readiness is probed inside the sandbox with the project interpreter, offline and without changes', async t => {
  const system = await command(['python3', '-c', 'import pytest;print(pytest.__version__)'], { timeoutMs: 10000 });
  if (system.code !== 0) return t.skip('system pytest unavailable');
  const f = await venvProject(t); if (!f) return;
  const before = await captureOrigin(f.repo), reader = await repository(f.repo);
  assert.deepEqual(await discoverDependencies(f.repo, '.', 'python'), ['.venv']);
  const profile = await discoverProfile(reader, { adapter: 'pytest' });
  assert.deepEqual(profile.environment, { mode: 'host', dependencies: ['.venv'], lockfiles: [] });
  const env = await checkEnvironment(profile, { cwd: f.repo });
  assert.equal(env.environment_ready, true); assert.equal(env.versions.adapter, 'pytest');
  assert.match(env.versions.executable, /\.venv\/bin\/python/, 'the linked virtual environment provides the interpreter');
  assert.deepEqual(env.dependencies.map(d => [d.path, d.kind]), [['.venv', 'python-venv']]);
  const setup = await setupProject(f.repo, { adapter: 'pytest', home: f.home });
  assert.equal(setup.ready, true, JSON.stringify(setup)); assert.deepEqual(setup.details.test.expected_tests, ['tests/test_calc.py::test_add']);
  assert.deepEqual(await captureOrigin(f.repo), before, 'setup never modifies the project');
});

test('ENV-06 ENV-07: missing or unsupported test runners stay non-runnable and cStack never installs them', async t => {
  const missing = await venvProject(t, null); if (!missing) return;
  const absent = await setupProject(missing.repo, { adapter: 'pytest', home: missing.home });
  assert.equal(absent.ready, false); assert.equal(absent.code, 'PROJECT_DEPENDENCY_MISSING'); assert.match(absent.next_action, /yourself/);
  const old = await venvProject(t, "__version__ = '6.2.5'\n");
  const unsupported = await setupProject(old.repo, { adapter: 'pytest', home: old.home });
  assert.equal(unsupported.ready, false); assert.equal(unsupported.code, 'TEST_RUNNER_VERSION_UNSUPPORTED');
  const node = await fixture(t, { '.gitignore': 'node_modules\n', 'package.json': '{"type":"module","devDependencies":{"vitest":"4.0.18"}}', 'tests/a.test.js': "import {test} from 'vitest';test('a',()=>{});" });
  const noModules = await setupProject(node.repo, { dependencies: ['node_modules'], adapter: 'vitest', home: node.home }).catch(e => ({ ready: false, code: e.code }));
  assert.equal(noModules.ready, false); assert.equal(noModules.code, 'PROJECT_DEPENDENCY_MISSING');
});

test('ENV-10: a cStack 0.5 Docker-image profile is refused with a rerun-setup instruction', () => {
  const old = { schema_version: 1, scope: '.', evidence: [], runtime: { kind: 'node', declared_version: null }, test: { adapter: 'none', roots: [], expected_tests: [], plugins: [] },
    environment: { mode: 'existing-image', image: 'node:22', lockfiles: [] }, conventions: [], readiness: 'ready', missing: [] };
  assert.throws(() => profileShape(old), { code: 'PROFILE_STALE', message: /rerun setup/ });
});
