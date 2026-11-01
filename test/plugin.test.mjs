import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlugin } from '../scripts/build-plugin.mjs';
import { command } from '../src/process.mjs';
import { contract } from './helpers/fixture.mjs';

async function temporary(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cstack-plugin-test-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('PLUGIN-02 PLUGIN-03: built plugin runs after relocation without the source checkout or global cstack', async t => {
  const root = await temporary(t), built = await buildPlugin({ output: join(root, 'marketplace') });
  const moved = join(root, 'relocated with spaces'); await cp(built.pluginRoot, moved, { recursive: true });
  const helper = join(moved, 'skills/cstack/scripts/cstack.mjs');
  const cfg = join(root, 'contract.json'); await writeFile(cfg, JSON.stringify(contract()));
  const result = await command([process.execPath, helper, 'validate', '--contract', cfg], { cwd: root });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).valid, true);
  const info = JSON.parse(await readFile(join(moved, 'build-info.json'), 'utf8'));
  assert.ok(info.files.some(f => f.path === 'runtime/src/core.mjs'));
  assert.ok(info.files.every(f => !/(^|\/)(\.git|\.bench-work|auth\.json|bench|test)(\/|$)/.test(f.path)));
});
test('build is repeatable and refuses to overwrite an altered generated runtime', async t => {
  const root = await temporary(t), output = join(root, 'marketplace');
  const first = await buildPlugin({ output }), second = await buildPlugin({ output });
  assert.equal(first.sourceDigest, second.sourceDigest); assert.equal(first.pluginRoot, second.pluginRoot);
  const path = join(first.pluginRoot, 'runtime/src/core.mjs');
  await writeFile(path, '// user-altered generated copy\n');
  await assert.rejects(buildPlugin({ output }), /preserving/);
  assert.equal(await readFile(path, 'utf8'), '// user-altered generated copy\n');
});
test('PLUGIN-04: unexpected files in a generated bundle are preserved and rejected', async t => {
  const root = await temporary(t), output = join(root, 'marketplace');
  const built = await buildPlugin({ output });
  const extra = join(built.pluginRoot, 'private-not-for-distribution.json');
  await writeFile(extra, '{"keep":"user data"}');
  await assert.rejects(buildPlugin({ output }), /Unexpected generated plugin contents/);
  assert.equal(await readFile(extra, 'utf8'), '{"keep":"user data"}');
});

test('relocated analysis skills map Python and identify stack declarations without Docker or Codex', async t => {
  const root = await temporary(t), built = await buildPlugin({ output: join(root, 'marketplace') });
  const moved = join(root, 'relocated with spaces'), project = join(root, 'project');
  await cp(built.pluginRoot, moved, { recursive: true });
  const { mkdir } = await import('node:fs/promises'); await mkdir(project);
  await writeFile(join(project, 'app.py'), 'from helper import value\n');
  await writeFile(join(project, 'helper.py'), 'value=1\n');
  await writeFile(join(project, 'pyproject.toml'), '[project]\ndependencies=["flask>=2"]\n');
  const env = { PATH: '/usr/bin:/bin', CSTACK_CODEX_BIN: '/nonexistent/codex', DOCKER_HOST: 'unix:///nonexistent/docker.sock' };
  const graph = await command([process.execPath, join(moved, 'skills/graph-map/scripts/map.mjs'), '--repo', project, '--format', 'json'], { cwd: root, env });
  assert.equal(graph.code, 0, graph.stderr);
  assert.ok(JSON.parse(graph.stdout).edges.some(e => e.from === 'app.py' && e.to === 'helper.py'));
  const stack = await command([process.execPath, join(moved, 'skills/stack-analysis/scripts/analyze.mjs'), '--repo', project, '--out', join(root, 'stack-report')], { cwd: root, env });
  assert.equal(stack.code, 0, stack.stderr);
  assert.equal(JSON.parse(stack.stdout).status, 'ANALYZED');
  assert.ok(JSON.parse(await readFile(join(root, 'stack-report/stack.json'), 'utf8')).findings.some(f => f.name === 'Flask'));
});
