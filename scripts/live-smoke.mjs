// Explicit opt-in: consumes a bounded real ChatGPT-authenticated Codex invocation.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/snapshot.mjs';
import { beginRun, processRun, effectiveStatus } from '../src/core.mjs';
const root = await mkdtemp(join(tmpdir(), 'cstack-live-')), repo = join(root, 'repo'); await mkdir(repo);
await git(repo, 'init', '-q'); await git(repo, 'config', 'user.name', 'cStack Smoke'); await git(repo, 'config', 'user.email', 'smoke@example.invalid');
await writeFile(join(repo, 'calc.mjs'), 'export const add=(a,b)=>a-b;\n'); await git(repo, 'add', '.'); await git(repo, 'commit', '-qm', 'Seed a reproducible defect');
const contract = { goal: 'Fix the addition function so it adds rather than subtracts', type: 'FIX', attempt_limit: 1,
  runner: { backend: process.env.CSTACK_LIVE_RUNNER || 'docker' }, budget: { max_attempts: 1, max_active_ms: 180000, worker_timeout_ms: 120000 },
  criteria: [{ id: 'ADD', kind: 'probe', text: 'Addition returns the right result for mixed signs',
    argv: ['node', '--input-type=module', '-e', "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';const a=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(add(...a)))"],
    cases: [{ stdin: '[9,4]', expect_json: 13 }, { stdin: '[-2,3]', expect_json: 1 }] }] };
const run = await beginRun({ repo, contract }); console.log('Explicit live run: ' + run.id);
await processRun(run); console.log(JSON.stringify({ status: await effectiveStatus(run), reason: run.reason, worktree: run.worktree }, null, 2));
if (await effectiveStatus(run) !== 'VERIFIED') process.exitCode = 2;
