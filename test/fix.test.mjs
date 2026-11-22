import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, scriptedUsage, correct } from './helpers/fixture.mjs';
import { fixDraft, fixApprove, DRAFT_FILE, draftPrompt } from '../src/fix.mjs';
import { captureOrigin, git } from '../src/snapshot.mjs';

const driver = "import {readFileSync} from 'node:fs';import {add} from './calc.mjs';console.log(JSON.stringify(add(...JSON.parse(readFileSync(0,'utf8')))))";
const goodDraft = { criteria: [{ id: 'BEHAVIOR', kind: 'probe', text: 'Addition returns the sum', argv: ['node', '--input-type=module', '-e', driver],
  cases: [{ id: 'bug', stdin: '[4,2]', expect_json: 6 }, { id: 'still-works', stdin: '[0,0]', expect_json: 0 }] }] };
const project = t => fixture(t, { 'package.json': '{"scripts":{"test":"node --test"}}', 'tests/add.test.mjs': "import test from 'node:test';test('existing',()=>{});" });
const drafter = (spec, extra = {}) => {
  const calls = [];
  const fn = async ({ run, prompt }) => {
    calls.push({ worktree: run.worktree, prompt });
    if (spec !== undefined) await writeFile(join(run.worktree, DRAFT_FILE), typeof spec === 'string' ? spec : JSON.stringify(spec));
    for (const [p, s] of Object.entries(extra)) await writeFile(join(run.worktree, p), s);
    return { code: 0, ...scriptedUsage };
  };
  fn.calls = calls; return fn;
};

test('FIX-01: fix drafts reproducing checks, proves they fail today, and waits for approval without touching the project', async t => {
  const f = await project(t), before = await captureOrigin(f.repo), draft = drafter(goodDraft, { 'calc.mjs': '// drafter must not fix code\n' });
  const r = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: draft });
  assert.equal(r.outcome, 'needs_you', JSON.stringify(r)); assert.equal(r.stage, 'approve'); assert.equal(r.checks_source, 'drafted by codex');
  assert.deepEqual(r.cases.map(c => [c.case, c.expected, c.fails_today]), [['bug', 6, true], ['still-works', 0, false]]);
  assert.equal(r.cases[0].today, 2, 'shows what the code does today');
  assert.match(r.next_action, new RegExp(`cstack fix --approve ${r.id}`));
  assert.match(draft.calls[0].prompt, /Do NOT fix/); assert.match(draft.calls[0].prompt, /FAILS with today's code/);
  assert.deepEqual(await captureOrigin(f.repo), before, 'the project is untouched');
  await assert.rejects(access(draft.calls[0].worktree), 'the drafting worktree is removed');
  assert.ok(!(await git(f.repo, 'worktree', 'list')).includes('draft-'), 'and unregistered');
});

test('FIX-02: approving runs the repair against exactly the approved checks', async t => {
  const f = await project(t);
  const draft = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: drafter(goodDraft) });
  let prompt = '';
  const done = await fixApprove(draft.id, { home: f.home, fixWorker: async x => { prompt = x.prompt; return correct(x); } });
  assert.equal(done.outcome, 'done', done.reason); assert.equal(done.status, 'VERIFIED');
  assert.equal(done.approved_by, 'person running --approve'); assert.deepEqual(done.changed_paths, ['calc.mjs']);
  assert.match(prompt, /BEHAVIOR: Addition returns the sum/);
  const approval = JSON.parse(await readFile(join(f.home, 'fixes', draft.id, 'approval.json'), 'utf8'));
  assert.equal(approval.plan_digest, draft.plan_digest);
});

test('FIX-03: drafted checks that already pass, or that do not reproduce, cannot be approved', async t => {
  const f = await project(t);
  const passing = { criteria: [{ ...goodDraft.criteria[0], cases: [{ id: 'zero', stdin: '[0,0]', expect_json: 0 }] }] };
  const r = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: drafter(passing) });
  assert.equal(r.outcome, 'needs_you'); assert.equal(r.stage, 'checks'); assert.match(r.reason, /already pass on the current code/);
  await assert.rejects(fixApprove(r.id, { home: f.home, fixWorker: correct }), { code: 'PLAN_NOT_READY' });
});

test('FIX-04: missing, malformed or non-probe drafts fail without a plan', async t => {
  for (const [spec, pattern] of [[undefined, /did not write a valid/], ['{not json', /did not write a valid/],
    [{ criteria: [{ id: 'T', kind: 'node-test', text: 'x', argv: ['node', '--test'], expected_tests: ['x'] }] }, /1-3 probe criteria/],
    [{ criteria: goodDraft.criteria, tasks: [] }, /Unknown drafted checks property|drafted checks/]]) {
    const f = await project(t);
    await assert.rejects(fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: drafter(spec) }), { code: /DRAFT_FAILED|INVALID/, message: pattern });
  }
  const f = await project(t);
  await assert.rejects(fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: async () => ({ code: 1, diagnostic: 'model refused' }) }), { code: 'DRAFT_FAILED', message: /model refused/ });
});

test('FIX-05: --yes runs straight through and records that no person reviewed the checks', async t => {
  const f = await project(t);
  const r = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, yes: true, draftWorker: drafter(goodDraft), fixWorker: correct });
  assert.equal(r.outcome, 'done', r.reason); assert.match(r.approved_by, /not reviewed by a person/);
});

test('FIX-06: approval is bound to the shown plan and the unchanged project', async t => {
  const f = await project(t);
  const tampered = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: drafter(goodDraft) });
  const planPath = tampered.plan, plan = JSON.parse(await readFile(planPath, 'utf8'));
  await writeFile(planPath, JSON.stringify({ ...plan, next_action: 'edited after review' }));
  await assert.rejects(fixApprove(tampered.id, { home: f.home, fixWorker: correct }), { code: 'PLAN_CHANGED' });
  const drifted = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, draftWorker: drafter(goodDraft) });
  await writeFile(join(f.repo, 'calc.mjs'), 'export const add=(a,b)=>a*b;\n'); await git(f.repo, 'commit', '-qam', 'unrelated change');
  await assert.rejects(fixApprove(drifted.id, { home: f.home, fixWorker: correct }), { code: 'PLAN_STALE' });
});

test('FIX-07: provided checks skip drafting; the draft prompt names the file and forbids edits', async t => {
  const f = await project(t), checks = join(f.root, 'checks.json');
  await writeFile(checks, JSON.stringify(goodDraft));
  const r = await fixDraft({ repo: f.repo, goal: 'Repair calculator addition', home: f.home, checks, draftWorker: () => assert.fail('no drafting with --checks') });
  assert.equal(r.stage, 'approve'); assert.equal(r.checks_source, 'provided');
  assert.match(draftPrompt('x'), new RegExp(DRAFT_FILE)); assert.match(draftPrompt('x'), /not from the current output/);
  assert.ok((await readdir(join(f.home, 'fixes'))).includes(r.id));
});
