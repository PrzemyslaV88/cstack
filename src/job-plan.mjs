import {nodeTestFiles} from './setup.mjs';
import {writeFile,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {repository} from './repository.mjs';import {validateProfile,storeProfile} from './project-profile.mjs';import {checkEnvironment} from './environment-plan.mjs';import {readJson,newOutputDirectory} from './artifacts.mjs';import {normalizeContract} from './contracts.mjs';import {captureOrigin} from './snapshot.mjs';import {verifierIdentity} from './verification.mjs';import {analyzeTrace} from './stack-analysis.mjs';import {readTraceFile} from './analysis-report.mjs';import {requireThat,exactKeys,digestOf,json,dataHome,hash} from './util.mjs';
const versions={plan:1,context:'evidence-v1',adapters:1,profile:1};
export async function createJobPlan({repo,profilePath,acceptancePath,goal,output,trace,sourceMode='clean',home=dataHome(),signal}){
 const planningStart=performance.now(),planningAt=new Date().toISOString();
 const reader=await repository(repo),profile=await readJson(profilePath),acceptance=await readJson(acceptancePath);
 exactKeys(acceptance,['criteria','model','reasoning','attempt_limit','budget','type','policy','implementation_paths','tasks','context','approved_test_fixtures'],'acceptance');requireThat(Array.isArray(acceptance.criteria)&&acceptance.criteria.length,'Acceptance criteria are required');
 await validateProfile(profile,reader);requireThat(profile.readiness==='ready','Project profile is not ready; run setup','PROJECT_NOT_READY');
 const environment=await checkEnvironment(profile,{cwd:reader.root,signal});const environment_digest=digestOf({image_id:environment.image_id,platform:environment.platform,versions:environment.versions,adapters:1});
 let context=acceptance.context||{policy:'evidence-v1',files:[],symbols:[],frames:[]};if(trace){const parsed=analyzeTrace(await readTraceFile(trace),reader);context={...context,frames:(parsed.frames||[]).filter(x=>x.path&&reader.known.has(x.path)).map(x=>({path:x.path,line:x.line}))};}
 const criteria=[...acceptance.criteria];if(profile.test.expected_tests.length&&!criteria.some(c=>['node-test','test-suite'].includes(c.kind))){requireThat(!criteria.some(c=>c.id==='PROJECT_TESTS'),'Reserved criterion ID PROJECT_TESTS');criteria.push(profile.test.adapter==='node-test'?{id:'PROJECT_TESTS',kind:'node-test',text:'Existing project tests pass',argv:['node','--test',...nodeTestFiles(reader,profile)],expected_tests:profile.test.expected_tests}:{id:'PROJECT_TESTS',kind:'test-suite',text:'Existing project tests pass',adapter:profile.test.adapter,roots:profile.test.roots,expected_tests:profile.test.expected_tests,plugins:profile.test.plugins,config:null});}
 const contract=normalizeContract({...acceptance,model:acceptance.model||'gpt-6.1-sol',criteria,schema_version:3,goal,source_mode:sourceMode,context,project:{profile_digest:digestOf(profile),environment_digest},runner:{backend:'docker',image:environment.image_id}});
 await storeProfile(profile,reader.root,home);const {beginRun,prepareBaseline}=await import('./core.mjs');const baseline=await beginRun({repo:reader.root,contract,home});baseline.journey=[{phase:'contract_planning',start_at:planningAt,end_at:new Date().toISOString(),duration_ms:performance.now()-planningStart,status:'COMPLETED',leaf:true}];await prepareBaseline(baseline,{home,signal});
 const reproduced=contract.criteria.some(c=>c.required&&c.kind==='probe'&&baseline.results[c.id]?.status==='FAIL');const pendingManual=contract.criteria.some(c=>c.required&&c.kind==='manual');
 const error=Object.values(baseline.results).some(p=>['ERROR','STALE'].includes(p.status));
 const ready=!error&&baseline.status!=='ALREADY_SATISFIED'&&(contract.type!=='FIX'||reproduced||pendingManual);
 const code=error?'BASELINE_ERROR':baseline.status==='ALREADY_SATISFIED'?'ALREADY_SATISFIED':ready?'PLAN_READY':'FAILURE_NOT_REPRODUCED';
 const plan={schema_version:1,ready,code,contract_digest:hash(json(contract)),profile_digest:digestOf(profile),environment_digest,origin:{root_id:baseline.origin.root_id,head:baseline.origin.head,ref:baseline.origin.ref,index_digest:baseline.origin.index_digest,inventory_digest:baseline.origin.inventory_digest,source_mode:sourceMode},
  model:contract.model,reasoning:contract.reasoning,context_policy:contract.context.policy,versions,verifier_identity:await verifierIdentity(),baseline:contract.criteria.map(c=>({id:c.id,status:baseline.results[c.id]?.status||'NOT_RUN'})),next_action:ready?'Run this frozen plan with its exact digest.':code==='ALREADY_SATISFIED'?'Configured outcomes already pass; no fix or worker spend was demonstrated.':'Resolve the stated baseline/setup issue and create a new plan.'};
 const directory=await newOutputDirectory(output,[reader.root,baseline.worktree]);
 for(const [name,value] of [['plan.json',plan],['contract.json',contract],['profile.json',profile],['local.json',{root:reader.root,baseline_run:baseline.id,home:resolve(home)}],['journey.json',{phases:baseline.journey,plan_duration_ms:performance.now()-planningStart,setup_to_ready_plan_ms:null,note:'Separate setup invocation and unmeasured user time are not inferred.'}]])await writeFile(join(directory,name),json(value),{flag:'wx',mode:0o600});
 await writeFile(join(directory,'plan.md'),`# Repair plan\n\n${goal}\n\nStatus: ${code}\n\n${plan.next_action}\n\nModel: ${plan.model}; context: ${plan.context_policy}\n\n${plan.baseline.map(c=>'- '+c.id+': '+c.status).join('\n')}\n\nBaseline evidence run: ${baseline.id}\n\nThe execution baseline is checked again. A profile/image prepares the verifier, not the host worker.\n`,{flag:'wx',mode:0o600});
 return {plan:join(directory,'plan.json'),digest:digestOf(plan),ready,code,next_action:plan.next_action,baseline_run:baseline.id};
}
export async function runJobPlan(path,expectedDigest,{home=dataHome(),signal,worker,onEvent}={}){
 const plan=await readJson(path);requireThat(digestOf(plan)===expectedDigest,'Plan content changed','PLAN_CHANGED');validateJobPlan(plan);requireThat(plan.schema_version===1&&plan.ready,'Plan is not ready: '+plan.code,'PLAN_NOT_READY');
 const dir=resolve(path,'..'),local=await readJson(join(dir,'local.json')),profile=await readJson(join(dir,'profile.json')),contract=await readJson(join(dir,'contract.json'));
 requireThat(hash(json(contract))===plan.contract_digest&&digestOf(profile)===plan.profile_digest,'Plan inputs changed','PLAN_STALE');
 const reader=await repository(local.root);await validateProfile(profile,reader);const origin=await captureOrigin(reader.root,contract);
 requireThat(['root_id','head','ref','index_digest','inventory_digest'].every(k=>origin[k]===plan.origin[k]),'Original project changed; create a new plan','PLAN_STALE');
 const env=await checkEnvironment(profile,{cwd:reader.root,signal});requireThat(digestOf({image_id:env.image_id,platform:env.platform,versions:env.versions,adapters:1})===plan.environment_digest&&await verifierIdentity()===plan.verifier_identity,'Verifier or environment changed','PLAN_STALE');
 const {beginRun,processRun}=await import('./core.mjs');const {commitRun,exportState}=await import('./store.mjs');const run=await beginRun({repo:reader.root,contract,home});
 run.plan_digest=expectedDigest;run.profile_digest=plan.profile_digest;run.project_profile=profile;commitRun(run,'plan_bound',{plan_digest:expectedDigest},home);await exportState(run,home);
 return processRun(run,{home,signal,worker,onEvent});
}

export function validateJobPlan(p){
 exactKeys(p,['schema_version','ready','code','contract_digest','profile_digest','environment_digest','origin','model','reasoning','context_policy','versions','verifier_identity','baseline','next_action'],'job plan');
 requireThat(p.schema_version===1&&typeof p.ready==='boolean'&&typeof p.code==='string'&&typeof p.next_action==='string','Invalid job plan');
 for(const key of ['contract_digest','profile_digest','environment_digest','verifier_identity'])requireThat(/^[a-f0-9]{64}$/.test(p[key]),'Invalid plan digest');
 exactKeys(p.origin,['root_id','head','ref','index_digest','inventory_digest','source_mode'],'origin');
 for(const key of ['root_id','index_digest','inventory_digest'])requireThat(/^[a-f0-9]{64}$/.test(p.origin[key]),'Invalid origin digest');
 requireThat(typeof p.origin.ref==='string'&&p.origin.ref.length>0&&/^[a-f0-9]{40,64}$/.test(p.origin.head)&&['clean','working-copy'].includes(p.origin.source_mode),'Invalid source identity');
 requireThat(typeof p.model==='string'&&/^[A-Za-z0-9._/-]{1,128}$/.test(p.model)&&['low','medium','high'].includes(p.reasoning)&&['evidence-v1','filename-v1'].includes(p.context_policy),'Invalid model/context');
 requireThat(digestOf(p.versions)===digestOf(versions),'Unsupported plan algorithms');requireThat(Array.isArray(p.baseline)&&p.baseline.length<=100,'Invalid baseline');for(const c of p.baseline){exactKeys(c,['id','status'],'baseline criterion');requireThat(typeof c.id==='string'&&typeof c.status==='string','Invalid criterion status');}return p;
}
