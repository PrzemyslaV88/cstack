import { readdir, lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, relative, extname, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { command } from './process.mjs';
import { credentialPath } from './file-policy.mjs';
import { requireThat } from './util.mjs';

const excluded = new Set(['.git', '.codex', '.cstack', 'node_modules', '.venv', 'venv', '.env',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache', '.next', '.nuxt',
  '.svelte-kit', 'dist', 'build', 'coverage', 'target', 'vendor', '.terraform']);
const languages = { '.py': 'Python', '.pyi': 'Python', '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.jsx': 'JavaScript', '.ts': 'TypeScript', '.tsx': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript',
  '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift', '.java': 'Java',
  '.kt': 'Kotlin', '.cs': 'C#', '.c': 'C', '.h': 'C/C++ header', '.cpp': 'C++', '.cc': 'C++',
  '.sh': 'Shell', '.sql': 'SQL', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.vue': 'Vue', '.svelte': 'Svelte', '.dart': 'Dart' };
export const languageOf = path => languages[extname(path).toLowerCase()] || null;
export const importLanguage = path => /\.(py|pyi|[cm]?[jt]sx?)$/.test(path);
const sha = value => createHash('sha256').update(value).digest('hex');
export const within = (root, path) => { const rel = relative(root, path); return !rel || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel)); };
function allowed(path) {
  return path && !/[\0\r\n\t\\]/.test(path) && !path.startsWith('/') && !path.split('/').some(p => p === '..' || excluded.has(p)) &&
    !path.split('/').some(p => p.startsWith('._') || p.startsWith('.env')) && !credentialPath(path);
}

export async function repository(repo, { maxEntries = 20_000, maxFileBytes = 512_000, maxBytes = 20_000_000 } = {}) {
  const root = await realpath(resolve(repo));
  requireThat((await lstat(root)).isDirectory(), 'Repository path must be a directory');
  const files = [], cache = new Map(), warnings = [], skipped = {};
  let bytes = 0, partial = false;
  const skip = (reason, path) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
    if (path && warnings.length < 50) warnings.push({ path, reason });
  };
  const listing = await command(['git', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null',
    '-c', 'core.untrackedCache=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, timeoutMs: 15_000, outputLimit: 4_000_000 });
  let mode = 'git tracked and non-ignored untracked files';
  async function add(path) {
    if (!allowed(path)) { skip('excluded'); return; }
    if (files.length >= maxEntries) { partial = true; return; }
    try {
      const full = join(root, path), info = await lstat(full);
      if (!info.isFile()) { skip('symlink or non-regular file', path); return; }
      if (!within(root, await realpath(full))) { skip('outside repository', path); return; }
      files.push({ path, bytes: info.size, language: languageOf(path) });
    } catch (e) { skip(e.code === 'ENOENT' ? 'file removed during scan' : 'unreadable file', path); }
  }
  if (listing.code === 0) {
    requireThat(!listing.truncated, 'Git file inventory exceeded its output limit; use a smaller project directory');
    for (const path of [...new Set(listing.stdout.split('\0').filter(Boolean))].sort()) await add(path);
  } else {
    mode = 'directory walk with generated/dependency folders excluded';
    let visited = 0;
    async function walk(dir, prefix = '') {
      for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (++visited > maxEntries) { partial = true; return; }
        const path = prefix + item.name;
        if (!allowed(path)) { skip('excluded'); continue; }
        if (item.isSymbolicLink()) { skip('symlink', path); continue; }
        if (item.isDirectory()) await walk(join(dir, item.name), path + '/');
        else await add(path);
      }
    }
    await walk(root);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const known = new Set(files.map(f => f.path));
  async function read(path) {
    if (cache.has(path)) return cache.get(path);
    if (!known.has(path)) return null;
    cache.set(path, null);
    let handle;
    try {
      const full = join(root, path);
      if (!within(root, await realpath(full))) { skip('outside repository', path); return null; }
      handle = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await handle.stat();
      if (!before.isFile() || before.size > maxFileBytes) { skip('file size/type limit', path); partial = true; return null; }
      if (bytes + before.size > maxBytes) { skip('total read limit', path); partial = true; return null; }
      // Bound actual reads even if a concurrent writer grows the file.
      const buffer = Buffer.alloc(before.size + 1);
      let used = 0;
      while (used < buffer.length) { const r = await handle.read(buffer, used, buffer.length - used, null); if (!r.bytesRead) break; used += r.bytesRead; }
      bytes += used;
      const after = await handle.stat();
      if (used !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        skip('file changed during read', path); partial = true; return null;
      }
      const raw = buffer.subarray(0, used);
      const source = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, '');
      if (source.includes('\0')) { skip('binary file', path); return null; }
      const value = { source, sha256: sha(raw) }; cache.set(path, value); return value;
    } catch (e) { skip(e.code === 'ELOOP' ? 'symlink' : 'unreadable or non-UTF8 file', path); partial = true; return null; }
    finally { await handle?.close(); }
  }
  return { root, files, known, read,
    coverage: () => ({ inventory_method: mode, inventory_files: files.length, bytes_read: bytes, partial,
      skipped: { ...skipped }, warnings: [...warnings],
      read_content_digest: sha(JSON.stringify([...cache].filter(([, v]) => v).map(([p, v]) => [p, v.sha256]).sort())),
      limits: { max_entries: maxEntries, max_file_bytes: maxFileBytes, max_read_bytes: maxBytes } }) };
}
