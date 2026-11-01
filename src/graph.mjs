export { focusedCodeMap as codeMap } from './code-map.mjs';
export function updateTasks(run) {
  for (const task of run.contract.tasks) run.tasks[task.id] = 'TODO';
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of run.contract.tasks) {
      if (run.tasks[task.id] === 'PASS' || !task.depends_on.every(id => run.tasks[id] === 'PASS')) continue;
      if (run.contract.criteria.filter(c => c.required && task.criteria.includes(c.id)).every(c => run.results[c.id]?.status === 'PASS')) {
        run.tasks[task.id] = 'PASS'; changed = true;
      } else run.tasks[task.id] = 'READY';
    }
  }
}
export const taskReady = run => run.contract.tasks.find(t => run.tasks[t.id] !== 'PASS' && t.depends_on.every(id => run.tasks[id] === 'PASS'));
