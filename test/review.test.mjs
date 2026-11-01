import test from 'node:test';import assert from 'node:assert/strict';
import {writeFile,readFile,chmod,unlink} from 'node:fs/promises';import {join} from 'node:path';
import {fixture,contract,correct} from './helpers/fixture.mjs';
import {beginRun,processRun,approveRun} from '../src/core.mjs';
import {buildReview,exportReview} from '../src/review.mjs';
test('REVIEW-01 REVIEW-02 REVIEW-04 REVIEW-06 REVIEW-07 REVIEW-09: current diff separates review, binary changes and unknown spending without approval',async t=>{
 const f=await fixture(t,{'tests/check.test.mjs':'// original test fixture\n','old.txt':'old\n','binary.dat':Buffer.from([0,1])}),r=await beginRun({...f,contract:contract()});
 await processRun(r,{home:f.home,worker:async x=>{await correct(x);await writeFile(join(x.run.worktree,'tests/check.test.mjs'),"// <script>alert('x')</script>\n");await unlink(join(x.run.worktree,'old.txt'));await writeFile(join(x.run.worktree,'binary.dat'),Buffer.from([0,2]));return {code:0};}});
 const view=await buildReview(r);assert.equal(view.human_review,'PENDING');assert.equal(view.automated_checks,'PASS');assert.equal(view.accounting.total_tokens,null);assert.equal(r.approvals.length,0);
 assert.ok(view.files.find(x=>x.path==='tests/check.test.mjs').protected);assert.equal(view.files.find(x=>x.path==='old.txt').kind,'deleted');assert.equal(view.files.find(x=>x.path==='binary.dat').binary,true);
 const out=await exportReview(view,join(f.root,'review'),{excluded:[f.repo,r.worktree]});const page=await readFile(join(out.directory,'review.html'),'utf8');
 assert.ok(page.includes('&lt;script&gt;'));assert.ok(!page.includes('<script>'));assert.ok(page.includes('Human review: PENDING'));assert.equal(r.approvals.length,0);
 await assert.rejects(exportReview(view,out.directory));await assert.rejects(exportReview(view,join(f.repo,'report'),{excluded:[f.repo]}));
});
test('REVIEW-03: long diff previews are bounded while full artifact retains changes',async t=>{
 const f=await fixture(t),r=await beginRun({...f,contract:contract()});await processRun(r,{home:f.home,worker:async x=>{const result=await correct(x);await writeFile(join(x.run.worktree,'notes.txt'),Array.from({length:500},(_,i)=>'line '+i).join('\n'));return result;}});
 const view=await buildReview(r);assert.equal(view.files.find(x=>x.path==='notes.txt').truncated,true);assert.ok(view.full_diff.includes('line 499'));
});
test('REVIEW-05 REVIEW-08: changed snapshot makes a report stale and rejects old approval',async t=>{
 const f=await fixture(t),r=await beginRun({...f,contract:contract()});await processRun(r,{home:f.home,worker:correct});await chmod(join(r.worktree,'calc.mjs'),0o755);
 const view=await buildReview(r);assert.equal(view.stale,true);assert.equal(view.automated_checks,'STALE');
 await assert.rejects(approveRun(r.id,{home:f.home,criterion:'outcome',snapshot:r.snapshot.source_digest,note:'Actual review of earlier version'}),/stale/);
});

test('REVIEW-02: full review diff preserves add/delete/binary and executable metadata',async t=>{
 const {fileDiff}=await import('../src/review.mjs'),{mkdir}=await import('node:fs/promises'),{command}=await import('../src/process.mjs');const f=await fixture(t),before=join(f.root,'before'),after=join(f.root,'after');await mkdir(before);await mkdir(after);await writeFile(join(before,'mode.sh'),'echo okay\n');await writeFile(join(after,'mode.sh'),'echo okay\n');await writeFile(join(after,'empty'),'');await writeFile(join(before,'binary'),Buffer.from([0,1]));await writeFile(join(after,'binary'),Buffer.from([0,2]));const e=(path,mode=0o644)=>({path,type:'file',mode});
 const mode=await fileDiff(before,after,e('mode.sh'),e('mode.sh',0o755));assert.match(mode.diff,/old mode 100644\nnew mode 100755/);const added=await fileDiff(before,after,null,e('empty'));assert.match(added.diff,/new file mode 100644/);const removed=await fileDiff(before,after,e('binary'),null);assert.match(removed.diff,/deleted file mode/);const binary=await fileDiff(before,after,e('binary'),e('binary'));assert.match(binary.diff,/GIT binary patch/);
 const check=await command(['git','apply','--check','--'],{cwd:before,input:mode.diff+added.diff+binary.diff});assert.equal(check.code,0,check.stderr);
});
