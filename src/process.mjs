import { spawn } from 'node:child_process';
import { dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv as validateArgv, integer } from './util.mjs';

// Host subprocesses receive no inherited credential, loader or shell-hook variables.
export function cleanEnv(extra = {}) {
  return { PATH: [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
    LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', ...extra };
}
const guardian = fileURLToPath(new URL('./runners/guardian.mjs', import.meta.url));
export async function command(args, options = {}) {
  validateArgv(args);
  const { cwd, input, env = cleanEnv(), outputLimit = 1_000_000, signal, onLine, onSpawn,
    orphanSafe = false, cleanup = [] } = options;
  const timeoutMs = integer(options.timeoutMs, 120_000, 1, 86_400_000, 'timeoutMs');
  const graceMs = integer(options.graceMs, 75, 0, 5000, 'graceMs');
  if (signal?.aborted) return { code: 130, stdout: '', stderr: '', aborted: true, timedOut: false, truncated: false };
  return await new Promise(resolve => {
    let stdout = '', stderr = '', buffered = '', bytes = 0, timedOut = false, truncated = false, aborted = false;
    let settled = false, terminating = false, hardTimer, settleTimer, timer;
    const wrapped = orphanSafe ? [process.execPath, guardian, String(process.pid), JSON.stringify(cleanup), ...args] : args;
    const child = spawn(wrapped[0], wrapped.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    function kill(sig) {
      try {
        if (process.platform === 'win32') {
          // taskkill /T terminates descendants as well; unsupported hosts fail preflight.
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        } else process.kill(-child.pid, sig);
      } catch { /* Process may already have exited. */ }
    }
    function finish(code, error = '') {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(hardTimer); clearTimeout(settleTimer);
      signal?.removeEventListener('abort', abort);
      if (buffered && onLine) { try { onLine(buffered); } catch { /* Caller must not control process completion. */ } }
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref();
      resolve({ code, stdout, stderr: stderr + error, timedOut, truncated, aborted, pid: child.pid });
    }
    function stop() {
      if (terminating || settled) return;
      terminating = true; kill('SIGTERM');
      hardTimer = setTimeout(() => {
        kill('SIGKILL');
        settleTimer = setTimeout(() => finish(timedOut ? 124 : 130), 100);
      }, graceMs);
    }
    function abort() { aborted = true; stop(); }
    function collect(kind, buffer) {
      bytes += buffer.length;
      if (bytes > outputLimit) { truncated = true; stop(); return; }
      const text = buffer.toString();
      if (kind === 'out') {
        stdout += text;
        if (onLine) {
          buffered += text;
          let i;
          while ((i = buffered.indexOf('\n')) >= 0) {
            const line = buffered.slice(0, i); buffered = buffered.slice(i + 1);
            try { onLine(line); } catch { aborted = true; stop(); }
          }
        }
      } else stderr += text;
    }
    child.stdout.on('data', x => collect('out', x)); child.stderr.on('data', x => collect('err', x));
    child.stdin.on('error', () => {}); // An early-exiting child may close stdin first.
    child.on('error', e => finish(127, '\n' + e.message));
    child.on('close', code => {
      // Also clean up a child that daemonised within the original process group.
      kill('SIGKILL'); finish(timedOut ? 124 : aborted ? 130 : code ?? 1);
    });
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    try { if (onSpawn && child.pid) onSpawn(child.pid); } catch { aborted = true; stop(); }
    child.stdin.end(input ?? '');
  });
}
