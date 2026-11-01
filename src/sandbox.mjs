import { mkdtemp, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { command, cleanEnv } from './process.mjs';
import { CstackError, hash } from './util.mjs';
const runnerDir = fileURLToPath(new URL('./runners/', import.meta.url));

export async function createRunner(config = {}, { control = command } = {}) {
  const backend = config.backend || 'docker';
  if (backend === 'linux') {
    if (process.platform !== 'linux') throw new CstackError('Linux namespace runner requires Linux; use Docker on macOS/Windows', 'ISOLATION');
    const check = await command(['unshare', '--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child', 'true'], { timeoutMs: 5000 });
    if (check.code !== 0) throw new CstackError('Linux namespaces unavailable; refusing unsandboxed verification: ' + check.stderr, 'ISOLATION');
    const nodeBin = await realpath(process.execPath);
    const identity = hash(JSON.stringify({ backend, platform: process.platform, arch: process.arch, node: process.version,
      node_hash: hash(await readFile(nodeBin)), launcher: hash(await readFile(join(runnerDir, 'linux.sh'))) }));
    return { backend, identity, async execute(args, { cwd, timeoutMs, input, signal } = {}) {
      const root = await mkdtemp(join(tmpdir(), 'cstack-ns-'));
      const argv = [args[0] === 'node' || args[0] === process.execPath ? '/runtime/node' : args[0], ...args.slice(1)];
      try {
        return await command(['unshare', '--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child',
          '/bin/bash', join(runnerDir, 'linux.sh'), root, cwd, nodeBin, runnerDir, ...argv],
        { timeoutMs, input, signal, env: cleanEnv(), orphanSafe: true });
      } finally { await rm(root, { recursive: true, force: true }); }
    } };
  }
  if (backend !== 'docker') throw new CstackError('Only docker and linux isolated runners are supported; no host fallback', 'ISOLATION');
  const image = config.image || 'node:22.16.0-bookworm-slim';
  const connection = Object.fromEntries(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH']
    .filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  const dockerEnv = cleanEnv({ HOME: homedir(), ...connection });
  const inspect = await control(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], { timeoutMs: 15000, env: dockerEnv });
  const imageId = inspect.stdout.trim();
  if (inspect.code !== 0 || !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new CstackError(`Docker/image unavailable. Explicitly pull or build ${image} first. No automatic pull or host fallback.`, 'ISOLATION');
  const identity = hash(JSON.stringify({ backend, image: imageId, limits: 'read-only,none,65534,128,1g,1cpu', version: 4 }));
  return { backend, identity, image: imageId, async execute(args, { cwd, timeoutMs, input, signal } = {}) {
    const candidateDir = await realpath(cwd);
    if (candidateDir.includes(',') || runnerDir.includes(',')) throw new CstackError('Docker bind paths must not contain commas', 'ISOLATION');
    const name = 'cstack-' + randomUUID();
    const executable = args[0] === process.execPath ? 'node' : args[0];
    const cleanup = ['docker', 'rm', '-f', name];
    // One owned cleanup path avoids racing Docker auto-removal against the guardian/finalizer.
    const launch = ['docker', 'run', '--pull=never', '--name', name, '--network=none', '--read-only', '--init',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user=65534:65534', '--pids-limit=128', '--memory=1g', '--cpus=1',
      '--no-healthcheck', '--tmpfs=/tmp:rw,nosuid,nodev,size=134217728,mode=1777',
      '--mount', `type=bind,src=${candidateDir},dst=/candidate,readonly`, '--mount', `type=bind,src=${runnerDir},dst=/runner,readonly`,
      '--workdir=/candidate', '--env=HOME=/tmp', '--env=TMPDIR=/tmp', '--env=NODE_OPTIONS=', '--env=TZ=UTC',
      '--entrypoint', executable, '-i', imageId, ...args.slice(1)];
    try { return await control(launch, { timeoutMs, input, signal, env: dockerEnv, orphanSafe: true, cleanup }); }
    finally {
      const cleaned = await control(cleanup, { timeoutMs: 3000, env: dockerEnv });
      if (cleaned.code !== 0 && !/No such container/i.test(cleaned.stderr)) {
        let absent=false;
        const deadline=Date.now()+15000;
        if(cleaned.timedOut||/removal.*already in progress/i.test(cleaned.stderr))while(Date.now()<deadline){
          const state=await control(['docker','container','inspect',name],{timeoutMs:1000,env:dockerEnv});
          if(state.code!==0&&/No such (?:container|object)/i.test(state.stderr)){absent=true;break;}
          await new Promise(resolve=>setTimeout(resolve,200));
        }
        if(!absent)throw new CstackError(`Cannot confirm cleanup of container ${name}: ${cleaned.stderr}`, 'ISOLATION');
      }
    }
  } };
}
