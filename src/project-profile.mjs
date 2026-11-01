import {posix,join,resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {repository,within} from './repository.mjs';
import {analyzeStack,projectScopes} from './stack-analysis.mjs';
import {exactKeys,requireThat,relativePath,digestOf,hash,compareText,dataHome} from './util.mjs';
import {immutableJson,atomicJson,readJson} from './artifacts.mjs';

const evidenceName=/^(package(?:-lock)?\.json|npm-shrinkwrap\.json|pyproject\.toml|setup\.cfg|requirements(?:[-.][^/]*)?\.(txt|in|lock)|pytest\.ini|tox\.ini|conftest\.py|AGENTS\.md|(?:vitest|vite|jest|tsconfig|jsconfig)\.config\.[^/]+|(?:tsconfig|jsconfig)\.json|\.python-version|\.node-version|\.nvmrc)$/;
const digestPattern=/^[a-f0-9]{64}$/;
export async function profileEvidence(reader,scope,conventions=[]) {
  const {scopeFor}=projectScopes(reader),paths=reader.files.filter(f=>scopeFor(f.path)===scope && evidenceName.test(posix.basename(f.path))).map(f=>f.path);
  for(const c of conventions) if(!paths.includes(c.path))paths.push(c.path);
  const evidence=[];
  for(const path of paths.sort(compareText)) {const data=await reader.read(path);requireThat(data,'Profile input unavailable: '+path,'PROFILE_STALE');evidence.push({path,sha256:data.sha256,role:conventions.some(c=>c.path===path)?'convention':/lock/.test(path)?'lockfile':'configuration'});}
  return evidence;
}
const uniqueStrings=(a,max,name)=>{requireThat(Array.isArray(a)&&a.length<=max&&a.every(x=>typeof x==='string'&&x.length>0)&&new Set(a).size===a.length,'Invalid '+name);return a;};
export function profileShape(p) {
  exactKeys(p,['schema_version','scope','evidence','runtime','test','environment','conventions','readiness','missing'],'profile');
  requireThat(p.schema_version===1,'Unsupported profile schema');relativePath(p.scope,{dot:true});
  exactKeys(p.runtime,['kind','declared_version'],'runtime');requireThat(['node','python'].includes(p.runtime.kind)&& (p.runtime.declared_version===null||typeof p.runtime.declared_version==='string'),'Invalid runtime');
  exactKeys(p.test,['adapter','roots','expected_tests','plugins'],'test');requireThat(['node-test','pytest','vitest','none'].includes(p.test.adapter),'Invalid adapter');
  uniqueStrings(p.test.roots,32,'test roots').forEach(x=>relativePath(x,{dot:true}));uniqueStrings(p.test.expected_tests,10000,'expected tests');uniqueStrings(p.test.plugins,16,'plugins');
  requireThat(p.test.plugins.every(x=>/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(x)) && (p.test.adapter==='pytest'||!p.test.plugins.length),'Invalid plugins');
  exactKeys(p.environment,['mode','image','lockfiles'],'environment');requireThat(['existing-image','npm-lock','pip-hashes','manual'].includes(p.environment.mode),'Invalid environment mode');
  requireThat(p.environment.image===null||typeof p.environment.image==='string'&&/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(p.environment.image),'Invalid image');
  uniqueStrings(p.environment.lockfiles,8,'lockfiles').forEach(x=>relativePath(x));
  requireThat(Array.isArray(p.evidence)&&p.evidence.length<=256,'Invalid profile evidence');const seen=new Set();
  for(const e of p.evidence){exactKeys(e,['path','sha256','role'],'evidence');relativePath(e.path);requireThat(digestPattern.test(e.sha256)&&['configuration','lockfile','convention'].includes(e.role)&&!seen.has(e.path),'Invalid evidence');seen.add(e.path);}
  requireThat(Array.isArray(p.conventions)&&p.conventions.length<=8,'Invalid conventions');
  for(const c of p.conventions){exactKeys(c,['path','sha256'],'convention');relativePath(c.path);requireThat(digestPattern.test(c.sha256),'Invalid convention digest');}
  requireThat(['draft','ready'].includes(p.readiness)&&Array.isArray(p.missing),'Invalid readiness');
  for(const m of p.missing){exactKeys(m,['code','next_action'],'missing prerequisite');requireThat(typeof m.code==='string'&&typeof m.next_action==='string','Invalid diagnostic');}
  return p;
}
export async function discoverProfile(reader,{scope,adapter,image,conventions=[]}={}) {
  const analysis=await analyzeStack(reader),{scopes,scopeFor}=projectScopes(reader);
  const apps=scopes.filter(s=>s.kind==='application'&&reader.files.some(f=>scopeFor(f.path)===s.id&&/^(package\.json|pyproject\.toml|setup\.cfg|requirements.*\.(txt|lock))$/.test(posix.basename(f.path))));
  if(scope===undefined){requireThat(apps.length<=1,'Select --scope: '+apps.map(s=>s.id).join(', '),'PROJECT_SCOPE_AMBIGUOUS');scope=apps[0]?.id||'.';}
  relativePath(scope,{dot:true});requireThat(scopes.some(s=>s.id===scope),'Unknown project scope');
  const paths=reader.files.filter(f=>scopeFor(f.path)===scope).map(f=>f.path),pkgPath=posix.join(scope,'package.json');
  const kind=paths.includes(pkgPath)?'node':'python';
  const findings=analysis.scoped_findings.filter(f=>f.scope_id===scope);
  const detected=[];
  if(findings.some(f=>f.name==='Vitest'))detected.push('vitest');
  if(findings.some(f=>f.name==='pytest'))detected.push('pytest');
  if(findings.some(f=>f.name==='Node.js test runner'))detected.push('node-test');
  let pkg=null; if(reader.known.has(pkgPath)){const data=await reader.read(pkgPath);try{pkg=JSON.parse(data.source);}catch{throw new Error('Invalid package manifest');}}
  if(typeof pkg?.scripts?.test==='string' && /\bnode\s+--test\b/.test(pkg.scripts.test) && !detected.includes('node-test')) detected.push('node-test');
  if(adapter){requireThat(detected.includes(adapter),'Selected adapter lacks project evidence');}
  else {requireThat(detected.length<=1,'Select --adapter: '+detected.join(', '),'TEST_ADAPTER_AMBIGUOUS');adapter=detected[0]||'none';}
  const roots=[...new Set(paths.filter(p=>/(^|\/)(tests?|testing|__tests__)(\/|$)/.test(p)).map(p=>{const parts=p.split('/');return parts.slice(0,parts.findIndex(x=>['test','tests','testing','__tests__'].includes(x))+1).join('/');}))].sort(compareText).slice(0,32);
  if(!roots.length&&adapter!=='none')roots.push(scope);
  const selected=[];let bytes=0;
  for(const path of conventions){relativePath(path);const data=await reader.read(path);requireThat(data,'Convention file unavailable');bytes+=Buffer.byteLength(data.source);requireThat(bytes<=16384&&selected.length<8,'Convention limit exceeded');selected.push({path,sha256:data.sha256});}
  const lockfiles=paths.filter(p=>/(^|\/)(package-lock\.json|requirements(?:[-.].*)?\.lock)$/.test(p));
  const missing=image?[]:[{code:'IMAGE_MISSING',next_action:'Select a prepared local image with --image, or create an explicit environment plan.'}];
  if(reader.coverage().partial)missing.push({code:'PROFILE_PARTIAL',next_action:'Narrow the scope or resolve unreadable inputs.'});
  const runtime=analysis.runtimes.find(r=>scopeFor(r.evidence.path)===scope&&r.name===(kind==='node'?'Node.js':'Python'));
  return profileShape({schema_version:1,scope,evidence:await profileEvidence(reader,scope,selected),runtime:{kind,declared_version:runtime?.declared_version||null},
    test:{adapter,roots,expected_tests:[],plugins:[]},environment:{mode:image?'existing-image':lockfiles.some(p=>p.endsWith('package-lock.json'))?'npm-lock':lockfiles.length?'pip-hashes':'manual',image:image||null,lockfiles},
    conventions:selected,readiness:'draft',missing});
}
export async function validateProfile(profile,reader) {
  profileShape(profile);requireThat(digestOf(await profileEvidence(reader,profile.scope,profile.conventions))===digestOf(profile.evidence),'Profile configuration changed','PROFILE_STALE');
  let bytes=0;for(const c of profile.conventions){const data=await reader.read(c.path);requireThat(data&&data.sha256===c.sha256,'Convention changed','PROFILE_STALE');bytes+=Buffer.byteLength(data.source);}
  requireThat(bytes<=16384,'Convention limit exceeded');
  for(const path of profile.test.roots)requireThat(path==='.'||reader.known.has(path)||reader.files.some(f=>f.path.startsWith(path+'/')),'Test root unavailable: '+path,'PROFILE_STALE');
  return {profile,digest:digestOf(profile),inputs_current:true};
}
export async function storeProfile(profile,repo,home=dataHome()) {
  profileShape(profile);const root=await realpath(resolve(repo)),base=join(resolve(home),'projects',hash(root));
  requireThat(!within(root,resolve(home)),'Controller home must be outside project');
  const stored=await immutableJson(join(base,'profiles'),profile);await atomicJson(join(base,'current.json'),{digest:stored.digest});
  await atomicJson(join(base,'local.json'),{root,updated_at:new Date().toISOString()});return stored;
}
export async function loadProfile(repo,home=dataHome()) {
  const root=await realpath(repo),base=join(resolve(home),'projects',hash(root));const pointer=await readJson(join(base,'current.json'));
  requireThat(digestPattern.test(pointer.digest),'Invalid profile pointer','INTEGRITY');const profile=await readJson(join(base,'profiles',pointer.digest+'.json'));
  requireThat(digestOf(profile)===pointer.digest,'Stored profile changed','INTEGRITY');await validateProfile(profile,await repository(root));return profile;
}
