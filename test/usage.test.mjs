import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {classifyUsage,accountingForRun} from '../src/usage.mjs';
import {parseCodexEvents} from '../src/codex.mjs';
import {beginRun,processRun,loadRun} from '../src/core.mjs';
import {fixture,contract,correct} from './helpers/fixture.mjs';
test('USAGE-01: complete token vectors count subsets once',()=>{
  assert.equal(classifyUsage([{input_tokens:100,output_tokens:10,cached_input_tokens:80}]).totals.total_tokens,110);
  assert.equal(classifyUsage([{input_tokens:0,output_tokens:0}]).totals.cached_input_tokens,null);
});
test('USAGE-02 USAGE-03: missing, malformed, negative and overflowing counters are not free',()=>{
  assert.equal(classifyUsage([]).status,'unknown');
  for(const v of [{input_tokens:1},{input_tokens:-1,output_tokens:0},{input_tokens:true,output_tokens:1},{input_tokens:2,output_tokens:1,cached_input_tokens:3},{input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1}]) assert.equal(classifyUsage([v]).status,'invalid');
  assert.equal(accountingForRun([{id:'a',usage:[]}]).total_tokens,null);
});
test('USAGE-04: duplicate terminal events are ambiguous protocol',()=>{
  const line=JSON.stringify({type:'turn.completed',usage:{input_tokens:1,output_tokens:2}});
  const p=parseCodexEvents([line,line]); assert.equal(p.protocol_error,true); assert.equal(p.usage_status,'invalid');
});
test('USAGE-05 USAGE-06: missing accounting stops a correction and survives resume',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()}); let calls=0;
  await processRun(run,{home:f.home,worker:async({run:r})=>{calls++; await writeFile(join(r.worktree,'calc.mjs'),'// changed but wrong\nexport const add=(a,b)=>a-b;');return {code:0};}});
  assert.equal(calls,1); assert.equal(run.stop_code,'USAGE_UNRESOLVED'); assert.equal(run.status,'BLOCKED');
  const resumed=await loadRun(run.id,f.home); await processRun(resumed,{home:f.home,worker:()=>assert.fail('must not spend')});
  assert.equal(resumed.attempts.length,1); assert.equal(resumed.accounting.total_tokens,null);
});
test('USAGE-07: a passing candidate can retain truthful unknown accounting',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});
  await processRun(run,{home:f.home,worker:async x=>{await correct(x);return {code:0};}});
  assert.equal(run.status,'VERIFIED'); assert.equal(run.accounting.accounting_complete,false);
});
test('USAGE-08: native delta records sum once and invalid attempts block admission',()=>{
  const a=accountingForRun([{id:'1',status:'FINISHED',accounting_source:'native-delta',usage:[{input_tokens:10,output_tokens:2}]},{id:'2',status:'FINISHED',usage:[{input_tokens:5,output_tokens:1}]}]);
  assert.equal(a.total_tokens,18); assert.equal(a.can_admit,true);
  assert.equal(accountingForRun([{id:'1',usage_status:'invalid',usage:[{input_tokens:1,output_tokens:2}]}]).can_admit,false);
});
