import { command, cleanEnv } from './process.mjs';
import { CstackError, redact, safeId } from './util.mjs';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
const limits = new Set(['rate_limit_exceeded', 'usage_limit_reached', 'insufficient_quota', 'credits_exhausted']);
export function parseCodexEvents(lines) {
  let thread = null, complete = false, failed = false, quota = false, malformed = false;
  const usage = [], errors = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { malformed = true; continue; }
    if (e.type === 'thread.started' && safeId(e.thread_id)) thread = e.thread_id;
    if (e.type === 'turn.completed') { complete = true; if (e.usage) usage.push(e.usage); }
    if (e.type === 'turn.failed' || e.type === 'error') {
      failed = true;
      const error = e.error || e;
      const message = String(error.message || 'Unknown Codex error'); errors.push(redact(message));
      quota ||= limits.has(error.code) || /\b(usage limit (?:has been )?reached|quota exceeded|credits exhausted|429 too many requests)\b/i.test(message);
    }
  }
  return { thread_id: thread, usage, complete, quota, protocol_error: malformed || !complete || failed, diagnostic: errors.join('; ') };
}
export function codexArgs(run) {
  const settings = {
    forced_login_method: 'chatgpt', model_provider: 'openai', approval_policy: 'never', sandbox_mode: 'workspace-write',
    'sandbox_workspace_write.network_access': false, 'sandbox_workspace_write.exclude_slash_tmp': true,
    'sandbox_workspace_write.exclude_tmpdir_env_var': true, 'features.multi_agent': false, 'features.multi_agent_v2': false, 'agents.enabled': false,
    'features.hooks': false, 'features.plugins': false, 'features.apps': false, 'features.goals': false,
    web_search: 'disabled', allow_login_shell: false, 'shell_environment_policy.inherit': 'none',
    'shell_environment_policy.set': { PATH: cleanEnv().PATH }, model_reasoning_effort: run.contract.reasoning || 'medium'
  };
  // TOML inline tables use '=' rather than JSON ':'; primitive settings are JSON-compatible TOML.
  const override = Object.entries(settings).flatMap(([k, v]) => ['-c', k + '=' + (typeof v === 'object' ? '{ PATH = ' + JSON.stringify(v.PATH) + ' }' : JSON.stringify(v))]);
  if (run.contract.model) override.push('-c', 'model=' + JSON.stringify(run.contract.model));
  return ['--no-daemon', ...override, 'exec', '--ignore-user-config', '--ignore-rules', '--json', '--sandbox', 'workspace-write', '--cd', run.worktree,
    ...(run.thread_id ? ['resume', run.thread_id] : []), '-'];
}
function workerEnv(extra = {}) {
  // API keys, cloud tokens, NODE_OPTIONS and proxies are never forwarded.
  return cleanEnv({ HOME: homedir(), ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}), ...extra });
}
export async function preflightCodex() {
  const bin = process.env.CSTACK_CODEX_BIN || 'codex';
  const help = await command([bin, 'exec', '--help'], { env: workerEnv(), timeoutMs: 10000 });
  if (help.code !== 0) throw new CstackError('Codex unavailable. Install/authenticate the CLI; no paid API fallback is supported.', 'AUTH');
  if (!help.stdout.includes('--ignore-user-config') || !help.stdout.includes('--ignore-rules')) throw new CstackError('Codex CLI lacks controlled-config flags; upgrade before running cStack.', 'CAPABILITY');
  const controls = ['multi_agent', 'multi_agent_v2', 'hooks', 'plugins', 'apps', 'goals'];
  // Ignore-config flags belong to exec, not to the root CLI/features command.
  // Check the controls in an empty, temporary config home; keep auth in its normal home.
  const configHome = await mkdtemp(join(tmpdir(), 'cstack-preflight-'));
  let features;
  try {
    features = await command([bin, '--no-daemon', ...controls.flatMap(name => ['-c', `features.${name}=false`]), 'features', 'list'],
      { env: workerEnv({ CODEX_HOME: configHome }), timeoutMs: 10000 });
  } finally { await rm(configHome, { recursive: true, force: true }); }
  if (features.code !== 0 || controls.some(name => !features.stdout.split('\n').some(line => new RegExp(`^${name}\\s+.*\\bfalse\\s*$`).test(line.trim())))) {
    throw new CstackError('Cannot confirm disabled subagents/hooks/plugins/apps/goals in the installed Codex CLI.', 'CAPABILITY');
  }
  const login = await command([bin, '-c', 'forced_login_method="chatgpt"', 'login', 'status'], { env: workerEnv(), timeoutMs: 10000 });
  if (login.code !== 0 || !/chatgpt/i.test(login.stdout + login.stderr)) throw new CstackError('A confirmed ChatGPT Codex login is required. API-key login will not be used.', 'AUTH');
  return { authentication: 'chatgpt', allowance: 'unknown', capabilities: 'controlled config, no subagents, workspace-write' };
}
export async function codexWorker({ run, prompt, timeoutMs, signal, onSpawn }) {
  const lines = [];
  const result = await command([process.env.CSTACK_CODEX_BIN || 'codex', ...codexArgs(run)],
    { cwd: run.worktree, input: prompt, timeoutMs: timeoutMs || run.contract.budget.worker_timeout_ms,
      signal, onSpawn, env: workerEnv(), outputLimit: 3_000_000, orphanSafe: true, onLine: line => lines.push(line) });
  const parsed = parseCodexEvents(lines);
  return { ...parsed, code: result.code || (parsed.protocol_error || result.truncated ? 1 : 0), timed_out: result.timedOut,
    diagnostic: redact(parsed.diagnostic || result.stderr || (parsed.protocol_error ? 'Missing or invalid completed-turn event' : '')).slice(-3000) };
}
export function usageTotals(events) {
  const total = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, reported_events: events.length };
  for (const event of events) for (const key of Object.keys(total).filter(x => x !== 'reported_events')) {
    if (Number.isSafeInteger(event[key]) && event[key] >= 0) total[key] += event[key];
  }
  total.observed_total_tokens = total.input_tokens + total.output_tokens; // cached/reasoning fields are subsets, not extra charges.
  return total;
}
