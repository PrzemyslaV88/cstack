import {measurePhase} from './journey.mjs';
import {readFile,writeFile,mkdir,realpath,readdir,lstat} from 'node:fs/promises';
import {join,resolve,posix} from 'node:path';
import {homedir} from 'node:os';
import {command,cleanEnv} from './process.mjs';
import {createRunner} from './sandbox.mjs';
import {repository} from './repository.mjs';
import {validateProfile,storeProfile,profileShape} from './project-profile.mjs';
import {readJson,newOutputDirectory,immutableJson} from './artifacts.mjs';
import {requireThat,hash,digestOf,json,dataHome,exactKeys,relativePath,redact} from './util.mjs';
export function dockerEnv(){return cleanEnv({HOME:homedir(),...Object.fromEntries(['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))});}
export async function inspectImage(image,control=command){
 requireThat(typeof image==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(image),'Select a local image','IMAGE_MISSING');
 const r=await control(['docker','image','inspect',image],{env:dockerEnv(),timeoutMs:15000});
 requireThat(r.code===0,'Local image missing: '+image,'IMAGE_MISSING');const info=JSON.parse(r.stdout)[0];requireThat(/^sha256:[a-f0-9]{64}$/.test(info.Id),'Image identity unavailable','INTEGRITY');
 return {id:info.Id,platform:info.Os+'/'+info.Architecture,reference:info.RepoDigests?.[0]||null};
}
export async function checkEnvironment(profile,{cwd,control=command,signal}={}) {
 const image=await inspectImage(profile.environment.image,control),runner=await createRunner({backend:'docker',image:image.id},{control});
 const adapter=profile.test.adapter;
 const args=profile.runtime.kind==='node'?['node','-e',`const fs=require('fs');const a=${JSON.stringify(adapter)};const v=a==='vitest'?JSON.parse(fs.readFileSync('/opt/cstack-deps/node_modules/vitest/package.json','utf8')).version:null;console.log(JSON.stringify({runtime:process.version,adapter:a,version:v}))`]:
 ['python','-I','-c',`import sys,json\na=${JSON.stringify(adapter)}\nv=__import__('pytest').__version__ if a=='pytest' else None\nprint(json.dumps({'runtime':sys.version.split()[0],'adapter':a,'version':v}))`];
 const result=await runner.execute(args,{cwd,timeoutMs:15000,signal});requireThat(!result.timedOut&&!result.aborted&&!result.truncated,'Environment check interrupted, timed out or exceeded output limit','ENVIRONMENT_CHECK_ERROR');requireThat(result.code===0&&!result.truncated,'Project runtime/dependency unavailable: '+redact(result.stderr).slice(-1000),'PROJECT_DEPENDENCY_MISSING');
 let versions;try{versions=JSON.parse(result.stdout);}catch{throw new Error('Invalid environment readiness response');}
 const expected={pytest:'8.3.5',vitest:'4.0.18'};
 requireThat(!expected[adapter]||versions.version===expected[adapter],'Supported '+adapter+' version is '+expected[adapter]+', found '+versions.version,'TEST_RUNNER_VERSION_UNSUPPORTED');
 return {environment_ready:true,image_id:image.id,platform:image.platform,versions,runner_identity:runner.identity};
}
function recipeDockerfile(recipe,base){const instructions=recipe==='npm-lock'?['WORKDIR /opt/cstack-deps','COPY package.json package-lock.json ./','RUN npm ci --ignore-scripts --no-audit --no-fund']:recipe==='pip-hashes'?['COPY requirements.lock /opt/cstack-requirements.lock','RUN python -m pip install --require-hashes --only-binary=:all: -r /opt/cstack-requirements.lock']:[];return ['FROM '+base,...instructions,''].join('\n');}
export async function planEnvironment(profile,{repo,recipe=profile.environment.mode,baseImage,control=command}={}) {
 const reader=await repository(repo);await validateProfile(profile,reader);
 requireThat(['existing-image','npm-lock','pip-hashes'].includes(recipe),'Use an explicit prepared image for unsupported dependency setup','ENVIRONMENT_MANUAL_REQUIRED');
 requireThat(recipe==='existing-image'?!baseImage:Boolean(baseImage),'--base-image is required only for dependency builds');
 const selected=recipe==='existing-image'?profile.environment.image:baseImage;
 let base;try{base=await inspectImage(selected,control);}catch(e){if(e.code!=='IMAGE_MISSING')throw e;return {plan:{schema_version:1,ready:false,recipe,missing:[{code:'IMAGE_MISSING',next_action:'Explicitly pull/build '+selected+' then regenerate this plan.'}]},inputs:[],local:{root:reader.root}};}
 const inputs=[];
 async function add(path,destination){const data=await reader.read(path);requireThat(data,'Missing build input '+path);inputs.push({path,destination,sha256:data.sha256,content:data.source});return data.source;}
 if(recipe==='npm-lock'){
  const p=JSON.parse(await add(posix.join(profile.scope,'package.json'),'package.json'));
  const lock=JSON.parse(await add(posix.join(profile.scope,'package-lock.json'),'package-lock.json'));
  requireThat([2,3].includes(lock.lockfileVersion)&&!p.workspaces,'npm workspaces/lock version require a manual image','ENVIRONMENT_MANUAL_REQUIRED');
  for(const group of ['dependencies','devDependencies','optionalDependencies'])for(const spec of Object.values(p[group]||{}))requireThat(typeof spec==='string'&&!/^(?:file:|link:|workspace:|git|https?:|ssh:)|\//.test(spec),'Non-registry dependency requires manual image','ENVIRONMENT_MANUAL_REQUIRED');
  for(const [path,item] of Object.entries(lock.packages||{})){
   requireThat(!item.link && (!item.resolved||/^https:\/\/registry\.npmjs\.org\//.test(item.resolved)),'Private/local dependency requires manual image','ENVIRONMENT_MANUAL_REQUIRED');
   if(path)requireThat(typeof item.integrity==='string'&&/^sha(256|384|512)-/.test(item.integrity),'Registry dependency has no integrity');
  }
 }else if(recipe==='pip-hashes'){
  const selected=profile.environment.lockfiles.find(p=>/requirements.*\.lock$/.test(p));requireThat(selected,'A complete hashed requirements lock is required','ENVIRONMENT_MANUAL_REQUIRED');
  const source=await add(selected,'requirements.lock');const lines=source.replace(/\\\r?\n/g,' ').split(/\r?\n/).map(l=>l.replace(/\s+#.*$/,'').trim()).filter(l=>l&&!l.startsWith('#'));
  requireThat(lines.length>0&&lines.every(l=>/^[A-Za-z0-9][\w.-]*(?:\[[\w,.-]+\])?==[A-Za-z0-9.+_-]+(?:\s+--hash=sha256:[a-f0-9]{64})+$/.test(l)),'Only exact hashed binary-wheel requirements are supported','ENVIRONMENT_MANUAL_REQUIRED');
 }
 const baseTag='cstack-base:'+base.id.slice(7);
 const dockerfile=recipeDockerfile(recipe,baseTag);
 const install_argv=recipe==='npm-lock'?['npm','ci','--ignore-scripts','--no-audit','--no-fund']:recipe==='pip-hashes'?['python','-m','pip','install','--require-hashes','--only-binary=:all:','-r','/opt/cstack-requirements.lock']:[];
 const environment_key=digestOf({template_version:1,platform:base.platform,base_image_id:base.id,inputs:inputs.map(({content,...x})=>x),install_argv});
 const plan={schema_version:1,ready:true,environment_key,install_argv,recipe,template_version:1,base_image_id:base.id,base_reference:baseTag,platform:base.platform,
  network_required:recipe!=='existing-image',inputs:inputs.map(({content,...x})=>x),dockerfile_sha256:hash(dockerfile),profile,profile_digest:digestOf(profile)};
 return {plan,inputs,dockerfile,local:{root:reader.root}};
}
export async function exportEnvironmentPlan(result,output){
 const directory=await newOutputDirectory(output,[result.local.root]);await writeFile(join(directory,'environment-plan.json'),json(result.plan),{flag:'wx',mode:0o600});
 await writeFile(join(directory,'local.json'),json(result.local),{flag:'wx',mode:0o600});
 if(result.plan.ready){await mkdir(join(directory,'context'),{mode:0o700});for(const x of result.inputs)await writeFile(join(directory,'context',x.destination),x.content,{flag:'wx',mode:0o600});await writeFile(join(directory,'context','Dockerfile'),result.dockerfile,{flag:'wx',mode:0o600});}
 await writeFile(join(directory,'environment.md'),`# Environment preparation\n\nRecipe: ${result.plan.recipe}\nReady: ${result.plan.ready}\nNetwork required for preparation: ${result.plan.network_required??'not executable'}\n\n${result.plan.ready?'Run env prepare with the exact plan digest. Verification remains offline.':result.plan.missing.map(m=>m.next_action).join('\n')}\n`,{flag:'wx',mode:0o600});
 return {directory,plan:join(directory,'environment-plan.json'),digest:digestOf(result.plan),ready:result.plan.ready};
}
export async function prepareEnvironment(planPath,expectedDigest,options={}){const journey=[];const result=await measurePhase(journey,'environment_preparation',()=>prepareEnvironmentInner(planPath,expectedDigest,options));return {...result,journey};}
async function prepareEnvironmentInner(planPath,expectedDigest,{control=command,signal,home=dataHome()}={}){
 const plan=await readJson(planPath);requireThat(digestOf(plan)===expectedDigest,'Environment plan changed','PLAN_CHANGED');requireThat(plan.ready,'Environment plan is not executable','IMAGE_MISSING');validateEnvironmentPlan(plan);
 const directory=resolve(planPath,'..'),local=await readJson(join(directory,'local.json'));const reader=await repository(local.root);await validateProfile(plan.profile,reader);
 for(const item of plan.inputs){relativePath(item.path);relativePath(item.destination);requireThat((await reader.read(item.path))?.sha256===item.sha256&&hash(await readFile(join(directory,'context',item.destination)))===item.sha256,'Build input changed','PLAN_CHANGED');}
 const allowedContext=['Dockerfile',...plan.inputs.map(i=>i.destination)].sort();const contextNames=(await readdir(join(directory,'context'))).filter(p=>!p.startsWith('._')).sort();requireThat(digestOf(contextNames)===digestOf(allowedContext),'Unexpected build context files; nothing was sent to Docker','PLAN_CHANGED');for(const name of contextNames)requireThat((await lstat(join(directory,'context',name))).isFile(),'Build context must contain regular files','PLAN_CHANGED');
 requireThat(hash(await readFile(join(directory,'context','Dockerfile')))===plan.dockerfile_sha256,'Build recipe changed','PLAN_CHANGED');
 requireThat((await inspectImage(plan.base_image_id,control)).id===plan.base_image_id,'Base image changed','ENVIRONMENT_CHANGED');
 let image=plan.base_image_id;
 if(plan.recipe!=='existing-image'){
  if(plan.base_reference.startsWith('cstack-base:')){const tag=await control(['docker','tag',plan.base_image_id,plan.base_reference],{env:dockerEnv(),timeoutMs:15000});requireThat(tag.code===0,'Cannot pin local base image','ENVIRONMENT_CHANGED');}
  const tag='cstack-env:'+plan.environment_key;let cached=null;try{cached=await inspectImage(tag,control);}catch{}
  const receiptDir=join(home,'environments',plan.environment_key);let prior=null;try{prior=await readJson(join(receiptDir,'current.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(cached&&prior?.image_id===cached.id)image=cached.id;
  else{
   requireThat(!cached,'Existing environment tag has unknown provenance; preserving it','ENVIRONMENT_CHANGED');
   const built=await control(['docker','build','--pull=false','--tag',tag,'--file',join(directory,'context','Dockerfile'),join(directory,'context')],{env:dockerEnv(),timeoutMs:600000,outputLimit:2000000,signal});
   requireThat(built.code===0&&!built.truncated,'Environment build failed: '+redact(built.stderr).slice(-1500),'ENVIRONMENT_BUILD_FAILED');
   requireThat((await inspectImage(plan.base_reference,control)).id===plan.base_image_id,'Base reference drifted','ENVIRONMENT_CHANGED');image=(await inspectImage(tag,control)).id;
  }
 }
 const profile={...plan.profile,environment:{...plan.profile.environment,image},readiness:'draft',missing:[]};
 const readiness=await checkEnvironment(profile,{cwd:reader.root,control,signal});
 const receipt={schema_version:1,environment_key:plan.environment_key,image_id:image,versions:readiness.versions,environment_ready:true,platform:readiness.platform};
 const record=await immutableJson(join(home,'environments',plan.environment_key,'receipts'),receipt);
 const {atomicJson}=await import('./artifacts.mjs');await atomicJson(join(home,'environments',plan.environment_key,'current.json'),{image_id:image,digest:record.digest});
 const saved=await storeProfile(profile,reader.root,home);
 return {...readiness,environment_digest:record.digest,receipt:record.path,profile:saved.path,profile_digest:saved.digest,project_verifier_ready:'collection not checked'};
}

export function validateEnvironmentPlan(p){
 exactKeys(p,['schema_version','ready','environment_key','install_argv','recipe','template_version','base_image_id','base_reference','platform','network_required','inputs','dockerfile_sha256','profile','profile_digest'],'environment plan');
 requireThat(p.schema_version===1&&p.ready===true&&p.template_version===1&&['existing-image','npm-lock','pip-hashes'].includes(p.recipe),'Unsupported environment plan');
 requireThat(/^sha256:[a-f0-9]{64}$/.test(p.base_image_id)&&/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(p.base_reference)&&/^[a-z0-9]+\/[a-z0-9]+$/.test(p.platform),'Invalid base image');
 requireThat(Array.isArray(p.inputs)&&p.inputs.length<=2&&/^[a-f0-9]{64}$/.test(p.dockerfile_sha256),'Invalid inputs');
 for(const i of p.inputs){exactKeys(i,['path','destination','sha256'],'input');relativePath(i.path);requireThat(['package.json','package-lock.json','requirements.lock'].includes(i.destination)&&/^[a-f0-9]{64}$/.test(i.sha256),'Invalid input');}
 const destinations=p.recipe==='npm-lock'?['package-lock.json','package.json']:p.recipe==='pip-hashes'?['requirements.lock']:[];requireThat(digestOf(p.inputs.map(i=>i.destination).sort())===digestOf(destinations),'Build inputs differ from fixed recipe','PLAN_CHANGED');requireThat(p.dockerfile_sha256===hash(recipeDockerfile(p.recipe,p.base_reference)),'Build recipe is not the supported fixed template','PLAN_CHANGED');
 const argv=p.recipe==='npm-lock'?['npm','ci','--ignore-scripts','--no-audit','--no-fund']:p.recipe==='pip-hashes'?['python','-m','pip','install','--require-hashes','--only-binary=:all:','-r','/opt/cstack-requirements.lock']:[];
 requireThat(digestOf(p.install_argv)===digestOf(argv)&&p.network_required===(p.recipe!=='existing-image'),'Invalid install policy');
 requireThat(p.environment_key===digestOf({template_version:1,platform:p.platform,base_image_id:p.base_image_id,inputs:p.inputs,install_argv:p.install_argv}),'Environment identity changed','PLAN_CHANGED');
 profileShape(p.profile);requireThat(digestOf(p.profile)===p.profile_digest,'Origin profile changed','PLAN_CHANGED');return p;
}
