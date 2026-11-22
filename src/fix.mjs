// `cstack fix "GOAL"`: one command from a bug description to a checked repair.
//
//   1. setup: profile the project and check its installed environment (no installs);
//   2. draft: the selected worker (Claude Code or Codex) gets ONE turn in a throwaway
//      worktree and may only write probe checks that capture the requested behavior;
//   3. prove: the controller freezes those checks into a plan, which runs them on the current
//      code; at least one must fail, otherwise they do not demonstrate the problem;
//   4. approve: a person reads the expected behavior (input -> expected, and what the code
//      does today) and approves exactly that plan digest;
//   5. fix: the normal repair runs against the frozen checks and returns done / failed / needs_you.
// The person reviews a few lines of expected behavior instead of a diff, and the agent that
// fixes the code cannot change what "fixed" means.
import { readFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { setupProject } from './setup.mjs';
import { createJobPlan, runJobPlan } from './job-plan.mjs';
import { createWorktree, linkEnvironment, git } from './snapshot.mjs';
import { resolveDependencies } from './environment.mjs';
import { workers, workerNames } from './workers.mjs';
import { loadRun } from './store.mjs';
import { effectiveStatus, reviewDetails, outcomeOf } from './core.mjs';
import { atomicJson, readJson } from './artifacts.mjs';
import { CstackError, requireThat, dataHome, exactKeys, safeId } from './util.mjs';

export const DRAFT_FILE = 'cstack-checks.json';
export function draftPrompt(goal) {
  return [
    'You are drafting acceptance checks. Do NOT fix, refactor or edit any project file.',
    `Requested change: ${goal}`,
    `Read the code, then write exactly one file, ${DRAFT_FILE}, in the repository root, containing JSON:`,
    '{"criteria":[{"id":"BEHAVIOR","kind":"probe","text":"<observable requirement>","argv":["node","--input-type=module","-e","<driver>"],"cases":[{"id":"bug","stdin":"<input>","expect_json":<value>},{"id":"still-works","stdin":"<input>","expect_json":<value>}]}]}',
    'Rules: 1-3 probe criteria, 2-8 cases each. argv is an array (no shell) that runs the project\'s own code with its installed runtime (node -e, python -c or a project CLI), reads stdin and prints JSON (expect_json) or exact text (expect_stdout).',
    'Checks run offline in a read-only sandbox from the repository root. Include at least one case that FAILS with today\'s code because of the requested change, and at least one case that already works and must keep working.',
    'Expected values must come from the requested behavior, not from the current output. Do not add tests, comments or any other file.',
  ].join('\n');
}
function summarizeCases(baseline, criteria) {
  const rows = [];
  for (const c of criteria.filter(c => c.kind === 'probe')) {
    const details = baseline?.[c.id]?.details || [];
    for (const item of c.cases) {
      const d = details.find(x => x.id === item.id);
      rows.push({ criterion: c.id, case: item.id, input: item.stdin, expected: Object.hasOwn(item, 'expect_json') ? item.expect_json : item.expect_stdout,
        today: d ? (d.pass ? 'passes' : d.observed ?? d.diagnostic) : 'not run', fails_today: d ? !d.pass : null });
    }
  }
  return rows;
}
async function draftChecks({ root, goal, worker, profile, home, signal, draftWorker }) {
  const agent = workers[worker];
  const auth = draftWorker ? null : await agent.preflight();
  const id = 'draft-' + randomUUID(), worktree = await createWorktree(root, await git(root, 'rev-parse', 'HEAD'), id, home);
  try {
    const links = await resolveDependencies(root, profile.environment.dependencies);
    await linkEnvironment(worktree, links);
    const run = { id, worktree, thread_id: null, auth, environment: { links },
      contract: { worker, reasoning: 'medium', budget: { worker_timeout_ms: 600_000 }, ...(agent.defaultModel ? { model: agent.defaultModel } : {}) } };
    const result = await (draftWorker || agent.run)({ run, prompt: draftPrompt(goal), timeoutMs: 600_000, signal, onSpawn() {} });
    requireThat(result.code === 0, 'The worker could not draft checks: ' + (result.diagnostic || 'exit ' + result.code), 'DRAFT_FAILED');
    let spec;
    try { spec = JSON.parse(await readFile(join(worktree, DRAFT_FILE), 'utf8')); } catch { throw new CstackError(`The worker did not write a valid ${DRAFT_FILE}`, 'DRAFT_FAILED'); }
    requireThat(spec && typeof spec === 'object' && !Array.isArray(spec), 'Drafted checks must be a JSON object', 'DRAFT_FAILED');
    exactKeys(spec, ['criteria'], 'drafted checks');
    requireThat(Array.isArray(spec.criteria) && spec.criteria.length >= 1 && spec.criteria.length <= 3 && spec.criteria.every(c => c?.kind === 'probe'), 'Drafted checks must be 1-3 probe criteria', 'DRAFT_FAILED');
    return { spec, usage: result.usage || [], worker };
  } finally {
    await git(root, 'worktree', 'remove', '--force', worktree).catch(() => {});
    await rm(worktree, { recursive: true, force: true });
  }
}

export async function fixDraft({ repo = '.', goal, worker = 'codex', checks, yes = false, home = dataHome(), signal, draftWorker, fixWorker, onEvent } = {}) {
  requireThat(typeof goal === 'string' && goal.trim().length >= 5, 'Describe the change: cstack fix "GOAL"', 'INVALID');
  requireThat(workerNames.includes(worker), 'worker must be ' + workerNames.join(' or '), 'INVALID');
  const root = await realpath(resolve(repo)), id = randomUUID(), dir = join(resolve(home), 'fixes', id);
  const setup = await setupProject(root, { home, signal });
  if (!setup.ready) return { schema_version: 1, id, outcome: 'needs_you', stage: 'setup', reason: 'Project setup is not ready: ' + setup.next_action, next_action: setup.next_action };
  let spec, source;
  if (checks) {
    // The same checks file works for `verify` and `fix`: the goal comes from the command, dependencies
    // from the project profile, and a timeout becomes the run's active-time budget.
    const { goal: _goal, dependencies: _deps, timeout_ms, ...rest } = await readJson(resolve(checks));
    spec = { ...rest, ...(timeout_ms ? { budget: { ...(rest.budget || {}), max_active_ms: timeout_ms } } : {}) }; source = 'provided';
  }
  else { const drafted = await draftChecks({ root, goal, worker, profile: setup.details, home, signal, draftWorker }); spec = drafted.spec; source = 'drafted by ' + worker; }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const acceptance = join(dir, 'acceptance.json');
  await atomicJson(acceptance, { ...spec, worker });
  const plan = await createJobPlan({ repo: root, profilePath: setup.profile, acceptancePath: acceptance, goal, output: join(dir, 'plan'), worker, home, signal });
  const frozen = await readJson(join(dir, 'plan', 'contract.json')), local = await readJson(join(dir, 'plan', 'local.json'));
  const baselineRun = await loadRun(local.baseline_run, home);
  const cases = summarizeCases(baselineRun.baseline, frozen.criteria);
  const record = { schema_version: 1, id, goal, worker, source, plan: plan.plan, plan_digest: plan.digest, ready: plan.ready, code: plan.code, created_at: new Date().toISOString() };
  await atomicJson(join(dir, 'fix.json'), record);
  if (!plan.ready) {
    const reason = plan.code === 'ALREADY_SATISFIED' ? 'The checks already pass on the current code, so they do not demonstrate the requested change. Rephrase the goal or supply checks with --checks.'
      : plan.code === 'FAILURE_NOT_REPRODUCED' ? 'No check fails on the current code, so the problem is not reproduced. Rephrase the goal or supply checks with --checks.'
      : 'The checks could not run on the current code: ' + plan.code;
    return { schema_version: 1, id, outcome: plan.code === 'BASELINE_ERROR' ? 'failed' : 'needs_you', stage: 'checks', reason, checks_source: source, cases, plan: plan.plan, next_action: reason };
  }
  if (!yes) return { schema_version: 1, id, outcome: 'needs_you', stage: 'approve', checks_source: source, cases,
    reason: 'Review the expected behavior below. The fix will be judged only against these checks.',
    next_action: `If these expectations are right, run: cstack fix --approve ${id}`, plan: plan.plan, plan_digest: plan.digest };
  return fixApprove(id, { home, signal, fixWorker, onEvent, approvedBy: 'flag --yes (not reviewed by a person)' });
}

export async function fixApprove(id, { home = dataHome(), signal, fixWorker, onEvent, approvedBy = 'person running --approve' } = {}) {
  requireThat(safeId(id), 'Invalid fix ID', 'INVALID');
  const dir = join(resolve(home), 'fixes', id), record = await readJson(join(dir, 'fix.json'));
  requireThat(record.ready, 'This fix has no reproducing checks to approve: ' + record.code, 'PLAN_NOT_READY');
  // The digest recorded when the expectations were shown: a changed plan is refused (PLAN_CHANGED).
  const run = await runJobPlan(record.plan, record.plan_digest, { home, signal, onEvent, worker: fixWorker });
  const status = await effectiveStatus(run), review = reviewDetails(run);
  await atomicJson(join(dir, 'approval.json'), { approved_by: approvedBy, plan_digest: record.plan_digest, run_id: run.id, at: new Date().toISOString() });
  return { schema_version: 1, id, stage: 'fix', run_id: run.id, outcome: outcomeOf(status), status, reason: run.reason, approved_by: approvedBy,
    review: review.pending, changed_paths: run.changed_paths, worktree: run.worktree,
    next_action: status === 'VERIFIED' ? `Preview with: cstack patch ${run.id} --out DIR, then apply with: cstack apply ${run.id} --repo REPO --snapshot ${run.snapshot.source_digest}`
      : review.pending.length ? 'A person must review: ' + review.pending.map(p => p.criterion).join(', ') : 'Inspect the report: cstack report ' + run.id };
}
export const fixExitCodes = { done: 0, failed: 2, needs_you: 3, running: 2 };
