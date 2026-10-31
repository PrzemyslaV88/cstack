import { readFile } from 'node:fs/promises';
import { dirname, posix, join } from 'node:path';
import { git } from './snapshot.mjs';
export async function codeMap(repo, goal, { maxFiles = 40, maxBytes = 100_000 } = {}) {
  const names = (await git(repo, 'ls-files', '-z')).split('\0').filter(Boolean), known = new Set(names);
  const terms = goal.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [], edges = [];
  const ranked = names.map(p => ({ p, score: terms.reduce((s, t) => s + (p.toLowerCase().includes(t) ? 4 : 0), 0) + (p.startsWith('src/') ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.p.localeCompare(b.p));
  let consumed = 0;
  for (const { p } of ranked.slice(0, maxFiles)) {
    if (!/\.(m?[jt]sx?)$/.test(p)) continue;
    const source = (await readFile(join(repo, p), 'utf8')).slice(0, maxBytes - consumed); consumed += source.length;
    for (const match of source.matchAll(/(?:from\s+|require\s*\(|import\s+)["'](\.{1,2}\/[^"']+)["']/g)) {
      const base = posix.normalize(posix.join(dirname(p), match[1]));
      const target = [base, ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'].map(s => base + s)].find(x => known.has(x));
      if (target) edges.push({ from: p, to: target, confidence: 'heuristic' });
    }
    if (consumed >= maxBytes) break;
  }
  // Edges now affect the selected context, rather than merely being written to disk.
  const seeds = ranked.slice(0, Math.max(1, Math.floor(maxFiles / 2))).map(x => x.p), selected = new Set(seeds);
  for (const edge of edges) if (seeds.includes(edge.from) || seeds.includes(edge.to)) { selected.add(edge.from); selected.add(edge.to); }
  for (const { p } of ranked) { if (selected.size >= maxFiles) break; selected.add(p); }
  return { files: [...selected].slice(0, maxFiles), edges: edges.filter(e => selected.has(e.from) && selected.has(e.to)), method: 'filename seeds + resolved relative-import neighbours', truncated: names.length > maxFiles };
}
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
