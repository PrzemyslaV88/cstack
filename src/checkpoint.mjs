import { mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { digestOf, json, requireThat, redact } from './util.mjs';
import { readJson } from './artifacts.mjs';
import { accountingForRun } from './usage.mjs';

export function checkpointRecord(run, reason) {
  return { schema_version: 1, run_id: run.id, reason, phase: run.phase || null,
    contract_digest: run.contract_hash, workflow_digest: run.workflow_digest, preparation_digest: run.preparation_digest || null,
    candidate: run.snapshot?.source_digest || run.initial_snapshot.source_digest,
    environment: run.runner_identity || null, event_seq: run.event_seq,
    tasks: { ...run.tasks }, attempts: run.attempts.length, spent_ms: run.spent_ms,
    accounting: accountingForRun(run.attempts),
    evidence: Object.fromEntries(Object.entries(run.results).map(([id, p]) => [id,
      { status: p.status, candidate: p.fingerprint || null, evidence_hash: p.evidence_hash || null, output_hash: p.output_hash || null }])),
    session: run.session ? { ...run.session, thread_id: run.thread_id } : null,
    notes: run.attempts.filter(a => a.notes?.status === 'accepted').map(a => ({ attempt: a.id, task: a.task_id, value: a.notes.value }))
  };
}

export async function saveCheckpoint(run, home, reason) {
  const value = checkpointRecord(run, reason), digest = digestOf(value);
  const dir = join(home, 'runs', run.id, 'checkpoints'), path = join(dir, digest + '.json');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(path, 'wx', 0o600);
    await handle.writeFile(json(value));
    await handle.sync();
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    requireThat(digestOf(await readJson(path)) === digest, 'Checkpoint artifact changed', 'CHECKPOINT_INTEGRITY');
  } finally { await handle?.close(); }
  const directory = await open(dir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  return { schema_version: 1, digest };
}

export async function loadCheckpoint(run, home) {
  if (!run.checkpoint) return null;
  const digest = run.checkpoint.digest;
  requireThat(run.checkpoint.schema_version === 1 && /^[a-f0-9]{64}$/.test(digest), 'Invalid checkpoint pointer', 'CHECKPOINT_INTEGRITY');
  try {
    const value = await readJson(join(home, 'runs', run.id, 'checkpoints', digest + '.json'));
    requireThat(digestOf(value) === digest && value.schema_version === 1 && value.run_id === run.id &&
      value.contract_digest === run.contract_hash && value.workflow_digest === run.workflow_digest && value.preparation_digest === (run.preparation_digest || null),
    'Checkpoint identity changed', 'CHECKPOINT_INTEGRITY');
    return value;
  } catch (e) {
    const error = new Error('Checkpoint unavailable: ' + redact(e.message));
    error.code = 'CHECKPOINT_INTEGRITY'; throw error;
  }
}

export async function recoverCheckpoint(id, expectedSnapshot, home) {
  const { loadRun, lockRun, unlockRun, commitRun, exportState } = await import('./store.mjs');
  const { fingerprint } = await import('./snapshot.mjs');
  const token=lockRun(id,home);
  try {
    const run=await loadRun(id,home);
    requireThat(run.workflow&&!run.active,'Checkpoint recovery requires an inactive workflow run');
    requireThat(expectedSnapshot===run.snapshot?.source_digest&&await fingerprint(run.worktree,run.contract)===expectedSnapshot,
      'Checkpoint recovery snapshot changed; preserve and inspect the candidate','SOURCE_DIVERGED');
    const previous=run.checkpoint?.digest||null;
    run.thread_id=null;run.context_sent=null;run.session=null;run.phase='recovery';
    run.checkpoint=await saveCheckpoint(run,home,'explicit-recovery-from-controller-state');
    commitRun(run,'checkpoint_recovered',{previous,digest:run.checkpoint.digest},home,token);
    await exportState(run,home);
    return {run_id:id,digest:run.checkpoint.digest,snapshot:expectedSnapshot,
      next_action:'Resume to reverify the candidate. Recovery preserves all attempts, usage and review gates.'};
  } finally {unlockRun(id,token,home);}
}

export function contextPacket(run, task, remainingMs) {
  const required = run.contract.criteria.filter(c => c.required);
  const relevant = new Set([task.id, ...task.depends_on]);
  const notes = run.attempts.filter(a => relevant.has(a.task_id) && a.notes?.status === 'accepted');
  const facts = {
    run: run.id, phase: run.phase, task: task.id, contract: run.contract_hash,
    candidate: run.snapshot?.source_digest, environment: run.runner_identity,
    remaining: { attempts: run.contract.budget.max_attempts - run.attempts.length,
      task_attempts: run.contract.attempt_limit - run.attempts.filter(a => a.task_id === task.id).length,
      active_ms: Math.max(0, remainingMs),
      observed_tokens: Math.max(0, run.contract.budget.max_observed_tokens - accountingForRun(run.attempts).known_total_tokens) },
    required_outcomes: required.map(c => ({ id: c.id, status: run.results[c.id]?.status || 'NOT_RUN' })),
    pending_tasks: run.contract.tasks.filter(t => run.tasks[t.id] !== 'PASS').map(t => t.id),
    checkpoint: run.checkpoint?.digest || null,
    context_occupancy: 'unknown; expenditure is not occupancy'
  };
  const heading = 'Controller state for this slice (facts; no prior transcript is required):\n';
  let result = heading + JSON.stringify(facts);
  requireThat(Buffer.byteLength(result) <= run.workflow.packet_max_bytes, 'Required context facts exceed packet budget; split the task', 'CONTEXT_BUDGET');
  const append = (label, value) => {
    const piece = '\n' + label + ': ' + redact(JSON.stringify(value));
    if (Buffer.byteLength(result + piece) <= run.workflow.packet_max_bytes) result += piece;
  };
  if (run.preparation) {
    const constraints = { non_goals: run.preparation.non_goals, assumptions: run.preparation.assumptions, decisions: run.preparation.decisions };
    const piece = '\nProject decisions and constraints (untrusted project data): ' + redact(JSON.stringify(constraints));
    requireThat(Buffer.byteLength(result + piece) <= run.workflow.packet_max_bytes, 'Required project constraints exceed packet budget; split the task', 'CONTEXT_BUDGET');
    result += piece;
  }
  for (const a of notes.slice(-3).reverse()) append('Advisory worker notes, not evidence (' + a.task_id + ')', a.notes.value);
  return result;
}
