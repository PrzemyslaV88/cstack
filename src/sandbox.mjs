// Isolated verifier runner. One backend, "host": the project's own environment inside an
// OS sandbox (Linux user/mount/net/PID namespaces, or macOS Seatbelt). There is no image,
// no daemon and no unsandboxed fallback. The runner proves its isolation properties with a
// self-test before it is used.
import { mkdtemp, mkdir, rm, readFile, writeFile, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { command, cleanEnv } from './process.mjs';
import { CstackError, hash } from './util.mjs';
import { environmentIdentity, sandboxPath, dependencyBins } from './environment.mjs';

const runnerDir = fileURLToPath(new URL('./runners/', import.meta.url));
export const RUNNER_VERSION = 6;
const selfTests = new Map();

export function runnerBackend(config = {}) {
  const backend = config.backend || 'host';
  if (backend === 'docker') throw new CstackError('Docker verification was removed in cStack 0.6. Use runner.backend "host": checks run with the project\'s own installed dependencies inside an OS sandbox.', 'CAPABILITY');
  if (!['host', 'linux'].includes(backend)) throw new CstackError('Only the isolated host runner is supported; no unsandboxed fallback', 'ISOLATION');
  return 'host';
}
export function sandboxKind(platform = process.platform) {
  if (platform === 'linux') return 'linux-namespaces';
  if (platform === 'darwin') return 'macos-seatbelt';
  throw new CstackError('Isolated verification needs Linux namespaces or macOS Seatbelt; use WSL2 on Windows', 'ISOLATION');
}
// Readable paths nested inside another readable path are already visible.
function outermost(paths) {
  const sorted = [...new Set(paths)].sort();
  return sorted.filter(p => !sorted.some(q => q !== p && p.startsWith(q + '/')));
}
export async function macosProfile(readable) {
  const base = await readFile(join(runnerDir, 'macos.sb'), 'utf8');
  const rules = readable.map((_, i) => `(allow file-read* (subpath (param "READ_${i}")))`).join('\n');
  return base.replace(';; CSTACK_READABLE', rules || ';; no extra readable paths');
}

export async function createRunner(config = {}, { environment = {}, selfTest = true } = {}) {
  runnerBackend(config);
  const sandbox = sandboxKind(), links = environment.links || [];
  if (sandbox === 'linux-namespaces') {
    const check = await command(['unshare', '--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child', 'true'], { timeoutMs: 5000 });
    if (check.code !== 0) throw new CstackError('Linux namespaces unavailable; refusing unsandboxed verification: ' + check.stderr, 'ISOLATION');
  } else {
    const check = await command(['/usr/bin/sandbox-exec', '-p', '(version 1)(allow default)', '/usr/bin/true'], { timeoutMs: 5000 });
    if (check.code !== 0) throw new CstackError('macOS sandbox-exec unavailable; refusing unsandboxed verification: ' + check.stderr, 'ISOLATION');
  }
  const env = await environmentIdentity(links), nodeBin = await realpath(process.execPath);
  const launcher = sandbox === 'linux-namespaces' ? 'linux.sh' : 'macos.sb';
  const readable = outermost(env.readable);
  const identity = hash(JSON.stringify({ backend: 'host', version: RUNNER_VERSION, sandbox, platform: process.platform, arch: process.arch,
    node: process.version, node_hash: hash(await readFile(nodeBin)), launcher: hash(await readFile(join(runnerDir, launcher))),
    links: env.links, runtimes: env.runtimes }));
  const systemPath = cleanEnv().PATH.split(':').filter(p => p !== dirname(process.execPath));
  const PATH = sandbox === 'linux-namespaces' ? ['/runtime', ...dependencyBins(links), ...systemPath].join(':') : sandboxPath(links);

  async function linuxExecute(args, { cwd, timeoutMs, input, signal } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'cstack-ns-')), candidate = await realpath(cwd);
    const argv = [args[0] === 'node' || args[0] === process.execPath ? '/runtime/node' : args[0], ...args.slice(1)];
    try {
      return await command(['unshare', '--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child',
        '/bin/bash', join(runnerDir, 'linux.sh'), root, candidate, nodeBin, runnerDir, PATH, String(readable.length), ...readable, '--', ...argv],
      { timeoutMs, input, signal, env: cleanEnv(), orphanSafe: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  async function macosExecute(args, { cwd, timeoutMs, input, signal } = {}) {
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'cstack-sb-'))), candidate = await realpath(cwd);
    const params = { CWD: candidate, SCRATCH: scratch, RUNNER: await realpath(runnerDir), HOME_DIR: await realpath(homedir()), TMP_DIR: await realpath(tmpdir()),
      ...Object.fromEntries(readable.map((p, i) => ['READ_' + i, p])) };
    const argv = [args[0] === process.execPath ? 'node' : args[0], ...args.slice(1)];
    const script = 'ulimit -c 0; ulimit -n 256; ulimit -f 65536; ulimit -t 120; cd "$1" || exit 126; shift; exec "$@"';
    try {
      return await command(['/usr/bin/sandbox-exec', '-p', await macosProfile(readable), ...Object.entries(params).flatMap(([k, v]) => ['-D', `${k}=${v}`]),
        '/bin/sh', '-c', script, 'cstack', candidate, ...argv],
      { timeoutMs, input, signal, orphanSafe: true,
        env: { PATH, HOME: scratch, TMPDIR: scratch, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC', CSTACK_CANDIDATE: candidate, CSTACK_RUNNER: runnerDir, CSTACK_SCRATCH: scratch } });
    } finally { await rm(scratch, { recursive: true, force: true }); }
  }
  const runner = { backend: 'host', sandbox, identity, environment: { links: env.links, runtimes: env.runtimes },
    runnerPath: name => sandbox === 'linux-namespaces' ? '/runner/' + name : join(runnerDir, name),
    execute: sandbox === 'linux-namespaces' ? linuxExecute : macosExecute };
  if (selfTest) await isolationSelfTest(runner);
  return runner;
}

// The runner must demonstrate, on this machine, that candidate code can run, cannot modify
// the candidate, cannot read host files outside the allowed paths, cannot reach the network,
// and can use its private scratch space. Results are cached per runner identity.
export function isolationSelfTest(runner) {
  if (selfTests.has(runner.identity)) return selfTests.get(runner.identity);
  const pending = (async () => {
    const base = await mkdtemp(join(tmpdir(), 'cstack-selftest-')), candidate = join(base, 'candidate'), secret = join(base, 'secret.txt');
    await mkdir(candidate); await writeFile(join(candidate, 'probe.txt'), 'readable'); await writeFile(secret, 'cstack-secret-canary');
    let connected = false;
    const server = createServer(socket => { connected = true; socket.destroy(); });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const fail = reason => { throw new CstackError('Isolation self-test failed: ' + reason + '. Refusing to verify outside a working sandbox.', 'ISOLATION'); };
    const run = (args, timeoutMs = 15000) => runner.execute(args, { cwd: candidate, timeoutMs });
    try {
      const basic = await run(['/bin/sh', '-c', 'cat probe.txt; printf " ok"']);
      if (basic.code !== 0 || basic.stdout !== 'readable ok') fail('basic execution (' + (basic.stderr || basic.code).toString().slice(0, 300) + ')');
      const write = await run(['/bin/sh', '-c', 'echo tampered > probe.txt']);
      if (write.code === 0 || await readFile(join(candidate, 'probe.txt'), 'utf8') !== 'readable') fail('the candidate was writable');
      const read = await run(['/bin/sh', '-c', 'cat "$1" 2>/dev/null', 'sh', secret]);
      if (read.stdout.includes('cstack-secret-canary')) fail('host files outside the allowed paths were readable');
      const port = server.address().port;
      const network = await run(['node', '-e', `const s=require('net').connect(${port},'127.0.0.1');s.on('connect',()=>{console.log('connected');process.exit(0)});s.on('error',()=>process.exit(3));setTimeout(()=>process.exit(4),3000)`]);
      if (network.stdout.includes('connected') || connected) fail('the network was reachable');
      const scratch = await run(['/bin/sh', '-c', 'echo w > "$TMPDIR/w" && cat "$TMPDIR/w"']);
      if (scratch.code !== 0 || scratch.stdout !== 'w\n') fail('scratch space was not writable (' + scratch.stderr.slice(0, 300) + ')');
      return { passed: true, checks: ['execution', 'candidate-read-only', 'host-files-hidden', 'network-denied', 'scratch-writable'] };
    } finally {
      await new Promise(resolve => server.close(resolve));
      await rm(base, { recursive: true, force: true });
    }
  })();
  selfTests.set(runner.identity, pending);
  pending.catch(() => selfTests.delete(runner.identity));
  return pending;
}
