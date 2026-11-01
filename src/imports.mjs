import { posix } from 'node:path';

// A bounded lexical map, not an AST/type checker or a runtime call graph.
// Strings/comments are tokens, so examples inside comments/docstrings are ignored.
export function tokens(source, python = false) {
  const out = []; let i = 0, line = 1;
  while (i < source.length) {
    const start = i, at = line, c = source[i];
    if (c === '\n') { out.push({ value: '\n', raw: '\n', line, kind: 'newline' }); line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if ((python && c === '#') || (!python && source.startsWith('//', i))) {
      while (i < source.length && source[i] !== '\n') i++; continue;
    }
    if (!python && source.startsWith('/*', i)) {
      i += 2; while (i < source.length && !source.startsWith('*/', i)) { if (source[i++] === '\n') line++; } i += 2; continue;
    }
    if (!python && c === '/') {
      const previous = out.findLast(t => t.kind !== 'newline');
      if (!previous || ['=', '(', '[', '{', ',', ':', ';', '!', '?', 'return', '=>'].includes(previous.value) ||
          (previous.value === '>' && out.at(-2)?.value === '=')) {
        let end = i + 1, characterClass = false;
        while (end < source.length && source[end] !== '\n') {
          if (source[end] === '\\') { end += 2; continue; }
          if (source[end] === '[') characterClass = true;
          if (source[end] === ']') characterClass = false;
          if (source[end] === '/' && !characterClass) break;
          end++;
        }
        if (source[end] === '/') {
          end++; while (/[a-z]/i.test(source[end] || '') && end < source.length) end++;
          out.push({ value: '[regexp]', raw: source.slice(i, end), line: at, kind: 'regexp' }); i = end; continue;
        }
      }
    }
    if (c === '"' || c === "'" || (!python && c === '`')) {
      const quote = python && source.startsWith(c.repeat(3), i) ? c.repeat(3) : c;
      i += quote.length; const content = i;
      while (i < source.length && !source.startsWith(quote, i)) {
        if (source[i] === '\\') { if (source[i + 1] === '\n') line++; i += 2; }
        else { if (source[i] === '\n') line++; i++; }
      }
      const end = i, closed = i < source.length; if (closed) i += quote.length;
      out.push({ value: source.slice(content, end).replace(/\\(['"\\])/g, '$1'), raw: source.slice(start, i),
        line: at, kind: 'string', quote, closed }); continue;
    }
    if (/[\w$]/.test(c)) {
      i++; while (i < source.length && /[\w$]/.test(source[i])) i++;
      out.push({ value: source.slice(start, i), raw: source.slice(start, i), line: at, kind: 'word' }); continue;
    }
    out.push({ value: c, raw: c, line: at, kind: 'punct' }); i++;
  }
  return out;
}

export function jsonConfig(source) {
  const ts = tokens(source).filter(t => t.kind !== 'newline');
  return JSON.parse(ts.filter((t, i) => !(t.kind === 'punct' && t.value === ',' && ['}', ']'].includes(ts[i + 1]?.value)))
    .map(t => t.raw).join(''));
}

export function importsOf(source, path) {
  const python = /\.(py|pyi)$/.test(path), ts = tokens(source, python), declarations = [];
  if (!python) {
    const significant = ts.filter(t => t.kind !== 'newline');
    for (let i = 0; i < significant.length; i++) {
      const t = significant[i], next = significant[i + 1];
      if (t.kind !== 'word' || significant[i - 1]?.value === '.') continue;
      if (['require', 'import'].includes(t.value) && next?.value === '(') {
        const arg = significant[i + 2];
        declarations.push({ specifier: arg?.kind === 'string' && arg.quote !== '`' && arg.closed && significant[i + 3]?.value === ')' ? arg.value : null,
          line: t.line, kind: t.value === 'import' ? 'dynamic-import' : 'require' }); continue;
      }
      if (!['import', 'export'].includes(t.value) || next?.value === '.') continue;
      if (t.value === 'import' && next?.kind === 'string' && next.closed) {
        declarations.push({ specifier: next.value, line: t.line, kind: 'import' }); continue;
      }
      for (let j = i + 1; j < Math.min(significant.length, i + 500); j++) {
        if (significant[j].value === ';' || significant[j].line > t.line + 50 ||
            (j > i + 1 && significant[j].kind === 'word' && ['import', 'export'].includes(significant[j].value))) break;
        if (significant[j].value === 'from' && significant[j + 1]?.kind === 'string' && significant[j + 1].closed) {
          declarations.push({ specifier: significant[j + 1].value, line: t.line, kind: t.value }); break;
        }
      }
    }
    return declarations;
  }
  // Fold parenthesized/backslash-continued Python import declarations.
  const statements = []; let statement = [], depth = 0;
  for (const t of ts) {
    if (['(', '[', '{'].includes(t.value) && t.kind !== 'string') depth++;
    if ([')', ']', '}'].includes(t.value) && t.kind !== 'string') depth--;
    if (t.kind === 'newline' && statement.at(-1)?.value === '\\') { statement.pop(); continue; }
    if ((t.kind === 'newline' && depth <= 0) || (t.kind === 'punct' && t.value === ';')) {
      if (statement.length) statements.push(statement); statement = []; continue;
    }
    if (t.kind !== 'newline') statement.push(t);
  }
  if (statement.length) statements.push(statement);
  for (const list of statements) for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind !== 'word' || (i && list[i - 1].value !== ':')) continue;
    if (t.value === 'import') {
      const groups = list.slice(i + 1).reduce((all, x) => { if (x.value === ',') all.push([]); else all.at(-1).push(x); return all; }, [[]]);
      for (const group of groups) {
        const alias = group.findIndex(x => x.value === 'as');
        const specifier = (alias < 0 ? group : group.slice(0, alias)).map(x => x.value).join('');
        if (/^[\w.]+$/.test(specifier)) declarations.push({ specifier, line: t.line, kind: 'python-import' });
      }
    } else if (t.value === 'from') {
      const index = list.findIndex((x, n) => n > i && x.kind === 'word' && x.value === 'import');
      if (index < 0) continue;
      const specifier = list.slice(i + 1, index).map(x => x.value).join('');
      if (!/^[\w.]+$/.test(specifier)) continue;
      const names = []; let first = true;
      for (const x of list.slice(index + 1)) {
        if (x.value === ',') first = true;
        else if (first && (x.kind === 'word' || x.value === '*')) { names.push(x.value); first = false; }
      }
      declarations.push({ specifier, names, line: t.line, kind: 'python-from' });
    }
  }
  return declarations;
}

const jsExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
export async function importResolver(reader) {
  const known = reader.known, python = new Map(), namespace = new Set(), configs = [];
  const roots = new Set(['']);
  for (const { path } of reader.files) {
    if (/(^|\/)(pyproject\.toml|setup\.cfg|setup\.py)$/.test(path)) roots.add(posix.dirname(path) === '.' ? '' : posix.dirname(path));
    const index = path.lastIndexOf('/src/');
    if (index >= 0) roots.add(path.slice(0, index + 4));
    if (path.startsWith('src/')) roots.add('src');
  }
  for (const { path } of reader.files.filter(f => /\.(py|pyi)$/.test(f.path))) for (const root of roots) {
    const prefix = root ? root + '/' : '';
    if (!path.startsWith(prefix)) continue;
    const module = path.slice(prefix.length).replace(/\.(py|pyi)$/, '').replace(/\/__init__$/, '').replaceAll('/', '.');
    if (!module || module === '__init__') continue;
    const values = python.get(module) || []; values.push({ path, root }); python.set(module, values);
    const parts = module.split('.'); for (let i = 1; i < parts.length; i++) namespace.add(parts.slice(0, i).join('.'));
  }
  for (const { path } of reader.files.filter(f => /(^|\/)(tsconfig|jsconfig)\.json$/.test(f.path)).slice(0, 32)) {
    const data = await reader.read(path); if (!data) continue;
    try {
      const cfg = jsonConfig(data.source), compiler = cfg.compilerOptions || {}, dir = posix.dirname(path);
      configs.push({ dir, base: posix.normalize(posix.join(dir, compiler.baseUrl || '.')), paths: compiler.paths || {} });
    } catch { /* Unreadable configuration stays unresolved rather than guessed. */ }
  }
  function local(base, extensions) {
    if (base.startsWith('../') || base.startsWith('/') || base === '..') return [];
    return [base, ...extensions.map(e => base + e), ...extensions.map(e => base + '/index' + e)].filter(p => known.has(p)).slice(0, 1);
  }
  function py(module, importer) {
    const values = python.get(module) || [];
    const ranked = values.map(v => ({ ...v, score: v.root && importer.startsWith(v.root + '/') ? v.root.length + 1 : 0 }))
      .sort((a, b) => b.score - a.score || Number(a.path.endsWith('.pyi')) - Number(b.path.endsWith('.pyi')));
    if (!ranked.length) return [];
    const best = ranked.filter(v => v.score === ranked[0].score && v.path.endsWith('.pyi') === ranked[0].path.endsWith('.pyi'));
    return [...new Set(best.map(v => v.path))];
  }
  return (importer, declaration) => {
    const { specifier: spec, kind, names = [] } = declaration;
    if (!spec) return { targets: [], reason: 'computed import is not statically resolved' };
    if (!kind.startsWith('python')) {
      let targets = [];
      if (spec.startsWith('.')) {
        const base = posix.normalize(posix.join(posix.dirname(importer), spec));
        targets = local(base, jsExtensions);
        if (!targets.length && /\.(js|jsx|mjs|cjs)$/.test(base)) {
          targets = local(base.replace(/\.(js|jsx|mjs|cjs)$/, ''), jsExtensions);
        }
      } else {
        const cfg = configs.filter(c => c.dir === '.' || importer.startsWith(c.dir + '/')).sort((a, b) => b.dir.length - a.dir.length)[0];
        if (cfg) for (const [pattern, destinations] of Object.entries(cfg.paths).sort(([a], [b]) => b.length - a.length)) {
          const [start, end = ''] = pattern.split('*');
          const match = pattern.includes('*') ? spec.startsWith(start) && spec.endsWith(end) : spec === pattern;
          if (!match || !Array.isArray(destinations)) continue;
          const middle = pattern.includes('*') ? spec.slice(start.length, spec.length - end.length) : '';
          for (const dest of destinations.filter(x => typeof x === 'string')) {
            targets = local(posix.normalize(posix.join(cfg.base, dest.replace('*', middle))), jsExtensions);
            if (targets.length) break;
          }
          break;
        }
      }
      return { targets, reason: targets.length ? null : spec.startsWith('.') ? 'local import not resolved in scanned inventory' : 'external package, alias or unresolved import' };
    }
    if (spec.startsWith('.')) {
      const dots = spec.match(/^\.+/)[0].length;
      const dir = posix.normalize(posix.join(posix.dirname(importer), ...Array(dots - 1).fill('..'), spec.slice(dots).replaceAll('.', '/')));
      if (dir.startsWith('../') || dir === '..') return { targets: [], reason: 'relative import escapes repository' };
      const targets = [];
      for (const base of [dir, ...names.filter(n => n !== '*').map(n => posix.join(dir, n))]) {
        const found = [base + '/__init__.py', base + '.py', base + '/__init__.pyi', base + '.pyi'].find(p => known.has(p));
        if (found) targets.push(found);
      }
      return { targets: [...new Set(targets)], reason: targets.length ? null : 'relative Python import not resolved in scanned inventory' };
    }
    const base = py(spec, importer), children = names.filter(n => n !== '*').flatMap(n => py(spec + '.' + n, importer));
    if (base.length > 1 || names.some(n => py(spec + '.' + n, importer).length > 1)) {
      return { targets: [], reason: 'ambiguous local Python module', candidates: [...new Set([...base, ...children])] };
    }
    const targets = [...new Set([...base, ...children])];
    return { targets, reason: targets.length ? null : namespace.has(spec) ? 'namespace package has no concrete module file' : 'external or unresolved Python module' };
  };
}
