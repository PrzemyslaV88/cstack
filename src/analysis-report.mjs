import { mkdir, realpath, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { graphDiagram } from './code-map.mjs';
import { within } from './repository.mjs';
import { requireThat } from './util.mjs';

const code = value => '<code>' + String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]/g, ' ') + '</code>';
const proof = e => code(e.path + ':' + e.line) + ' (' + code(e.key || e.kind) + ')';
const table = (headers, rows) => ['| ' + headers.join(' | ') + ' |', '| ' + headers.map(() => '---').join(' | ') + ' |', ...rows.map(r => '| ' + r.join(' | ') + ' |')];

export function graphMarkdown(graph, options = {}) {
  const diagram = graphDiagram(graph, options);
  const central = [...graph.nodes].sort((a, b) => b.imported_by - a.imported_by || a.path.localeCompare(b.path)).slice(0, 20);
  const lines = ['# cStack dependency map', '',
    `${graph.coverage.scanned_source_files} of ${graph.coverage.supported_source_files} supported source files scanned; ${graph.edges.length} local file relationships.`, '',
    `Coverage: **${graph.coverage.partial ? 'partial — inspect limits and skipped files' : 'within configured limits'}**. JavaScript, TypeScript and Python imports are mapped heuristically.`, '',
    'An arrow means “imports”. It does not represent a function call or prove runtime execution.', '',
    `The diagram shows ${diagram.shown_nodes} files and omits ${diagram.omitted_nodes}. The JSON report contains all inventoried source nodes and resolved edges.`, '',
    '```mermaid', diagram.mermaid.trimEnd(), '```', '', '## Files with the most incoming imports', '',
    ...table(['File', 'Imported by', 'Imports', 'Source scanned'], central.map(n => [code(n.path), n.imported_by, n.imports, n.scanned ? 'yes' : 'no'])), '',
    `External-or-unresolved declarations: ${graph.external_or_unresolved.length}. Other unresolved imports: ${graph.unresolved.length}. Neither proves that a dependency is installed.`, ''];
  if (graph.unresolved.length) lines.push(...table(['File', 'Line', 'Import', 'Reason'], graph.unresolved.slice(0, 30).map(e => [code(e.path), e.line, code(e.specifier ?? '(computed)'), code(e.reason)])), '');
  lines.push('## Scope and limits', '', ...graph.limits.map(x => '- ' + x),
    '- Reports describe current files on disk, including non-ignored untracked files; no project code or package scripts were executed.',
    '- Secrets, generated/dependency folders and file symlinks are excluded. Skipped or oversized files may leave relationships unresolved.', '',
    'Read-content digest: ' + code(graph.coverage.read_content_digest), '');
  if (graph.coverage.warnings.length) lines.push('Scan warnings:', '', ...graph.coverage.warnings.map(w => '- ' + code(w.path) + ': ' + w.reason), '');
  return lines.join('\n');
}

export function stackMarkdown(stack) {
  const lines = ['# cStack stack analysis', '', 'Observed declarations and file signals; installed versions and running services were not checked.', '',
    `Coverage: **${stack.coverage.partial ? 'partial' : 'within configured limits'}**. ${stack.coverage.inventory_files} files inventoried.`, '',
    '## Languages', '', ...table(['Language', 'Files'], stack.languages.map(l => [l.name, l.files])), '', '## Runtime declarations', '',
    ...table(['Runtime', 'Declared version', 'Evidence'], stack.runtimes.map(r => [r.name, code(r.declared_version ?? 'not specified'), proof(r.evidence)])), '',
    '## Frameworks and tools', '', ...table(['Component', 'Category', 'Declared versions', 'Evidence'], stack.findings.map(f => [f.name, f.category,
      code(f.declared_versions.join(', ') || 'not specified'), f.evidence.slice(0, 3).map(proof).join('; ')])), '',
    '## Candidate entrypoints', '', ...table(['File', 'Evidence'], stack.entrypoints.map(e => [code(e.path), proof(e.evidence)])), '',
    '## Project commands', '', ...table(['Manifest', 'Command names'], stack.scripts.map(s => [code(s.path), s.names.map(code).join(', ')])), '',
    'Command bodies are neither executed nor exported. Dependency declarations and complete evidence are in the JSON report.', ''];
  if (stack.trace) {
    lines.push('## Supplied error trace', '', 'Exception types: ' + code(stack.trace.exception_types.join(', ') || 'not recognized'), '',
      ...table(['Format', 'File', 'Line', 'Resolution'], stack.trace.frames.map(f => [f.format, code(f.path || f.external_file || 'unknown'), f.line, f.resolution])), '',
      stack.trace.note, '', ...(stack.trace.warning ? [stack.trace.warning, ''] : []));
  }
  lines.push('## Scope and limits', '', ...stack.limits.map(x => '- ' + x), '', 'Read-content digest: ' + code(stack.coverage.read_content_digest), '');
  if (stack.warnings.length || stack.coverage.warnings.length) lines.push('Warnings:', '',
    ...[...stack.warnings, ...stack.coverage.warnings].map(w => '- ' + code(w.path) + ': ' + w.reason), '');
  return lines.join('\n');
}

export async function readTraceFile(path) {
  const handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await handle.stat();
    requireThat(info.isFile() && info.size <= 512_000, 'Trace must be a regular file of at most 512 KB');
    const buffer = Buffer.alloc(info.size + 1); let used = 0;
    while (used < buffer.length) { const r = await handle.read(buffer, used, buffer.length - used, null); if (!r.bytesRead) break; used += r.bytesRead; }
    requireThat(used === info.size && (await handle.stat()).mtimeMs === info.mtimeMs, 'Trace changed while being read');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used));
  } finally { await handle.close(); }
}

export async function exportAnalysis(report, kind, output, options = {}) {
  const destination = resolve(output); let ancestor = dirname(destination);
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (e) { if (e.code !== 'ENOENT') throw e; ancestor = dirname(ancestor); }
  }
  requireThat(!within(report.repository, destination) && !within(report.repository, ancestor), 'Analysis output must be outside the project');
  // Resolve the nearest existing parent before writing, including parent symlinks.
  let originalAncestor = dirname(destination);
  while (true) { try { await realpath(originalAncestor); break; } catch (e) { if (e.code !== 'ENOENT') throw e; originalAncestor = dirname(originalAncestor); } }
  requireThat(!within(report.repository, resolve(ancestor, relative(originalAncestor, destination))), 'Analysis output resolves inside the project');
  await mkdir(dirname(destination), { recursive: true });
  requireThat(!within(report.repository, await realpath(dirname(destination))), 'Analysis output parent resolves inside the project');
  await mkdir(destination, { mode: 0o700 }); // Never overwrite an existing report or user directory.
  const stem = kind === 'map' ? 'graph' : 'stack';
  await writeFile(join(destination, stem + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(join(destination, stem + '.md'), kind === 'map' ? graphMarkdown(report, options) : stackMarkdown(report), { flag: 'wx', mode: 0o600 });
  if (kind === 'map') await writeFile(join(destination, 'graph.mmd'), graphDiagram(report, options).mermaid, { flag: 'wx', mode: 0o600 });
  return { directory: destination, files: [stem + '.json', stem + '.md', ...(kind === 'map' ? ['graph.mmd'] : [])] };
}
