import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, contract, scriptedUsage, correct } from './helpers/fixture.mjs';
import { beginRun, processRun, effectiveStatus } from '../src/core.mjs';
import { loadRun, commitRun } from '../src/store.mjs';
import { loadCheckpoint, recoverCheckpoint } from '../src/checkpoint.mjs';
import { workflowPolicy } from '../src/workflow.mjs';
import { buildReview, exportReview } from '../src/review.mjs';
import { normalizePreparation } from '../src/intake.mjs';
import { digestOf } from '../src/util.mjs';

const observable = (id, module, call, expected) => ({id,text:id+' public interface result',kind:'probe',
  argv:['node','--input-type=module','-e',`import * as api from './${module}';console.log(JSON.stringify(${call}));`],
  cases:[{id:'worked-example',stdin:'',expect_json:expected}]});

async function staged(t, sessions='boundary-v1') {
  const f=await fixture(t,{'scale.mjs':'export const scale=x=>x*3;\n',
    'pipeline.mjs':"import {add} from './calc.mjs';import {scale} from './scale.mjs';export const result=()=>scale(add(2,3))-1;\n"});
  const criteria=[observable('ADD','calc.mjs','api.add(2,3)',5),observable('SCALE','scale.mjs','api.scale(2)',4),observable('INTEGRATION','pipeline.mjs','api.result()',10)];
  const tasks=[{id:'addition',title:'Correct addition',depends_on:[],criteria:['ADD']},
    {id:'scaling',title:'Correct scaling',depends_on:[],criteria:['SCALE']},
    {id:'whole-path',title:'Correct complete calculation',depends_on:['addition','scaling'],criteria:['INTEGRATION']}];
  const preparation=normalizePreparation({schema_version:1,non_goals:['Preserve the public exports.'],assumptions:[],decisions:[],
    outcome_sources:criteria.map(c=>({id:c.id,source:'Independent arithmetic example in the user requirement.',seam:'Exported module function'})),
    integration_criteria:['INTEGRATION'],brief_digest:digestOf({fixture:'arithmetic'})},criteria,tasks);
  const run=await beginRun({...f,contract:contract({schema_version:3,criteria,tasks,budget:{max_attempts:4}}),
    preparation,workflow:workflowPolicy({sessions})});
  return {...f,run};
}

test('three-phase journey rotates sessions, preserves the root outcome, verifies integration and exports before/after evidence',async t=>{
  const f=await staged(t),seen=[];
  await processRun(f.run,{home:f.home,worker:async({run,prompt})=>{
    const task=run.attempts.at(-1).task_id;seen.push({task,thread:run.thread_id,prompt});
    if(task==='addition')await writeFile(join(run.worktree,'calc.mjs'),'export const add=(a,b)=>a+b;\n');
    if(task==='scaling')await writeFile(join(run.worktree,'scale.mjs'),'export const scale=x=>x*2;\n');
    if(task==='whole-path')await writeFile(join(run.worktree,'pipeline.mjs'),"import {add} from './calc.mjs';import {scale} from './scale.mjs';export const result=()=>scale(add(2,3));\n");
    return {code:0,thread_id:'thread-'+task,...scriptedUsage,worker_notes:{status:'VERIFIED',budget:999}};
  }});
  assert.equal(f.run.status,'VERIFIED',f.run.reason);assert.equal(seen.length,3);
  assert.ok(seen.every(s=>s.thread===null));assert.ok(seen.every(s=>s.prompt.includes('Preserve the public exports.')));
  assert.ok(seen.every(s=>s.prompt.includes('INTEGRATION')));
  assert.deepEqual(f.run.attempts.map(a=>a.phase),['implementation','implementation','integration']);
  assert.ok(f.run.attempts.every(a=>a.notes.status==='invalid'));assert.equal(f.run.approvals.length,0);
  const saved=await loadRun(f.run.id,f.home),checkpoint=await loadCheckpoint(saved,f.home);
  assert.equal(checkpoint.attempts,3);assert.equal(checkpoint.evidence.INTEGRATION.status,'PASS');
  const review=await buildReview(saved),exported=await exportReview(review,join(f.root,'review'),{excluded:[f.repo,saved.worktree]});
  assert.equal(review.requirements.find(c=>c.id==='INTEGRATION').before,'FAIL');
  assert.equal(review.requirements.find(c=>c.id==='INTEGRATION').after,'PASS');
  assert.equal(review.standards.status,'NOT_SEMANTICALLY_REVIEWED');
  const proof=review.requirements[0].candidate_evidence;
  assert.ok((await readFile(join(exported.directory,'evidence',proof.record+'.json'),'utf8')).includes('fingerprint'));
  assert.match(await readFile(join(exported.directory,'pr.md'),'utf8'),/before \*\*FAIL\*\*, after \*\*PASS\*\*/);
});

test('continuity comparison uses the same outcomes while explicit resume policy retains the previous thread',async t=>{
  const f=await staged(t,'resume-v1'),threads=[];
  await processRun(f.run,{home:f.home,worker:async({run})=>{
    const task=run.attempts.at(-1).task_id;threads.push(run.thread_id);
    if(task==='addition')await writeFile(join(run.worktree,'calc.mjs'),'export const add=(a,b)=>a+b;\n');
    if(task==='scaling')await writeFile(join(run.worktree,'scale.mjs'),'export const scale=x=>x*2;\n');
    if(task==='whole-path')await writeFile(join(run.worktree,'pipeline.mjs'),"import {add} from './calc.mjs';import {scale} from './scale.mjs';export const result=()=>scale(add(2,3));\n");
    return {code:0,thread_id:'continuous',...scriptedUsage};
  }});
  assert.equal(f.run.status,'VERIFIED',f.run.reason);assert.deepEqual(threads,[null,'continuous','continuous']);
  assert.equal(f.run.attempts.length,3);
});

test('a corrupt checkpoint blocks worker admission and preserves consumed attempts',async t=>{
  const f=await staged(t);
  await processRun(f.run,{home:f.home,worker:async()=>({code:1,...scriptedUsage,diagnostic:'temporary worker interruption'})});
  const attempts=f.run.attempts.length,pointer=f.run.checkpoint.digest;
  await unlink(join(f.home,'runs',f.run.id,'checkpoints',pointer+'.json'));
  await processRun(f.run,{home:f.home,worker:()=>assert.fail('Corrupt recovery must not admit a worker')});
  assert.equal(f.run.status,'BLOCKED');assert.match(f.run.reason,/CHECKPOINT_INTEGRITY/);
  assert.equal(f.run.attempts.length,attempts);assert.equal(f.run.checkpoint.digest,pointer);
  await assert.rejects(recoverCheckpoint(f.run.id,'0'.repeat(64),f.home),{code:'SOURCE_DIVERGED'});
  const restored=await recoverCheckpoint(f.run.id,f.run.snapshot.source_digest,f.home);
  assert.notEqual(restored.digest,pointer);
  const current=await loadRun(f.run.id,f.home);assert.equal(current.attempts.length,attempts);
  assert.equal(current.thread_id,null);assert.ok(await loadCheckpoint(current,f.home));
});

test('native compaction refreshes the next same-task attempt and does not relax the attempt limit',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract({schema_version:3,attempt_limit:2})});let calls=0;
  await processRun(run,{home:f.home,worker:async x=>{
    calls++;
    if(calls===1){await writeFile(join(x.run.worktree,'calc.mjs'),'export const add=(a,b)=>a-b+0;\n');return {code:0,thread_id:'compacted',compacted:true,...scriptedUsage};}
    assert.equal(x.run.thread_id,null);assert.match(x.prompt,/calc\.mjs/);return correct(x);
  }});
  assert.equal(run.status,'VERIFIED',run.reason);assert.equal(calls,2);assert.equal(run.attempts[1].session_reason,'context-compacted');
});

test('changed source cannot retain a verified result just because the checkpoint says complete',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract({schema_version:3})});
  await processRun(run,{home:f.home,worker:correct});assert.equal(run.status,'VERIFIED',run.reason);
  await writeFile(join(run.worktree,'calc.mjs'),'export const add=()=>0;\n');assert.equal(await effectiveStatus(run),'STALE_EVIDENCE');
});
