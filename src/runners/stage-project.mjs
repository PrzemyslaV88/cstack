import {readdir,lstat,readFile,readlink,cp,symlink} from 'node:fs/promises';import {join} from 'node:path';import {createHash} from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function inventory(root){const entries=[];let size=0;async function walk(dir,prefix=''){for(const name of (await readdir(dir)).sort()){const path=prefix+name,full=join(dir,name),s=await lstat(full);if(s.isSymbolicLink())entries.push([path,'symlink',await readlink(full)]);else if(s.isDirectory())await walk(full,path+'/');else if(s.isFile()){size+=s.size;if(size>96*1024*1024-1048576)throw Error('SCRATCH_CAPACITY');entries.push([path,'file',hash(await readFile(full)),Boolean(s.mode&0o111)]);}else throw Error('Unsupported staging file');}}await walk(root);return hash(JSON.stringify(entries));}
export async function stageProject(){
 const before=await inventory('/candidate');try{await lstat('/candidate/node_modules');throw Error('DEPENDENCY_PATH_COLLISION');}catch(e){if(e.code!=='ENOENT')throw e;}
 await cp('/candidate','/tmp/project',{recursive:true,dereference:false,verbatimSymlinks:true});const after=await inventory('/tmp/project');if(before!==after)throw Error('STAGING_INTEGRITY');
 await symlink('/opt/cstack-deps/node_modules','/tmp/project/node_modules');process.chdir('/tmp/project');return {staging_before:before,staging_after:after};
}
