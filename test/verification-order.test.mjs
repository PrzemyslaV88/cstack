import test from 'node:test';import assert from 'node:assert/strict';import {fixture,contract} from './helpers/fixture.mjs';import {beginRun} from '../src/core.mjs';import {verify} from '../src/verification.mjs';
test('ADAPTER-10 ADAPTER-11: failed-first feedback stops early, success checks full current set',async t=>{
 const f=await fixture(t),criteria=['first','failed','optional'].map(id=>({id,kind:'probe',text:id,required:id!=='optional',argv:['node',id],cases:[{id:'one',stdin:'',expect_stdout:'yes'}]})),run=await beginRun({...f,contract:contract({schema_version:3,criteria})});run.results={first:{status:'PASS'},failed:{status:'FAIL'}};let order=[],pass=false;
 const runner={identity:'scripted-order',execute:async args=>{order.push(args[1]);return {code:0,stdout:pass?'yes':'no',stderr:''};}};
 const failed=await verify(run,run.initial_snapshot,runner,{home:f.home,focused:true});assert.deepEqual(order,['failed']);assert.equal(failed.first.status,'NOT_RUN');assert.equal(failed.optional.status,'NOT_RUN');
 pass=true;order=[];const complete=await verify(run,run.initial_snapshot,runner,{home:f.home,focused:true});assert.deepEqual(order,['failed','first','optional']);assert.ok(Object.values(complete).every(p=>p.status==='PASS'));
});
