// Additive test-change policy and fail-to-pass evidence.
//
// An edit to an existing test file normally needs human change review. Under the
// "additive" policy that review is not required when ALL of the following hold for
// the current sealed candidate:
//   1. every protected change is an existing Python test module whose change the
//      controller-owned static classifier (runners/test-changes.py) proves to be
//      additive: existing statements unchanged, only new tests added;
//   2. every required automated check passes on the candidate with ALL test files
//      restored to their baseline bytes (new test files removed). Added tests and
//      their import-time effects therefore cannot be what makes the original
//      checks pass.
// Separately, newly added tests are run against the baseline implementation.
// Tests that fail there and pass on the candidate are recorded as fail-to-pass
// evidence. That evidence is reported; it never replaces a frozen probe.
import {readFile,writeFile,cp,rm,mkdir,chmod} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash,json,redact,requireThat} from './util.mjs';
import {testPath,configPath} from './file-policy.mjs';
import {manifest} from './snapshot.mjs';
import {verify,verifierIdentity} from './verification.mjs';

export const testChangePolicies=['review','additive'];
// Contracts frozen before this policy existed keep their original review semantics.
export const testChangePolicy=contract=>contract?.schema_version===3&&contract.test_change_policy||'review';
const MAX_CLASSIFIER_INPUT=16*1024*1024,MAX_FILE=2*1024*1024;
const qualifiedName=/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)?$/;

async function readEntry(root,entry){
  const bytes=await readFile(join(root,entry.path));
  requireThat(hash(bytes)===entry.sha256,'Sealed snapshot content changed: '+entry.path,'INTEGRITY');return bytes;
}
function eligibility(run,path,before,after,fixtures){
  const a=before.get(path),b=after.get(path);
  if(configPath(path))return 'Configuration or collection files always need review';
  if(run.oracle_paths?.includes(path))return 'Frozen acceptance check file';
  if(!testPath(path))return 'Not a recognised test path';
  if(fixtures.has(path))return 'Approved test fixture';
  if(!a)return 'Not an existing test file';
  if(!b)return 'Existing test file deleted';
  if(a.type!=='file'||b.type!=='file')return 'Only regular files can be classified';
  if(a.mode!==b.mode)return 'File mode changed';
  if(!/\.py$/.test(path))return 'Additive classification supports Python test files only';
  if(a.bytes>MAX_FILE||b.bytes>MAX_FILE)return 'Test file exceeds the classifier size limit';
  return null;
}
function parseClassifier(result,requested){
  if(result.code!==0||result.timedOut||result.aborted||result.truncated)throw Error('Classifier did not complete: '+(result.stderr||'exit '+result.code).slice(0,500));
  const report=JSON.parse(result.stdout);
  requireThat(report&&report.schema_version===1&&typeof report.python==='string'&&Array.isArray(report.files)&&report.files.length===requested.length,'Malformed classifier report');
  return report.files.map((f,i)=>{
    requireThat(f.path===requested[i].path&&['additive','modified','unparsable','added-file'].includes(f.status),'Malformed classifier entry');
    requireThat(Array.isArray(f.added_tests)&&f.added_tests.length<=2000&&f.added_tests.every(t=>typeof t==='string'&&qualifiedName.test(t)),'Malformed added test names');
    requireThat(Array.isArray(f.reasons)&&f.reasons.length<=20&&f.reasons.every(r=>typeof r==='string'&&r.length<=1000),'Malformed classifier reasons');
    requireThat(requested[i].baseline===null?['added-file','unparsable'].includes(f.status):f.status!=='added-file','Classifier status does not match file kind');
    return {...f,python:report.python};
  });
}
// Builds a disposable tree from a sealed `base` with selected paths restored from another
// sealed snapshot or removed. Modes are set explicitly so an unprivileged verifier user can
// read the tree whatever the host umask.
async function buildTree(home,run,base,{restore=[],remove=[]}){
  const dir=join(home,'runs',run.id,'trees',randomUUID());
  await mkdir(dirname(dir),{recursive:true,mode:0o755});
  await cp(base,dir,{recursive:true,dereference:false,verbatimSymlinks:true,errorOnExist:true});
  for(const path of remove)await rm(join(dir,path),{force:true});
  for(const {root,entry} of restore){
    const destination=join(dir,entry.path);let current=dir;
    for(const part of dirname(entry.path).split('/').filter(x=>x&&x!=='.')){
      current=join(current,part);
      try{await mkdir(current,{mode:0o755});await chmod(current,0o755);}catch(e){if(e.code!=='EEXIST')throw e;}
    }
    const mode=entry.mode&0o111?0o755:0o644;
    await rm(destination,{force:true});await writeFile(destination,await readEntry(root,entry),{mode});await chmod(destination,mode);
  }
  const artifact_digest=hash(json(await manifest(dir,run.contract)));
  return {path:dir,artifact_digest};
}
function outcomesFrom(proof){
  const detail=proof?.details?.[0];
  // Only a complete, well-formed adapter report carries a staging identity.
  if(!detail?.staging||!Array.isArray(detail.cases)||['STALE','NOT_RUN'].includes(proof.status))return null;
  return new Map(detail.cases.map(c=>[c.id,c.outcome]));
}
function matchIds(ids,path,test){
  const id=path+'::'+test;return ids.filter(x=>x===id||x.startsWith(id+'['));
}

export async function assessTestChanges(run,runner,{home,signal,deadline=Infinity,protectedChanges}){
  const started=Date.now();
  const binding={fingerprint:run.snapshot.source_digest,artifact_digest:run.snapshot.artifact_digest,runner_identity:runner.identity,
    verifier_identity:await verifierIdentity(),contract_hash:run.contract_hash};
  const before=new Map(run.initial_snapshot.entries.map(e=>[e.path,e])),after=new Map(run.snapshot.entries.map(e=>[e.path,e]));
  const fixtures=new Set((run.contract.approved_test_fixtures||[]).map(f=>f.path));
  const files=[];
  for(const path of protectedChanges){
    const reason=eligibility(run,path,before,after,fixtures);
    files.push({path,kind:'existing',status:reason?'review':'pending',added_tests:[],reasons:reason?[reason]:[]});
  }
  for(const path of run.changed_paths)if(!before.has(path)&&after.get(path)?.type==='file'&&testPath(path)&&!configPath(path)&&!protectedChanges.includes(path))
    files.push({path,kind:'added',status:/\.py$/.test(path)&&after.get(path).bytes<=MAX_FILE?'pending':'added-file',added_tests:[],reasons:[]});
  const pending=files.filter(f=>f.status==='pending');
  let classifier=null;
  if(pending.length){
    const requested=[];let bytes=0;
    for(const f of pending){
      const candidate=await readEntry(run.snapshot.path,after.get(f.path)),baseline=f.kind==='existing'?await readEntry(run.initial_snapshot.path,before.get(f.path)):null;
      bytes+=candidate.length+(baseline?.length||0);
      requested.push({path:f.path,baseline:baseline?baseline.toString('base64'):null,candidate:candidate.toString('base64')});
    }
    try{
      requireThat(bytes<=MAX_CLASSIFIER_INPUT,'Changed test files exceed the classifier input limit');
      const remaining=deadline-Date.now();requireThat(remaining>0,'Active run deadline exhausted');
      const result=await runner.execute(['python','-I',runner.runnerPath('test-changes.py')],{cwd:run.snapshot.path,input:JSON.stringify({files:requested}),timeoutMs:Math.max(1,Math.min(60_000,remaining)),signal});
      const parsed=parseClassifier(result,requested);classifier={status:'COMPLETED',python:parsed[0]?.python||null};
      for(const [i,f] of pending.entries()){
        const r=parsed[i];f.added_tests=r.added_tests;f.reasons=r.reasons.map(x=>redact(x));
        f.status=f.kind==='added'?'added-file':r.status==='additive'?'additive':'review';
        if(r.status==='unparsable')f.reasons=f.reasons.length?f.reasons:['Unparsable test file'];
      }
    }catch(error){
      classifier={status:'ERROR',diagnostic:redact(String(error.message||error)).slice(0,1000)};
      for(const f of pending){f.status=f.kind==='added'?'added-file':'review';f.reasons=['Static classification unavailable: '+classifier.diagnostic];}
    }
  }
  const existing=files.filter(f=>f.kind==='existing');
  const eligible=existing.length>0&&existing.every(f=>f.status==='additive');
  const record={schema_version:1,policy:testChangePolicy(run.contract),...binding,files,classifier,
    original_tests:null,fail_to_pass:null,exempt_paths:[],duration_ms:0};

  const requiredAutomated=run.contract.criteria.filter(c=>c.required&&c.kind!=='manual');
  if(eligible){
    // Candidate implementation against exactly the original test files.
    const restore=existing.map(f=>({root:run.initial_snapshot.path,entry:before.get(f.path)}));
    const remove=files.filter(f=>f.kind==='added').map(f=>f.path);
    let tree;
    try{
      tree=await buildTree(home,run,run.snapshot.path,{restore,remove});
      const proofs=await verify({...run,contract:{...run.contract,criteria:requiredAutomated}},{path:tree.path,source_digest:run.snapshot.source_digest,artifact_digest:tree.artifact_digest},runner,{home,signal,deadline});
      const results=Object.fromEntries(requiredAutomated.map(c=>[c.id,{status:proofs[c.id]?.status||'NOT_RUN',evidence_hash:proofs[c.id]?.evidence_hash||null,diagnostic:proofs[c.id]?.status==='PASS'?'':(proofs[c.id]?.diagnostic||'').slice(0,1000)}]));
      const pass=requiredAutomated.length>0&&requiredAutomated.every(c=>results[c.id].status==='PASS');
      record.original_tests={status:pass?'PASS':'FAIL',tree_digest:tree.artifact_digest,results,
        reason:pass?'Required checks pass with the original test files':'Required checks do not pass with the original test files; the test edits need review'};
    }catch(error){record.original_tests={status:'ERROR',tree_digest:tree?.artifact_digest||null,results:{},reason:redact(String(error.message||error)).slice(0,1000)};}
    finally{if(tree)await rm(tree.path,{recursive:true,force:true});}
    if(record.original_tests.status==='PASS')record.exempt_paths=[...protectedChanges].sort();
  }

  // Fail-to-pass: newly added tests against the baseline implementation.
  const added=files.filter(f=>['additive','added-file'].includes(f.status));
  const suites=run.contract.criteria.filter(c=>c.kind==='test-suite'&&c.adapter==='pytest');
  if(!added.some(f=>f.added_tests.length))record.fail_to_pass={status:'NOT_MEASURED',reason:'No added Python tests were identified',tests:[]};
  else if(!suites.length)record.fail_to_pass={status:'NOT_MEASURED',reason:'No pytest test-suite check is configured',tests:[]};
  else{
    let tree;
    try{
      const restore=added.map(f=>({root:run.snapshot.path,entry:after.get(f.path)}));
      // New supporting test files (helpers, data) travel with the added tests.
      for(const path of run.changed_paths)if(!before.has(path)&&after.get(path)?.type==='file'&&testPath(path)&&!configPath(path)&&!added.some(f=>f.path===path))restore.push({root:run.snapshot.path,entry:after.get(path)});
      tree=await buildTree(home,run,run.initial_snapshot.path,{restore});
      const proofs=await verify({...run,contract:{...run.contract,criteria:suites}},{path:tree.path,source_digest:run.snapshot.source_digest,artifact_digest:tree.artifact_digest},runner,{home,signal,deadline});
      const tests=[];let usable=false;
      for(const f of added)for(const name of f.added_tests){
        let matched=false;
        for(const suite of suites){
          const candidate=outcomesFrom(run.results[suite.id]),baseline=outcomesFrom(proofs[suite.id]);
          if(!candidate||!baseline)continue;usable=true;
          for(const id of matchIds([...candidate.keys()],f.path,name)){
            matched=true;const now=candidate.get(id),then=baseline.get(id);
            const kind=now!=='passed'?'not-passing-on-candidate':['failed','error'].includes(then)?'fail-to-pass':then==='passed'?'pass-to-pass':then===undefined?'not-collected-on-baseline':'not-run-on-baseline';
            tests.push({id,criterion:suite.id,baseline:then??'not-collected',candidate:now,kind});
          }
          if(matched)break;
        }
        if(!matched)tests.push({id:f.path+'::'+name,criterion:null,baseline:null,candidate:'not-collected',kind:'not-collected-on-candidate'});
      }
      record.fail_to_pass=usable?{status:'MEASURED',tree_digest:tree.artifact_digest,
        evidence:Object.fromEntries(suites.map(s=>[s.id,proofs[s.id]?.evidence_hash||null])),tests:tests.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)}
        :{status:'ERROR',tree_digest:tree.artifact_digest,reason:'No complete adapter report for the candidate and baseline trees',tests:[]};
    }catch(error){record.fail_to_pass={status:'ERROR',reason:redact(String(error.message||error)).slice(0,1000),tests:[]};}
    finally{if(tree)await rm(tree.path,{recursive:true,force:true});}
  }
  record.duration_ms=Date.now()-started;
  const evidence=json(record),evidence_hash=hash(evidence),dir=join(home,'runs',run.id,'evidence');
  await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,evidence_hash+'.json'),evidence,{mode:0o600});
  return {...record,evidence_hash};
}

// Exemptions apply only to the exact candidate, contract and runner they were measured for.
export function currentExemptions(run,protectedChanges){
  const record=run.test_changes;
  if(!record||testChangePolicy(run.contract)!=='additive'||!protectedChanges.length)return [];
  if(record.fingerprint!==run.snapshot?.source_digest||record.artifact_digest!==run.snapshot?.artifact_digest||
    record.contract_hash!==run.contract_hash||record.runner_identity!==run.runner_identity||record.original_tests?.status!=='PASS')return [];
  const exempt=[...record.exempt_paths].sort(),wanted=[...protectedChanges].sort();
  return exempt.length===wanted.length&&exempt.every((p,i)=>p===wanted[i])?wanted:[];
}
// Called by the final evidence gate when a VERIFIED status relied on an exemption.
export async function exemptionEvidenceCurrent(run){
  const record=run.test_changes;
  if(!record?.evidence_hash||record.verifier_identity!==await verifierIdentity())return false;
  const {evidence_hash,...stored}=record;
  const bytes=await readFile(join(run.snapshot.path,'..','..','evidence',evidence_hash+'.json'));
  return hash(bytes)===evidence_hash&&hash(json(stored))===evidence_hash;
}
export function testChangeSummary(record){
  if(!record)return null;
  const tests=record.fail_to_pass?.tests||[],count=kind=>tests.filter(t=>t.kind===kind).length;
  return {policy:record.policy,snapshot:record.fingerprint,
    additive_files:record.files.filter(f=>f.status==='additive').map(f=>({path:f.path,added_tests:f.added_tests})),
    review_files:record.files.filter(f=>f.status==='review').map(f=>({path:f.path,reasons:f.reasons})),
    added_files:record.files.filter(f=>f.status==='added-file').map(f=>({path:f.path,added_tests:f.added_tests})),
    original_tests:record.original_tests?{status:record.original_tests.status,reason:record.original_tests.reason}:null,
    fail_to_pass:record.fail_to_pass?{status:record.fail_to_pass.status,reason:record.fail_to_pass.reason||null,
      fail_to_pass:count('fail-to-pass'),pass_to_pass:count('pass-to-pass'),other:tests.length-count('fail-to-pass')-count('pass-to-pass'),
      tests:tests.slice(0,200)}:null,
    exempt_paths:record.exempt_paths};
}
