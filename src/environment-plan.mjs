// Host environment readiness. cStack never builds, pulls or installs an environment: it
// checks that the project's own installed runtime and test runner work inside the sandbox.
import {access,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,posix} from 'node:path';
import {createRunner} from './sandbox.mjs';
import {resolveDependencies} from './environment.mjs';
import {supportedAdapterVersion} from './test-adapters.mjs';
import {requireThat,redact,CstackError} from './util.mjs';

const exists=async path=>access(path,constants.F_OK).then(()=>true,()=>false);
// Installed dependency folders present in the project scope (never installed by cStack).
export async function discoverDependencies(root,scope,kind){
  const found=[];
  if(kind==='node'){const p=posix.join(scope,'node_modules');if(await exists(join(root,p))&&(await stat(join(root,p))).isDirectory())found.push(p);}
  if(kind==='python')for(const name of ['.venv','venv']){const p=posix.join(scope,name);if(await exists(join(root,p,'pyvenv.cfg'))){found.push(p);break;}}
  return found;
}
export const installHint=kind=>kind==='node'?'Install the project dependencies yourself (for example `npm ci`) and rerun setup.'
  :'Install the project dependencies yourself (for example `python -m venv .venv && .venv/bin/pip install -r requirements.txt`) and rerun setup.';

export async function checkEnvironment(profile,{cwd,signal}={}){
  const links=await resolveDependencies(cwd,profile.environment.dependencies);
  const runner=await createRunner({backend:'host',dependencies:profile.environment.dependencies},{environment:{links}});
  const adapter=profile.test.adapter,root=JSON.stringify(profile.scope);
  const args=profile.runtime.kind==='node'?['node','-e',`const fs=require('fs'),path=require('path');const a=${JSON.stringify(adapter)};let v=null;if(a==='vitest'){for(const dir of [path.join(${root},'node_modules'),'node_modules']){try{v=JSON.parse(fs.readFileSync(path.join(dir,'vitest','package.json'),'utf8')).version;break;}catch{}}}console.log(JSON.stringify({runtime:process.version,adapter:a,version:v}))`]:
   ['python','-I','-c',`import sys,json\na=${JSON.stringify(adapter)}\nv=__import__('pytest').__version__ if a=='pytest' else None\nprint(json.dumps({'runtime':sys.version.split()[0],'executable':sys.executable,'adapter':a,'version':v}))`];
  const result=await runner.execute(args,{cwd,timeoutMs:15000,signal});
  requireThat(!result.timedOut&&!result.aborted&&!result.truncated,'Environment check interrupted, timed out or exceeded output limit','ENVIRONMENT_CHECK_ERROR');
  if(result.code!==0)throw Object.assign(new CstackError('Project runtime or test runner unavailable in the sandbox: '+redact(result.stderr).slice(-600)+' '+installHint(profile.runtime.kind),'PROJECT_DEPENDENCY_MISSING'),{next_action:installHint(profile.runtime.kind)});
  let versions;try{versions=JSON.parse(result.stdout);}catch{throw new Error('Invalid environment readiness response');}
  if(['pytest','vitest'].includes(adapter)&&!versions.version)throw new CstackError(`${adapter} is not installed in the project environment. `+installHint(profile.runtime.kind),'PROJECT_DEPENDENCY_MISSING');
  requireThat(!['pytest','vitest'].includes(adapter)||supportedAdapterVersion(adapter,versions.version),`Supported ${adapter} versions: ${adapter==='pytest'?'7-9':'4.x'}; found ${versions.version}`,'TEST_RUNNER_VERSION_UNSUPPORTED');
  return {environment_ready:true,sandbox:runner.sandbox,runner_identity:runner.identity,versions,dependencies:runner.environment.links,runtimes:runner.environment.runtimes,runner};
}
