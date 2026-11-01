import { requireThat, integer, argv, safeId } from './util.mjs';
import { normalizeTestFixtures } from './file-policy.mjs';
const validTypes = ['FIX', 'FEATURE', 'REFACTOR', 'INVESTIGATE'];
function strings(value, name, nonempty = false) {
  requireThat(Array.isArray(value) && (!nonempty || value.length) && value.every(x => typeof x === 'string' && x.trim()) && new Set(value).size === value.length, `${name} must be an array of unique strings`);
  return [...value];
}
function paths(value, name) {
  return strings(value, name).map(p => {
    requireThat(!p.startsWith('/') && !p.includes('..') && !p.includes('\\') && !p.includes('\0'), `${name}: unsafe path ${p}`);
    return p;
  });
}
export function normalizeContract(raw) {
  requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), 'Contract must be an object');
  const allowed = new Set(['draft', 'schema_version', 'goal', 'type', 'policy', 'attempt_limit', 'criteria', 'tasks', 'implementation_paths', 'workspace_inputs', 'approved_test_fixtures', 'runner', 'budget', 'model', 'reasoning']);
  for (const key of Object.keys(raw)) requireThat(allowed.has(key), `Unknown contract property: ${key}`);
  requireThat(raw.schema_version === undefined || raw.schema_version === 2, 'Use schema_version 2; v1 evidence cannot be promoted');
  requireThat(!raw.draft, 'Review the draft contract and set draft=false before execution');
  requireThat(raw.reasoning === undefined || ['low', 'medium', 'high'].includes(raw.reasoning), 'Unknown reasoning effort');
  const type = String(raw.type || 'FIX').toUpperCase(), policy = raw.policy || 'balanced';
  requireThat(validTypes.includes(type), 'Unsupported contract type');
  requireThat(['lean', 'balanced', 'critical'].includes(policy), 'Unknown policy');
  requireThat(typeof raw.goal === 'string' && raw.goal.trim().length >= 5, 'A meaningful goal is required');
  const attemptLimit = integer(raw.attempt_limit, policy === 'lean' ? 2 : 3, 1, 10, 'attempt_limit');
  requireThat(Array.isArray(raw.criteria) && raw.criteria.length > 0 && raw.criteria.length <= 100, 'At least one acceptance criterion is required (maximum 100)');
  const ids = new Set();
  const criteria = raw.criteria.map((c, index) => {
    requireThat(c && typeof c === 'object', 'Invalid criterion');
    const id = c.id || `AC${index + 1}`;
    requireThat(safeId(id) && !ids.has(id), 'Duplicate/invalid criterion ID'); ids.add(id);
    requireThat(typeof c.text === 'string' && c.text.trim(), `Criterion ${id} needs a description`);
    let kind = c.kind || 'probe';
    // Explicit migration only: never infer proof from an arbitrary successful command.
    if (kind === 'command') {
      requireThat(c.argv?.includes('--test') && Array.isArray(c.expected_tests), `${id}: v0.2 command checks need expected_tests, or use an external probe`);
      kind = 'node-test';
    }
    requireThat(['probe', 'node-test', 'manual'].includes(kind), `Unsupported criterion kind ${kind}`);
    requireThat(c.required === undefined || typeof c.required === 'boolean', 'required must be boolean');
    const out = { id, text: c.text.trim(), required: c.required !== false, kind,
      timeout_ms: integer(c.timeout_ms, 30_000, 50, 600_000, 'criterion timeout_ms') };
    if (kind !== 'manual') out.argv = argv(c.argv);
    if (kind === 'node-test') {
      requireThat(out.argv[0] === 'node' && out.argv.includes('--test'), 'node-test argv must use node --test');
      requireThat(!out.argv.some(a => /--(test-reporter|test-name-pattern|test-skip-pattern)/.test(a)), 'Reporter and case filtering are controller owned');
      out.expected_tests = strings(c.expected_tests, 'expected_tests', true);
    }
    if (kind === 'probe') {
      requireThat(Array.isArray(c.cases) && c.cases.length > 0 && c.cases.length <= 100, `${id} needs bounded external probe cases`);
      const caseIds = new Set();
      out.cases = c.cases.map((item, i) => {
        const caseId = item.id || `case-${i + 1}`;
        requireThat(safeId(caseId) && !caseIds.has(caseId), 'Duplicate/invalid case id'); caseIds.add(caseId);
        requireThat(typeof item.stdin === 'string' && item.stdin.length <= 100_000, 'Probe stdin must be a bounded string');
        requireThat(Object.hasOwn(item, 'expect_json') !== Object.hasOwn(item, 'expect_stdout'), 'Specify exactly one of expect_json or expect_stdout');
        const result = { id: caseId, stdin: item.stdin };
        if (Object.hasOwn(item, 'expect_json')) {
          requireThat(JSON.stringify(item.expect_json) !== undefined && JSON.stringify(item.expect_json).length <= 100_000, 'Invalid JSON expectation');
          result.expect_json = item.expect_json;
        } else {
          requireThat(typeof item.expect_stdout === 'string' && item.expect_stdout.length <= 100_000, 'expect_stdout must be a bounded string');
          result.expect_stdout = item.expect_stdout;
        }
        return result;
      });
    }
    return out;
  });
  requireThat(criteria.some(c => c.required), 'At least one REQUIRED acceptance criterion is necessary');
  if (policy === 'critical') {
    requireThat(criteria.some(c => c.required && c.kind === 'probe') && criteria.some(c => c.required && c.kind === 'manual'), 'Critical policy requires both an external probe and a human acceptance criterion');
  }
  const tasks = raw.tasks ?? [{ id: 'T1', title: raw.goal, depends_on: [], criteria: criteria.map(c => c.id) }];
  requireThat(Array.isArray(tasks) && tasks.length > 0 && tasks.length <= 100, 'Tasks must be a nonempty array');
  const taskIds = new Set();
  const normalizedTasks = tasks.map(t => {
    requireThat(safeId(t.id) && !taskIds.has(t.id), 'Invalid/duplicate task ID'); taskIds.add(t.id);
    return { id: t.id, title: String(t.title || t.id), depends_on: strings(t.depends_on ?? [], 'depends_on'), criteria: strings(t.criteria ?? [], 'task criteria') };
  });
  for (const task of normalizedTasks) {
    for (const dep of task.depends_on) requireThat(taskIds.has(dep) && dep !== task.id, `Invalid dependency ${dep}`);
    for (const id of task.criteria) requireThat(ids.has(id), `Unknown criterion ${id}`);
  }
  const visited = new Set(), active = new Set();
  function visit(id) {
    requireThat(!active.has(id), 'Task graph contains a cycle');
    if (visited.has(id)) return;
    active.add(id); for (const d of normalizedTasks.find(t => t.id === id).depends_on) visit(d);
    active.delete(id); visited.add(id);
  }
  for (const task of normalizedTasks) visit(task.id);
  for (const task of normalizedTasks) requireThat(task.criteria.some(id => criteria.some(c => c.id === id && c.required)), `Task ${task.id} needs a required outcome; do not create edit-only nodes`);
  requireThat(new Set(normalizedTasks.flatMap(t => t.criteria)).size === criteria.length, 'Every criterion must be assigned to a task');
  const runner = raw.runner || { backend: 'docker' };
  requireThat(runner && ['docker', 'linux'].includes(runner.backend), 'runner.backend must be docker or linux; no host execution');
  requireThat(!runner.image || (typeof runner.image === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(runner.image)), 'Invalid runner image');
  const workspaceInputs = raw.workspace_inputs || [];
  requireThat(Array.isArray(workspaceInputs) && workspaceInputs.length <= 8, 'workspace_inputs must be a bounded array');
  const inputDestinations = new Set();
  for (const input of workspaceInputs) {
    requireThat(typeof input.source === 'string' && input.source.startsWith('/'), 'Input bundle source must be absolute');
    paths([input.destination], 'input destination');
    requireThat(!/^\.(git|codex|cstack)(\/|$)/.test(input.destination) && !inputDestinations.has(input.destination), 'Unsafe/duplicate input destination');
    requireThat(typeof input.digest === 'string' && /^[a-f0-9]{64}$/.test(input.digest), 'Input bundle digest required; run cstack input-digest');
    inputDestinations.add(input.destination);
  }
  const b = raw.budget || {};
  for (const key of Object.keys(b)) requireThat(['max_attempts', 'max_active_ms', 'worker_timeout_ms', 'max_observed_tokens'].includes(key), `Unknown budget key ${key}`);
  return { schema_version: 2, type, goal: raw.goal.trim(), policy, attempt_limit: attemptLimit, criteria, tasks: normalizedTasks,
    implementation_paths: paths(raw.implementation_paths || [], 'implementation_paths'),
    workspace_inputs: workspaceInputs.map(x => ({ source: x.source, destination: x.destination, digest: x.digest })),
    approved_test_fixtures: normalizeTestFixtures(raw.approved_test_fixtures),
    runner: { backend: runner.backend, ...(runner.image ? { image: runner.image } : {}) },
    budget: { max_attempts: integer(b.max_attempts, Math.min(12, attemptLimit * tasks.length), 1, 100, 'max_attempts'),
      max_active_ms: integer(b.max_active_ms, 1_800_000, 100, 86_400_000, 'max_active_ms'),
      worker_timeout_ms: integer(b.worker_timeout_ms, 600_000, 100, 3_600_000, 'worker_timeout_ms'),
      max_observed_tokens: integer(b.max_observed_tokens, 500_000, 1, 100_000_000, 'max_observed_tokens') },
    ...(raw.model ? { model: String(raw.model) } : {}), reasoning: ['low', 'medium', 'high'].includes(raw.reasoning) ? raw.reasoning : 'medium' };
}
