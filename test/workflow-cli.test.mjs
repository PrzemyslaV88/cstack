import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, contract, probe } from './helpers/fixture.mjs';
import { command, cleanEnv } from '../src/process.mjs';
import { beginRun } from '../src/core.mjs';
import { saveCheckpoint } from '../src/checkpoint.mjs';
import { commitRun } from '../src/store.mjs';

const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
const invoke=(f,args)=>command([process.execPath,cli,...args],{cwd:f.root,env:cleanEnv({CSTACK_HOME:f.home,CSTACK_CODEX_BIN:'/nonexistent/codex',DOCKER_HOST:'unix:///nonexistent/docker'})});

test('intake CLI prepares and compiles a local acceptance without Docker or a model',async t=>{
  const f=await fixture(t),draft=await invoke(f,['intake','Repair addition','--repo',f.repo,'--out',join(f.root,'draft'),'--format','json']);
  assert.equal(draft.code,0,draft.stderr);const path=JSON.parse(draft.stdout).brief;
  const brief=JSON.parse(await readFile(path,'utf8'));
  brief.outcomes=[{criterion:probe,source:'Independent arithmetic worked examples.',seam:'Exported addition'}];
  brief.tasks=[{id:'add',title:'Correct addition',depends_on:[],criteria:['AC1']}];
  await writeFile(path,JSON.stringify(brief));
  const result=await invoke(f,['intake','compile','--brief',path,'--repo',f.repo,'--out',join(f.root,'compiled'),'--format','json']);
  assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).code,'ACCEPTANCE_PREPARED');
});

test('architecture CLI emits private local reports without starting a worker or verifier',async t=>{
  const f=await fixture(t),result=await invoke(f,['architecture','--repo',f.repo,'--focus','calc.mjs','--out',join(f.root,'architecture'),'--format','json']);
  assert.equal(result.code,0,result.stderr);
  const view=JSON.parse(await readFile(join(JSON.parse(result.stdout).directory,'report.json'),'utf8'));
  assert.equal(view.kind,'architecture');assert.ok(view.candidates.some(c=>c.path==='calc.mjs'));
});

test('checkpoint and retrospective CLI inspect selected controller records without granting completion',async t=>{
  const f=await fixture(t),run=await beginRun({...f,contract:contract()});
  run.checkpoint=await saveCheckpoint(run,f.home,'cli-fixture');commitRun(run,'checkpoint_saved',{},f.home);
  const checkpoint=await invoke(f,['checkpoint',run.id,'--format','json']);assert.equal(checkpoint.code,0,checkpoint.stderr);
  assert.equal(JSON.parse(checkpoint.stdout).attempts,0);
  const retro=await invoke(f,['retro',run.id,'--out',join(f.root,'retro'),'--format','json']);assert.equal(retro.code,0,retro.stderr);
  assert.equal(JSON.parse(await readFile(join(f.root,'retro','report.json'),'utf8')).runs[0].status,'CREATED');
});
