import { mkdir, readFile, writeFile, appendFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, relative, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const STATES = ['CREATED','BASELINED','READY','IMPLEMENTING','VERIFYING','REPAIR_READY','VERIFIED','PARTIAL','BLOCKED','STALLED','BUDGET_EXHAUSTED','NEEDS_MANUAL_VERIFICATION','INVESTIGATED'];
const TYPES = ['FIX','FEATURE','REFACTOR','INVESTIGATE'];
const END = new Set(['VERIFIED','PARTIAL','BLOCKED','STALLED','BUDGET_EXHAUSTED','NEEDS_MANUAL_VERIFICATION','INVESTIGATED']);
const hash = value => createHash('sha256').update(value).digest('hex');
const asJson = value => JSON.stringify(value, null, 2) + '\n';
const safeName = name => /^[a-zA-Z0-9._-]+$/.test(name);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class CstackError extends Error { constructor(message, code='INVALID'){ super(message); this.code=code; } }
export const dataHome = () => resolve(process.env.CSTACK_HOME || join(homedir(), '.cstack'));

// Commands are argv arrays; no shell interpretation of verifier input.
export async function command(argv, {cwd, timeoutMs=120_000, input, env=process.env, outputLimit=1_000_000}={}) {
  if (!Array.isArray(argv) || !argv.length || argv.some(x=>typeof x!=='string'||!x)) throw new CstackError('Command must be a nonempty string array');
  return await new Promise((done) => {
    let stdout='',stderr='',timedOut=false, truncated=false, finished=false;
    const childEnv={...env}; delete childEnv.NODE_TEST_CONTEXT; // Nested verifiers must not inherit Node's test-runner recursion guard.
    const child=spawn(argv[0],argv.slice(1),{cwd,env:childEnv,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    const add=(which,data)=>{ const s=data.toString(); if((which==='out'?stdout:stderr).length+s.length>outputLimit){truncated=true;return;} if(which==='out')stdout+=s; else stderr+=s; };
    child.stdout.on('data',d=>add('out',d)); child.stderr.on('data',d=>add('err',d));
    const timer=setTimeout(()=>{timedOut=true; try { if(process.platform!=='win32')process.kill(-child.pid,'SIGTERM'); else child.kill('SIGTERM'); }catch{} },timeoutMs);
    child.on('error',e=>{ if(!finished){finished=true;clearTimeout(timer);done({code:127,stdout,stderr:stderr+'\n'+e.message,timedOut,truncated});} });
    child.on('close',(code,signal)=>{if(!finished){finished=true;clearTimeout(timer);done({code:code??(signal?128:1),stdout,stderr,timedOut,truncated});}});
    if(input!==undefined)child.stdin.end(input);else child.stdin.end();
  });
}
const git = async (cwd,...args)=> {const out=await command(['git',...args],{cwd,timeoutMs:30_000});if(out.code!==0)throw new CstackError('git '+args[0]+': '+out.stderr.trim(),'GIT');return out.stdout.trim();};

export function normalizeContract(raw) {
  if (!raw || typeof raw!=='object') throw new CstackError('Contract must be a JSON object');
  const type=String(raw.type||'FIX').toUpperCase();
  if(!TYPES.includes(type))throw new CstackError('Unsupported contract type');
  if(typeof raw.goal!=='string'||raw.goal.trim().length<5)throw new CstackError('A meaningful goal is required');
  const policy=raw.policy||'balanced';
  if(!['lean','balanced','critical'].includes(policy))throw new CstackError('Policy must be lean, balanced or critical');
  const attempts=raw.attempt_limit??({lean:2,balanced:3,critical:3}[policy]);
  if(!Number.isInteger(attempts)||attempts<1||attempts>10)throw new CstackError('attempt_limit must be 1..10');
  const criteria=raw.criteria||[];
  if(!Array.isArray(criteria)||criteria.length===0)throw new CstackError('At least one acceptance criterion is required; use a manual criterion if no automated oracle exists');
  const ids=new Set();
  const validated=criteria.map((c,i)=>{
    const id=c.id||`AC${i+1}`;
    if(typeof id!=='string'||!safeName(id)||ids.has(id))throw new CstackError('Duplicate/invalid criterion ID: '+id);
    ids.add(id);
    if(typeof c.text!=='string'||!c.text.trim())throw new CstackError('Criterion '+id+' has no description');
    const kind=c.kind||'command';
    if(!['command','manual'].includes(kind))throw new CstackError('Unknown criterion kind '+kind);
    if(kind==='command'&&(!Array.isArray(c.argv)||!c.argv.length||c.argv.some(x=>typeof x!=='string'||!x)))throw new CstackError('Criterion '+id+' needs argv array');
    return {id,text:c.text,required:c.required!==false,kind,argv:kind==='command'?c.argv:undefined,timeout_ms:c.timeout_ms||120_000};
  });
  const tasks=raw.tasks||[{id:'T1',title:raw.goal,depends_on:[],criteria:validated.map(x=>x.id)}];
  if(!Array.isArray(tasks)||!tasks.length)throw new CstackError('At least one task is required');
  const tid=new Set();
  const mapped=tasks.map(t=>{if(typeof t.id!=='string'||!safeName(t.id)||tid.has(t.id))throw new CstackError('Invalid/duplicate task id'); tid.add(t.id);return {id:t.id,title:t.title||t.id,depends_on:t.depends_on||[],criteria:t.criteria||[]};});
  for(const t of mapped){ for(const d of t.depends_on)if(!tid.has(d)||d===t.id)throw new CstackError('Invalid dependency '+d);for(const id of t.criteria)if(!ids.has(id))throw new CstackError('Task references unknown acceptance criterion '+id); }
  const visited=new Set(),stack=new Set();
  const visit=id=>{if(stack.has(id))throw new CstackError('Task graph contains cycle');if(visited.has(id))return;stack.add(id);for(const d of mapped.find(x=>x.id===id).depends_on)visit(d);stack.delete(id);visited.add(id);};
  for(const t of mapped)visit(t.id);
  if(new Set(mapped.flatMap(t=>t.criteria)).size!==validated.length)throw new CstackError('Every criterion must be associated with a task');
  return {schema_version:1,type,goal:raw.goal.trim(),policy,attempt_limit:attempts,criteria:validated,tasks:mapped,requires_runtime_change:type!=='INVESTIGATE'};
}

export async function inspectRepo(repo) {
  const root=resolve(repo);
  const top=await git(root,'rev-parse','--show-toplevel');
  if(resolve(top)!==root)throw new CstackError('Specify the Git repository root: '+top);
  if(await git(root,'status','--porcelain'))throw new CstackError('Repository has uncommitted/untracked files; refusing to alter existing work','DIRTY');
  return {root,base:await git(root,'rev-parse','HEAD')};
}

export async function createWorktree(repo,base,id,home=dataHome()) {
  const dest=join(home,'worktrees',id);
  if(existsSync(dest))throw new CstackError('Worktree already exists');
  await mkdir(join(home,'worktrees'),{recursive:true});
  await git(repo,'worktree','add','--detach',dest,base);
  return dest;
}

export function openStore(home=dataHome()) {
  const db=new DatabaseSync(join(home,'state.db'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, goal TEXT NOT NULL, status TEXT NOT NULL, contract_hash TEXT NOT NULL, updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,seq));
    CREATE TABLE IF NOT EXISTS evidence (run_id TEXT NOT NULL, criterion_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, artifact_hash TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(run_id,criterion_id,fingerprint));
  `);
  return db;
}
async function save(run,home=dataHome()) {
  const dir=join(home,'runs',run.id); await mkdir(dir,{recursive:true});
  const path=join(dir,'run.json');const tmp=path+'.tmp';await writeFile(tmp,asJson(run));await (await import('node:fs/promises')).rename(tmp,path);
  const db=openStore(home);try{db.prepare('INSERT INTO runs VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated=excluded.updated').run(run.id,run.contract.goal,run.status,run.contract_hash,new Date().toISOString());}finally{db.close();}
}
async function emit(run,kind,payload={},home=dataHome()){
  run.event_seq=(run.event_seq||0)+1;const evt={seq:run.event_seq,at:new Date().toISOString(),kind,payload};
  await appendFile(join(home,'runs',run.id,'events.jsonl'),JSON.stringify(evt)+'\n');
  const db=openStore(home);try{db.prepare('INSERT INTO events VALUES(?,?,?,?,?)').run(run.id,evt.seq,evt.at,kind,JSON.stringify(payload));}finally{db.close();}
  await save(run,home);
}
export async function loadRun(id,home=dataHome()){
  if(!safeName(id))throw new CstackError('Invalid run id');
  const run=JSON.parse(await readFile(join(home,'runs',id,'run.json'),'utf8'));
  const stored=await readFile(join(home,'runs',id,'contract.json'),'utf8');
  if(hash(stored)!==run.contract_hash||JSON.stringify(JSON.parse(stored))!==JSON.stringify(run.contract))throw new CstackError('Frozen contract integrity failure','INTEGRITY');
  return run;
}
export async function beginRun({repo,contract,home=dataHome()}){
  const c=normalizeContract(contract),info=await inspectRepo(repo),id=randomUUID();
  const worktree=await createWorktree(info.root,info.base,id,home);
  const run={id,status:'CREATED',repo:info.root,base:info.base,worktree,contract:c,contract_hash:'',attempts:[],results:{},tasks:Object.fromEntries(c.tasks.map(t=>[t.id,'TODO'])),event_seq:0,thread_id:null,usage:[],changed_paths:[],baseline:{},created:new Date().toISOString()};
  await mkdir(join(home,'runs',id,'evidence'),{recursive:true});
  const frozen=asJson(c);run.contract_hash=hash(frozen);
  await writeFile(join(home,'runs',id,'contract.json'),frozen,{flag:'wx'});
  await save(run,home);await emit(run,'created',{repo:run.repo,base:run.base,worktree:run.worktree},home);
  return run;
}

export async function fingerprint(repo){
  const paths=await changedPaths(repo);
  const rec=[];
  for(const p of paths){const full=join(repo,p);let val='DELETED';try{val=hash(await readFile(full));}catch{} rec.push(p+':'+val);}
  return hash(rec.join('\n'));
}
export async function changedPaths(repo,base){
  const tracked=await git(repo,'diff','--name-only',base||'HEAD');
  const extras=await git(repo,'ls-files','--others','--exclude-standard');
  return [...new Set([...tracked.split('\n'),...extras.split('\n')].filter(Boolean))].sort();
}
const testPath=p=>/(^|\/)(__tests__|tests?|specs?|fixtures)(\/|$)|\.(test|spec)\.[^.]+$/.test(p);
export function runtimePaths(paths){return paths.filter(p=>!testPath(p)&&!/(^|\/)(docs?|\.github)(\/|$)/.test(p)&&!/(^|\/)(AGENTS\.md|README\S*|package(-lock)?\.json|tsconfig\S*|.*\.config\.[^.]+)$/.test(p)&&/\.(mjs|cjs|js|jsx|ts|tsx|py|swift|go|rs|java|kt|dart|rb|php|c|h|cpp|cs)$/.test(p));}
export function tampering(paths){return paths.filter(p=>testPath(p)||/(^|\/)(\.github|\.cstack|AGENTS\.md)(\/|$)/.test(p)||/(^|\/)(package\.json|pytest\.ini|tox\.ini|vitest\.config\.[^.]+|jest\.config\.[^.]+)$/.test(p));}

// Lightweight static code map, not a claimed semantic call graph.
export async function codeMap(repo,goal,{maxFiles=60,maxBytes=14_000}={}){
  const names=(await git(repo,'ls-files')).split('\n').filter(Boolean).filter(p=>!p.startsWith('node_modules/'));
  const terms=goal.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g)||[];
  const ranked=names.map(p=>({p,score:terms.reduce((s,t)=>s+(p.toLowerCase().includes(t)?4:0),0)+(p.startsWith('src/')?1:0)})).sort((a,b)=>b.score-a.score||a.p.localeCompare(b.p));
  const selected=ranked.slice(0,maxFiles).map(x=>x.p),links=[];let consumed=0;
  for(const p of selected){if(!/\.(ts|tsx|js|jsx|mjs|py)$/.test(p))continue;try{let source=await readFile(join(repo,p),'utf8');if(consumed+source.length>maxBytes)source=source.slice(0,Math.max(0,maxBytes-consumed));consumed+=source.length;const found=[...source.matchAll(/(?:from\s+|require\s*\(|import\s+)(?:['"])(\.{1,2}\/[^'"\s)]+)/g)];for(const match of found.slice(0,40))links.push({from:p,to:match[1],kind:'relative_import',confidence:'heuristic'});}catch{}if(consumed>=maxBytes)break;}
  return {files:selected,edges:links,truncated:names.length>maxFiles,method:'filename ranking + heuristic relative imports'};
}

async function verify(run,home=dataHome(),execute=command){
  const fp=await fingerprint(run.worktree),paths=await changedPaths(run.worktree,run.base);
  const proof={};
  for(const c of run.contract.criteria){
    if(c.kind==='manual'){proof[c.id]={status:'NEEDS_MANUAL_REVIEW',description:c.text,fingerprint:fp};continue;}
    const started=Date.now(),result=await execute(c.argv,{cwd:run.worktree,timeoutMs:c.timeout_ms});
    const output=result.stdout+'\n---stderr---\n'+result.stderr;
    const outputHash=hash(output);await writeFile(join(home,'runs',run.id,'evidence',outputHash+'.log'),output);
    const status=result.code===0&&!result.timedOut&&!result.truncated?'PASS':'FAIL';
    proof[c.id]={status,argv:c.argv,exit_code:result.code,timed_out:result.timedOut,output_truncated:result.truncated,duration_ms:Date.now()-started,fingerprint:fp,output_hash:outputHash};
    const db=openStore(home);try{db.prepare('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?)').run(run.id,c.id,fp,status,outputHash,new Date().toISOString());}finally{db.close();}
  }
  return {proof,paths,fp};
}
function classify(run,paths,proof){
  const required=run.contract.criteria.filter(x=>x.required);
  const passed=required.every(c=>proof[c.id]?.status==='PASS');
  const missing=required.some(c=>proof[c.id]?.status==='NEEDS_MANUAL_REVIEW');
  const source=runtimePaths(paths).length>0;
  const changes=paths.length>0;
  const integrity=paths.filter(p=>run.initial_paths?.includes(p)||run.oracle_paths?.includes(p)||/(^|\/)(\.github|\.cstack)(\/|$)/.test(p)||/(^|\/)(package(-lock)?\.json|pytest\.ini|tox\.ini|vitest\.config\.[^.]+|jest\.config\.[^.]+)$/.test(p));
  if(integrity.length)return {state:'NEEDS_MANUAL_VERIFICATION',reason:'Protected/test configuration changed: '+integrity.join(', ')};
  if(!changes && run.contract.type!=='INVESTIGATE')return {state:'PARTIAL',reason:'No code changes produced'};
  if(run.contract.requires_runtime_change&&!source)return {state:'PARTIAL',reason:'No runtime implementation files changed'};
  if(missing)return {state:'NEEDS_MANUAL_VERIFICATION',reason:'Required manual acceptance is not yet verified'};
  if(passed)return {state:run.contract.type==='INVESTIGATE'?'INVESTIGATED':'VERIFIED',reason:'All required independent checks passed'};
  return {state:'REPAIR_READY',reason:'Acceptance checks failed'};
}

export async function codexWorker({run,prompt,timeoutMs=900_000}){
  const args=['exec','--json','--sandbox','workspace-write','--cd',run.worktree];
  if(run.thread_id)args.push('resume',run.thread_id,'-');else args.push('-');
  const r=await command([process.env.CSTACK_CODEX_BIN||'codex',...args],{cwd:run.worktree,input:prompt,timeoutMs,outputLimit:3_000_000});
  let thread=run.thread_id;const usage=[];
  for(const line of r.stdout.split('\n')){try{const e=JSON.parse(line);if(e.type==='thread.started')thread=e.thread_id;if(e.type==='turn.completed'&&e.usage)usage.push(e.usage);}catch{}}
  const low=(r.stdout+' '+r.stderr).toLowerCase();
  const quota=/rate.limit|usage.limit|quota|too many requests|credits exhausted/.test(low);
  return {thread_id:thread,usage,code:r.code,timed_out:r.timedOut,quota,diagnostic:r.stderr.slice(-2000)};
}

function promptFor(run,task,context,prior){
  return [
    'You are the ONLY coding worker in a cStack run. Do not spawn subagents.',
    'The requested deliverable is WORKING IMPLEMENTATION, not an audit, report or plan.',
    `Objective: ${run.contract.goal}`,
    `Current task (${task.id}): ${task.title}`,
    'Required acceptance criteria:',...run.contract.criteria.filter(c=>task.criteria.includes(c.id)).map(c=>`${c.id}: ${c.text}`),
    'Work within this Git worktree. Do not push, deploy, alter credentials, modify protected cStack run state or weaken tests.',
    'Actually change the appropriate implementation files when fixing or building code.',
    'Your claims of success are not considered verification. Independent checks run after this turn.',
    `Likely relevant files (heuristic only): ${context.files.join(', ')}`,
    prior?`Prior verification failures: ${prior}`:'',
    'Proceed to implementation. Stop and report explicitly if blocked.'
  ].filter(Boolean).join('\n\n');
}
function taskReady(run){return run.contract.tasks.find(t=>run.tasks[t.id]!=='PASS'&&t.depends_on.every(d=>run.tasks[d]==='PASS'));}

export async function processRun(run,{home=dataHome(),worker=codexWorker,execute=command,afterAttempt}={}){
  if(END.has(run.status)&&run.status!=='PARTIAL'&&run.status!=='STALLED'&&run.status!=='BUDGET_EXHAUSTED')throw new CstackError('Run has terminal state '+run.status);
  const worktreeHead=await git(run.worktree,'rev-parse','HEAD');
  if(worktreeHead!==run.base)throw new CstackError('Worktree HEAD moved since creation; resolve manually','INTEGRITY');
  if(!run.baselined){
    run.status='BASELINED';const trackedPaths=(await git(run.worktree,'ls-files')).split('\n').filter(Boolean);
    run.initial_paths=trackedPaths.filter(testPath);
    run.oracle_paths=trackedPaths.filter(p=>run.contract.criteria.some(c=>c.argv?.includes(p)||c.argv?.includes('./'+p))); // Actual trusted oracles may have any filename.
    const base={};for(const c of run.contract.criteria){if(c.kind==='command'){const r=await execute(c.argv,{cwd:run.worktree,timeoutMs:c.timeout_ms});base[c.id]={exit_code:r.code,timed_out:r.timedOut};}}
    run.baseline=base;run.baselined=true;await emit(run,'baseline',{base},home);
  }
  const context=await codeMap(run.worktree,run.contract.goal);
  await writeFile(join(home,'runs',run.id,'code-map.json'),asJson(context));
  run.status='READY';await save(run,home);
  while(true){
    const task=taskReady(run);
    if(!task){run.status=Object.values(run.tasks).every(x=>x==='PASS')?'VERIFIED':'PARTIAL';break;}
    const count=run.attempts.filter(x=>x.task_id===task.id).length;
    if(count>=run.contract.attempt_limit){run.status='STALLED';run.reason='Attempt cap reached on '+task.id;break;}
    const prior=run.attempts.at(-1)?.failures||'';
    const before=await fingerprint(run.worktree);
    run.status='IMPLEMENTING';run.tasks[task.id]='IN_PROGRESS';await emit(run,'attempt_started',{task:task.id,number:count+1},home);
    let result;
    try{result=await worker({run,prompt:promptFor(run,task,context,prior)});}catch(e){result={code:1,diagnostic:String(e),usage:[]};}
    run.thread_id=result.thread_id||run.thread_id;
    run.usage.push(...(result.usage||[]));
    if(result.quota){run.status='BUDGET_EXHAUSTED';run.reason='Codex reported a usage/quota limit';await emit(run,'budget_exhausted',{task:task.id},home);break;}
    if(result.code!==0){run.status='BLOCKED';run.reason=`Codex execution failed (${result.code}): ${result.diagnostic||'unknown error'}`;await emit(run,'worker_error',{reason:run.reason},home);break;}
    run.status='VERIFYING';await save(run,home);
    const checked=await verify(run,home,execute),outcome=classify(run,checked.paths,checked.proof);
    const after=checked.fp;
    const failures=Object.entries(checked.proof).filter(([,x])=>x.status!=='PASS').map(([k,x])=>k+':'+x.status).join('; ');
    const attempt={task_id:task.id,number:count+1,before,after,changed_paths:checked.paths,proof:checked.proof,decision:outcome.state,reason:outcome.reason,failures,at:new Date().toISOString()};
    run.attempts.push(attempt);run.results=checked.proof;run.changed_paths=checked.paths;
    await emit(run,'attempt_verified',{task:task.id,number:count+1,outcome:outcome.state,reason:outcome.reason},home);
    if(afterAttempt)await afterAttempt(run);
    if(outcome.state==='VERIFIED'||outcome.state==='INVESTIGATED'){
      run.tasks[task.id]='PASS';if(run.contract.tasks.every(t=>run.tasks[t.id]==='PASS')){run.status=outcome.state;run.reason=outcome.reason;break;}run.status='READY';continue;
    }
    if(outcome.state==='NEEDS_MANUAL_VERIFICATION'){run.status=outcome.state;run.reason=outcome.reason;break;}
    if(after===before){run.status='STALLED';run.reason='Worker produced no new file changes on attempt '+(count+1);break;}
    if(count+1>=run.contract.attempt_limit){run.status='STALLED';run.reason='Attempt limit reached with unmet criteria';break;}
    run.status='REPAIR_READY';run.tasks[task.id]='READY';await save(run,home);
  }
  await emit(run,'run_stopped',{status:run.status,reason:run.reason||''},home);
  await writeReport(run,home);return run;
}
export async function effectiveStatus(run){
  if(run.status!=='VERIFIED'&&run.status!=='INVESTIGATED')return run.status;
  const current=await fingerprint(run.worktree);
  if(run.contract.criteria.some(c=>c.required&&run.results[c.id]?.fingerprint!==current))return 'STALE_EVIDENCE';
  return run.status;
}
export async function writeReport(run,home=dataHome()){
  const status=await effectiveStatus(run);
  const lines=[`# cStack run ${run.id}`,``, `**Outcome:** ${status}`,`**Goal:** ${run.contract.goal}`,`**Repository:** ${run.repo}`,`**Worktree:** ${run.worktree}`,`**Base SHA:** ${run.base}`,`**Contract hash:** ${run.contract_hash}`,`**Attempts:** ${run.attempts.length}`,`**Codex usage events:** ${run.usage.length}`,``, `## Acceptance criteria`,``];
  for(const c of run.contract.criteria){const p=run.results[c.id];lines.push(`- ${c.id} ${c.text}: **${p?.status||'NOT_RUN'}**${p?.output_hash?' (evidence SHA256 '+p.output_hash+')':''}`);}
  lines.push('', '## Runtime changes', ...runtimePaths(run.changed_paths).map(p=>'- '+p),'','## All changed paths',...run.changed_paths.map(p=>'- '+p),'','## Remaining issue',run.reason||'None reported','', '**Important:** Verified means the configured independent checks passed on the current worktree; it does not guarantee correctness beyond those checks. Nothing is pushed, merged or deployed by cStack.','');
  await writeFile(join(home,'runs',run.id,'report.md'),lines.join('\n'));return lines.join('\n');
}
export const isTerminal = state => END.has(state);
export const stateNames = STATES;
