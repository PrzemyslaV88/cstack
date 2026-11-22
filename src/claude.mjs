// Claude Code as a cStack coding worker (`claude -p`, stream-json).
//
// The worker is isolated the same way as the Codex worker: one agent, no subagents, no web
// tools, no MCP servers, no user/project/local settings or hooks (`--restricted`), file tools
// confined to the private worktree, shell commands inside Claude Code's own sandbox with no
// network (failing closed if that sandbox is unavailable), and every permission prompt
// denied. The independent cStack verifier still decides completion; the worker's prose never
// does. Authentication is the subscription login unless the operator explicitly selects an
// API key; cStack never reads, stores or forwards keys and never switches modes on its own.
import { command, cleanEnv } from './process.mjs';
import { CstackError, redact, safeId } from './util.mjs';
import { homedir } from 'node:os';
import { classifyUsage } from './usage.mjs';
import { sandboxPath } from './environment.mjs';

export const CLAUDE_MIN_VERSION = [2, 1, 259];
export const claudeTools = ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'];
const quotaPattern = /\b(usage limit|rate[ _-]?limit|quota|credit balance is too low)\b/i;
const bin = () => process.env.CSTACK_CLAUDE_BIN || 'claude';

export function claudeAuth(value = process.env.CSTACK_CLAUDE_AUTH) {
  const mode = value || 'subscription';
  if (!['subscription', 'api-key'].includes(mode)) throw new CstackError('CSTACK_CLAUDE_AUTH must be subscription or api-key', 'AUTH');
  return mode;
}
// API keys in the environment silently override a subscription login in `claude -p`, so the
// worker environment carries none. A long-lived subscription token from `claude setup-token`
// (CLAUDE_CODE_OAUTH_TOKEN) is forwarded only when present, for headless machines.
function workerEnv(links = []) {
  return cleanEnv({ HOME: homedir(), PATH: sandboxPath(links),
    ...(process.env.CLAUDE_CONFIG_DIR ? { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR } : {}),
    ...(process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : {}),
    CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '5000' });
}
export const claudeSettings = () => JSON.stringify({ sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false,
  autoAllowBashIfSandboxed: true, network: { allowedDomains: [] } } });
export function claudeArgs(run, prompt) {
  const effort = { low: 'low', medium: 'medium', high: 'high' }[run.contract.reasoning || 'medium'];
  // The prompt comes right after -p: later flags take variadic values.
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--restricted', '--strict-mcp-config',
    '--tools', claudeTools.join(','), '--disallowedTools', 'mcp__*', 'Agent', 'WebFetch', 'WebSearch',
    '--permission-mode', 'acceptEdits', '--permission-prompts', 'none', '--settings', claudeSettings(), '--max-turns', '120',
    ...(effort ? ['--effort', effort] : []), ...(run.contract.model ? ['--model', run.contract.model] : []),
    ...(run.thread_id ? ['--resume', run.thread_id] : [])];
}
export function parseClaudeEvents(lines) {
  let session = null, malformed = false, quota = false;
  const results = [], errors = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { malformed = true; continue; }
    if (!session && typeof e.session_id === 'string' && safeId(e.session_id)) session = e.session_id;
    if (e.type === 'result') results.push(e);
  }
  const result = results.at(-1), usage = [];
  if (result?.usage) {
    const u = result.usage, read = u.cache_read_input_tokens ?? 0, created = u.cache_creation_input_tokens ?? 0;
    // Anthropic input_tokens excludes cache reads and writes; cStack counts all input, with cached input as a subset.
    if ([u.input_tokens, u.output_tokens, read, created].every(n => Number.isSafeInteger(n) && n >= 0))
      usage.push({ input_tokens: u.input_tokens + read + created, cached_input_tokens: read, output_tokens: u.output_tokens });
  }
  const failed = !result || result.is_error || result.subtype !== 'success';
  if (result && failed) {
    const text = [result.subtype, ...(Array.isArray(result.errors) ? result.errors : []), typeof result.result === 'string' ? result.result : ''].join(' ');
    errors.push(redact(text).slice(0, 2000)); quota = quotaPattern.test(text);
  }
  const accounting = classifyUsage(usage);
  return { thread_id: result && safeId(result.session_id) ? result.session_id : session, usage, complete: !failed, quota, accounting_source: 'native',
    usage_status: results.length > 1 ? 'invalid' : accounting.status, usage_diagnostic: results.length > 1 ? 'Duplicate result event' : accounting.diagnostic,
    protocol_error: malformed || results.length !== 1 || failed, diagnostic: errors.join('; '),
    cost_usd: Number.isFinite(result?.total_cost_usd) ? result.total_cost_usd : null, turns: Number.isSafeInteger(result?.num_turns) ? result.num_turns : null };
}
function versionAtLeast(text, min) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text); if (!m) return false;
  const v = m.slice(1).map(Number);
  for (let i = 0; i < 3; i++) { if (v[i] !== min[i]) return v[i] > min[i]; }
  return true;
}
export async function preflightClaude() {
  const env = workerEnv();
  const version = await command([bin(), '--version'], { env, timeoutMs: 10000 });
  if (version.code !== 0) throw new CstackError('Claude Code CLI unavailable. Install and sign in to Claude Code; no paid API fallback is used.', 'AUTH');
  if (!versionAtLeast(version.stdout, CLAUDE_MIN_VERSION)) throw new CstackError(`Claude Code ${CLAUDE_MIN_VERSION.join('.')} or newer is required for controlled headless runs.`, 'CAPABILITY');
  const help = await command([bin(), '--help'], { env, timeoutMs: 10000 });
  for (const flag of ['--restricted', '--strict-mcp-config', '--permission-prompts', '--tools', '--settings', '--output-format'])
    if (!help.stdout.includes(flag)) throw new CstackError('Claude Code CLI lacks ' + flag + '; upgrade before running cStack.', 'CAPABILITY');
  const mode = claudeAuth();
  const status = await command([bin(), 'auth', 'status', '--json'], { env, timeoutMs: 10000 });
  let method = null; try { method = JSON.parse(status.stdout).authMethod; } catch {}
  const subscription = ['claude.ai', 'oauth_token'], keyed = ['api_key', 'api_key_helper'];
  if (mode === 'subscription' && (status.code !== 0 || !subscription.includes(method))) throw new CstackError('A Claude subscription login is required (claude auth login, or CLAUDE_CODE_OAUTH_TOKEN from claude setup-token). API-key login is used only when CSTACK_CLAUDE_AUTH=api-key is set explicitly.', 'AUTH');
  if (mode === 'api-key' && (status.code !== 0 || !keyed.includes(method))) throw new CstackError('CSTACK_CLAUDE_AUTH=api-key needs an API-key login stored by Claude Code itself (claude auth login --console). cStack never reads or forwards keys.', 'AUTH');
  return { worker: 'claude', authentication: mode === 'api-key' ? 'api-key' : 'subscription', allowance: mode === 'api-key' ? 'billed to the API account' : 'unknown',
    capabilities: 'restricted settings, no subagents/web/MCP, worktree-confined edits, sandboxed shell without network' };
}
export async function claudeWorker({ run, prompt, timeoutMs, signal, onSpawn }) {
  const lines = [];
  const result = await command([bin(), ...claudeArgs(run, prompt)], { cwd: run.worktree, timeoutMs: timeoutMs || run.contract.budget.worker_timeout_ms,
    signal, onSpawn, env: workerEnv(run.environment?.links || []), outputLimit: 3_000_000, orphanSafe: true, onLine: line => lines.push(line) });
  const parsed = parseClaudeEvents(lines);
  return { ...parsed, code: result.code || (parsed.protocol_error || result.truncated ? 1 : 0), timed_out: result.timedOut,
    diagnostic: redact(parsed.diagnostic || result.stderr || (parsed.protocol_error ? 'Missing or invalid result event' : '')).slice(-3000) };
}
