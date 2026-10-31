#!/usr/bin/env node
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { beginRun, processRun, loadRun, normalizeContract, effectiveStatus, writeReport, approveRun, exportCandidate, dataHome } from './core.mjs';
import { createRunner } from './sandbox.mjs';
import { preflightCodex, usageTotals } from './codex.mjs';
import { manifest } from './snapshot.mjs';
import { hash, json, requireThat } from './util.mjs';
const help = `cStack 0.2 — single-worker, evidence-gated engineering

cstack doctor [--runner docker|linux] [--image IMAGE]
cstack init "Observable goal" --out /outside/repo/contract.json [--runner docker|linux]
cstack validate --contract /path/contract.json
cstack input-digest /absolute/dependency-bundle
cstack run ["Goal matching contract"] --repo /path/repo --contract /path/contract.json
cstack status RUN_ID
cstack resume RUN_ID
cstack evidence RUN_ID --criterion AC1
cstack approve RUN_ID --criterion AC1|change-review|outcome --snapshot SHA256 --note "Human evidence"
cstack report RUN_ID
cstack export RUN_ID --out /new/export/directory

Defaults: Docker verification, no network, no host fallback, ChatGPT Codex auth only.
Linux namespaces are an explicitly selected alternative. Native Windows: use WSL2.
Contracts are frozen. Resume never increases budgets. No automatic push/deployment.
`;
function options(args) {
  const flags = {}, rest = [];
  const known = new Set(['help', 'repo', 'contract', 'runner', 'image', 'out', 'criterion', 'snapshot', 'note']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { rest.push(args[i]); continue; }
    const key = args[i].slice(2); requireThat(known.has(key), 'Unknown option --' + key);
    if (key === 'help') flags[key] = true;
    else { requireThat(args[i + 1] && !args[i + 1].startsWith('--'), 'Missing value for --' + key); flags[key] = args[++i]; }
  }
  return { flags, rest };
}
async function main() {
  const [op, ...args] = process.argv.slice(2), { flags, rest } = options(args);
  if (!op || flags.help || op === 'help' || op === '--help') { console.log(help); return; }
  if (op === 'input-digest') { requireThat(rest[0], 'Bundle directory is required'); console.log(hash(json(await manifest(resolve(rest[0]))))); return; }
  if (op === 'init') {
    requireThat(rest.length && flags.out, 'Specify an observable goal and --out outside the target repository');
    const draft = { schema_version: 2, draft: true, type: 'FIX', goal: rest.join(' '), policy: 'lean', runner: { backend: flags.runner || 'docker' },
      criteria: [{ id: 'AC1', kind: 'manual', text: 'Replace this with the specific outcome and an external probe or deliberate human check.' }] };
    await writeFile(resolve(flags.out), json(draft), { flag: 'wx', mode: 0o600 });
    console.log('Draft created: ' + resolve(flags.out) + '\nReview criteria, add observable probes, then set draft=false. Drafts cannot execute.'); return;
  }
  if (op === 'doctor') {
    const report = { node: process.version, platform: process.platform, remaining_subscription_allowance: 'unknown' };
    const temp = await mkdtemp(join(tmpdir(), 'cstack-doctor-'));
    try {
      try {
        const runner = await createRunner({ backend: flags.runner || 'docker', image: flags.image });
        const health = await runner.execute(['/bin/sh', '-c', 'printf cstack-isolated'], { cwd: temp, timeoutMs: 5000 });
        requireThat(health.code === 0 && health.stdout === 'cstack-isolated', health.stderr || 'Isolation probe failed');
        report.verification = { ready: true, backend: runner.backend, identity: runner.identity };
      } catch (e) { report.verification = { ready: false, reason: e.message }; }
      try { report.codex = { ready: true, ...(await preflightCodex()) }; } catch (e) { report.codex = { ready: false, reason: e.message }; }
      console.log(json(report)); if (!report.verification.ready || !report.codex.ready) process.exitCode = 2;
    } finally { await rm(temp, { recursive: true, force: true }); } return;
  }
  if (op === 'validate' || op === 'run') {
    requireThat(flags.contract, '--contract is required'); const c = normalizeContract(JSON.parse(await readFile(resolve(flags.contract), 'utf8')));
    if (op === 'validate') { console.log(json({ valid: true, goal: c.goal, required: c.criteria.filter(x => x.required).length, runner: c.runner })); return; }
    requireThat(!rest.length || rest.join(' ') === c.goal, 'Goal differs from the frozen contract');
    const run = await beginRun({ repo: resolve(flags.repo || '.'), contract: c });
    console.log('Run: ' + run.id + '\nWorktree: ' + run.worktree); await execute(run); return;
  }
  requireThat(rest[0], 'Run ID required'); const run = await loadRun(rest[0]);
  if (op === 'status') {
    console.log(json({ id: run.id, status: await effectiveStatus(run), goal: run.contract.goal, candidate: run.snapshot?.source_digest,
      attempts: run.attempts.length, tasks: run.tasks, usage: usageTotals(run.usage), allowance_remaining: 'unknown', reason: run.reason, worktree: run.worktree })); return;
  }
  if (op === 'report') { console.log(await writeReport(run)); return; }
  if (op === 'resume') { await execute(run); return; }
  if (op === 'approve') {
    await approveRun(run.id, { criterion: flags.criterion, snapshot: flags.snapshot, note: flags.note });
    console.log('Human approval recorded. Resume rechecks the candidate; approval does not override failed automated checks.'); return;
  }
  if (op === 'evidence') {
    const proof = run.results[flags.criterion]; requireThat(proof?.output_hash && /^[a-f0-9]{64}$/.test(proof.output_hash), 'No recorded command evidence for this criterion');
    console.log(await readFile(join(dataHome(), 'runs', run.id, 'evidence', proof.output_hash + '.log'), 'utf8')); return;
  }
  if (op === 'export') { requireThat(flags.out, '--out required'); console.log(await exportCandidate(run.id, flags.out)); return; }
  throw new Error('Unknown command: ' + op);
}
async function execute(run) {
  const abort = new AbortController(), cancel = () => abort.abort(); process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const result = await processRun(run, { signal: abort.signal, onEvent: e => {
      if (['attempt_reserved', 'worker_finished', 'verified_candidate', 'run_stopped'].includes(e.kind)) console.error(`${e.kind}: ${e.status}; reserved attempts ${e.attempts}`);
    } });
    const status = await effectiveStatus(result);
    console.log(json({ id: result.id, status, reason: result.reason, report: join(dataHome(), 'runs', result.id, 'report.md') }));
    if (!['VERIFIED', 'INVESTIGATED'].includes(status)) process.exitCode = 2;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
main().catch(e => { console.error('cStack: ' + e.message); process.exitCode = 1; });
