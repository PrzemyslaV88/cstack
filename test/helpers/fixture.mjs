import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { git } from '../../src/snapshot.mjs';
export const backend = 'host';
export const driver = "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';const [a,b]=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(add(a,b)));";
export const probe = { id: 'AC1', text: 'Addition returns the correct observable result', kind: 'probe',
  argv: ['node', '--input-type=module', '-e', driver], cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }, { id: 'negative', stdin: '[-5,3]', expect_json: -2 }] };
export const contract = (extra = {}) => ({ type: 'FIX', goal: 'Repair incorrect calculator addition', policy: 'lean', attempt_limit: 2,
  runner: { backend }, criteria: [probe], ...extra });
export async function fixture(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cstack-v2-test-')), repo = join(root, 'repo'), home = join(root, 'state'); await mkdir(repo);
  await git(repo, 'init', '-q'); await git(repo, 'config', 'user.name', 'cStack Test'); await git(repo, 'config', 'user.email', 'test@example.invalid');
  for (const [p, content] of Object.entries({ 'calc.mjs': 'export const add=(a,b)=>a-b;\n', 'check.mjs': "import test from 'node:test';import assert from 'node:assert/strict';import {add} from './calc.mjs';test('add',()=>assert.equal(add(4,2),6));\n", ...files })) {
    await mkdir(dirname(join(repo, p)), { recursive: true }); await writeFile(join(repo, p), content);
  }
  await git(repo, 'add', '-f', '.'); await git(repo, 'commit', '-qm', 'baseline');
  t.after(() => rm(root, { recursive: true, force: true })); return { root, repo, home };
}
export const scriptedUsage = {accounting_source:'scripted', usage:[{input_tokens:0,output_tokens:0}]};
export const edit = source => async ({ run }) => { await writeFile(join(run.worktree, 'calc.mjs'), source); return { code: 0, ...scriptedUsage }; };
export const correct = edit('export const add=(a,b)=>a+b;\n');
// Vitest needs real installed packages. Point CSTACK_TEST_VITEST_MODULES at a node_modules folder
// containing Vitest 4 (for example `npm ci` in test/fixtures/environments/vitest); otherwise skip.
export async function linkVitest(t, repo) {
  const modules = process.env.CSTACK_TEST_VITEST_MODULES;
  if (!modules) { t.skip('Set CSTACK_TEST_VITEST_MODULES to an installed Vitest 4 node_modules folder'); return null; }
  const { symlink, realpath } = await import('node:fs/promises');
  const { resolveDependencies } = await import('../../src/environment.mjs');
  await symlink(await realpath(modules), join(repo, 'node_modules'));
  return { links: await resolveDependencies(repo, ['node_modules']) };
}
// Native plugin discovery needs a real Codex CLI; skip with a reason when it is not installed.
export async function needCodexCli(t) {
  const { command } = await import('../../src/process.mjs');
  const r = await command([process.env.CSTACK_CODEX_BIN || 'codex', '--version'], { timeoutMs: 10000 }).catch(() => ({ code: 127 }));
  if (r.code !== 0) { t.skip('Codex CLI not installed; native plugin discovery cannot run'); return false; }
  return true;
}
