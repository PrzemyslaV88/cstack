import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, contract, probe } from './helpers/fixture.mjs';
import { workflowPolicy, selectSession, normalizeWorkerNotes } from '../src/workflow.mjs';
import { contextPacket, saveCheckpoint, loadCheckpoint } from '../src/checkpoint.mjs';
import { codexArgs, parseCodexEvents } from '../src/codex.mjs';
import { beginRun, promptFor } from '../src/core.mjs';
import { commitRun, loadRun } from '../src/store.mjs';
import { draftIntake, compileIntake } from '../src/intake.mjs';
import { buildContext } from '../src/context.mjs';
import { hash, digestOf } from '../src/util.mjs';
import { architectureInvestigation, exportInvestigation, retrospective } from '../src/investigations.mjs';

const notes = () => ({ diagnosis:'The observed result violates the supplied example.',next_action:'Fix the addition interface.',
  blockers:[],decisions:[],rejected_hypotheses:[],files:['calc.mjs'],checks_run:[] });

test('session boundaries produce a fresh CLI invocation without resetting task budgets or failures',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract({schema_version:3})});
  const task=run.contract.tasks[0];
  selectSession(run,task);run.thread_id='old-thread';run.session.turns=1;
  run.attempts.push({id:'attempt-a',task_id:task.id,failure_signature:'original-failure'});
  assert.equal(selectSession(run,task).fresh,false);
  assert.ok(codexArgs(run).includes('resume'));
  const count=run.attempts.length,budget=structuredClone(run.contract.budget);
  run.context_sent={thread:'old-thread',manifest:[]};
  assert.equal(selectSession(run,{id:'next',criteria:[]}).reason,'task-boundary');
  assert.ok(!codexArgs(run).includes('resume'));
  assert.equal(run.context_sent,null);assert.equal(run.attempts.length,count);
  assert.deepEqual(run.contract.budget,budget);assert.equal(run.attempts[0].failure_signature,'original-failure');
  assert.ok(codexArgs(run).includes('--output-schema'));
});

test('bounded continuation, compaction and recovery refresh context; legacy runs keep their policy',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});const task=run.contract.tasks[0];
  selectSession(run,task);run.thread_id='a';run.session.turns=run.workflow.max_session_turns;
  assert.equal(selectSession(run,task).reason,'bounded-continuation');
  run.thread_id='b';run.session.compacted=true;assert.equal(selectSession(run,task).reason,'context-compacted');
  run.thread_id='c';assert.equal(selectSession(run,task,true).reason,'recovery');
  const legacy=await beginRun({...f,contract:contract(),workflow:null});legacy.thread_id='keep';
  assert.equal(selectSession(legacy,task,true).fresh,false);assert.equal(legacy.thread_id,'keep');
  assert.ok(!codexArgs(legacy).includes('--output-schema'));
});

test('worker notes cannot forge completion, change budgets, name external files or grow without bound',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});
  assert.equal(normalizeWorkerNotes(undefined,run).status,'missing');
  for(const bad of ['not JSON',{...notes(),status:'VERIFIED'},{...notes(),budget:999},
    {...notes(),files:['../controller.json']},{...notes(),files:['not-in-project.mjs']},
    {...notes(),diagnosis:'a'.repeat(5000)}])assert.equal(normalizeWorkerNotes(bad,run).status,'invalid');
  const value=normalizeWorkerNotes({...notes(),diagnosis:'password=synthetic-value'},run);
  assert.equal(value.status,'accepted');assert.ok(!value.value.diagnosis.includes('synthetic-value'));
  assert.equal(run.status,'CREATED');assert.equal(run.approvals.length,0);assert.equal(run.attempts.length,0);
});

test('checkpoint publication is explicit; orphaned or corrupt artifacts cannot replace the current checkpoint',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});
  const first=await saveCheckpoint(run,f.home,'initial');
  assert.equal((await loadRun(run.id,f.home)).checkpoint,undefined);
  run.checkpoint=first;commitRun(run,'checkpoint_saved',{digest:first.digest},f.home);
  run.phase='implementation';await saveCheckpoint(run,f.home,'orphaned-before-state-commit');
  const loaded=await loadRun(run.id,f.home);assert.equal(loaded.checkpoint.digest,first.digest);
  assert.equal((await loadCheckpoint(loaded,f.home)).phase,'preparation');
  await writeFile(join(f.home,'runs',run.id,'checkpoints',first.digest+'.json'),'{}');
  await assert.rejects(loadCheckpoint(loaded,f.home),{code:'CHECKPOINT_INTEGRITY'});
});

test('frozen workflow identity cannot change on a stale object or during commit',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});
  run.workflow=workflowPolicy({sessions:'resume-v1'});run.workflow_digest=digestOf(run.workflow);
  assert.throws(()=>commitRun(run,'forged-workflow',{},f.home),/Frozen workflow/);
  const real=await loadRun(run.id,f.home);assert.equal(real.workflow.sessions,'boundary-v1');
});

test('starting packet preserves constraints and unmet integration outcomes; mandatory overflow fails visibly',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});run.phase='implementation';
  run.preparation={non_goals:['Preserve existing user edits'],assumptions:[],decisions:['Use the corrected public requirement']};
  const packet=contextPacket(run,run.contract.tasks[0],1000);
  assert.match(packet,/Preserve existing user edits/);assert.match(packet,/AC1/);assert.match(packet,/NOT_RUN/);
  run.preparation.decisions=['x'.repeat(7000)];assert.throws(()=>contextPacket(run,run.contract.tasks[0],1000),{code:'CONTEXT_BUDGET'});
});

test('new workflow runs reject oversized legacy-contract prompts instead of truncating the objective',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract({goal:'Repair '+ 'x'.repeat(40000)})});
  assert.throws(()=>promptFor(run,run.contract.tasks[0],{files:[],edges:[]}),{code:'CONTEXT_BUDGET'});
});

test('intake compiles known independent expectations into a dependency plan and refuses unresolved drafts',async t=>{
  const f=await fixture(t),draft=await draftIntake({repo:f.repo,goal:'Repair calculator addition',output:join(f.root,'draft')});
  await assert.rejects(compileIntake({repo:f.repo,briefPath:draft.brief,output:join(f.root,'empty')}),/observable outcomes/);
  const brief=JSON.parse(await readFile(draft.brief,'utf8'));
  brief.outcomes=[{criterion:probe,source:'User requirement: 4 plus 2 is 6, and -5 plus 3 is -2.',seam:'Exported add(a,b)'}];
  brief.tasks=[{id:'ADD',title:'Correct observable addition',depends_on:[],criteria:['AC1']}];
  brief.integration_criteria=['AC1'];await writeFile(draft.brief,JSON.stringify(brief));
  const ready=await compileIntake({repo:f.repo,briefPath:draft.brief,output:join(f.root,'ready')});
  const acceptance=JSON.parse(await readFile(ready.acceptance,'utf8'));
  assert.equal(acceptance.criteria[0].cases[0].expect_json,6);
  assert.equal(acceptance.preparation.outcome_sources[0].seam,'Exported add(a,b)');
  assert.equal(acceptance.workflow.sessions,'boundary-v1');assert.equal(ready.code,'ACCEPTANCE_PREPARED');
  brief.questions=['Should missing input be rejected?'];await writeFile(draft.brief,JSON.stringify(brief));
  await assert.rejects(compileIntake({repo:f.repo,briefPath:draft.brief,output:join(f.root,'question')}),{code:'OUTCOME_UNRESOLVED'});
  assert.equal(await readFile(join(f.repo,'calc.mjs'),'utf8'),'export const add=(a,b)=>a-b;\n');
});

test('selected long project vocabulary supplies relevant later entries inside the context limit',async t=>{
  const glossary=Array.from({length:100},(_,i)=>`Entry ${i}: unrelated vocabulary.`).join('\n')+'\n## Addition\nAddition combines values through add(a,b).\n';
  const f=await fixture(t,{'GLOSSARY.md':glossary}),cfg={...contract({schema_version:3}),context:{policy:'evidence-v1',files:[],frames:[],symbols:[]}};
  const context=await buildContext(f.repo,cfg,{conventions:[{path:'GLOSSARY.md',sha256:hash(glossary)}],matchConventions:true,byteLimit:8000});
  assert.match(context.text,/Addition combines values/);assert.ok(context.bytes<=8000);
});

test('transport notes and known compaction events remain separate from usage/completion authority',()=>{
  const parsed=parseCodexEvents([JSON.stringify({type:'thread.started',thread_id:'t'}),
    JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(notes())}}),
    JSON.stringify({type:'item.completed',item:{type:'context_compaction'}}),
    JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:3}})]);
  assert.equal(parsed.protocol_error,false);assert.equal(parsed.compacted,true);assert.equal(JSON.parse(parsed.worker_notes).files[0],'calc.mjs');
  assert.equal(parseCodexEvents([JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'VERIFIED'}})]).protocol_error,true);
});

test('an excerpt omitted by the byte budget is not falsely treated as already present in a resumed thread',async t=>{
  const f=await fixture(t),cfg={...contract({schema_version:3}),context:{policy:'evidence-v1',files:['calc.mjs'],frames:[],symbols:[]}};
  const omitted=await buildContext(f.repo,cfg,{byteLimit:0,strictDelta:true});
  assert.equal(omitted.text,'');
  const actual=await buildContext(f.repo,cfg,{previous:{thread:'same',manifest:omitted.manifest},thread:'same',strictDelta:true});
  assert.match(actual.text,/calc\.mjs/);
  const cached=await buildContext(f.repo,cfg,{previous:{thread:'same',manifest:actual.manifest},thread:'same',strictDelta:true});
  assert.equal(cached.text,'');
});

test('architecture and selected-run retrospectives are advisory, bounded and local',async t=>{
  const f=await fixture(t,{'consumer.mjs':"import {add} from './calc.mjs';"}),run=await beginRun({...f,contract:contract()});
  const before=await readFile(join(f.repo,'calc.mjs'),'utf8');
  const architecture=await architectureInvestigation(f.repo,{focus:'calc.mjs'});
  assert.equal(architecture.candidates[0].path,'calc.mjs');assert.equal(architecture.candidates[0].strength,'INVESTIGATION_TARGET_ONLY');
  const out=await exportInvestigation(architecture,join(f.root,'architecture'),[f.repo]);
  assert.ok((await readFile(join(out.directory,'report.html'),'utf8')).includes('Content-Security-Policy'));
  const retro=await retrospective([run.id],{home:f.home});assert.equal(retro.runs.length,1);assert.ok(retro.findings.some(f=>/regression suite/.test(f.problem)));
  assert.equal(await readFile(join(f.repo,'calc.mjs'),'utf8'),before);
});
