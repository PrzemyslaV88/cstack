import { repository, importLanguage, languageOf } from './repository.mjs';
import { importsOf, importResolver } from './imports.mjs';

export function rankedFiles(files, goal = '') {
  const terms = [...new Set(goal.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [])];
  return files.map(f => ({ path: f.path, score: (f.path === goal ? 1000 : 0) + terms.reduce((s, t) => s + (f.path.toLowerCase().includes(t) ? 4 : 0), 0)
    + (f.path.startsWith('src/') ? 1 : 0) })).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}
const displayImport = value => value == null ? null : /:\/\/|[?&](?:token|key|password|secret)=/i.test(value)
  ? '[URL import details omitted]' : value.replace(/[\r\n\0]/g, '?');

export async function dependencyGraph(reader, { maxFiles = 2000, goal = '' } = {}) {
  const sourceFiles = reader.files.filter(f => importLanguage(f.path)), resolveImport = await importResolver(reader);
  const nodes = new Map(sourceFiles.map(f => [f.path, { path: f.path, language: f.language, scanned: false }]));
  const links = new Map(), external = [], unresolved = [];
  let scanned = 0;
  for (const { path } of rankedFiles(sourceFiles, goal).slice(0, maxFiles)) {
    const data = await reader.read(path); if (!data) continue;
    nodes.get(path).scanned = true; scanned++;
    for (const declaration of importsOf(data.source, path)) {
      const resolution = resolveImport(path, declaration);
      const evidence = { path, line: declaration.line, kind: declaration.kind, specifier: displayImport(declaration.specifier) };
      for (const target of resolution.targets) {
        if (!nodes.has(target)) nodes.set(target, { path: target, language: languageOf(target) || 'data/config', scanned: false });
        const key = path + '\0' + target;
        if (!links.has(key)) links.set(key, { from: path, to: target, confidence: 'heuristic', evidence: [] });
        links.get(key).evidence.push(evidence);
      }
      if (!resolution.targets.length) {
        const record = { ...evidence, reason: resolution.reason, ...(resolution.candidates ? { candidates: resolution.candidates } : {}) };
        (resolution.reason.startsWith('external') ? external : unresolved).push(record);
      }
    }
  }
  const edges = [...links.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  const degree = new Map([...nodes.keys()].map(p => [p, { imports: 0, imported_by: 0 }]));
  for (const e of edges) { degree.get(e.from).imports++; degree.get(e.to).imported_by++; }
  return { schema_version: 1, repository: reader.root, method: 'lexical static import declarations with local path resolution',
    nodes: [...nodes.values()].sort((a, b) => a.path.localeCompare(b.path)).map(n => ({ ...n, ...degree.get(n.path) })),
    edges, external_or_unresolved: external, unresolved,
    coverage: { ...reader.coverage(), supported_source_files: sourceFiles.length, scanned_source_files: scanned,
      source_file_limit: maxFiles, partial: reader.coverage().partial || scanned < sourceFiles.length },
    limits: ['Maps file imports, not function calls or runtime execution.',
      'Computed imports, runtime Python path changes, package export conditions and inherited TS configuration may be unresolved.',
      'External imports are declarations only; package installation and application behavior were not checked.'] };
}

export async function focusedCodeMap(repo, goal, { maxFiles = 40, maxBytes = 100_000 } = {}) {
  const reader = await repository(repo, { maxBytes, maxFileBytes: maxBytes });
  const ranked = rankedFiles(reader.files, goal);
  const graph = await dependencyGraph(reader, { maxFiles, goal });
  const seeds = ranked.slice(0, Math.max(1, Math.floor(maxFiles / 2))).map(f => f.path), selected = new Set(seeds);
  for (const edge of graph.edges) if (seeds.includes(edge.from) || seeds.includes(edge.to)) { selected.add(edge.from); selected.add(edge.to); }
  for (const { path } of ranked) { if (selected.size >= maxFiles) break; selected.add(path); }
  const files = [...selected].slice(0, maxFiles), chosen = new Set(files);
  return { files, edges: graph.edges.filter(e => chosen.has(e.from) && chosen.has(e.to)).map(({ from, to, confidence }) => ({ from, to, confidence })),
    method: 'filename seeds + resolved Python/JavaScript/TypeScript import neighbours',
    truncated: reader.files.length > maxFiles || graph.coverage.partial };
}

const label = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\r\n]/g, ' ');
export function graphDiagram(graph, { maxNodes = 60, focus } = {}) {
  const ranked = [...graph.nodes].sort((a, b) => (b.imports + b.imported_by) - (a.imports + a.imported_by) || a.path.localeCompare(b.path));
  const selected = new Set();
  if (focus && graph.nodes.some(n => n.path === focus)) {
    selected.add(focus);
    for (const e of graph.edges) if (e.from === focus || e.to === focus) {
      if (selected.size < maxNodes) selected.add(e.from);
      if (selected.size < maxNodes) selected.add(e.to);
    }
  }
  for (const n of ranked) { if (selected.size >= maxNodes) break; selected.add(n.path); }
  const names = [...selected], ids = new Map(names.map((n, i) => [n, 'N' + i]));
  const lines = ['flowchart LR', ...names.map(n => `  ${ids.get(n)}["${label(n)}"]`),
    ...graph.edges.filter(e => selected.has(e.from) && selected.has(e.to)).map(e => `  ${ids.get(e.from)} --> ${ids.get(e.to)}`)];
  if (!names.length) lines.push('  empty["No supported source files found"]');
  return { mermaid: lines.join('\n') + '\n', shown_nodes: names.length, omitted_nodes: graph.nodes.length - names.length };
}
