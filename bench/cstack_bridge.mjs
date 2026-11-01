// Host-side cStack controller. The contestant worker remains in Harbor's container.
// No candidate code or hidden tests execute in this bridge process.
import { createInterface } from 'node:readline';
import { beginRun, processRun, effectiveStatus, reviewDetails } from '../src/core.mjs';
import { join } from 'node:path';
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
const controller = new AbortController();
process.on('SIGTERM', () => controller.abort());
process.on('SIGINT', () => controller.abort());
function send(value) { process.stdout.write(JSON.stringify(value) + '\n'); }
async function receive() {
  const entry = await iterator.next();
  if (entry.done || entry.value.length > 2_000_000) throw new Error('Bridge input closed/too large');
  return JSON.parse(entry.value);
}
try {
  const config = await receive();
  if (config.op !== 'start') throw new Error('Expected start');
  const run = await beginRun({ repo: config.repo, contract: config.contract, home: config.home });
  let sequence = 0;
  await processRun(run, { home: config.home, signal: controller.signal,
    worker: async ({ run: attempt, prompt, timeoutMs }) => {
      const id = ++sequence;
      send({ op: 'worker', id, prompt, timeout_ms: timeoutMs, worktree: attempt.worktree });
      const response = await receive();
      if (response.op !== 'worker_result' || response.id !== id) throw new Error('Mismatched bridge response');
      return response.result;
    }
  });
  send({ op: 'finished', status: await effectiveStatus(run), reason: run.reason,
    checks_for_snapshot: reviewDetails(run), metrics: run.metrics, attempts: run.attempts.length,
    run_id: run.id, worktree: run.worktree, report: join(config.home, 'runs', run.id, 'report.md') });
} catch (error) {
  send({ op: 'error', message: String(error.message || error) }); process.exitCode = 2;
} finally { lines.close(); process.stdin.destroy(); }
