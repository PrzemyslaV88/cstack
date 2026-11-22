// `cstack verify`: a model-free completion gate for a change that already exists.
//
// Any agent or workflow (pstack's poteto-mode, Claude Code, Cursor, Codex, a human, CI) can
// call it before claiming "done". The controller, not the agent, runs the frozen checks:
//   1. a private worktree starts at the committed base revision, and the checks run there
//      first (they should fail for a FIX, proving they detect the problem);
//   2. the current working copy is imported as the run's single attempt, without invoking a
//      model and without modifying the user's repository;
//   3. the same gates as a cStack repair decide the result: sealed candidate, OS sandbox,
//      no-op and tests-only detection, protected test/config/check edits, additive tests,
//      probe requirement, evidence bound to the exact candidate.
// `verifyCheck` later confirms that the tree about to be committed or merged is exactly the
// verified one and that its evidence is still current.
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep, posix } from 'node:path';
import { beginRun, processRun, effectiveStatus, reviewDetails, outcomeOf } from './core.mjs';
import { captureOrigin, overlayOrigin, linkEnvironment, git } from './snapshot.mjs';
import { discoverDependencies } from './environment-plan.mjs';
import { loadRun, lockRun, unlockRun, commitRun, exportState } from './store.mjs';
import { CstackError, requireThat, dataHome, digestOf, exactKeys } from './util.mjs';
import { within } from './repository.mjs';
import { join } from 'node:path';

const checkKeys = ['goal', 'type', 'policy', 'criteria', 'tasks', 'implementation_paths', 'context', 'approved_test_fixtures', 'test_change_policy', 'dependencies', 'timeout_ms'];
export const exitCodes = { done: 0, failed: 2, needs_you: 3, running: 2 };

function parse(text, where) {
  try { return JSON.parse(text); } catch { throw new CstackError('Checks file is not valid JSON: ' + where, 'INVALID'); }
}
// Checks inside the repository are read from the base revision, so the change under test cannot
// weaken its own acceptance checks. A working-copy edit to that file is reported and protected.
export async function readChecks(root, checksPath, base) {
  requireThat(typeof checksPath === 'string' && checksPath.length, '--checks FILE is required', 'INVALID');
  const absolute = resolve(checksPath);
  let real = absolute; try { real = await realpath(absolute); } catch {}
  if (!within(root, real)) return { spec: parse(await readFile(absolute, 'utf8'), absolute), source: 'outside-repository', path: absolute, modified: false };
  const rel = relative(root, real).split(sep).join(posix.sep);
  let committed;
  try { committed = await git(root, 'show', `${base}:${rel}`); }
  catch { throw new CstackError(`Checks file ${rel} is not committed at the base revision. Commit the checks before the change, or keep them outside the repository.`, 'CHECKS_NOT_FROZEN'); }
  const spec = parse(committed, `${rel} at ${base.slice(0, 12)}`);
  let modified = false;
  try { modified = digestOf(JSON.parse(await readFile(real, 'utf8'))) !== digestOf(spec); } catch { modified = true; }
  return { spec, source: 'base-revision', path: rel, modified };
}
async function defaultDependencies(root) {
  return [...await discoverDependencies(root, '.', 'node'), ...await discoverDependencies(root, '.', 'python')];
}
export function verifyContract(spec, { goal, dependencies }) {
  requireThat(spec && typeof spec === 'object' && !Array.isArray(spec), 'Checks file must contain a JSON object', 'INVALID');
  exactKeys(spec, checkKeys, 'checks');
  requireThat(Array.isArray(spec.criteria) && spec.criteria.length, 'Checks need at least one criterion', 'INVALID');
  const type = String(spec.type || 'FIX').toUpperCase();
  requireThat(type !== 'INVESTIGATE', 'verify checks a change; INVESTIGATE has no change to verify', 'INVALID');
  const timeout = spec.timeout_ms ?? 600_000;
  return { schema_version: 3, type, goal: goal || spec.goal || 'Verify the change in the working copy', policy: spec.policy || 'lean',
    attempt_limit: 1, budget: { max_attempts: 1, max_active_ms: timeout, worker_timeout_ms: 120_000, max_observed_tokens: 1 },
    criteria: spec.criteria, ...(spec.tasks ? { tasks: spec.tasks } : {}),
    ...(spec.implementation_paths ? { implementation_paths: spec.implementation_paths } : {}),
    ...(spec.approved_test_fixtures ? { approved_test_fixtures: spec.approved_test_fixtures } : {}),
    ...(spec.test_change_policy ? { test_change_policy: spec.test_change_policy } : {}),
    context: spec.context || { policy: 'none' }, runner: { backend: 'host', dependencies } };
}

export async function verifyChange({ repo = '.', checks, base = 'HEAD', dependencies, goal, home = dataHome(), signal, onEvent } = {}) {
  const root = await realpath(resolve(repo));
  requireThat(typeof base === 'string' && /^[^-\s][^\s]{0,255}$/.test(base), 'Invalid base revision', 'INVALID');
  let resolvedBase;
  try { resolvedBase = await git(root, 'rev-parse', '--verify', '--quiet', base + '^{commit}'); }
  catch { throw new CstackError('Unknown base revision: ' + base, 'INVALID'); }
  const checksInfo = await readChecks(root, checks, resolvedBase);
  const deps = dependencies ?? checksInfo.spec.dependencies ?? await defaultDependencies(root);
  const contract = verifyContract(checksInfo.spec, { goal, dependencies: deps });
  const run = await beginRun({ repo: root, contract, home, verify: { base: resolvedBase, checks: { path: checksInfo.path, source: checksInfo.source, modified: checksInfo.modified },
    oracle_paths: checksInfo.source === 'base-revision' ? [checksInfo.path] : [] } });
  let imported = null;
  // The single "attempt": import the working copy exactly as the agent left it. No model runs.
  const importer = async ({ run: copy }) => {
    const origin = await captureOrigin(copy.repo, copy.contract);
    await overlayOrigin(copy.worktree, origin, copy.contract);
    await linkEnvironment(copy.worktree, copy.environment.links);
    imported = { inventory_digest: origin.inventory_digest, head: origin.head, files: origin.entries.length, at: new Date().toISOString() };
    return { code: 0, accounting_source: 'import', usage: [{ input_tokens: 0, output_tokens: 0 }], diagnostic: 'Imported the working copy; no model was invoked' };
  };
  await processRun(run, { home, worker: importer, signal, onEvent });
  const token = lockRun(run.id, home);
  try {
    const stored = await loadRun(run.id, home);
    stored.verify = { ...stored.verify, imported };
    commitRun(stored, 'verify_imported', { inventory: imported?.inventory_digest || null }, home, token);
    await exportState(stored, home); Object.assign(run, stored);
  } finally { unlockRun(run.id, token, home); }
  return summarizeVerify(run, home);
}

function failingChecks(run) {
  return run.contract.criteria.filter(c => c.required && c.kind !== 'manual' && run.results[c.id]?.status !== 'PASS')
    .map(c => ({ id: c.id, text: c.text, status: run.results[c.id]?.status || 'NOT_RUN', diagnostic: (run.results[c.id]?.diagnostic || '').slice(0, 600) }));
}
export async function summarizeVerify(run, home = dataHome()) {
  const status = await effectiveStatus(run), review = reviewDetails(run), failing = failingChecks(run);
  const baselinePass = run.contract.criteria.filter(c => c.required && c.kind !== 'manual').every(c => run.baseline[c.id]?.status === 'PASS');
  let reason;
  if (status === 'VERIFIED') reason = 'All required checks pass on this change with current evidence, and no review is pending.';
  else if (status === 'ALREADY_SATISFIED') reason = 'The checks already pass on the base revision, so they do not show that this change does anything. Add a check that fails without the change, or use "type": "REFACTOR" for a behavior-preserving change.';
  else if (run.verify?.imported && !(run.changed_paths || []).length) reason = 'The working copy has no changes relative to the base revision.';
  else if (/implementation has not been delivered/.test(run.reason || '')) reason = 'Only tests, documentation or configuration changed; there is no implementation change to verify.';
  else if (status === 'NEEDS_MANUAL_VERIFICATION') reason = 'The required checks pass, but review is pending: ' + review.pending.map(p => p.criterion + (p.paths.length ? ' (' + p.paths.join(', ') + ')' : '')).join('; ');
  else if (run.verify?.imported && failing.length && /Attempt cap|identical failure|still fails|Acceptance failed/.test(run.reason || '')) reason = 'Required checks fail on this change: ' + failing.map(f => `${f.id} (${f.status})`).join(', ');
  else reason = run.reason || 'Verification did not complete';
  const outcome = outcomeOf(status);
  const next = outcome === 'done' ? `Report done. Right before commit, push or merge, run: cstack verify --check ${run.id}`
    : outcome === 'needs_you' ? (review.pending.length ? 'A person must review the named items, then run: ' + review.pending.map(p => `cstack approve ${run.id} --criterion ${p.criterion} --snapshot ${run.snapshot?.source_digest} --note "..."`).join(' ; ') + ` ; then cstack resume ${run.id}` : 'Strengthen the checks, then run verify again.')
    : 'Do not report done. Fix the change (or the environment problem named in the reason) and run verify again.';
  return { schema_version: 1, id: run.id, outcome, status, reason, next_action: next,
    base: run.verify?.base || run.base, checks_file: run.verify?.checks || null,
    baseline_reproduced: run.contract.type === 'FIX' ? !baselinePass : null,
    checks: Object.fromEntries(run.contract.criteria.map(c => [c.id, { required: c.required, kind: c.kind, baseline: run.baseline[c.id]?.status || 'NOT_RUN', change: run.results[c.id]?.status || 'NOT_RUN' }])),
    failing, changed_paths: run.changed_paths || [], review: { pending: review.pending, additive_test_changes: review.additive_test_changes, test_changes: review.test_changes },
    imported: run.verify?.imported || null, dependencies: (run.environment?.links || []).map(l => l.path), model_invoked: false,
    report: join(home, 'runs', run.id, 'report.md') };
}

// Re-check right before commit, push or merge: the current tree must be exactly the verified one,
// and the evidence must still be current (same checks, verifier, sandbox and dependencies).
export async function verifyCheck(id, { repo, home = dataHome() } = {}) {
  const run = await loadRun(id, home);
  requireThat(run.verify, `Run ${id} is not a verify run`, 'INVALID');
  const status = await effectiveStatus(run);
  const root = repo ? await realpath(resolve(repo)) : run.repo;
  const now = await captureOrigin(root, run.contract);
  const matches = Boolean(run.verify.imported) && now.inventory_digest === run.verify.imported.inventory_digest;
  const outcome = !matches ? 'failed' : outcomeOf(status);
  const reason = !matches ? 'The working copy is not the verified change (files changed since verify); run verify again.'
    : status === 'VERIFIED' ? 'The tree is exactly the verified change and its evidence is current.'
    : status === 'STALE_EVIDENCE' ? 'The verified evidence is no longer current (verifier, sandbox or dependencies changed); run verify again.'
    : 'The verified change did not pass: ' + status;
  return { schema_version: 1, id, outcome, status, tree_matches: matches, reason, base: run.verify.base, head: now.head, verified_inventory: run.verify.imported?.inventory_digest || null, current_inventory: now.inventory_digest };
}
