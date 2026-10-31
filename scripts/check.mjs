import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
let count = 0;
async function visit(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) await visit(p);
    else if (p.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', p], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1); count++;
    }
  }
}
for (const directory of ['src', 'test', 'scripts']) await visit(directory);
console.log(`Syntax checked ${count} JavaScript modules.`);
