// The project's own environment: installed dependency folders and language runtimes.
//
// cStack does not build or download an environment. The worker and the verifier both use
// the dependencies the developer already installed (for example `node_modules` or a
// `.venv`). They are linked read-only into the worker's private worktree and into every
// sealed candidate, excluded from candidate identity and delivery, and fingerprinted so a
// dependency change makes earlier evidence stale.
import {lstat,readdir,readFile,readlink,realpath,stat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
import {join,dirname,delimiter,posix} from 'node:path';
import {command,cleanEnv} from './process.mjs';
import {CstackError,requireThat,hash,relativePath} from './util.mjs';

export const MAX_DEPENDENCIES=8;
// Caches that tools write into dependency folders; they do not change behavior.
const volatile=new Set(['__pycache__','.cache','.vite','.vitest']);
const systemPrefixes=['/usr/','/bin/','/sbin/','/lib/','/lib64/','/System/','/Library/Apple/'];

export function normalizeDependencies(value=[]){
  requireThat(Array.isArray(value)&&value.length<=MAX_DEPENDENCIES,`runner.dependencies must list at most ${MAX_DEPENDENCIES} paths`);
  const seen=new Set();
  return value.map(p=>{
    requireThat(typeof p==='string','Dependency path must be a string');relativePath(p,{dot:true});
    requireThat(p!=='.'&&p===posix.normalize(p)&&!p.endsWith('/')&&!p.split('/').some(x=>['.git','.codex','.cstack'].includes(x)),'Unsafe dependency path: '+p);
    requireThat(!seen.has(p)&&![...seen].some(q=>p.startsWith(q+'/')||q.startsWith(p+'/')),'Duplicate or nested dependency path: '+p);seen.add(p);return p;
  });
}
async function gitQuiet(cwd,...args){return command(['git','-C',cwd,...args],{timeoutMs:30000,env:cleanEnv()});}

// Resolve declared dependency folders of the source project into link records.
export async function resolveDependencies(root,paths=[]){
  const links=[];
  for(const path of normalizeDependencies(paths)){
    const full=join(root,path);let info;
    try{info=await lstat(full);}catch(e){if(e.code==='ENOENT')throw new CstackError(`Dependency folder ${path} is not installed. Install the project's dependencies yourself, then retry; cStack never installs them.`,'PROJECT_DEPENDENCY_MISSING');throw e;}
    const target=await realpath(full);requireThat((await stat(target)).isDirectory(),'Dependency path must resolve to a directory: '+path,'PROJECT_DEPENDENCY_MISSING');
    requireThat(info.isDirectory()||info.isSymbolicLink(),'Dependency path must be a directory or a link to one: '+path);
    const tracked=await gitQuiet(root,'ls-files','-z','--',path);
    requireThat(tracked.code===0&&!tracked.stdout.length,`Dependency folder ${path} contains tracked files; only git-ignored install folders can be shared`,'ENVIRONMENT_UNSAFE');
    const ignored=await gitQuiet(root,'check-ignore','-q','--',path);
    requireThat(ignored.code===0,`Dependency folder ${path} must be git-ignored so it is never part of a candidate or a delivered patch. Add "${path}" to .gitignore (a "${path}/" pattern does not match a symbolic link)`,'ENVIRONMENT_UNSAFE');
    const venv=await access(join(target,'pyvenv.cfg'),constants.R_OK).then(()=>true,()=>false);
    links.push({path,target,kind:venv?'python-venv':posix.basename(path)==='node_modules'?'node-modules':'directory'});
  }
  return links;
}
// Executable directories contributed by dependency folders, in declaration order.
export const dependencyBins=links=>links.flatMap(l=>l.kind==='python-venv'?[join(l.target,'bin')]:l.kind==='node-modules'?[join(l.target,'.bin')]:[]);
export function sandboxPath(links=[]){return [...dependencyBins(links),cleanEnv().PATH].join(delimiter);}

// Stat-level fingerprint: paths, types, sizes, modes, modification times and link targets.
// Content hashing large dependency trees on every check would be too slow; installs and
// upgrades change these attributes.
export async function treeDigest(root,{maxEntries=500_000}={}){
  const rows=[];
  async function walk(dir,prefix){
    for(const name of (await readdir(dir)).sort()){
      if(volatile.has(name)||name.endsWith('.pyc'))continue;
      requireThat(rows.length<maxEntries,'Dependency folder is too large to fingerprint: '+root,'ENVIRONMENT_UNSAFE');
      const full=join(dir,name),path=prefix?prefix+'/'+name:name,s=await lstat(full);
      if(s.isSymbolicLink())rows.push([path,'l',await readlink(full)]);
      else if(s.isDirectory()){rows.push([path,'d',s.mode&0o7777]);await walk(full,path);}
      else rows.push([path,'f',s.size,s.mode&0o7777,Math.trunc(s.mtimeMs)]);
    }
  }
  await walk(root,'');return hash(JSON.stringify(rows));
}
async function executable(path){try{await access(path,constants.X_OK);return (await stat(path)).isFile();}catch{return false;}}
// The interpreters the sandbox PATH resolves, with their content digests and install prefixes.
export async function resolveRuntimes(links=[],names=['node','python3','python']){
  const found=[];
  for(const name of names){
    for(const dir of sandboxPath(links).split(delimiter)){
      const candidate=join(dir,name);if(!await executable(candidate))continue;
      const real=await realpath(candidate);
      found.push({name,path:candidate,realpath:real,sha256:hash(await readFile(real)),prefix:dirname(dirname(real))});break;
    }
  }
  return found;
}
export const isSystemPath=p=>systemPrefixes.some(prefix=>p===prefix.slice(0,-1)||p.startsWith(prefix));
// Host directories the verifier must be able to read besides the candidate and runner scripts.
export function readablePaths(links,runtimes){
  return [...new Set([...links.map(l=>l.target),...runtimes.map(r=>r.prefix)].filter(p=>!isSystemPath(p+'/')))].sort();
}
export async function environmentIdentity(links=[]){
  const runtimes=await resolveRuntimes(links);
  return {links:await Promise.all(links.map(async l=>({path:l.path,target:l.target,kind:l.kind,tree:await treeDigest(l.target)}))),
    runtimes:runtimes.map(({name,realpath,sha256})=>({name,realpath,sha256})),readable:readablePaths(links,runtimes),runtimesResolved:runtimes};
}
