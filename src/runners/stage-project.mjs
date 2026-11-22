import {readdir,lstat,readFile,readlink,cp,mkdtemp} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
// Links (including the project's dependency links) are recorded, never followed.
async function inventory(root){const entries=[];let size=0;async function walk(dir,prefix=''){for(const name of (await readdir(dir)).sort()){const path=prefix+name,full=join(dir,name),s=await lstat(full);if(s.isSymbolicLink())entries.push([path,'symlink',await readlink(full)]);else if(s.isDirectory())await walk(full,path+'/');else if(s.isFile()){size+=s.size;if(size>96*1024*1024-1048576)throw Error('SCRATCH_CAPACITY');entries.push([path,'file',hash(await readFile(full)),Boolean(s.mode&0o111)]);}else throw Error('Unsupported staging file');}}await walk(root);return hash(JSON.stringify(entries));}
export async function stageProject(){
 const source=process.env.CSTACK_CANDIDATE||process.cwd(),scratch=process.env.CSTACK_SCRATCH||process.env.TMPDIR||'/tmp';
 const dest=join(await mkdtemp(join(scratch,'stage-')),'project');
 const before=await inventory(source);
 await cp(source,dest,{recursive:true,dereference:false,verbatimSymlinks:true});const after=await inventory(dest);if(before!==after)throw Error('STAGING_INTEGRITY');
 process.chdir(dest);return {root:dest,staging_before:before,staging_after:after};
}
// The project's own installed test runner, resolved from its node_modules (often a dependency link).
export async function projectPackage(root,name){
 const dir=join(root,'node_modules',name);let manifest;
 try{manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));}catch{throw Error(`${name} is not installed in the project's node_modules; install the project's dependencies and rerun setup`);}
 return {version:manifest.version,dir,url:file=>pathToFileURL(join(dir,file)).href};
}
