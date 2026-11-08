import test from 'node:test';import assert from 'node:assert/strict';import {readFile,writeFile,readdir} from 'node:fs/promises';import {join} from 'node:path';
import {fixture} from './helpers/fixture.mjs';import {repository} from '../src/repository.mjs';import {discoverProfile} from '../src/project-profile.mjs';import {planEnvironment,exportEnvironmentPlan,prepareEnvironment,checkEnvironment} from '../src/environment-plan.mjs';import {digestOf} from '../src/util.mjs';
const id='sha256:'+'a'.repeat(64),calls=[];const inspect=async args=>{calls.push(args);assert.deepEqual(args.slice(0,3),['docker','image','inspect']);return {code:0,stdout:JSON.stringify([{Id:id,Os:'linux',Architecture:'arm64',RepoDigests:[]}])};};
async function setup(t,extra={}){const f=await fixture(t,{'package.json':JSON.stringify({scripts:{test:'node --test'},dependencies:{}}),'package-lock.json':JSON.stringify({lockfileVersion:3,packages:{'':{}}}),'private-canary.txt':'do not copy',...extra});return {...f,profile:await discoverProfile(await repository(f.repo),{image:'node:22.16.0-bookworm-slim'})};}
test('ENV-01 ENV-03: existing local image readiness is independently probed offline',async t=>{const f=await setup(t);const ready=await checkEnvironment(f.profile,{cwd:f.repo});assert.equal(ready.environment_ready,true);assert.equal(ready.versions.adapter,'node-test');});
test('a locally available base stays local even when Docker records a registry digest',async t=>{
 const f=await setup(t);
 const control=async()=>({code:0,stdout:JSON.stringify([{Id:id,Os:'linux',Architecture:'arm64',RepoDigests:['node@'+id]}])});
 const result=await planEnvironment(f.profile,{repo:f.repo,recipe:'npm-lock',baseImage:'node:22.16.0-bookworm-slim',control});
 assert.equal(result.plan.base_reference,'cstack-base:'+id.slice(7));
 assert.ok(result.dockerfile.startsWith('FROM cstack-base:'+id.slice(7)+'\n'));
});
test('ENV-02 ENV-04 ENV-05 ENV-07 ENV-09: minimal deterministic plan refuses drift before build',async t=>{
 const f=await setup(t),opts={repo:f.repo,recipe:'npm-lock',baseImage:'node:22.16.0-bookworm-slim',control:inspect};const a=await planEnvironment(f.profile,opts),b=await planEnvironment(f.profile,opts);assert.equal(digestOf(a.plan),digestOf(b.plan));assert.equal(a.inputs.length,2);
 const exported=await exportEnvironmentPlan(a,join(f.root,'plan with spaces'));assert.deepEqual((await readdir(join(exported.directory,'context'))).sort(),['Dockerfile','package-lock.json','package.json']);assert.ok((await readFile(join(exported.directory,'context','Dockerfile'),'utf8')).includes('--ignore-scripts'));assert.ok(calls.every(x=>x[1]==='image'));
 await writeFile(join(f.repo,'package-lock.json'),'{}');await assert.rejects(prepareEnvironment(exported.plan,exported.digest,{control:async()=>{throw Error('must not build');},home:f.home}),{code:'PROFILE_STALE'});assert.equal((await readFile(join(f.repo,'private-canary.txt'),'utf8')),'do not copy');
});
test('ENV-06 ENV-07: unsupported dependencies and missing images remain non-runnable',async t=>{const f=await setup(t,{'package.json':JSON.stringify({scripts:{test:'node --test'},dependencies:{bad:'file:../bad'}})});await assert.rejects(planEnvironment(f.profile,{repo:f.repo,recipe:'npm-lock',baseImage:'base',control:inspect}),{code:'ENVIRONMENT_MANUAL_REQUIRED'});
 const p=await planEnvironment(f.profile,{repo:f.repo,control:async()=>({code:1,stderr:'missing'})});assert.equal(p.plan.ready,false);assert.equal(p.plan.missing[0].code,'IMAGE_MISSING');await assert.rejects(planEnvironment(f.profile,{repo:f.repo,recipe:'manual'}),{code:'ENVIRONMENT_MANUAL_REQUIRED'});
});

test('ENV-04 ENV-05: edited recipes and extra context files cannot reach Docker',async t=>{
 const {validateEnvironmentPlan}=await import('../src/environment-plan.mjs'),{hash}=await import('../src/util.mjs');const f=await setup(t),p=await planEnvironment(f.profile,{repo:f.repo,recipe:'npm-lock',baseImage:'node:22.16.0-bookworm-slim',control:inspect});const malicious={...p.plan,dockerfile_sha256:hash(p.dockerfile+'RUN echo unexpected\n')};assert.throws(()=>validateEnvironmentPlan(malicious),{code:'PLAN_CHANGED'});
 const out=await exportEnvironmentPlan(p,join(f.root,'extra-context'));await writeFile(join(out.directory,'context','unrelated-private.txt'),'private fixture');let invoked=0;await assert.rejects(prepareEnvironment(out.plan,out.digest,{home:f.home,control:async()=>{invoked++;throw Error('must not reach Docker');}}),{code:'PLAN_CHANGED'});assert.equal(invoked,0);
});
test('ENV-01 ENV-02 ENV-03 ENV-09: real bounded npm preparation skips hooks and reuses its recorded image',async t=>{
 const {command}=await import('../src/process.mjs'),{dockerEnv}=await import('../src/environment-plan.mjs');const f=await setup(t,{'package.json':JSON.stringify({name:'cstack-environment-fixture',version:'1.0.0',scripts:{test:'node --test',postinstall:'node -e "process.exit(42)"'},dependencies:{}})});
 const result=await planEnvironment(f.profile,{repo:f.repo,recipe:'npm-lock',baseImage:'node:22.16.0-bookworm-slim'}),out=await exportEnvironmentPlan(result,join(f.root,'real preparation'));let builds=0;
 const control=async(args,options)=>{if(args[0]==='docker'&&args[1]==='build')builds++;return command(args,options);};
 // Only remove the tag created by this fixture, never prune unrelated Docker data.
 t.after(async()=>{if(builds)await command(['docker','image','rm','cstack-env:'+result.plan.environment_key],{env:dockerEnv(),timeoutMs:30000});});
 const first=await prepareEnvironment(out.plan,out.digest,{home:f.home,control});assert.equal(first.environment_ready,true);assert.equal(builds,1);assert.ok(first.journey[0].duration_ms>0);assert.equal(first.journey[0].status,'COMPLETED');
 const second=await prepareEnvironment(out.plan,out.digest,{home:f.home,control});assert.equal(second.environment_digest,first.environment_digest);assert.equal(second.image_id,first.image_id);assert.equal(builds,1);assert.equal(await readFile(join(f.repo,'private-canary.txt'),'utf8'),'do not copy');
});
