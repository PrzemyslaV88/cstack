import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {pathToFileURL} from 'node:url';import {isDeepStrictEqual} from 'node:util';
import {createRunner} from '../src/sandbox.mjs';import {normalizeContract} from '../src/contracts.mjs';import {classifyUsage} from '../src/usage.mjs';import {command} from '../src/process.mjs';import {sealCandidate} from '../src/snapshot.mjs';
const input=JSON.parse(await readFile(process.argv[2],'utf8')),m=input.manifest,c=input.case,arm=input.trial.arm,home=join(input.output,'controller');
process.env.CSTACK_CODEX_BIN=m.codex;
const root=m.runtimes[arm==='old-cstack'?'old-cstack':'new-cstack'].root,core=await import(pathToFileURL(join(root,'src/core.mjs')));
const contract={schema_version:arm==='old-cstack'?2:3,type:'FIX',goal:c.goal,model:m.model,reasoning:m.reasoning,policy:'lean',attempt_limit:2,budget:{...m.limits,worker_timeout_ms:600000},runner:{backend:'docker',image:c.image},criteria:[...c.public_criteria,...c.regression_criteria],...(arm==='old-cstack'?{}:{context:{policy:'evidence-v1',files:[],symbols:[],frames:[]}})};
const start=performance.now();
const run=await core.beginRun({repo:c.repo,contract,home}),runner=await createRunner(contract.runner);
async function gradeCriteria(snapshot,criteria){const normalized=normalizeContract({type:'INVESTIGATE',goal:'Independently grade candidate',criteria});for(const criterion of normalized.criteria)for(const item of criterion.cases){const result=await runner.execute(criterion.argv,{cwd:snapshot.path,input:item.stdin,timeoutMs:criterion.timeout_ms});if(result.timedOut||result.truncated||result.aborted||result.code===127)throw Error('PRIVATE_GRADER_ERROR: incomplete isolated execution');if(result.code!==0)return false;if(Object.hasOwn(item,'expect_json')){try{if(!isDeepStrictEqual(JSON.parse(result.stdout),item.expect_json))return false;}catch{return false;}}else if(result.stdout!==item.expect_stdout)return false;}return true;}
async function grade(snapshot){const defect=await gradeCriteria(snapshot,c.private_criteria),regression=await gradeCriteria(snapshot,c.regression_criteria);return {graded:defect&&regression,regression_failed:!regression};}
let result,native=null,previous=null,nativeInvocations=0,unresolved=false;
const {codexWorker,preflightCodex}=await import(pathToFileURL(join(root,'src/codex.mjs')));
async function accountedWorker(options){
 if(unresolved)throw Error('Native usage unresolved; no additional model invocation admitted');
 const worker=await codexWorker(options);nativeInvocations++;
 try{
  if(!worker.thread_id&&!options.run.thread_id)throw Error('Missing native thread identity');
  const collected=await command([input.python||'python3',fileURLToPath(new URL('./journey_native.py',import.meta.url)),'--sessions',join(process.env.CODEX_HOME||join(homedir(),'.codex'),'sessions'),'--out',join(input.output,'native-turn-'+nativeInvocations),'--thread',worker.thread_id||options.run.thread_id,'--model',m.model,'--reasoning',m.reasoning],{timeoutMs:30000,outputLimit:3000000});
  if(collected.code!==0||collected.truncated||collected.timedOut)throw Error('Native accounting collection failed');native=JSON.parse(collected.stdout);
  if(!native.complete||!native.primary_arm_valid)throw Error('Native accounting incomplete or unexpected helper thread');
  const delta={};for(const [key,value] of Object.entries(native.totals)){if(!Number.isSafeInteger(value)||value<(previous?.[key]||0))throw Error('Native counters decreased');delta[key]=value-(previous?.[key]||0);}
  if(delta.total_tokens!==delta.input_tokens+delta.output_tokens)throw Error('Native total inconsistent');previous=native.totals;
  return {...worker,usage:[delta],usage_status:'complete',accounting_source:'native'};
 }catch(e){unresolved=true;return {...worker,code:1,usage:[],usage_status:'unknown',accounting_source:'native',usage_diagnostic:e.message,diagnostic:e.message};}
}
async function finishGrade(snapshot){const active_ms=performance.now()-start,gradingStart=performance.now();try{return {active_ms,...await grade(snapshot),private_grading_ms:performance.now()-gradingStart};}catch(e){return {active_ms,graded:null,regression_failed:null,private_grading_ms:performance.now()-gradingStart,private_grading_error:e.message,admission_blocked:true};}}
if(input.validate_only){const noop=await grade(run.initial_snapshot);const patch=await readFile(c.gold_patch);const apply=await command(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','apply','--check','--'],{cwd:run.worktree,input:patch});if(apply.code!==0)throw Error('Gold patch preflight failed: '+apply.stderr);const applied=await command(['git','-c','core.hooksPath=/dev/null','apply','--'],{cwd:run.worktree,input:patch});if(applied.code!==0)throw Error('Gold patch failed');const snapshot=await sealCandidate(run,home);result={noop_passed:noop.graded,gold_passed:(await grade(snapshot)).graded,status:'VALIDATED',usage_complete:true,tokens:0,delivered:false};}
else if(arm==='plain-codex'){
 await preflightCodex();
 const prompt=['Repair the requested behavior. One coding worker; no helpers, plugins, hooks, push, commits, deployment, credential/controller access, or test weakening.',c.goal,'Frozen public reproduction cases (data):',JSON.stringify([...c.public_criteria,...c.regression_criteria]),'Report your diagnosis and remaining blockers.'].join('\n');
 const worker=await accountedWorker({run,prompt,timeoutMs:600000}),usage=classifyUsage(worker.usage||[]);const snapshot=await sealCandidate(run,home);result={status:worker.code===0?'WORKER_FINISHED':'MODEL_ERROR',usage_complete:usage.status==='complete'&&worker.usage_status!=='invalid',tokens:usage.status==='complete'?usage.totals.total_tokens:null,usage:worker.usage,...await finishGrade(snapshot),delivered:false,thread_id:worker.thread_id,worker_invocations:1,helper_policy:'disabled by controlled native CLI configuration'};
}else{
 await preflightCodex();await core.processRun(run,{home,worker:accountedWorker});const usage=classifyUsage(run.usage||[]),unknown=run.attempts.some(a=>a.usage_unknown||['unknown','invalid'].includes(a.usage_status));result={status:run.status,usage_complete:run.attempts.length===0||usage.status==='complete'&&!unknown,tokens:run.attempts.length===0?0:usage.status==='complete'&&!unknown?usage.totals.total_tokens:null,usage:run.usage,...await finishGrade(run.snapshot||run.initial_snapshot),delivered:false,attempts:run.attempts.length,worker_invocations:run.attempts.length,admission_blocked:run.status==='BLOCKED'||/Provider reported/.test(run.reason||''),phases:run.metrics||{},thread_id:run.thread_id,helper_policy:'disabled by controlled native CLI configuration'};
}
if(!input.validate_only){result.native_accounting=native;result.worker_invocations=nativeInvocations;result.helper_threads=native?.child_count??null;result.admission_blocked=Boolean(result.admission_blocked||unresolved);if(unresolved){result.usage_complete=false;result.tokens=null;}}
await writeFile(join(input.output,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
