import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { command, normalizeContract, beginRun, processRun, loadRun, changedPaths, effectiveStatus, CstackError } from '../src/core.mjs';

const runCommand=async(argv,cwd)=>{const r=await command(argv,{cwd});assert.equal(r.code,0,`${argv.join(' ')} failed: ${r.stderr}`);};
const contract=(overrides={})=>({type:'FIX',goal:'Repair incorrect calculator addition',policy:'lean',attempt_limit:2,criteria:[{id:'AC1',text:'Calculator returns the correct sum',kind:'command',argv:['node','--test','check.mjs']}],...overrides});
async function fixture(){
  const tmp=await mkdtemp(join(tmpdir(),'cstack-test-')),repo=join(tmp,'repo'),home=join(tmp,'state');await mkdir(repo);await mkdir(home);
  await runCommand(['git','init','-q'],repo);await runCommand(['git','config','user.name','cStack Test'],repo);await runCommand(['git','config','user.email','test@example.invalid'],repo);
  await writeFile(join(repo,'calc.mjs'),'export const add = (a,b)=> a - b;\n');
  await writeFile(join(repo,'check.mjs'),"import test from 'node:test';import assert from 'node:assert/strict';import {add} from './calc.mjs';test('add',()=>assert.equal(add(4,2),6));\n");
  await runCommand(['git','add','.'],repo);await runCommand(['git','commit','-qm','base'],repo);
  return {tmp,repo,home};
}
const workerEdit=content=>async({run})=>{await writeFile(join(run.worktree,'calc.mjs'),content);return {code:0,usage:[]};};
const corrected=workerEdit('export const add = (a,b)=> a + b;\n');

test('contract rejects missing acceptance checks, dangling dependencies and cycles',()=>{
  assert.throws(()=>normalizeContract(contract({criteria:[]})),/At least one/);
  assert.throws(()=>normalizeContract(contract({tasks:[{id:'T1',depends_on:['T2'],criteria:['AC1']},{id:'T2',depends_on:['T1'],criteria:[]}]})),/cycle/);
  assert.throws(()=>normalizeContract(contract({tasks:[{id:'T1',depends_on:['UNKNOWN'],criteria:['AC1']}]})),/Invalid dependency/);
  assert.throws(()=>normalizeContract(contract({criteria:[{id:'AC1',text:'Bad',kind:'command',argv:'npm test'}]})),/argv array/);
});

test('verified source fix passes independent regression and produces durable report',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  const out=await processRun(run,{home,worker:corrected});
  assert.equal(out.status,'VERIFIED');assert.equal(out.results.AC1.status,'PASS');assert.deepEqual(out.changed_paths,['calc.mjs']);
  const again=await loadRun(run.id,home);assert.equal(again.status,'VERIFIED');
  assert.match(await readFile(join(home,'runs',run.id,'report.md'),'utf8'),/VERIFIED/);
});

test('agent saying done with no actual source change is not VERIFIED',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  const out=await processRun(run,{home,worker:async()=>({code:0,diagnostic:'All solved!',usage:[]})});
  assert.equal(out.status,'STALLED');assert.equal(out.attempts[0].decision,'PARTIAL');
  assert.equal(out.results.AC1.status,'FAIL');
});

test('tests-only patch cannot satisfy implementation contract',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  const worker=async({run:r})=>{await writeFile(join(r.worktree,'check.mjs'),"import test from 'node:test';test('fake passing test',()=>{});\n");return {code:0};};
  const out=await processRun(run,{home,worker});
  assert.notEqual(out.status,'VERIFIED');assert.equal(out.attempts[0].decision,'NEEDS_MANUAL_VERIFICATION');
});

test('failed independent oracle cannot be overridden by agent self-report',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract({attempt_limit:1}),home});
  const out=await processRun(run,{home,worker:workerEdit('export const add = (a,b)=> a * b;\n')});
  assert.equal(out.status,'STALLED');assert.equal(out.results.AC1.status,'FAIL');
});

test('repair loop retries and succeeds without extra agents',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract({attempt_limit:2}),home});let calls=0;
  const worker=async({run:r})=>{calls++;await writeFile(join(r.worktree,'calc.mjs'),calls===1?'export const add = (a,b)=> a * b;\n':'export const add = (a,b)=> a + b;\n');return {code:0};};
  const out=await processRun(run,{home,worker});
  assert.equal(out.status,'VERIFIED');assert.equal(calls,2);assert.equal(out.attempts[0].proof.AC1.status,'FAIL');assert.equal(out.attempts[1].proof.AC1.status,'PASS');
  assert.notEqual(out.attempts[0].after,out.attempts[1].after);
});

test('manual oracle prevents VERIFIED even if source was fixed',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract({criteria:[{id:'AC1',text:'Human validates real purchase',kind:'manual'}]}),home});
  const out=await processRun(run,{home,worker:corrected});assert.equal(out.status,'NEEDS_MANUAL_VERIFICATION');
});

test('quota stop preserves worktree and run state',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  const out=await processRun(run,{home,worker:async()=>({code:1,quota:true,diagnostic:'usage limit'})});
  assert.equal(out.status,'BUDGET_EXHAUSTED');assert.equal((await loadRun(out.id,home)).status,'BUDGET_EXHAUSTED');
});

test('tampered frozen contract refuses reload',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  await writeFile(join(home,'runs',run.id,'contract.json'),'{}');
  await assert.rejects(loadRun(run.id,home),/integrity/);
});

test('dirty repository is rejected to protect user changes',async()=>{
  const {repo,home}=await fixture();await writeFile(join(repo,'unexpected.txt'),'personal changes');
  await assert.rejects(beginRun({repo,contract:contract(),home}),/uncommitted\/untracked/);
});

test('all changes are bound to current fingerprint and can be invalidated',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract(),home});
  const out=await processRun(run,{home,worker:corrected});
  const old=out.results.AC1.fingerprint;
  await writeFile(join(out.worktree,'calc.mjs'),'export const add = (a,b)=> a + b + 1;\n');
  const {fingerprint}=await import('../src/core.mjs');
  assert.notEqual(await fingerprint(out.worktree),old);
  assert.equal(await effectiveStatus(out),'STALE_EVIDENCE');
  assert.deepEqual(await changedPaths(out.worktree,out.base),['calc.mjs']);
});

test('investigation may finish without runtime changes only with explicit contract',async()=>{
  const {repo,home}=await fixture(),run=await beginRun({repo,contract:contract({type:'INVESTIGATE',criteria:[{id:'AC1',text:'Investigation output exists',kind:'command',argv:['node','--version']}]}),home});
  const out=await processRun(run,{home,worker:async()=>({code:0})});
  assert.equal(out.status,'INVESTIGATED');
});


test('verifier configuration rewrite cannot make an npm script appear passed',async()=>{
  const {repo,home}=await fixture();
  await writeFile(join(repo,'package.json'),'{"scripts":{"test":"node --test check.mjs"}}\n');
  await runCommand(['git','add','package.json'],repo);await runCommand(['git','commit','-qm','add test script'],repo);
  const run=await beginRun({repo,contract:contract({criteria:[{id:'AC1',text:'Correct calculation',kind:'command',argv:['npm','test']}]}),home});
  const worker=async({run:r})=>{await writeFile(join(r.worktree,'package.json'),'{"scripts":{"test":"node -e \"process.exit(0)\""}}\n');return {code:0};};
  const out=await processRun(run,{home,worker});
  assert.notEqual(out.status,'VERIFIED');
});
