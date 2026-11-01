import { readdir, readFile, mkdir, writeFile, lstat, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('..', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = x => JSON.stringify(x, null, 2) + '\n';

export async function buildPlugin({ output = join(repo, 'dist/cstack-marketplace') } = {}) {
  const files = new Map();
  async function collect(source, target) {
    for (const item of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('._')) continue;
      const from = join(source, item.name), to = target ? target + '/' + item.name : item.name;
      if (item.isDirectory()) await collect(from, to);
      else {
        const stat = await lstat(from);
        if (!stat.isFile()) throw new Error('Plugin source must contain regular files only: ' + from);
        files.set(to, { bytes: await readFile(from), mode: stat.mode & 0o111 ? 0o755 : 0o644 });
      }
    }
  }
  await collect(join(repo, 'plugin'), '');
  await collect(join(repo, 'src'), 'runtime/src');
  const pkg = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
  const portable = JSON.parse(files.get('plugin.json').bytes);
  const overlay = JSON.parse(files.get('.codex-plugin/plugin.json').bytes);
  if (portable.name !== 'cstack' || portable.version !== pkg.version || overlay.version !== pkg.version) {
    throw new Error('Plugin manifest versions must match package.json');
  }
  files.set('runtime/package.json', { bytes: Buffer.from(json({ name: '@cstack/plugin-runtime', version: pkg.version,
    type: 'module', private: true, engines: pkg.engines, license: pkg.license })), mode: 0o644 });
  files.set('runtime/CONTRACT.md', { bytes: await readFile(join(repo, 'docs/CONTRACT.md')), mode: 0o644 });
  const entries = [...files].sort(([a], [b]) => a.localeCompare(b))
    .map(([path, f]) => ({ path, mode: f.mode, sha256: sha(f.bytes) }));
  const digest = sha(json(entries));
  const relative = `plugins/cstack-${pkg.version}-${digest.slice(0, 12)}`;
  const marketplaceRoot = resolve(output), pluginRoot = join(marketplaceRoot, relative);
  let exists = true;
  try { await access(pluginRoot); } catch (e) { if (e.code !== 'ENOENT') throw e; exists = false; }
  if (exists) {
    const stored = JSON.parse(await readFile(join(pluginRoot, 'build-info.json'), 'utf8'));
    if (stored.source_digest !== digest) throw new Error('Existing generated plugin has a different identity');
    for (const entry of entries) {
      if (sha(await readFile(join(pluginRoot, entry.path))) !== entry.sha256) {
        throw new Error('Existing generated plugin changed; preserving it: ' + entry.path);
      }
    }
    const actual = [];
    async function inventory(dir, prefix = '') {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        if (item.name.startsWith('._')) continue;
        const p = prefix + item.name;
        if (item.isDirectory()) await inventory(join(dir, item.name), p + '/');
        else if (item.isFile()) actual.push(p);
        else throw new Error('Unexpected generated plugin file type; preserving it: ' + p);
      }
    }
    await inventory(pluginRoot);
    if (json(actual.sort()) !== json([...entries.map(e => e.path), 'build-info.json'].sort())) {
      throw new Error('Unexpected generated plugin contents; preserving them');
    }
  } else {
    for (const [path, f] of files) {
      const destination = join(pluginRoot, path);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, f.bytes, { flag: 'wx', mode: f.mode });
    }
    await writeFile(join(pluginRoot, 'build-info.json'), json({ name: 'cstack', version: pkg.version,
      source_digest: digest, files: entries }), { flag: 'wx' });
  }
  const catalogPath = join(marketplaceRoot, '.agents/plugins/marketplace.json');
  try {
    const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
    if (catalog.name !== 'cstack-local' || catalog.plugins.length !== 1 || catalog.plugins[0].name !== 'cstack') {
      throw new Error('Refusing to replace an unrelated marketplace');
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await mkdir(dirname(catalogPath), { recursive: true });
  await writeFile(catalogPath, json({ name: 'cstack-local', interface: { displayName: 'cStack Local' },
    plugins: [{ name: 'cstack', source: { source: 'local', path: './' + relative },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL', products: ['CODEX'] }, category: 'Developer Tools' }] }));
  const result = { marketplace: 'cstack-local', marketplaceRoot, pluginRoot, version: pkg.version, sourceDigest: digest, files: files.size };
  await writeFile(join(marketplaceRoot, 'build-result.json'), json(result));
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(json(await buildPlugin())); }
  catch (e) { console.error('Plugin build: ' + e.message); process.exitCode = 1; }
}
