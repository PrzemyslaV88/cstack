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
  const env = { PATH: '/usr/bin:/bin', CSTACK_CODEX_BIN: '/nonexistent/codex' };
  const graph = await command([process.execPath, join(moved, 'skills/graph-map/scripts/map.mjs'), '--repo', project, '--format', 'json'], { cwd: root, env });
  assert.equal(graph.code, 0, graph.stderr);
  assert.ok(JSON.parse(graph.stdout).edges.some(e => e.from === 'app.py' && e.to === 'helper.py'));
  const stack = await command([process.execPath, join(moved, 'skills/stack-analysis/scripts/analyze.mjs'), '--repo', project, '--out', join(root, 'stack-report')], { cwd: root, env });
  assert.equal(stack.code, 0, stack.stderr);
  assert.equal(JSON.parse(stack.stdout).status, 'ANALYZED');
  assert.ok(JSON.parse(await readFile(join(root, 'stack-report/stack.json'), 'utf8')).findings.some(f => f.name === 'Flask'));
});

test('VERIFY-13: the relocated verify skill gates an existing change without the source checkout or Codex', async t => {
  const { fixture } = await import('./helpers/fixture.mjs'), { cleanEnv } = await import('../src/process.mjs');
  const root = await temporary(t), built = await buildPlugin({ output: join(root, 'marketplace') });
  const moved = join(root, 'relocated with spaces'); await cp(built.pluginRoot, moved, { recursive: true });
  const f = await fixture(t), checks = join(f.root, 'checks.json');
  await writeFile(checks, JSON.stringify({ criteria: [contract().criteria[0]] }));
  const verify = join(moved, 'skills/verify/scripts/verify.mjs');
  const env = cleanEnv({ CSTACK_HOME: f.home, CSTACK_CODEX_BIN: '/nonexistent/codex' });
  const run = args => command([process.execPath, verify, ...args, '--format', 'json'], { cwd: root, env, timeoutMs: 120000 });
  const broken = await run(['--repo', f.repo, '--checks', checks]);
  assert.equal(broken.code, 2, broken.stderr); assert.equal(JSON.parse(broken.stdout).outcome, 'failed');
  await writeFile(join(f.repo, 'calc.mjs'), 'export const add=(a,b)=>a+b;\n');
  const done = await run(['--repo', f.repo, '--checks', checks]);
  assert.equal(done.code, 0, done.stderr + done.stdout); const body = JSON.parse(done.stdout);
  assert.equal(body.outcome, 'done'); assert.equal(body.model_invoked, false);
  assert.ok(body.report.startsWith(f.home));
});

test('CLAUDE-PLUGIN-01: Claude Code manifests follow the documented plugin and marketplace rules', async t => {
  const { access, stat } = await import('node:fs/promises'), { constants } = await import('node:fs');
  const repo = join(import.meta.dirname, '..'), pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const checkPlugin = async (root, manifest) => {
    assert.equal(manifest.name, 'cstack'); assert.match(manifest.name, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.equal(manifest.version, pkg.version);
    assert.equal(manifest.license, 'MIT'); new URL(manifest.homepage);
    for (const p of [].concat(manifest.skills || [])) { assert.match(p, /^\.\//); assert.ok(!p.includes('..')); await access(join(root, p)); }
    const skills = manifest.skills ? join(root, [].concat(manifest.skills)[0]) : join(root, 'skills');
    for (const name of ['cstack', 'verify', 'graph-map', 'impact-analysis', 'stack-analysis']) {
      const text = await readFile(join(skills, name, 'SKILL.md'), 'utf8'); assert.match(text, /^---\nname: [a-z-]+\ndescription: .{20,}/, name);
    }
  };
  // Repository root: a one-plugin marketplace whose plugin root is the repository itself.
  const marketplace = JSON.parse(await readFile(join(repo, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(marketplace.name, 'cstack'); assert.ok(marketplace.owner.name);
  assert.deepEqual(marketplace.plugins.map(p => [p.name, p.source]), [['cstack', './']]);
  await checkPlugin(repo, JSON.parse(await readFile(join(repo, '.claude-plugin/plugin.json'), 'utf8')));
  assert.ok((await stat(join(repo, 'bin/cstack'))).mode & constants.S_IXUSR);
  // Built bundle: the Claude marketplace sits beside the Codex catalog and points at the bundle.
  const root = await temporary(t), built = await buildPlugin({ output: join(root, 'marketplace') });
  const local = JSON.parse(await readFile(join(built.marketplaceRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(local.plugins[0].name, 'cstack'); assert.match(local.plugins[0].source, /^\.\/plugins\/cstack-/);
  assert.equal(join(built.marketplaceRoot, local.plugins[0].source), built.pluginRoot);
  await checkPlugin(built.pluginRoot, JSON.parse(await readFile(join(built.pluginRoot, '.claude-plugin/plugin.json'), 'utf8')));
  const help = await command([join(built.pluginRoot, 'bin/cstack'), '--help'], { cwd: root });
  assert.equal(help.code, 0); assert.match(help.stdout, /cstack verify/);
  const fromCheckout = await command([process.execPath, join(repo, 'plugin/skills/verify/scripts/verify.mjs'), '--help'], { cwd: root });
  assert.equal(fromCheckout.code, 0, 'a repository install runs the skills against src/ without a build');
});
