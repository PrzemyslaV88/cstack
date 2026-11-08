import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../scripts/build-plugin.mjs';
import { command, cleanEnv } from '../src/process.mjs';

const installer=fileURLToPath(new URL('../scripts/install-plugin.mjs',import.meta.url));
async function registered(t){
  const root=await mkdtemp(join(tmpdir(),'cstack-installer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const build=await buildPlugin({output:join(root,'persistent marketplace')});
  const env=cleanEnv({CODEX_HOME:join(root,'isolated codex')});
  await mkdir(env.CODEX_HOME);
  const result=await command(['codex','plugin','marketplace','add',build.marketplaceRoot,'--json'],{env});
  assert.equal(result.code,0,result.stderr);return {root,build,env};
}

test('installer reuses a valid persistent local Cstack registration rather than removing or replacing it',async t=>{
  const f=await registered(t),result=await command([process.execPath,installer],{env:f.env});
  assert.equal(result.code,0,result.stderr);
  const installed=JSON.parse(result.stdout);assert.equal(await realpath(installed.build.marketplaceRoot),await realpath(f.build.marketplaceRoot));
  assert.equal(installed.verifiedEnabled,true);
  assert.equal(JSON.parse(await readFile(join(installed.installed.installedPath,'plugin.json'),'utf8')).version,'0.6.0');
});

test('installer preserves a registered catalog that contains unrelated plugins',async t=>{
  const f=await registered(t),path=join(f.build.marketplaceRoot,'.agents/plugins/marketplace.json');
  const catalog=JSON.parse(await readFile(path,'utf8'));catalog.plugins.push({...catalog.plugins[0],name:'unrelated'});
  const before=JSON.stringify(catalog);await writeFile(path,before);
  const result=await command([process.execPath,installer],{env:f.env});
  assert.notEqual(result.code,0);assert.match(result.stderr,/unrelated plugins/);assert.equal(await readFile(path,'utf8'),before);
});
