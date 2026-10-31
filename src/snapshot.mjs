import { mkdir, readdir, lstat, readFile, readlink, realpath, writeFile, chmod, symlink, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command, cleanEnv } from './process.mjs';
import { hash, json, requireThat, CstackError } from './util.mjs';
export async function git(cwd, ...args) {
  const out = await command(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { cwd, env: cleanEnv(), timeoutMs: 30_000 });
  if (out.code !== 0) throw new CstackError(`git ${args[0]}: ${out.stderr.trim()}`, 'GIT');
  return out.stdout.trimEnd();
}
export async function inspectRepo(repo) {
  const root = await realpath(resolve(repo));
  requireThat(await realpath(await git(root, 'rev-parse', '--show-toplevel')) === root, 'Specify the Git repository root');
  requireThat(!(await git(root, 'status', '--porcelain')), 'Repository has uncommitted/untracked files; no existing work is altered', 'DIRTY');
  return { root, base: await git(root, 'rev-parse', 'HEAD') };
}
export async function createWorktree(repo, base, id, home) {
  const destination = join(home, 'worktrees', id); await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await git(repo, 'worktree', 'add', '--detach', destination, base); return destination;
}
export async function changedPaths(repo, base = 'HEAD') {
  const tracked = await git(repo, 'diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', base);
  const extras = await git(repo, 'ls-files', '--others', '--exclude-standard', '-z');
  return [...new Set([...tracked.split('\0'), ...extras.split('\0')].filter(Boolean))].sort();
}
function inside(root, path) { const rel = relative(root, path); return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/')); }
const credentialPath = p => /(^|\/)(\.env(?:\.(?!example$|sample$)[^/]*)?|auth\.json|\.npmrc|id_rsa|id_ed25519)$|\.(pem|key|p12)$/i.test(p);

// Includes ignored inputs and file modes. Symlinks may only resolve inside the candidate.
export async function manifest(root, { rejectCredentials = true, maxFiles = 30_000, maxBytes = 256 * 1024 * 1024 } = {}) {
  root = await realpath(root); const entries = []; let total = 0;
  async function visit(dir, prefix = '') {
    for (const name of (await readdir(dir)).sort()) {
      if (!prefix && name === '.git') continue;
      const path = prefix ? `${prefix}/${name}` : name, full = join(dir, name), info = await lstat(full);
      requireThat(!path.includes('\n') && !path.includes('\r') && !path.includes('\0'), 'Unsupported control characters in path', 'SNAPSHOT');
      requireThat(!rejectCredentials || !credentialPath(path), `Potential credential file ${path}: remove it from the candidate; no secret mounts are supported`, 'SECRET');
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
        total += info.size; requireThat(total <= maxBytes, 'Snapshot byte limit exceeded; use a prebuilt dependency image', 'SNAPSHOT');
        entries.push({ ...item, type: 'file', bytes: info.size, sha256: hash(await readFile(full)) });
      }
    }
  }
  await visit(root); return entries;
}
export async function candidateIdentity(repo) {
  const head = await git(repo, 'rev-parse', 'HEAD');
  const entries = await manifest(repo);
  requireThat(head === await git(repo, 'rev-parse', 'HEAD'), 'HEAD changed while snapshotting', 'INTEGRITY');
  return { head, entries, digest: hash(json({ head, entries })) };
}
export async function fingerprint(repo) { return (await candidateIdentity(repo)).digest; }
export async function sealCandidate(run, home) {
  const source = await candidateIdentity(run.worktree);
  requireThat(source.head === run.base, 'Worktree HEAD moved; restore the original base before resuming', 'INTEGRITY');
  const dir = join(home, 'runs', run.id, 'snapshots', randomUUID());
  await mkdir(dir, { recursive: true, mode: 0o755 });
  try {
    for (const e of source.entries) {
      const destination = join(dir, e.path); await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
      if (e.type === 'directory') { await mkdir(destination, { recursive: true, mode: 0o755 }); }
      else if (e.type === 'symlink') await symlink(e.target, destination);
      else {
        const bytes = await readFile(join(run.worktree, e.path));
        requireThat(hash(bytes) === e.sha256, 'Candidate changed while copying', 'INTEGRITY');
        await writeFile(destination, bytes, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
      }
    }
    requireThat((await fingerprint(run.worktree)) === source.digest, 'Candidate changed during seal', 'INTEGRITY');
    const artifact = await manifest(dir), artifactDigest = hash(json(artifact));
    const stable = join(home, 'runs', run.id, 'snapshots', source.digest);
    let existing = false;
    try { existing = true; requireThat(hash(json(await manifest(stable))) === artifactDigest, 'Stored snapshot was altered', 'INTEGRITY'); }
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
