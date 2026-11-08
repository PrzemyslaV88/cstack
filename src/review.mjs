import {readFile,writeFile,mkdtemp,rm,symlink,chmod,mkdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {hash,json,digestOf,requireThat} from './util.mjs';
import {verifierIdentity} from './verification.mjs';
import {manifest,fingerprint,manifestChanges} from './snapshot.mjs';
import {reviewDetails,effectiveStatus} from './core.mjs';
import {accountingForRun} from './usage.mjs';
import {command,cleanEnv} from './process.mjs';
import {html} from './cli-output.mjs';
import {testPath,configPath} from './file-policy.mjs';
import {newOutputDirectory} from './artifacts.mjs';
import {requirementCoverage,standardsReview,summaryMarkdown,pullRequestMarkdown,workflowSummary} from './review-summary.mjs';

async function contents(root,e) {return !e ? Buffer.alloc(0) : e.type==='symlink' ? Buffer.from(e.target) : readFile(join(root,e.path));}
export async function fileDiff(beforeRoot,afterRoot,a,b) {
  const before=await contents(beforeRoot,a),after=await contents(afterRoot,b),path=(b||a).path;
  let binary=before.includes(0)||after.includes(0);try {new TextDecoder('utf-8',{fatal:true}).decode(before);new TextDecoder('utf-8',{fatal:true}).decode(after);}catch{binary=true;}
  const dir=await mkdtemp(join(tmpdir(),'cstack-diff-'));
  try {
    for(const [name,entry,bytes] of [['before',a,before],['after',b,after]])if(entry){if(entry.type==='symlink')await symlink(entry.target,join(dir,name));else{await writeFile(join(dir,name),bytes);await chmod(join(dir,name),entry.mode&0o111?0o755:0o644);}}
    const result=await command(['git','-c','core.hooksPath=/dev/null','diff','--no-index','--no-ext-diff','--no-textconv','--binary','--full-index','--unified=3','--',a?'before':'/dev/null',b?'after':'/dev/null'],
      {cwd:dir,env:cleanEnv({GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}),outputLimit:32*1024*1024,timeoutMs:15000});
    requireThat([0,1].includes(result.code)&&!result.truncated,'Diff exceeds limits or failed','PATCH_INTEGRITY');
    const diff=result.stdout.replace(/^diff --git .*$/m,()=> 'diff --git '+JSON.stringify('a/'+path)+' '+JSON.stringify('b/'+path))
      .replace(/^--- .*$/m,()=> '--- '+(a?JSON.stringify('a/'+path):'/dev/null')).replace(/^\+\+\+ .*$/m,()=> '+++ '+(b?JSON.stringify('b/'+path):'/dev/null'));
    const lines=diff.split('\n'); const added=lines.filter(l=>l.startsWith('+')&&!l.startsWith('+++')),removed=lines.filter(l=>l.startsWith('-')&&!l.startsWith('---'));
    return {diff,binary,added_lines:binary?null:added.length,deleted_lines:binary?null:removed.length,
      syntax_flags:[...(removed.some(l=>/\b(assert|expect)\b/.test(l))?['assertion-lines-removed']:[]),
        ...(removed.some(l=>/\b(assert|expect)\b/.test(l))&&added.some(l=>/\b(assert|expect)\b/.test(l))?['expected-value-lines-changed']:[]),
        ...(added.some(l=>/\b(skip|xfail|todo)\b/.test(l))?['test-skip-marker-added']:[])]};
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function buildReview(run) {
  requireThat(run.snapshot && run.initial_snapshot,'No candidate snapshot to review');
  let stale=false;
  try {stale=await fingerprint(run.worktree,run.contract)!==run.snapshot.source_digest || hash(json(await manifest(run.snapshot.path,run.contract)))!==run.snapshot.artifact_digest;
    const version=await verifierIdentity();
    for(const p of Object.values(run.results)) if(p.evidence_hash) {
      if(p.verifier_identity!==version||p.contract_hash!==run.contract_hash||p.fingerprint!==run.snapshot.source_digest)stale=true;
      const dir=join(run.snapshot.path,'..','..','evidence');
      if(hash(await readFile(join(dir,p.evidence_hash+'.json')))!==p.evidence_hash || hash(await readFile(join(dir,p.output_hash+'.log')))!==p.output_hash) stale=true;
    }
  }catch{stale=true;}
  const details=reviewDetails(run),before=new Map(run.initial_snapshot.entries.map(x=>[x.path,x])),after=new Map(run.snapshot.entries.map(x=>[x.path,x]));
  const files=[];let remaining=2000,full='';
  for(const path of manifestChanges(run.initial_snapshot.entries,run.snapshot.entries)) {
    const a=before.get(path),b=after.get(path),diff=await fileDiff(run.initial_snapshot.path,run.snapshot.path,a,b);
    const lines=diff.diff.split('\n'),count=Math.min(remaining,200,lines.length);remaining-=count;
    full+=diff.diff;requireThat(Buffer.byteLength(full)<=32*1024*1024,'Review diff exceeds 32 MiB','PATCH_INTEGRITY');
    files.push({path,kind:!a?'added':!b?'deleted':a.sha256===b.sha256?'mode-change':'modified',
      before_digest:a?.sha256||null,after_digest:b?.sha256||null,before_bytes:a?.bytes??null,after_bytes:b?.bytes??null,before_mode:a?.mode??null,after_mode:b?.mode??null,added_test:!a&&testPath(path),protected:details.protected_changes.includes(path),
      protected_reason:details.protected_changes.includes(path)?'Existing tests, acceptance checks or configuration':null,
      binary:diff.binary,added_lines:diff.added_lines,deleted_lines:diff.deleted_lines,syntax_flags:[...diff.syntax_flags,...(!b&&testPath(path)?['test-file-deleted']:[]),...(configPath(path)?['configuration-changed']:[])],
      preview:diff.binary?'Binary content: inspect hashes and the full artifact':lines.slice(0,count).join('\n'),truncated:lines.length>count});
  }
  const status=stale?'STALE_EVIDENCE':await effectiveStatus(run);
  return {schema_version:2,run_id:run.id,goal:run.contract.goal,evidence_directory:join(run.snapshot.path,'..','..','evidence'),candidate:run.snapshot.source_digest,contract:run.contract_hash,status,stale:stale||status==='STALE_EVIDENCE',
    requirements:requirementCoverage(run,stale||status==='STALE_EVIDENCE'),standards:standardsReview(files),workflow:workflowSummary(run),
    automated_checks:stale?'STALE':details.automated_checks,human_review:details.pending.length?'PENDING':'SATISFIED', approval_commands:details.pending.map(p=>`cstack approve ${run.id} --criterion ${p.criterion} --snapshot ${run.snapshot.source_digest} --note \"ACTUAL_HUMAN_REVIEW_NOTE\"`),
    journey:run.journey||[],human_review_wait:run.human_review_wait||null,request_recorded_at:run.request_recorded_at||run.created,verified_at:status==='VERIFIED'?run.verified_at||null:null,applied_at:run.delivery?.status==='APPLIED'?run.applied_at||null:null,accounting:accountingForRun(run.attempts),delivery:run.delivery?.status||'NOT_APPLIED',
    baseline:run.baseline,checks:run.contract.criteria.map(c=>({id:c.id,required:c.required,text:c.text,status:run.results[c.id]?.status||'NOT_RUN'})),
    pending:details.pending,files,full_diff:full,next_actions:stale?['Resume to obtain current evidence.']:details.pending.length?['Review the named protected changes; approval must come from a person.']:['Inspect the patch and apply when delivery is authorized.'],
    note:'Syntax labels describe changed text, not semantic correctness. Reading this report is not approval.'};
}
export function reviewMarkdown(r) {
  return [`# cStack review — ${r.run_id}`,'',`Status: **${r.status}**`,`Automated checks: **${r.automated_checks}**`,`Human review: **${r.human_review}**`,`Delivery: **${r.delivery}**`,
    `Tokens: ${r.accounting.total_tokens ?? 'unknown'} (known lower bound ${r.accounting.known_total_tokens})`,`Candidate: ${r.candidate}`,'',...r.next_actions,'',r.note,'',
    ...r.pending.map(p=>`- Review ${html(p.criterion)}: ${html(p.reason)} — ${p.paths.map(path=>'<code>'+html(path)+'</code>').join(', ')}`),'',summaryMarkdown(r),'',
    ...r.files.flatMap(f=>[`## <code>${html(f.path)}</code>`,`${f.kind}; ${f.protected?'human review required':'supporting change'}${f.truncated?'; preview truncated':''}`,
      '','<pre>'+html(f.preview)+'</pre>',''])].join('\n');
}
export async function exportReview(review,output,{excluded=[]}={}) {
  const directory=await newOutputDirectory(output,excluded),{full_diff,evidence_directory,...record}=review;
  if(!review.stale){
    const artifacts=new Set(review.requirements.flatMap(c=>[c.baseline_evidence,c.candidate_evidence].filter(Boolean).flatMap(e=>[e.record+'.json',e.output+'.log'])));
    if(artifacts.size)await mkdir(join(directory,'evidence'),{mode:0o700});
    for(const name of artifacts){
      requireThat(/^[a-f0-9]{64}\.(json|log)$/.test(name),'Invalid evidence reference','INTEGRITY');
      const source=join(evidence_directory,name),info=await lstat(source);requireThat(info.isFile()&&info.size<=4000000,'Invalid evidence artifact','INTEGRITY');
      const bytes=await readFile(source);requireThat(hash(bytes)===name.split('.')[0],'Evidence artifact changed','INTEGRITY');
      await writeFile(join(directory,'evidence',name),bytes,{flag:'wx',mode:0o600});
    }
  }
  await writeFile(join(directory,'review.json'),json({...record,full_diff_sha256:hash(full_diff)}),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'review.md'),reviewMarkdown(review),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'review.diff'),full_diff,{flag:'wx',mode:0o600});
  await writeFile(join(directory,'pr.md'),pullRequestMarkdown(review),{flag:'wx',mode:0o600});
  const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>cStack review</title><style>body{font:16px/1.6 system-ui;margin:40px auto;padding:0 24px;max-width:1000px;color:#172033;background:#f4f7fb}section,details{background:white;border:1px solid #cbd5e1;border-radius:12px;padding:20px;margin:16px 0}h1{line-height:1.2}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}summary{cursor:pointer;font-weight:700}.status{font-size:20px}a{color:#1749a5}</style><h1>Review this change</h1><section class="status"><p>${html(review.status)}</p><p>Checks: ${html(review.automated_checks)} · Human review: ${html(review.human_review)} · Delivery: ${html(review.delivery)}</p><p>Tokens: ${html(review.accounting.total_tokens??'unknown')}</p></section><section><h2>Next action</h2>${review.next_actions.map(x=>'<p>'+html(x)+'</p>').join('')}<p>${html(review.note)}</p><p>Candidate: ${html(review.candidate)}</p></section>${review.files.map(f=>`<details><summary>${html(f.path)} — ${html(f.kind)}${f.protected?' — human review required':''}</summary><p>${html(f.syntax_flags.join(', '))}</p><pre>${html(f.preview)}</pre>${f.truncated?'<p>Preview truncated; full changes are in review.diff.</p>':''}</details>`).join('')}<p><a href="review.json">Evidence summary</a> · <a href="review.diff">Full diff</a></p></html>`;
  const sections=`<section><h2>Requirements</h2>${review.requirements.map(c=>`<p><strong>${html(c.id)}</strong>: ${html(c.before)} → ${html(c.after)}${c.integration?' (integration)':''}<br>${html(c.text)}</p>`).join('')}</section><section><h2>Standards</h2><p>${html(review.standards.note)}</p>${review.standards.findings.map(f=>`<p>${html(f.path)}: ${html(f.flag)}</p>`).join('')}</section><section><h2>Workflow</h2><p>Phase: ${html(review.workflow.phase||'legacy')}. Context occupancy: unknown.</p>${review.workflow.sessions.map(s=>`<p>${html(s.task)}: ${html(s.action||'legacy')} — ${html(s.reason||'continuity')}</p>`).join('')}<a href="pr.md">Local PR summary</a></section>`;
  await writeFile(join(directory,'review.html'),page.replace('<h1>Review this change</h1>','<h1>Review this change</h1>'+sections),{flag:'wx',mode:0o600});return {directory,files:['review.json','review.md','review.html','review.diff','pr.md'],digest:digestOf(record)};
}
