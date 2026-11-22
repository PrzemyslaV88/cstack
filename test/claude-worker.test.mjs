import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, contract, probe } from './helpers/fixture.mjs';
import { beginRun, processRun } from '../src/core.mjs';
import { claudeArgs, parseClaudeEvents, preflightClaude, claudeAuth, claudeSettings } from '../src/claude.mjs';
import { workerFor } from '../src/workers.mjs';
import { normalizeContract } from '../src/contracts.mjs';

// A stand-in `claude` executable. Behaviour comes from a JSON file beside it, because the worker
// environment deliberately carries no arbitrary variables. Each -p run is logged with its argv and env.
async function fakeClaude(t, f, { version = '2.1.330 (Claude Code)', auth = 'claude.ai', attempts = [] } = {}) {
  const dir = f.root, bin = join(dir, 'claude'), config = join(dir, 'fake-claude.json'), log = join(dir, 'fake-claude.log');
  await writeFile(config, JSON.stringify({ version, auth, attempts, log }));
  await writeFile(bin, `#!/usr/bin/env node
const fs=require('fs'),path=require('path');const c=JSON.parse(fs.readFileSync(${JSON.stringify(config)},'utf8'));const a=process.argv.slice(2);
if(a[0]==='--version'){console.log(c.version);process.exit(0);}
if(a[0]==='--help'){console.log('--restricted --strict-mcp-config --permission-prompts --tools --settings --output-format');process.exit(0);}
if(a[0]==='auth'){console.log(JSON.stringify({loggedIn:c.auth!=='none',authMethod:c.auth}));process.exit(c.auth==='none'?1:0);}
const n=fs.existsSync(c.log)?fs.readFileSync(c.log,'utf8').split('\\n').filter(Boolean).length:0;
fs.appendFileSync(c.log,JSON.stringify({argv:a,env:Object.keys(process.env).sort(),cwd:process.cwd()})+'\\n');
const step=c.attempts[Math.min(n,c.attempts.length-1)]||{};for(const [p,s] of Object.entries(step.write||{}))fs.writeFileSync(path.join(process.cwd(),p),s);
const sid='5d9c2a6e-1111-4222-8333-944455556666';const out=o=>process.stdout.write(JSON.stringify(o)+'\\n');
out({type:'system',subtype:'init',session_id:sid,tools:['Bash','Read','Edit','Write']});
out({type:'assistant',message:{content:[{type:'text',text:step.say||'All tests pass, done.'}]},session_id:sid});
out(step.result||{type:'result',subtype:'success',is_error:false,session_id:sid,num_turns:4,total_cost_usd:0.0123,result:step.say||'done',
 usage:{input_tokens:100,output_tokens:50,cache_read_input_tokens:1000,cache_creation_input_tokens:10}});
`);
  await chmod(bin, 0o755);
  const previous = { bin: process.env.CSTACK_CLAUDE_BIN, auth: process.env.CSTACK_CLAUDE_AUTH, key: process.env.ANTHROPIC_API_KEY };
  t.after(() => { for (const [k, v] of [['CSTACK_CLAUDE_BIN', previous.bin], ['CSTACK_CLAUDE_AUTH', previous.auth], ['ANTHROPIC_API_KEY', previous.key]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  process.env.CSTACK_CLAUDE_BIN = bin;
  return { log: async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(l => JSON.parse(l)) };
}
const claudeContract = (extra = {}) => contract({ schema_version: 3, worker: 'claude', ...extra });
const fixed = { 'calc.mjs': 'export const add=(a,b)=>a+b;\n' };

test('CLAUDE-01: the Claude worker runs restricted, without subagents, web, MCP or network, and denies prompts', async t => {
  const f = await fixture(t), run = await beginRun({ ...f, contract: claudeContract() });
  const args = claudeArgs(run, 'PROMPT');
  assert.deepEqual(args.slice(0, 2), ['-p', 'PROMPT'], 'the prompt precedes variadic flags');
  for (const flag of ['--restricted', '--strict-mcp-config', '--verbose']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--tools') + 1], 'Bash,Read,Edit,Write,Glob,Grep');
  for (const tool of ['Agent', 'WebFetch', 'WebSearch', 'mcp__*']) assert.ok(args.includes(tool), tool);
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(args[args.indexOf('--permission-prompts') + 1], 'none');
  assert.ok(!args.some(a => /bypass|dangerously/.test(a)));
  const sandbox = JSON.parse(claudeSettings()).sandbox;
  assert.deepEqual(sandbox, { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: true, network: { allowedDomains: [] } });
  assert.ok(!args.includes('--resume'));
  assert.deepEqual(claudeArgs({ ...run, thread_id: 'abc-1', contract: { ...run.contract, model: 'claude-opus-5-5', reasoning: 'high' } }, 'P').slice(-6), ['--effort', 'high', '--model', 'claude-opus-5-5', '--resume', 'abc-1']);
  assert.equal(workerFor(run.contract).name, 'claude'); assert.equal(workerFor({}).name, 'codex', 'frozen contracts without a worker keep Codex');
  assert.throws(() => normalizeContract(claudeContract({ worker: 'gpt' })), /worker must be codex or claude/);
});

test('CLAUDE-02: stream-json parsing maps usage, rejects missing, failed or duplicate results, and detects usage limits', () => {
  const ok = { type: 'result', subtype: 'success', is_error: false, session_id: 'sess-1', num_turns: 3, total_cost_usd: 0.5,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 2 } };
  const parsed = parseClaudeEvents([JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-1' }), JSON.stringify(ok)]);
  assert.equal(parsed.complete, true); assert.equal(parsed.protocol_error, false); assert.equal(parsed.thread_id, 'sess-1');
  assert.deepEqual(parsed.usage, [{ input_tokens: 112, cached_input_tokens: 100, output_tokens: 5 }]); assert.equal(parsed.usage_status, 'complete');
  assert.equal(parsed.cost_usd, 0.5); assert.equal(parsed.turns, 3);
  assert.equal(parseClaudeEvents([JSON.stringify({ type: 'system', session_id: 'x' })]).protocol_error, true, 'no result event');
  const maxTurns = parseClaudeEvents([JSON.stringify({ ...ok, subtype: 'error_max_turns', is_error: true, errors: ['Reached max turns'] })]);
  assert.equal(maxTurns.protocol_error, true); assert.match(maxTurns.diagnostic, /error_max_turns/); assert.equal(maxTurns.quota, false);
  assert.equal(parseClaudeEvents([JSON.stringify(ok), JSON.stringify(ok)]).usage_status, 'invalid');
  assert.equal(parseClaudeEvents(['not json', JSON.stringify(ok)]).protocol_error, true);
  assert.equal(parseClaudeEvents([JSON.stringify({ ...ok, subtype: 'error_during_execution', is_error: true, errors: ['Claude AI usage limit reached'] })]).quota, true);
  assert.equal(parseClaudeEvents([JSON.stringify({ ...ok, subtype: 'error_during_execution', is_error: true, errors: ['API overloaded'] })]).quota, false);
  assert.deepEqual(parseClaudeEvents([JSON.stringify({ ...ok, usage: { input_tokens: -1, output_tokens: 1 } })]).usage, []);
});

test('CLAUDE-03: subscription auth by default; API keys only when explicitly selected and never forwarded', async t => {
  const f = await fixture(t);
  await fakeClaude(t, f, { auth: 'claude.ai' });
  delete process.env.CSTACK_CLAUDE_AUTH;
  assert.equal((await preflightClaude()).authentication, 'subscription');
  await fakeClaude(t, f, { auth: 'api_key' });
  await assert.rejects(preflightClaude(), { code: 'AUTH', message: /subscription login is required/ }, 'an API-key login is not silently accepted');
  process.env.CSTACK_CLAUDE_AUTH = 'api-key';
  const keyed = await preflightClaude(); assert.equal(keyed.authentication, 'api-key'); assert.match(keyed.allowance, /billed/);
  await fakeClaude(t, f, { auth: 'claude.ai' });
  await assert.rejects(preflightClaude(), { code: 'AUTH', message: /never reads or forwards keys/ });
  delete process.env.CSTACK_CLAUDE_AUTH;
  await fakeClaude(t, f, { version: '2.1.100 (Claude Code)' });
  await assert.rejects(preflightClaude(), { code: 'CAPABILITY' });
  assert.throws(() => claudeAuth('automatic'), { code: 'AUTH' });
});

test('CLAUDE-04: a Claude worker repair is verified by the controller, with native usage and no API key in its environment', async t => {
  const f = await fixture(t), fake = await fakeClaude(t, f, { attempts: [{ write: fixed }] });
  process.env.ANTHROPIC_API_KEY = 'synthetic-not-a-real-key';
  const run = await beginRun({ ...f, contract: claudeContract() });
  await processRun(run, { home: f.home });
  assert.equal(run.status, 'VERIFIED', run.reason); assert.equal(run.auth.worker, 'claude');
  assert.deepEqual(run.usage, [{ input_tokens: 1110, cached_input_tokens: 1000, output_tokens: 50 }]);
  assert.equal(run.thread_id, '5d9c2a6e-1111-4222-8333-944455556666');
  const [call] = await fake.log();
  assert.equal(call.cwd, run.worktree, 'the worker edits only the private worktree');
  assert.ok(!call.env.includes('ANTHROPIC_API_KEY') && !call.env.includes('ANTHROPIC_AUTH_TOKEN'), 'no API key reaches the worker');
  assert.match(await readFile(join(f.home, 'runs', run.id, 'report.md'), 'utf8'), /Worker: claude; authentication: subscription/);
});

test('CLAUDE-05: a Claude claim of success does not complete a broken fix, and a failed result blocks', async t => {
  const f = await fixture(t);
  await fakeClaude(t, f, { attempts: [{ write: { 'calc.mjs': 'export const add=(a,b)=>Math.abs(a)+b;\n' }, say: 'Fixed. All tests pass.' }] });
  const run = await beginRun({ ...f, contract: claudeContract({ attempt_limit: 1 }) });
  await processRun(run, { home: f.home });
  assert.notEqual(run.status, 'VERIFIED'); assert.equal(run.results.AC1.status, 'FAIL');
  const g = await fixture(t);
  await fakeClaude(t, g, { attempts: [{ result: { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's', errors: ['tool failure'], usage: { input_tokens: 1, output_tokens: 1 } } }] });
  const blocked = await beginRun({ ...g, contract: claudeContract() });
  await processRun(blocked, { home: g.home });
  assert.equal(blocked.status, 'BLOCKED'); assert.match(blocked.reason, /Worker execution failed/);
});

test('CLAUDE-06: a correction resumes the same Claude session with the verifier feedback', async t => {
  const f = await fixture(t);
  const fake = await fakeClaude(t, f, { attempts: [{ write: { 'calc.mjs': 'export const add=(a,b)=>Math.abs(a)+b;\n' } }, { write: fixed }] });
  const run = await beginRun({ ...f, contract: claudeContract() });
  await processRun(run, { home: f.home });
  assert.equal(run.status, 'VERIFIED', run.reason); assert.equal(run.attempts.length, 2);
  const [first, second] = await fake.log();
  assert.ok(!first.argv.includes('--resume'));
  assert.equal(second.argv[second.argv.indexOf('--resume') + 1], '5d9c2a6e-1111-4222-8333-944455556666');
  assert.match(second.argv[1], /Independent verification feedback[\s\S]*AC1: FAIL/);
});

test('CLAUDE-07: plans freeze the selected worker and its own default model', async t => {
  const { setupProject } = await import('../src/setup.mjs'), { createJobPlan } = await import('../src/job-plan.mjs');
  const f = await fixture(t, { 'package.json': '{"scripts":{"test":"node --test"}}', 'tests/add.test.mjs': "import test from 'node:test';test('existing',()=>{});" });
  const setup = await setupProject(f.repo, { home: f.home }); assert.equal(setup.ready, true, JSON.stringify(setup));
  const acceptance = join(f.root, 'acceptance.json'); await writeFile(acceptance, JSON.stringify({ criteria: [probe] }));
  const plan = await createJobPlan({ repo: f.repo, profilePath: setup.profile, acceptancePath: acceptance, goal: 'Repair calculator addition', output: join(f.root, 'plan'), worker: 'claude', home: f.home });
  const frozen = JSON.parse(await readFile(join(f.root, 'plan', 'contract.json'), 'utf8')), stored = JSON.parse(await readFile(plan.plan, 'utf8'));
  assert.equal(frozen.worker, 'claude'); assert.equal(frozen.model, undefined, 'no Codex model leaks into a Claude plan'); assert.equal(stored.worker, 'claude');
  const codexPlan = await createJobPlan({ repo: f.repo, profilePath: setup.profile, acceptancePath: acceptance, goal: 'Repair calculator addition', output: join(f.root, 'plan2'), home: f.home });
  assert.equal(JSON.parse(await readFile(join(f.root, 'plan2', 'contract.json'), 'utf8')).worker, 'codex'); assert.equal(codexPlan.ready, true);
});
