import { mkdir, readdir, lstat, readlink, realpath, writeFile, chmod, symlink, rm, rename, access } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command, cleanEnv } from './process.mjs';
import { hash, json, requireThat, CstackError, digestOf, relativePath, compareText } from './util.mjs';
import { credentialPath, normalizeTestFixtures } from './file-policy.mjs';
import { readPinnedFile } from './safe-fs.mjs';
export async function git(cwd, ...args) {
  const out = await command(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: cleanEnv({GIT_OPTIONAL_LOCKS:'0'}), timeoutMs: 30_000 });
  if (out.code !== 0) throw new CstackError(`git ${args[0]}: ${out.stderr.trim()}`, 'GIT');
  return out.stdout.trimEnd();
}
// Disable repository-supplied conversion programs for source reads and checkout.
async function filterOverrides(repo) {
  const r=await command(['git','config','--local','--name-only','--get-regexp','^filter\\..*\\.(clean|smudge|process)$'],{cwd:repo,env:cleanEnv()});
  requireThat([0,1].includes(r.code),'Cannot inspect Git filters','GIT');
  return r.stdout.trim().split('\n').filter(Boolean).flatMap(key=>['-c',key+'=']);
}
export async function assertSupportedSource(root) {
  for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply']) {
    const path=resolve(root,await git(root,'rev-parse','--git-path',name));
    try {await access(path);throw new CstackError('Finish the current Git operation: '+name,'SOURCE_OPERATION_UNSUPPORTED');}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const config=await git(root,'config','--list');
  requireThat(!/^core\.sparsecheckout=true$/m.test(config),'Sparse checkout is unsupported','SOURCE_SPARSE_UNSUPPORTED');
  const index=await indexEntries(root);
  requireThat(index.every(e=>e.stage===0),'Unmerged index is unsupported','SOURCE_UNMERGED_UNSUPPORTED');
  requireThat(index.every(e=>e.mode!=='160000'),'Submodules are unsupported','SOURCE_SUBMODULE_UNSUPPORTED');
}
export async function inspectRepo(repo, {source_mode='clean'}={}) {
  const root=await realpath(resolve(repo));
  requireThat(await realpath(await git(root,'rev-parse','--show-toplevel'))===root,'Specify the Git repository root');
  await assertSupportedSource(root);
  if(source_mode==='clean') requireThat(!(await git(root,...await filterOverrides(root),'status','--porcelain')),'Repository has uncommitted/untracked files; use explicit working-copy mode','DIRTY');
  return {root,base:await git(root,'rev-parse','HEAD')};
}
export async function createWorktree(repo,base,id,home) {
  const destination=join(home,'worktrees',id);await mkdir(dirname(destination),{recursive:true,mode:0o700});
  await git(repo,...await filterOverrides(repo),'-c','core.autocrlf=false','worktree','add','--detach',destination,base);return destination;
}
async function indexEntries(root) {
  return (await git(root,'ls-files','--stage','-z')).split('\0').filter(Boolean).map(row=>{
    const m=/^(\d{6}) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/.exec(row);requireThat(m,'Invalid index entry','GIT');
    return {path:m[4],mode:m[1],oid:m[2],stage:Number(m[3])};
  }).sort((a,b)=>compareText(a.path,b.path)||a.stage-b.stage);
}
function uniqueCasePaths(paths) {
  const names=new Map();for(const path of paths){let prefix='';for(const part of path.split('/')){prefix=prefix?prefix+'/'+part:part;const key=prefix.normalize('NFC').toLowerCase();requireThat(!names.has(key)||names.get(key)===prefix,'Ambiguous case collision: '+prefix,'SOURCE_CASE_COLLISION');names.set(key,prefix);}}
}
// Git omits untracked FIFOs/sockets from ls-files; inspect types without opening them.
async function rejectSpecialFiles(root,tracked) {
  let inspected=0;const directories=[''];
  while(directories.length){const prefix=directories.shift(),entries=await readdir(join(root,prefix),{withFileTypes:true}),candidates=[];
    for(const e of entries){if(!prefix&&e.name==='.git')continue;requireThat(++inspected<=60000,'Source type inventory limit exceeded','SNAPSHOT');if(e.isFile()||e.isSymbolicLink())continue;const path=prefix?prefix+'/'+e.name:e.name;relativePath(path);candidates.push({path,directory:e.isDirectory()});}
    if(!candidates.length)continue;
    const ignored=await command(['git','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false','check-ignore','--stdin','-z'],{cwd:root,env:cleanEnv({GIT_OPTIONAL_LOCKS:'0'}),input:candidates.map(e=>e.path).join('\0')+'\0',timeoutMs:30000});
    requireThat([0,1].includes(ignored.code)&&!ignored.truncated,'Cannot classify source exclusions','GIT');const skip=new Set(ignored.stdout.split('\0').filter(Boolean));
    for(const e of candidates){if(skip.has(e.path)&&!tracked.some(p=>p===e.path||p.startsWith(e.path+'/')))continue;requireThat(e.directory,'Unsupported source special file: '+e.path,'SOURCE_SPECIAL_UNSUPPORTED');directories.push(e.path);}
  }
}
async function originInventory(root,policy) {
  const head=await git(root,'rev-parse','HEAD'),ref=await git(root,'rev-parse','--symbolic-full-name','HEAD'),index_entries=await indexEntries(root);
  await rejectSpecialFiles(root,index_entries.map(e=>e.path));
  const listing=await git(root,'ls-files','--cached','--others','--exclude-standard','-z'),paths=[...new Set(listing.split('\0').filter(Boolean))].sort(compareText);
  requireThat(paths.length<=30000,'Origin inventory too large','SNAPSHOT');uniqueCasePaths(paths);
  const fixtures=new Map(normalizeTestFixtures(policy.approved_test_fixtures).map(x=>[x.path,x])),entries=[];let bytes=0;
  for(const path of paths) {
    relativePath(path);const full=join(root,path);let stat;
    try{stat=await lstat(full);}catch(e){if(e.code==='ENOENT')continue;throw e;}
    const parent=await realpath(dirname(full));requireThat(inside(root,parent),'Origin parent escapes repository','SOURCE_SYMLINK_UNSUPPORTED');
    requireThat(!credentialPath(path)||fixtures.has(path),'Potential credential file '+path,'SECRET');
    if(stat.isSymbolicLink()) {
      const target=await readlink(full);requireThat(!target.startsWith('/')&&inside(root,resolve(parent,target)),'External symlink denied: '+path,'SOURCE_SYMLINK_UNSUPPORTED');
      try{requireThat(inside(root,await realpath(full)),'Escaping symlink denied: '+path,'SOURCE_SYMLINK_UNSUPPORTED');}catch(e){if(e.code!=='ENOENT')throw e;}
      entries.push({path,mode:0o777,type:'symlink',target});
    }else{
      requireThat(stat.isFile(),'Unsupported origin file: '+path,'SOURCE_SPECIAL_UNSUPPORTED');
      const content=await readPinnedFile(root,path,{expected:stat,maxBytes:256*1024*1024-bytes,code:'SOURCE_CHANGED_DURING_CAPTURE',message:'Source changed during capture'});bytes+=content.length;
      const sha256=hash(content);requireThat(!fixtures.has(path)||fixtures.get(path).sha256===sha256,'Approved test fixture changed: '+path,'SECRET');entries.push({path,mode:stat.mode&0o111?0o755:0o644,type:'file',bytes:content.length,sha256});
    }
  }
  const present=new Set(entries.map(e=>e.path)),headPaths=(await git(root,'ls-tree','-r','-z','--name-only',head)).split('\0').filter(Boolean),deleted_paths=[...new Set([...headPaths,...index_entries.map(e=>e.path)].filter(p=>!present.has(p)))].sort(compareText);
  return {root,root_id:hash(root),head,ref,index_entries,index_digest:digestOf(index_entries),inventory_digest:digestOf(entries),entries,deleted_paths,source_mode:policy.source_mode||'clean'};
}
export async function captureOrigin(repo,policy={}, {betweenInventories}={}) {
  const root=await realpath(resolve(repo)),first=await originInventory(root,policy);if(betweenInventories)await betweenInventories();
  const second=await originInventory(root,policy);requireThat(digestOf(first)===digestOf(second),'Source changed during capture','SOURCE_CHANGED_DURING_CAPTURE');return first;
}
export async function overlayOrigin(worktree,origin,policy={}) {
  // Only the owned detached worktree is cleared. The original index and files are read-only.
  for(const name of await readdir(worktree))if(name!=='.git')await rm(join(worktree,name),{recursive:true,force:true});
  for(const e of origin.entries){const dest=join(worktree,e.path);await mkdir(dirname(dest),{recursive:true,mode:0o755});
    if(e.type==='symlink')await symlink(e.target,dest);
    else{const content=await readPinnedFile(origin.root,e.path,{maxBytes:e.bytes,code:'SOURCE_CHANGED_DURING_CAPTURE',message:'Source changed while copying'});requireThat(hash(content)===e.sha256,'Source changed while copying','SOURCE_CHANGED_DURING_CAPTURE');await writeFile(dest,content,{mode:e.mode});await chmod(dest,e.mode);}}
  const overlay=(await manifest(worktree,policy)).filter(e=>e.type!=='directory').sort((a,b)=>compareText(a.path,b.path));
  requireThat(digestOf(overlay)===origin.inventory_digest,'Working-copy overlay differs from capture','SOURCE_CHANGED_DURING_CAPTURE');
  const after=await captureOrigin(origin.root,policy);requireThat(digestOf(after)===digestOf(origin),'Source changed during capture','SOURCE_CHANGED_DURING_CAPTURE');
  const ignored=(await git(origin.root,'ls-files','--others','--ignored','--exclude-standard','-z')).split('\0').filter(Boolean);
  const changed=(await git(origin.root,...await filterOverrides(origin.root),'diff','--no-ext-diff','--no-textconv','--name-only','-z',origin.head)).split('\0').filter(Boolean);
  const tracked=new Set(origin.index_entries.map(e=>e.path));
  return {...origin,overlay_digest:digestOf(overlay),excluded_ignored_count:ignored.length,preexisting_paths:[...new Set([...changed,...origin.entries.filter(e=>!tracked.has(e.path)).map(e=>e.path)])].sort(compareText)};
}
export async function changedPaths(repo, base = 'HEAD') {
  const tracked = await git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base);
  const extras = await git(repo, 'ls-files', '--others', '--exclude-standard', '-z');
  return [...new Set([...tracked.split('\0'), ...extras.split('\0')].filter(Boolean))].sort();
}
function inside(root, path) { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')); }

// Includes ignored inputs and file modes. Symlinks may only resolve inside the candidate.
export async function manifest(root, { rejectCredentials = true, approved_test_fixtures = [], maxFiles = 30_000, maxBytes = 256 * 1024 * 1024 } = {}) {
  root = await realpath(root); const entries = []; let total = 0;
  const fixtures = new Map(normalizeTestFixtures(approved_test_fixtures).map(x => [x.path, x]));
  async function visit(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      if (!prefix && name === '.git') continue;
      const path = prefix ? `${prefix}/${name}` : name, full = join(dir, name), info = await lstat(full);
      requireThat(!path.includes('\n') && !path.includes('\r') && !path.includes('\0'), 'Unsupported control characters in path', 'SNAPSHOT');
      const fixture = fixtures.get(path);
      requireThat(!rejectCredentials || !credentialPath(path) || (fixture && info.isFile()),
        `Potential credential file ${path}: only an exact, reviewed test fixture can be admitted; no secret mounts are supported`, 'SECRET');
      requireThat(entries.length < maxFiles, 'Snapshot file limit exceeded; use a prebuilt dependency image', 'SNAPSHOT');
      const item = { path, mode: info.mode & 0o777 };
      if (info.isSymbolicLink()) {
        const target = await readlink(full); requireThat(!target.startsWith('/') && inside(root, resolve(dirname(full), target)), `External symlink denied: ${path}`, 'SNAPSHOT');
        try { requireThat(inside(root, await realpath(full)), `Escaping symlink denied: ${path}`, 'SNAPSHOT'); }
        catch (e) { if (e.code !== 'ENOENT') throw e; }
        entries.push({ ...item, type: 'symlink', target });
      } else if (info.isDirectory()) { entries.push({ ...item, type: 'directory' }); await visit(full, path); }
      else {
        requireThat(info.isFile(), `Special file denied: ${path}`, 'SNAPSHOT');
        const content=await readPinnedFile(root,path,{expected:info,maxBytes:maxBytes-total,code:'SNAPSHOT',message:`File changed during snapshot: ${path}`});
        total += content.length;
        const sha256 = hash(content);
        requireThat(!fixture || sha256 === fixture.sha256, `Approved test fixture changed: ${path}`, 'SECRET');
        entries.push({ ...item, type: 'file', bytes: content.length, sha256 });
      }
    }
  }
  await visit(root);
  for (const p of fixtures.keys()) requireThat(entries.some(e => e.path === p && e.type === 'file'), `Approved test fixture missing: ${p}`, 'SECRET');
  return entries;
}
export async function candidateIdentity(repo, policy = {}) {
  const head = await git(repo, 'rev-parse', 'HEAD');
  const entries = await manifest(repo, policy);
  requireThat(head === await git(repo, 'rev-parse', 'HEAD'), 'HEAD changed while snapshotting', 'INTEGRITY');
  return { head, entries, digest: hash(json({ head, entries })) };
}
export async function fingerprint(repo, policy = {}) { return (await candidateIdentity(repo, policy)).digest; }
export async function sealCandidate(run, home) {
  const source = await candidateIdentity(run.worktree, run.contract);
  requireThat(source.head === run.base, 'Worktree HEAD moved; restore the original base before resuming', 'INTEGRITY');
  const dir = join(home, 'runs', run.id, 'snapshots', randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o755 });
  try {
    for (const e of source.entries) {
      const destination = join(dir, e.path); await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
      if (e.type === 'directory') { await mkdir(destination, { recursive: true, mode: 0o755 }); }
      else if (e.type === 'symlink') await symlink(e.target, destination);
      else {
        const bytes = await readPinnedFile(run.worktree,e.path,{maxBytes:e.bytes,code:'INTEGRITY',message:'Candidate changed while copying'});
        requireThat(hash(bytes) === e.sha256, 'Candidate changed while copying', 'INTEGRITY');
        await writeFile(destination, bytes, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
      }
    }
    requireThat((await fingerprint(run.worktree, run.contract)) === source.digest, 'Candidate changed during seal', 'INTEGRITY');
    const artifact = await manifest(dir, run.contract), artifactDigest = hash(json(artifact));
    const stable = join(home, 'runs', run.id, 'snapshots', source.digest);
    let existing = false;
    try { existing = true; requireThat(hash(json(await manifest(stable, run.contract))) === artifactDigest, 'Stored snapshot was altered', 'INTEGRITY'); }
    catch (e) { if (e.code === 'ENOENT') existing = false; else throw e; }
    if (existing) await rm(dir, { recursive: true, force: true });
    else await rename(dir, stable);
    return { path: stable, source_digest: source.digest, artifact_digest: artifactDigest, head: source.head, entries: source.entries };
  } catch (e) { await rm(dir, { recursive: true, force: true }); throw e; }
}
export function manifestChanges(before, after) {
  const a = new Map(before.map(x => [x.path, x])), b = new Map(after.map(x => [x.path, x]));
  return [...new Set([...a.keys(), ...b.keys()])].filter(p => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p)))
    .filter(p => (b.get(p) || a.get(p)).type !== 'directory').sort();
}
