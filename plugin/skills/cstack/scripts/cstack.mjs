#!/usr/bin/env node
import { access } from 'node:fs/promises';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('cStack needs Node 22.13 or newer.'); process.exit(1);
}
// A built bundle carries its runtime; a plugin installed straight from the repository
// (Claude Code `/plugin marketplace add PrzemyslaV88/cstack`) uses the repository's src/.
const candidates = [new URL('../../../runtime/src/cli.mjs', import.meta.url), new URL('../../../../src/cli.mjs', import.meta.url)];
let runtime = null;
for (const candidate of candidates) { try { await access(candidate); runtime = candidate; break; } catch {} }
if (!runtime) { console.error('cStack runtime missing. Build the plugin with npm run plugin:build.'); process.exit(1); }
await import(runtime.href);
