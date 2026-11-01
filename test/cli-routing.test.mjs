import {fileURLToPath} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {command,cleanEnv} from '../src/process.mjs';
const cli=fileURLToPath(new URL('../src/cli.mjs',import.meta.url));
test('CLI-01 CLI-02 CLI-03: analysis/help are independent of SQLite, repair state and external tools',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'cstack-readonly-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const repo=join(dir,'repo'); await mkdir(repo); await writeFile(join(repo,'a.py'),'import os\n');
  const home=join(dir,'must-not-exist');
  for(const args of [['--help'],['map','--repo',repo],['analyze-stack','--repo',repo]]) {
    const r=await command([process.execPath,cli,...args],{env:cleanEnv({CSTACK_HOME:home,CSTACK_CODEX_BIN:'/missing/codex',DOCKER_HOST:'unix:///missing/docker'})});
    assert.equal(r.code,0,r.stderr); assert.doesNotMatch(r.stderr,/SQLite|ExperimentalWarning/);
  }
  await assert.rejects(access(home));
});
test('CLI-04: per-command options reject flags that would otherwise be ignored',async()=>{
  const r=await command([process.execPath,cli,'map','--contract','anything']); assert.equal(r.code,1); assert.match(r.stderr,/Unknown option/);
});
