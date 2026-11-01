import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { git } from '../../src/snapshot.mjs';
export const backend = process.env.CSTACK_TEST_RUNNER || (process.platform === 'linux' ? 'linux' : 'docker');
export const driver = "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';const [a,b]=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(add(a,b)));";
export const probe = { id: 'AC1', text: 'Addition returns the correct observable result', kind: 'probe',
  argv: ['node', '--input-type=module', '-e', driver], cases: [{ id: 'positive', stdin: '[4,2]', expect_json: 6 }, { id: 'negative', stdin: '[-5,3]', expect_json: -2 }] };
export const contract = (extra = {}) => ({ type: 'FIX', goal: 'Repair incorrect calculator addition', policy: 'lean', attempt_limit: 2,
  runner: { backend, ...(backend === 'docker' ? { image: process.env.CSTACK_TEST_IMAGE || 'node:22.16.0-bookworm-slim' } : {}) }, criteria: [probe], ...extra });
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
