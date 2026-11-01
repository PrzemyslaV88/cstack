import {mkdir,realpath,readFile,writeFile,rename,open,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {within} from './repository.mjs';
import {requireThat,digestOf,json} from './util.mjs';
export async function readJson(path,maxBytes=2000000) {
  const info=await lstat(path); requireThat(info.isFile() && info.size<=maxBytes,'Expected bounded regular JSON file');
  return JSON.parse(await readFile(path,'utf8'));
}
export async function newOutputDirectory(output,excluded=[]) {
  const dest=resolve(output); let parent=dirname(dest);
  while(true) {try {parent=await realpath(parent);break;} catch(e) {if(e.code!=='ENOENT')throw e;parent=dirname(parent);}}
  for(const root of excluded.filter(Boolean)) {
    const real=await realpath(root);requireThat(!within(real,dest)&&!within(real,parent),'Output must be outside the project');
  }
  await mkdir(dirname(dest),{recursive:true,mode:0o700});
  const actualParent=await realpath(dirname(dest));
  for(const root of excluded.filter(Boolean)) requireThat(!within(await realpath(root),actualParent),'Output parent resolves inside project');
  await mkdir(dest,{mode:0o700}); return dest;
}
export async function atomicJson(path,value) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.tmp-'+randomUUID(); const handle=await open(temp,'wx',0o600);
  try {await handle.writeFile(json(value));await handle.sync();} finally {await handle.close();}
  await rename(temp,path);
  const dir=await open(dirname(path),'r');try {await dir.sync();} finally {await dir.close();}
}
export async function immutableJson(directory,value) {
  const digest=digestOf(value),path=join(directory,digest+'.json'); await mkdir(directory,{recursive:true,mode:0o700});
  try {await writeFile(path,json(value),{flag:'wx',mode:0o600});}
  catch(e) {if(e.code!=='EEXIST')throw e;requireThat(digestOf(await readJson(path))===digest,'Stored artifact changed','INTEGRITY');}
  return {path,digest};
}
