import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, probe, correct } from './helpers/fixture.mjs';
import { setupProject } from '../src/setup.mjs';
import { createJobPlan, runJobPlan } from '../src/job-plan.mjs';
import { digestOf } from '../src/util.mjs';

async function prepared(t) {
  const f=await fixture(t,{'package.json':'{"scripts":{"test":"node --test"}}',
    'tests/project.test.mjs':"import test from 'node:test';test('project smoke',()=>{});"});
  const setup=await setupProject(f.repo,{image:'node:22.16.0-bookworm-slim',home:f.home});assert.equal(setup.ready,true,JSON.stringify(setup));
  const path=join(f.root,'acceptance.json');
  await writeFile(path,JSON.stringify({criteria:[probe],tasks:[{id:'add',title:'Correct addition',depends_on:[],criteria:['AC1']}],policy:'lean'}));
  const plan=await createJobPlan({repo:f.repo,profilePath:setup.profile,acceptancePath:path,goal:'Correct observable addition',output:join(f.root,'plan'),home:f.home});
  assert.equal(plan.ready,true,JSON.stringify(plan));return {...f,plan};
}

test('new plans freeze workflow data and retain an automatically discovered suite with explicit tasks',async t=>{
  const f=await prepared(t),plan=JSON.parse(await readFile(f.plan.plan,'utf8'));
  assert.equal(plan.schema_version,2);assert.ok(plan.workflow_digest);
  const contract=JSON.parse(await readFile(join(f.root,'plan','contract.json'),'utf8'));
  assert.ok(contract.tasks[0].criteria.includes('PROJECT_TESTS'));
  const file=join(f.root,'plan','workflow.json'),data=JSON.parse(await readFile(file,'utf8'));
  data.workflow.sessions='resume-v1';await writeFile(file,JSON.stringify(data));
  await assert.rejects(runJobPlan(f.plan.plan,f.plan.digest,{home:f.home,worker:()=>assert.fail('changed policy')}),{code:'PLAN_STALE'});
});

test('legacy plan schema 1 remains executable with its original continuity behavior',async t=>{
  const f=await prepared(t),plan=JSON.parse(await readFile(f.plan.plan,'utf8'));
  plan.schema_version=1;delete plan.workflow_digest;delete plan.preparation_digest;
  delete plan.versions.workflow;delete plan.versions.intake;
  const path=join(f.root,'plan','legacy.json');await writeFile(path,JSON.stringify(plan));
  const run=await runJobPlan(path,digestOf(plan),{home:f.home,worker:async x=>{
    assert.equal(x.run.workflow,undefined);return correct(x);
  }});
  assert.equal(run.status,'VERIFIED',run.reason);assert.equal(run.workflow,undefined);
});
