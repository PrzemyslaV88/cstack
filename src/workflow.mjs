import { digestOf, exactKeys, integer, requireThat, redact, relativePath } from './util.mjs';
import { readFileSync } from 'node:fs';

const guidance = {
  shared: 'Work on one complete observable behavior at a time. Exercise the public interface. Derive expectations from the frozen requirements or an independent worked example. Keep interface changes small and preserve relevant project decisions. Report checks actually run and their limitations.',
  FIX: 'Use the supplied reproduction and expected-versus-observed feedback. Minimize the failing scenario before broad changes. For an uncertain cause, state a falsifiable hypothesis and test one prediction at a time. Add a regression test at the interface that exposes the actual bug when runnable. Remove temporary instrumentation.',
  FEATURE: 'Implement one end-to-end slice through the required interfaces. When runnable, write one failing behavioral test, observe it fail, implement the slice, then observe it pass. Frozen outcome checks remain independent of repository tests.',
  REFACTOR: 'Preserve externally observable behavior. Use existing interface tests and small changes to concentrate complexity. Verify after each runnable slice; keep unrelated redesign outside this task.',
  INVESTIGATE: 'Separate observed evidence, inference and unresolved questions. Cite current file locations. Deliver the requested investigation without claiming an implementation.',
  correction: 'Correct the specific recorded failure. State what new evidence changes the diagnosis; avoid repeating an unchanged failed approach. Host dependencies may differ from the verifier image: record unavailable checks rather than claiming a test-first cycle occurred.'
};

export const guidanceDigest = digestOf(guidance);
export const workflowRuntimeDigest = digestOf(['workflow.mjs','checkpoint.mjs','context.mjs','core.mjs','codex.mjs','intake.mjs','worker-notes.schema.json']
  .map(path=>readFileSync(new URL('./'+path,import.meta.url),'utf8')));

export function workflowPolicy(input = {}) {
  exactKeys(input, ['schema_version', 'sessions', 'max_session_turns', 'notes_max_bytes', 'packet_max_bytes', 'guidance_digest', 'runtime_digest'], 'workflow policy');
  requireThat(input.schema_version === undefined || input.schema_version === 1, 'Unsupported workflow policy');
  requireThat(input.guidance_digest === undefined || input.guidance_digest === guidanceDigest, 'Workflow guidance changed; use its supported runtime', 'WORKFLOW_CHANGED');
  requireThat(input.runtime_digest === undefined || input.runtime_digest === workflowRuntimeDigest, 'Workflow runtime changed; use the frozen runtime or create a new plan', 'WORKFLOW_CHANGED');
  const sessions = input.sessions || 'boundary-v1';
  requireThat(['boundary-v1', 'resume-v1'].includes(sessions), 'Unsupported session policy');
  return { schema_version: 1, sessions,
    max_session_turns: integer(input.max_session_turns, 2, 1, 10, 'max_session_turns'),
    notes_max_bytes: integer(input.notes_max_bytes, 4096, 512, 4096, 'notes_max_bytes'),
    packet_max_bytes: integer(input.packet_max_bytes, 6000, 2000, 6000, 'packet_max_bytes'),
    guidance_digest: guidanceDigest, runtime_digest: workflowRuntimeDigest };
}

export function validateWorkflow(run) {
  if (!run.workflow) return;
  requireThat(digestOf(workflowPolicy(run.workflow)) === run.workflow_digest, 'Frozen workflow identity changed', 'WORKFLOW_CHANGED');
}

export function workerGuidance(run, task) {
  if (!run.workflow) return '';
  return [guidance.shared, guidance[run.contract.type],
    run.attempts.some(a => a.task_id === task.id) ? guidance.correction : '',
    'Return the requested structured handoff. Notes are advisory; the controller alone checks outcomes. Finish this slice, not the whole project.']
    .filter(Boolean).join('\n');
}

export function sessionDecision(run, task, recovered = false) {
  if (!run.workflow || run.workflow.sessions === 'resume-v1') return { fresh: !run.thread_id, reason: 'legacy-continuity' };
  if (!run.thread_id) return { fresh: true, reason: 'new-session' };
  if (recovered) return { fresh: true, reason: 'recovery' };
  if (run.session?.task_id !== task.id) return { fresh: true, reason: 'task-boundary' };
  if (run.session?.compacted) return { fresh: true, reason: 'context-compacted' };
  if ((run.session?.turns || 0) >= run.workflow.max_session_turns) return { fresh: true, reason: 'bounded-continuation' };
  return { fresh: false, reason: 'same-task-correction' };
}

export function selectSession(run, task, recovered = false) {
  const decision = sessionDecision(run, task, recovered);
  if (decision.fresh) {
    run.thread_id = null;
    run.context_sent = null;
    run.session = { epoch: (run.session?.epoch || 0) + 1, task_id: task.id, turns: 0, compacted: false };
  }
  return decision;
}

export function taskPhase(run, task) {
  const integration = run.preparation?.integration_criteria || [];
  return task.criteria.some(id => integration.includes(id)) ? 'integration' : 'implementation';
}

const text = (value, limit, name) => {
  requireThat(typeof value === 'string' && Buffer.byteLength(value) <= limit && !value.includes('\0'), 'Invalid ' + name);
  return redact(value);
};

export function normalizeWorkerNotes(value, run) {
  if (value === undefined || value === null) return { status: 'missing', value: null };
  try {
    if (typeof value === 'string') {
      requireThat(Buffer.byteLength(value) <= run.workflow.notes_max_bytes, 'Handoff exceeds byte limit');
      value = JSON.parse(value);
    }
    requireThat(Buffer.byteLength(JSON.stringify(value)) <= run.workflow.notes_max_bytes, 'Handoff exceeds byte limit');
    exactKeys(value, ['diagnosis', 'next_action', 'blockers', 'decisions', 'rejected_hypotheses', 'files', 'checks_run'], 'worker notes');
    const list = (key, limit = 6) => {
      requireThat(Array.isArray(value[key]) && value[key].length <= limit, 'Invalid notes ' + key);
      return value[key].map(x => text(x, 400, key));
    };
    const known = new Set((run.snapshot?.entries || run.initial_snapshot.entries).map(e => e.path));
    const files = list('files', 12).map(p => {
      relativePath(p); requireThat(known.has(p), 'Handoff names an unknown source file'); return p;
    });
    return { status: 'accepted', value: {
      diagnosis: text(value.diagnosis, 800, 'diagnosis'), next_action: text(value.next_action, 600, 'next_action'),
      blockers: list('blockers'), decisions: list('decisions'), rejected_hypotheses: list('rejected_hypotheses'),
      files, checks_run: list('checks_run')
    } };
  } catch (e) { return { status: 'invalid', value: null, diagnostic: redact(e.message).slice(0, 240) }; }
}

export function workflowSummary(run) {
  return { phase: run.phase || null, policy: run.workflow || null,
    checkpoint: run.checkpoint?.digest || null, context_occupancy: 'unknown',
    usage_scope: 'Coding worker usage only; outer preparation and semantic review usage are unmeasured.', full_workflow_tokens: null,
    sessions: (run.attempts || []).map(a => ({ attempt: a.id, task: a.task_id, phase: a.phase || null,
      thread: a.thread_id || null, epoch: a.session_epoch || null, action: a.session_action || null,
      reason: a.session_reason || null, notes: a.notes?.status || 'missing' })) };
}
