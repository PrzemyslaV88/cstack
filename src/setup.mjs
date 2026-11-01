import {measurePhase} from './journey.mjs';
import {repository} from './repository.mjs';import {discoverProfile,validateProfile,storeProfile} from './project-profile.mjs';import {checkEnvironment} from './environment-plan.mjs';import {readJson} from './artifacts.mjs';import {createRunner} from './sandbox.mjs';import {executeTestSuite} from './test-adapters.mjs';import {testPath} from './file-policy.mjs';
import {requireThat,dataHome,compareText} from './util.mjs';
export function nodeTestFiles(reader,profile){return reader.files.filter(f=>/\.[cm]?js$/.test(f.path)&&testPath(f.path)&&profile.test.roots.some(r=>r==='.'||f.path===r||f.path.startsWith(r+'/'))).map(f=>f.path).sort(compareText);}
export async function collectProjectTests(profile,runner,cwd,{signal}={}){
 if(['pytest','vitest'].includes(profile.test.adapter)){
  const result=await executeTestSuite({...profile.test,config:null},runner,{cwd,signal,collect_only:true});
  requireThat(result.parsed.passed,'Project test collection failed: '+result.parsed.diagnostic,'PROJECT_COLLECTION_FAILED');return result.parsed.ids;
 }
 if(profile.test.adapter==='node-test'){
  const files=nodeTestFiles(await repository(cwd),profile);requireThat(files.length,'No Node test files found','PROJECT_COLLECTION_FAILED');
  const r=await runner.execute(['node','--test','--test-reporter=/runner/node-reporter.mjs',...files],{cwd,timeoutMs:30000,signal});
  requireThat(!r.truncated&&!r.timedOut&&!r.aborted,'Node collection incomplete','PROJECT_COLLECTION_FAILED');let events;try{events=r.stdout.trim().split('\n').filter(Boolean).map(x=>JSON.parse(x));}catch{throw Error('Malformed Node test report');}
  const ends=events.filter(e=>e.type==='cstack:test-stream-complete'),ids=events.filter(e=>['test:pass','test:fail'].includes(e.type)).map(e=>e.name);
  requireThat(ends.length===1&&events.at(-1)===ends[0]&&ids.length&&new Set(ids).size===ids.length,'Empty/duplicate/incomplete Node tests','PROJECT_COLLECTION_FAILED');return ids.sort(compareText);
 }
 return [];
}
export async function setupProject(repo,{profilePath,scope,adapter,image,conventions=[],home=dataHome(),signal}={}){
 requireThat(!profilePath||!scope&&!adapter&&!image&&!conventions.length,'--profile conflicts with discovery selections');const journey=[];const reader=await repository(repo);
 let profile=profilePath?await readJson(profilePath):await measurePhase(journey,'setup_discovery',()=>discoverProfile(reader,{scope,adapter,image,conventions}));await validateProfile(profile,reader);
 profile={...profile,readiness:'draft',missing:[]};let environment=null;
 try{
  environment=await measurePhase(journey,'environment_readiness',()=>checkEnvironment(profile,{cwd:reader.root,signal}));const runner=await createRunner({backend:'docker',image:environment.image_id});
  const expected_tests=await measurePhase(journey,'test_collection',()=>collectProjectTests(profile,runner,reader.root,{signal}));profile={...profile,test:{...profile.test,expected_tests},environment:{...profile.environment,image:environment.image_id},readiness:'ready'};
 }catch(e){profile.missing.push({code:e.code||'PROJECT_COLLECTION_FAILED',next_action:e.message});}
 const stored=await storeProfile(profile,reader.root,home);
 return {schema_version:1,journey,ready:profile.readiness==='ready',controller_ready:true,worker_ready:'not_checked',project_verifier_ready:profile.readiness==='ready',environment,profile:stored.path,profile_digest:stored.digest,details:profile,code:profile.readiness==='ready'?'PROJECT_READY':profile.missing[0]?.code,next_action:profile.missing[0]?.next_action||'Create a plan with concrete acceptance checks.'};
}
