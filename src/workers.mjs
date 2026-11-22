// Coding workers cStack can run. The frozen contract names one; the controller, never the
// worker, decides completion. Each worker has its own isolation and explicit auth policy.
import { codexWorker, preflightCodex } from './codex.mjs';
import { claudeWorker, preflightClaude } from './claude.mjs';
import { CstackError } from './util.mjs';

export const workers = {
  codex: { name: 'codex', run: codexWorker, preflight: preflightCodex, defaultModel: 'gpt-6.1-sol' },
  claude: { name: 'claude', run: claudeWorker, preflight: preflightClaude, defaultModel: null },
};
export const workerNames = Object.keys(workers);
export function workerFor(contract) {
  const name = contract?.worker || 'codex', worker = workers[name];
  if (!worker) throw new CstackError('Unknown worker ' + name + '; use ' + workerNames.join(' or '), 'INVALID');
  return worker;
}
