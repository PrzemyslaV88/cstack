import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, chmod, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginRun, processRun, effectiveStatus, command } from '../src/core.mjs';
import { cleanEnv } from '../src/process.mjs';
import { manifest } from '../src/snapshot.mjs';
import { hash, json } from '../src/util.mjs';
import { createRunner } from '../src/sandbox.mjs';
import { fixture, contract, correct, backend } from './helpers/fixture.mjs';
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));

test('CLI lifecycle exercises real persistence and isolated verification with a synthetic Codex protocol executable', async t => {
  const f = await fixture(t), binary = join(f.root, 'codex-fixture'), received = join(f.root, 'received.json');
  const script = `#!/usr/bin/env node
import {writeFileSync} from 'node:fs';import {join} from 'node:path';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('--ignore-user-config --ignore-rules');}
else if(args.includes('features')){if(args.includes('--ignore-user-config')||args.includes('--ignore-rules'))process.exit(2);for(const f of ['multi_agent','multi_agent_v2','hooks','plugins','apps','goals'])console.log(f+' stable false');}
else if(args.includes('login'))console.log('Logged in using ChatGPT');
else{if(args.indexOf('--ignore-user-config')<args.indexOf('exec'))process.exit(2);writeFileSync(${JSON.stringify(received)},JSON.stringify({args,apiKeyPresent:Boolean(process.env.OPENAI_API_KEY)}));
writeFileSync(join(args[args.indexOf('--cd')+1],'calc.mjs'),'export const add=(a,b)=>a+b;');
console.log(JSON.stringify({type:'thread.started',thread_id:'fixture-session'}));
console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Fixed quota-related accounting too'}}));
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:90,output_tokens:20}}));}
`;
  await writeFile(binary, script); await chmod(binary, 0o755);
  const path = join(f.root, 'contract.json'); await writeFile(path, json(contract()));
  const env = cleanEnv({ CSTACK_HOME: f.home, CSTACK_CODEX_BIN: binary, OPENAI_API_KEY: 'synthetic-not-a-real-key',
    ...(process.env.DOCKER_CONTEXT ? { DOCKER_CONTEXT: process.env.DOCKER_CONTEXT } : {}),
    ...(process.env.DOCKER_HOST ? { DOCKER_HOST: process.env.DOCKER_HOST } : {}) });
  const start = await command([process.execPath, cli, 'run', '--repo', f.repo, '--contract', path], { env, timeoutMs: 15000 });
  assert.equal(start.code, 0, start.stderr + start.stdout); assert.match(start.stdout, /"status": "VERIFIED"/);
  const id = start.stdout.match(/Run: ([A-Za-z0-9-]+)/)[1];
  const record = JSON.parse(await readFile(received, 'utf8')); assert.equal(record.apiKeyPresent, false); assert.ok(record.args.includes('forced_login_method="chatgpt"'));
  const status = await command([process.execPath, cli, 'status', id], { env }); const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.usage.observed_total_tokens, 120); assert.equal(parsed.allowance_remaining, 'unknown');
  const evidence = await command([process.execPath, cli, 'evidence', id, '--criterion', 'AC1'], { env }); assert.equal(evidence.code, 0); assert.match(evidence.stdout, /Case positive/);
  const exported = await command([process.execPath, cli, 'export', id, '--out', join(f.root, 'handoff')], { env }); assert.equal(exported.code, 0, exported.stderr);
});
test('CLI init produces a non-executable draft rather than weak automatic acceptance', async t => {
  const f = await fixture(t), destination = join(f.root, 'draft.json');
  const result = await command([process.execPath, cli, 'init', 'Fix calculator output', '--out', destination]); assert.equal(result.code, 0);
  const validate = await command([process.execPath, cli, 'validate', '--contract', destination]); assert.notEqual(validate.code, 0); assert.match(validate.stderr, /Review the draft/);
});
test('unknown CLI options are rejected rather than silently ignored', async () => {
  const result = await command([process.execPath, cli, 'run', '--unlimited', 'yes']); assert.equal(result.code, 1); assert.match(result.stderr, /Unknown option/);
});
test('explicit pinned dependency bundles work for an otherwise clean worktree', async t => {
  const f = await fixture(t, { '.gitignore': 'node_modules/\n', 'calc.mjs': "import {offset} from 'local-fixture-dependency';export const add=(a,b)=>a-b+offset;" });
  const bundle = join(f.root, 'offline-dependencies'); await mkdir(join(bundle, 'local-fixture-dependency'), { recursive: true });
  await writeFile(join(bundle, 'local-fixture-dependency', 'package.json'), '{"name":"local-fixture-dependency","type":"module","exports":"./index.js"}');
  await writeFile(join(bundle, 'local-fixture-dependency', 'index.js'), 'export const offset=0;');
  const cfg = contract({ workspace_inputs: [{ source: bundle, destination: 'node_modules', digest: hash(json(await manifest(bundle))) }] });
  const run = await beginRun({ ...f, contract: cfg });
  await processRun(run, { home: f.home, worker: async ({ run }) => { await writeFile(join(run.worktree, 'calc.mjs'), "import {offset} from 'local-fixture-dependency';export const add=(a,b)=>a+b+offset;"); return { code: 0 }; } });
  assert.equal(run.status, 'VERIFIED'); assert.deepEqual(run.changed_paths, ['calc.mjs']);
  await writeFile(join(run.worktree, 'node_modules', 'local-fixture-dependency', 'index.js'), 'export const offset=99;'); assert.equal(await effectiveStatus(run), 'STALE_EVIDENCE');
});
test('changed dependency bundle cannot enter a run under its previous digest', async t => {
  const f = await fixture(t), bundle = join(f.root, 'bundle'); await mkdir(bundle); await writeFile(join(bundle, 'input.json'), '{}');
  const digest = hash(json(await manifest(bundle))); await writeFile(join(bundle, 'input.json'), '{"altered":true}');
  await assert.rejects(beginRun({ ...f, contract: contract({ workspace_inputs: [{ source: bundle, destination: 'deps', digest }] }) }), /digest mismatch/);
});
test('Docker adapter pins image ID, restricts capabilities/resources, and always requests cleanup', async t => {
  const f = await fixture(t), calls = [];
  const previous = { DOCKER_HOST: process.env.DOCKER_HOST, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  t.after(() => { for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  process.env.DOCKER_HOST = 'unix:///tmp/cstack-test-docker.sock';
  process.env.OPENAI_API_KEY = 'synthetic-not-a-real-key';
  const control = async (args, opts) => {
    calls.push({ args, opts });
    if (args.includes('inspect')) return { code: 0, stdout: 'sha256:' + 'a'.repeat(64), stderr: '' };
    return { code: 0, stdout: 'ok', stderr: '' };
  };
  const runner = await createRunner({ backend: 'docker' }, { control });
  const alias = join(f.root, 'repo-link'); await symlink(await realpath(f.repo), alias, 'dir');
  await runner.execute(['node', '-e', 'console.log(1)'], { cwd: alias, timeoutMs: 1000 });
  const launch = calls.find(c => c.args[1] === 'run');
  for (const flag of ['--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=128', '--memory=1g', '--pull=never']) assert.ok(launch.args.includes(flag), flag);
  assert.ok(launch.args.includes('sha256:' + 'a'.repeat(64))); assert.ok(calls.some(c => c.args[1] === 'rm'));
  assert.equal(launch.opts.env.OPENAI_API_KEY, undefined);
  assert.ok(calls.every(c => c.opts.env.DOCKER_HOST === process.env.DOCKER_HOST));
  assert.ok(launch.args.includes(`type=bind,src=${await realpath(f.repo)},dst=/candidate,readonly`));
});
