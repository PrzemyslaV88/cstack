// Build the plugin and install it into Claude Code from the local marketplace.
// For a GitHub install instead: /plugin marketplace add PrzemyslaV88/cstack, then /plugin install cstack@cstack
import { spawnSync } from 'node:child_process';
import { buildPlugin } from './build-plugin.mjs';

function claude(args) {
  const result = spawnSync(process.env.CSTACK_CLAUDE_BIN || 'claude', args, { encoding: 'utf8', maxBuffer: 8_000_000, timeout: 120000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout);
  return result.stdout.trim();
}
try {
  const build = await buildPlugin();
  const validated = claude(['plugin', 'validate', build.pluginRoot]);
  const marketplace = claude(['plugin', 'marketplace', 'add', build.marketplaceRoot]);
  const installed = claude(['plugin', 'install', 'cstack@cstack-local']);
  console.log(JSON.stringify({ build, validated, marketplace, installed, next: 'Start a new Claude Code session and run /cstack:verify or /cstack:cstack' }, null, 2));
} catch (e) { console.error('Claude plugin install: ' + e.message); process.exitCode = 1; }
