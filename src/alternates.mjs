// Evidence-selected alternates ("best of N").
//
// After the first failed attempt, the contract may ask for up to three independent attempts
// that start from the run's initial snapshot, in separate worktrees, in parallel, optionally
// on different workers (Claude Code, Codex). Each is sealed and checked by the independent
// verifier in the sandbox. Selection uses evidence only: every required automated check must
// pass, then the smallest change wins. The winner is copied into the run's worktree and then
// goes through every normal gate (seal, verify, protected changes, additive tests, probe
// requirement); losing worktrees are removed. No model judges another model's work.
import { readdir, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createWorktree, sealCandidate, manifestChanges, git } from './snapshot.mjs';
import { verify } from './verification.mjs';
import { workerFor } from './workers.mjs';
import { classifyUsage } from './usage.mjs';
import { redact } from './util.mjs';

// Replace a worktree's content (never its .git link) with another tree's content, links included.
export async function replaceTree(destination, source) {
  for (const name of await readdir(destination)) if (name !== '.git') await rm(join(destination, name), { recursive: true, force: true });
  for (const name of await readdir(source)) if (name !== '.git') await cp(join(source, name), join(destination, name), { recursive: true, dereference: false, verbatimSymlinks: true });
}
export function alternateWorkers(contract, count) {
  const names = contract.alternates?.workers?.length ? contract.alternates.workers : [contract.worker || 'codex'];
  return Array.from({ length: count }, (_, i) => names[i % names.length]);
}

export async function runAlternates(run, { task, home, runner, worker, signal, remaining, persist, prompt: makePrompt, context: makeContext }) {
  const limits = run.contract.budget, wanted = run.contract.alternates?.count || 0;
  const room = Math.max(0, Math.min(wanted, limits.max_attempts - run.attempts.length));
  if (!room) return { candidates: [], winner: null, reason: 'No attempt budget left for alternates' };
  const names = alternateWorkers(run.contract, room), candidates = [];
  // Reserve every alternate durably before any of them starts.
  for (const [i, name] of names.entries()) {
    const attempt = { id: randomUUID(), task_id: task.id, number: run.attempts.filter(a => a.task_id === task.id).length + 1, alternate: i + 1, worker: name,
      status: 'RESERVED', started: new Date().toISOString(), prompt_mode: 'alternate' };
    run.attempts.push(attempt); candidates.push({ attempt, name, worktree: null });
  }
  persist('alternates_reserved', { ids: candidates.map(c => c.attempt.id), workers: names });
  // Git worktree registration is serialized; only the workers run in parallel.
  for (const c of candidates) {
    try { c.worktree = await createWorktree(run.repo, run.base, `${run.id}-alt${c.attempt.alternate}`, home); await replaceTree(c.worktree, run.initial_snapshot.path); }
    catch (e) { c.setup_error = e; }
  }
  const preflights = new Map();
  async function one(candidate) {
    const { attempt, name } = candidate;
    try {
      if (candidate.setup_error) throw candidate.setup_error;
      const clone = { ...structuredClone(run), worktree: candidate.worktree, thread_id: null, contract: { ...run.contract, worker: name } };
      const agent = worker ? null : workerFor({ worker: name });
      if (agent) { if (!preflights.has(name)) preflights.set(name, agent.preflight()); clone.auth = await preflights.get(name); }
      const context = await makeContext(clone), prompt = makePrompt(clone, task, context);
      attempt.prompt_chars = prompt.length; attempt.context_files = context.files.length;
      const started = Date.now();
      const result = await (worker || agent.run)({ run: clone, prompt, signal, alternate: { index: attempt.alternate, worker: name },
        timeoutMs: Math.max(1, Math.min(limits.worker_timeout_ms, remaining())), onSpawn: pid => { attempt.pid = pid; attempt.status = 'RUNNING'; } });
      attempt.worker_ms = Date.now() - started;
      const usage = result.usage || [], accounting = classifyUsage(usage, result.accounting_source || 'worker');
      run.usage.push(...usage);
      Object.assign(attempt, { status: result.code === 0 ? 'FINISHED' : 'INTERRUPTED', exit_code: result.code, usage, usage_unknown: !usage.length,
        usage_status: result.usage_status || accounting.status, usage_diagnostic: result.usage_diagnostic || accounting.diagnostic,
        accounting_source: result.accounting_source || 'worker', reason: redact(result.diagnostic || ''), finished: new Date().toISOString() });
      if (result.code !== 0) { attempt.decision = 'ALTERNATE_FAILED'; return; }
      const snapshot = await sealCandidate(clone, home);
      const proofs = await verify(clone, snapshot, runner, { home, signal, deadline: Date.now() + Math.max(0, remaining()) });
      const required = run.contract.criteria.filter(c => c.required && c.kind !== 'manual');
      candidate.passing = required.filter(c => proofs[c.id]?.status === 'PASS').length;
      candidate.complete = required.length > 0 && candidate.passing === required.length;
      candidate.changed = manifestChanges(run.initial_snapshot.entries, snapshot.entries);
      Object.assign(attempt, { after: snapshot.source_digest, passing: candidate.passing, changed_paths: candidate.changed,
        results: Object.fromEntries(Object.entries(proofs).map(([id, p]) => [id, p.status])), decision: candidate.complete ? 'ALTERNATE_PASS' : 'ALTERNATE_FAIL' });
    } catch (e) {
      Object.assign(attempt, { status: attempt.status === 'RESERVED' ? 'INTERRUPTED' : attempt.status, decision: 'ALTERNATE_ERROR', reason: redact(String(e.message || e)).slice(0, 1000), usage_unknown: !attempt.usage?.length });
    }
  }
  await Promise.all(candidates.map(one));
  // Evidence decides: every required check passes; then the smallest change; then the earliest.
  const passing = candidates.filter(c => c.complete && c.changed?.length).sort((a, b) => a.changed.length - b.changed.length || a.attempt.alternate - b.attempt.alternate);
  const winner = passing[0] || null;
  if (winner) { await replaceTree(run.worktree, winner.worktree); winner.attempt.decision = 'ALTERNATE_SELECTED'; }
  for (const c of candidates) if (c.worktree) { await git(run.repo, 'worktree', 'remove', '--force', c.worktree).catch(() => {}); await rm(c.worktree, { recursive: true, force: true }); }
  run.alternates_summary = { ran: candidates.length, selected: winner ? { attempt: winner.attempt.id, worker: winner.name, changed_paths: winner.changed } : null,
    candidates: candidates.map(c => ({ attempt: c.attempt.id, worker: c.name, decision: c.attempt.decision, passing: c.passing ?? null, changed: c.changed?.length ?? null })) };
  persist('alternates_evaluated', { selected: winner?.attempt.id || null });
  return { candidates, winner };
}
