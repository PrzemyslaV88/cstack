import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readPinnedFile} from '../src/safe-fs.mjs';
import {plain} from '../src/cli-output.mjs';
import {markdownBlock,markdownCode} from '../src/markdown.mjs';
import {writeReport} from '../src/core.mjs';

test('pinned reads accept regular files and reject final or ancestor symlinks',async t=>{
 const temporary=await mkdtemp(join(tmpdir(),'cstack-safe-read-')),root=await realpath(temporary);t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'inside'));await writeFile(join(root,'inside','file.txt'),'trusted');
 assert.equal((await readPinnedFile(root,'inside/file.txt')).toString(),'trusted');
 await mkdir(join(root,'..data'));await writeFile(join(root,'..data','file.txt'),'legitimate');assert.equal((await readPinnedFile(root,'..data/file.txt')).toString(),'legitimate');
 await symlink('file.txt',join(root,'inside','alias.txt'));
 await assert.rejects(readPinnedFile(root,'inside/alias.txt'));
 const outside=await mkdtemp(join(tmpdir(),'cstack-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await writeFile(join(outside,'secret.txt'),'outside');
 await symlink(outside,join(root,'escape'));
 await assert.rejects(readPinnedFile(root,'escape/secret.txt'),/escapes trusted root/);
});

test('terminal display neutralizes CSI, OSC, C1, carriage return and residual controls',()=>{
 const hostile='safe\x1b[2J\x1b]52;c;Y2FuYXJ5\x07\u009b31m\rreplace\x08\x7f\nnext\tcell';
 const rendered=plain(hostile);
 assert.equal(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(rendered),false);
 assert.match(rendered,/safe/);assert.match(rendered,/replace/);assert.match(rendered,/next\tcell/);
});

test('Markdown literals cannot terminate their dynamically sized code delimiters',()=>{
 const hostile='![remote](https://example.test/x) <img src=x>\n# forged\n```\n````';
 const inline=markdownCode(hostile),block=markdownBlock(hostile),lines=block.split('\n');
 assert.ok(inline.startsWith('`````')&&inline.endsWith('`````'));
 assert.equal(lines[0],lines.at(-1));assert.ok(lines[0].length>4);
 assert.equal(lines.slice(1,-1).join('\n'),hostile);
});

test('generated reports keep hostile goals and diagnostics inside literal Markdown',async t=>{
 const home=await mkdtemp(join(tmpdir(),'cstack-report-'));t.after(()=>rm(home,{recursive:true,force:true}));
 const hostile='secret: x ![remote](https://example.test/x)\n# forged\n<img src=x>\n````';
 const run={id:'security-report',status:'BLOCKED',contract:{goal:hostile,runner:{backend:'docker'},budget:{max_attempts:1},criteria:[{id:'AC1',kind:'probe',required:true,text:hostile}],approved_test_fixtures:[]},
  reason:hostile,worktree:'/tmp/'+hostile,base:'base',contract_hash:'contract',runner_identity:null,attempts:[],spent_ms:0,usage:[],approvals:[],changed_paths:[hostile],metrics:{},
  results:{AC1:{status:'FAIL',strength:'external-observation',diagnostic:hostile,fingerprint:'snapshot',output_hash:'evidence'}},baseline:{}};
 await writeReport(run,home);const report=await readFile(join(home,'runs',run.id,'report.md'),'utf8');
 const goal=report.split('\n').find(line=>line.startsWith('Goal: '));assert.ok(goal.startsWith('Goal: `````')&&goal.endsWith('`````'));assert.match(goal,/secret: \[REDACTED\]/);
 const feedback=report.split('## Independent failure feedback\n')[1],fence=feedback.split('\n')[0];assert.ok(fence.length>4);assert.ok(feedback.endsWith(fence+'\n\nVERIFIED covers the declared observable cases on this candidate, not all possible behavior. Tests reported by candidate processes are not, alone, sufficient proof. No push, merge, deployment or paid API fallback was performed.\n'));
});
