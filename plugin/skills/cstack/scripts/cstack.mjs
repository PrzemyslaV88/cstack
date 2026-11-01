#!/usr/bin/env node
import { access } from 'node:fs/promises';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error('cStack needs Node 22.13 or newer.'); process.exit(1);
}
const runtime = new URL('../../../runtime/src/cli.mjs', import.meta.url);
try { await access(runtime); }
catch { console.error('Bundled cStack runtime missing. Build the plugin with npm run plugin:build.'); process.exit(1); }
await import(runtime.href);
