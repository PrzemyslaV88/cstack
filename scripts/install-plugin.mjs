import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildPlugin } from './build-plugin.mjs';

function codex(args) {
  const result = spawnSync(process.env.CSTACK_CODEX_BIN || 'codex', args, { encoding: 'utf8', maxBuffer: 8_000_000, timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
try {
  const registrations = codex(['plugin', 'marketplace', 'list', '--json']);
  const existing = registrations.marketplaces?.find(m => m.name === 'cstack-local');
  let output;
  if (existing) {
    if (existing.marketplaceSource?.sourceType !== 'local') throw new Error('The existing cstack-local marketplace is not local; preserve its source and choose a local installation explicitly.');
    output = resolve(existing.root);
    const catalog = JSON.parse(await readFile(join(output, '.agents/plugins/marketplace.json'), 'utf8'));
    if (catalog.name !== 'cstack-local' || catalog.plugins?.length !== 1 || catalog.plugins[0].name !== 'cstack') {
      throw new Error('Existing cstack-local registration contains unrelated plugins; preserving it.');
    }
  }
  const build = await buildPlugin(output ? { output } : {});
  const marketplace = codex(['plugin', 'marketplace', 'add', build.marketplaceRoot, '--json']);
  const installed = codex(['plugin', 'add', 'cstack@cstack-local', '--json']);
  const listing = codex(['plugin', 'list', '--marketplace', 'cstack-local', '--json']);
  const active = listing.installed.find(p => p.pluginId === 'cstack@cstack-local');
  if (!active?.installed || !active.enabled) throw new Error('Codex has not enabled the installed cStack plugin');
  const cached = JSON.parse(await readFile(join(installed.installedPath, 'build-info.json'), 'utf8'));
  if (cached.source_digest !== build.sourceDigest) throw new Error('Installed plugin differs from this build; preserve it and check version/update behavior');
  console.log(JSON.stringify({ build, marketplace, installed, verifiedEnabled: true }, null, 2));
} catch (e) { console.error('Plugin install: ' + e.message); process.exitCode = 1; }
