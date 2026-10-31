// Runs in its own process group. Kill remaining children if the controller dies.
import { spawn, spawnSync } from 'node:child_process';
const [parent, cleanupJSON, ...args] = process.argv.slice(2);
const cleanup = JSON.parse(cleanupJSON);
function stop() {
  if (cleanup.length) { try { spawnSync(cleanup[0], cleanup.slice(1), { timeout: 1500, stdio: 'ignore' }); } catch {} }
  try { process.kill(-process.pid, 'SIGKILL'); } catch { process.exit(130); }
}
const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: process.env });
const watcher = setInterval(() => { try { process.kill(Number(parent), 0); } catch { stop(); } }, 100);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.on('error', e => { console.error(e.message); process.exit(127); });
child.on('exit', code => { clearInterval(watcher); process.exit(code ?? 1); });
