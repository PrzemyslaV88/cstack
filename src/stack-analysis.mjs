import { posix } from 'node:path';
import { tokens, jsonConfig } from './imports.mjs';
import { dependencyGraph } from './code-map.mjs';
import { compareText } from './util.mjs';

export function projectScopes(reader) {
  const dirs = new Set(['.']);
  for(const {path} of reader.files) if(/^(package\.json|pyproject\.toml|setup\.cfg|Cargo\.toml|go\.mod|requirements(?:[-.][^/]*)?\.(?:txt|in|lock))$/.test(posix.basename(path))) dirs.add(posix.dirname(path));
  const classify = p => {
    const parts=p.split('/');
    for(const [kind,names] of [['benchmark',['bench','benchmark','benchmarks']],['example',['example','examples','demo','demos']],['test',['test','tests','testing','spec','specs','__tests__']]]) if(parts.some(x=>names.includes(x))) return kind;
    return 'application';
  };
  const scopes=[...dirs].sort(compareText).map(path=>({id:path,path,kind:classify(path),basis:'manifest directory and path convention'}));
  const ordered=[...scopes].sort((a,b)=>(a.path==='.'?1:b.path==='.'?-1:b.path.length-a.path.length) || compareText(a.path,b.path));
  return {scopes,scopeFor:path=>ordered.find(s=>s.path==='.' || path.startsWith(s.path+'/')).id};
}
function dependencyRelation(proof) {
  if(proof.kind==='lockfile entry' || /(?:lock|shrinkwrap)/.test(posix.basename(proof.path))) return 'lockfile-only';
  if(proof.kind==='source import signal') return 'import-observed';
  if(proof.kind==='filename signal') return 'configuration-signal';
  return /devDependencies|dependency-groups|\.group\..*\.dependencies|dev-dependencies/.test(proof.key) ? 'declared-development' : 'declared-direct';
}

const tools = {
  react: ['React', 'UI framework'], next: ['Next.js', 'Application framework'], vue: ['Vue', 'UI framework'],
  nuxt: ['Nuxt', 'Application framework'], svelte: ['Svelte', 'UI framework'], '@sveltejs/kit': ['SvelteKit', 'Application framework'],
  '@angular/core': ['Angular', 'UI framework'], express: ['Express', 'Server framework'], fastify: ['Fastify', 'Server framework'],
  '@nestjs/core': ['NestJS', 'Server framework'], vite: ['Vite', 'Build tool'], webpack: ['webpack', 'Build tool'],
  typescript: ['TypeScript compiler', 'Build tool'], jest: ['Jest', 'Test tool'], vitest: ['Vitest', 'Test tool'],
  '@playwright/test': ['Playwright', 'Test tool'], playwright: ['Playwright', 'Test tool'], cypress: ['Cypress', 'Test tool'],
  prisma: ['Prisma', 'Database tooling'], 'drizzle-orm': ['Drizzle', 'Database tooling'],
  flask: ['Flask', 'Server framework'], django: ['Django', 'Application framework'], fastapi: ['FastAPI', 'Server framework'],
  starlette: ['Starlette', 'Server framework'], pytest: ['pytest', 'Test tool'], unittest: ['unittest', 'Test tool'],
  sphinx: ['Sphinx', 'Documentation tool'], sympy: ['SymPy', 'Mathematics library'], numpy: ['NumPy', 'Numerical library'],
  pandas: ['pandas', 'Data library'], sqlalchemy: ['SQLAlchemy', 'Database tooling'],
  setuptools: ['setuptools', 'Build tool'], hatchling: ['Hatchling', 'Build tool'], 'poetry-core': ['Poetry Core', 'Build tool'],
  'node:test': ['Node.js test runner', 'Test tool'], harbor: ['Harbor', 'Benchmark tool'],
  'github.com/gin-gonic/gin': ['Gin', 'Server framework'], 'github.com/labstack/echo/v4': ['Echo', 'Server framework'],
  tokio: ['Tokio', 'Async runtime'], axum: ['Axum', 'Server framework'], 'actix-web': ['Actix Web', 'Server framework']
};
const normalize = name => name.toLowerCase().replace(/[_.]+/g, '-');
function version(value) {
  if (typeof value !== 'string') return null;
  value = value.trim();
  return value.length <= 120 && (/^[v\d~^<>=!*][\w.+*^~<>=!|,() -]*$/.test(value) || ['latest', 'next', 'stable'].includes(value))
    && !/[A-Za-z0-9_-]{30}/.test(value) ? value : '[source/workspace details omitted]';
}
function assignments(source) {
  const result = []; let section = '', current = [], depth = 0;
  function finish() {
    if (!current.length) return;
    const eq = current.findIndex(t => t.kind === 'punct' && t.value === '=');
    if (eq < 0 && current[0].value === '[') section = current.filter(t => !['[', ']'].includes(t.value)).map(t => t.value).join('');
    else if (eq > 0) result.push({ section, key: current.slice(0, eq).map(t => t.value).join(''), value: current.slice(eq + 1), line: current[0].line });
    current = [];
  }
  for (const t of tokens(source, true)) {
    if (t.kind === 'punct' && ['[', '{'].includes(t.value)) depth++;
    if (t.kind === 'punct' && [']', '}'].includes(t.value)) depth--;
    if (t.kind === 'newline' && depth <= 0) finish();
    else if (t.kind !== 'newline') current.push(t);
  }
  finish(); return result;
}
function arrayStrings(value) {
  let brackets = 0, braces = 0; const values = [];
  for (const t of value) {
    if (t.kind === 'punct') { if (t.value === '[') brackets++; if (t.value === ']') brackets--; if (t.value === '{') braces++; if (t.value === '}') braces--; }
    if (t.kind === 'string' && brackets === 1 && braces === 0) values.push(t.value);
  }
  return values;
}
function declaredValue(value) {
  if (value[0]?.kind === 'string') return value[0].value;
  const index = value.findIndex(t => t.value === 'version');
  return index >= 0 && value[index + 2]?.kind === 'string' ? value[index + 2].value : null;
}

export async function analyzeStack(reader, { maxFiles = 2000 } = {}) {
  const findings = new Map(), dependencies = [], runtimes = [], scripts = [], entrypoints = [], warnings = [];
  const scoped = new Map(), {scopes,scopeFor} = projectScopes(reader);
  const evidence = (path, line, key, kind = 'manifest declaration') => ({ path, line, key, kind });
  function signal(name, category, proof, declaredVersion = null) {
    const id = category + '/' + name, record = findings.get(id) || { name, category, evidence: [], declared_versions: [] };
    if (!record.evidence.some(e => JSON.stringify(e) === JSON.stringify(proof))) record.evidence.push(proof);
    const v = version(declaredVersion); if (v && !record.declared_versions.includes(v)) record.declared_versions.push(v);
    findings.set(id, record);
    const scope_id=scopeFor(proof.path), sid=scope_id+'\0'+id, relation=dependencyRelation(proof);
    const local=scoped.get(sid)||{scope_id,name,category,evidence:[],declared_versions:[],dependency_relations:[]};
    if(!local.evidence.some(e=>JSON.stringify(e)===JSON.stringify(proof))) local.evidence.push(proof);
    if(v && !local.declared_versions.includes(v)) local.declared_versions.push(v);
    if(!local.dependency_relations.includes(relation)) local.dependency_relations.push(relation);
    scoped.set(sid,local);
  }
  function dependency(name, declaredVersion, ecosystem, proof) {
    if (!/^[\w@./-]{1,200}$/.test(name)) return;
    dependencies.push({ name, ecosystem, declared_version: version(declaredVersion), evidence: proof, scope_id:scopeFor(proof.path), dependency_relation:dependencyRelation(proof) });
    const found = tools[name] || tools[normalize(name)]; if (found) signal(...found, proof, declaredVersion);
  }
  function requirement(text, proof) {
    const match = text.trim().match(/^([A-Za-z0-9][\w.-]*)(?:\[[^\]]*\])?\s*(.*)$/);
    if (match) dependency(match[1], match[2].split(';')[0] || null, 'Python', proof);
  }
  function entry(path, proof) {
    path = posix.normalize(path);
    if (reader.known.has(path) && !entrypoints.some(e => e.path === path)) entrypoints.push({ path, evidence: proof });
  }
  for (const file of reader.files) {
    const base = posix.basename(file.path), dir = posix.dirname(file.path), path = file.path;
    if (/^(package-lock\.json|npm-shrinkwrap\.json)$/.test(base)) signal('npm', 'Package manager', evidence(path, 1, 'lockfile', 'filename signal'));
    if (/^(pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/.test(base)) {
      const name = base.startsWith('pnpm') ? 'pnpm' : base.startsWith('yarn') ? 'Yarn' : base.startsWith('bun') ? 'Bun' : base.split('.')[0];
      signal(name, 'Package manager', evidence(path, 1, 'lockfile', 'filename signal'));
    }
    if (/^Dockerfile(?:\..*)?$/.test(base)) signal('Docker', 'Container configuration', evidence(path, 1, 'Dockerfile', 'filename signal'));
    if (/^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/.test(base)) signal('Docker Compose', 'Container configuration', evidence(path, 1, 'compose file', 'filename signal'));
    if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) signal('GitHub Actions', 'CI configuration', evidence(path, 1, 'workflow', 'filename signal'));
    if (/\.tf$/.test(base)) signal('Terraform', 'Infrastructure configuration', evidence(path, 1, 'Terraform file', 'filename signal'));
    if (/^(?:pytest\.ini|tox\.ini)$/.test(base)) signal(base === 'tox.ini' ? 'tox' : 'pytest', 'Test tool', evidence(path, 1, base, 'filename signal'));
    if (/^(?:__main__\.py|manage\.py|asgi\.py|wsgi\.py|main\.go)$/.test(base) || /(^|\/)src\/main\.rs$/.test(path)) entry(path, evidence(path, 1, 'entrypoint convention', 'filename signal'));

    const manifest = base === 'package.json' || base === 'pyproject.toml' || base === 'setup.cfg' || base === 'Cargo.toml' || base === 'go.mod' ||
      /^requirements(?:[-.][^/]*)?\.(?:txt|in|lock)$/.test(base) || ['.python-version', '.node-version', '.nvmrc'].includes(base);
    if (!manifest) continue;
    const data = await reader.read(path); if (!data) continue;
    const source = data.source, lines = source.split('\n');
    const manifestTokens = base === 'package.json' ? tokens(source).filter(t => t.kind !== 'newline') : [];
    function lineFor(key, parent) {
      let start = 1;
      if (parent) {
        const index = manifestTokens.findIndex((t, i) => t.kind === 'string' && t.value === parent &&
          manifestTokens[i + 1]?.value === ':' && manifestTokens[i + 2]?.value === '{');
        if (index < 0) return 1; start = index + 3;
      }
      let depth = 0;
      for (let i = start; i < manifestTokens.length; i++) {
        const t = manifestTokens[i];
        if (depth === 0 && t.kind === 'string' && t.value === key && manifestTokens[i + 1]?.value === ':') return t.line;
        if (t.kind === 'punct' && ['{', '['].includes(t.value)) depth++;
        if (t.kind === 'punct' && ['}', ']'].includes(t.value) && --depth < 0) break;
      }
      return 1;
    }
    if (base === 'package.json') {
      let pkg; try { pkg = jsonConfig(source); } catch { warnings.push({ path, reason: 'Invalid package JSON; declarations were not inferred' }); continue; }
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) { warnings.push({ path, reason: 'Package manifest must be an object' }); continue; }
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        if (pkg[section] && typeof pkg[section] === 'object') for (const [name, value] of Object.entries(pkg[section])) {
          dependency(name, value, 'JavaScript/TypeScript', evidence(path, lineFor(name, section), section + '.' + name));
        }
      }
      if (pkg.engines?.node) runtimes.push({ name: 'Node.js', declared_version: version(pkg.engines.node), evidence: evidence(path, lineFor('node', 'engines'), 'engines.node') });
      if (typeof pkg.packageManager === 'string') {
        const match = pkg.packageManager.match(/^(npm|pnpm|yarn|bun)@([\w.+-]+)/);
        if (match) signal(match[1], 'Package manager', evidence(path, lineFor('packageManager'), 'packageManager'), match[2]);
      }
      if (pkg.scripts && typeof pkg.scripts === 'object') scripts.push({ path, names: Object.keys(pkg.scripts).filter(k => /^[\w:.-]{1,100}$/.test(k)), note: 'Names only; commands were not executed or exported' });
      const candidates = [pkg.main, pkg.module, ...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {}))];
      for (const candidate of candidates.filter(x => typeof x === 'string')) entry(posix.join(dir, candidate), evidence(path, 1, 'main/module/bin'));
    } else if (/requirements/.test(base)) {
      lines.forEach((line, index) => { if (!/^\s*(?:#|-|$)/.test(line)) requirement(line, evidence(path, index + 1, 'requirement', base.endsWith('.lock') ? 'lockfile entry' : 'manifest declaration')); });
      if (lines.some(l => /^\s*-(?:r|e|c)\b/.test(l))) warnings.push({ path, reason: 'Requirement includes, constraints and editable paths were not followed' });
    } else if (base === 'pyproject.toml' || base === 'Cargo.toml') {
      for (const a of assignments(source)) {
        const proof = evidence(path, a.line, a.section + '.' + a.key);
        if (base === 'pyproject.toml') {
          if ((a.section === 'project' && a.key === 'dependencies') || a.section === 'project.optional-dependencies' || a.section === 'dependency-groups' ||
              (a.section === 'build-system' && a.key === 'requires')) {
            for (const req of arrayStrings(a.value)) requirement(req, proof);
          }
          if (/^tool\.poetry(?:\.group\.[\w-]+)?\.(?:dev-)?dependencies$/.test(a.section)) {
            if (a.key === 'python') runtimes.push({ name: 'Python', declared_version: version(declaredValue(a.value)), evidence: proof });
            else dependency(a.key, declaredValue(a.value), 'Python', proof);
          }
          if (a.section === 'project' && a.key === 'requires-python') runtimes.push({ name: 'Python', declared_version: version(declaredValue(a.value)), evidence: proof });
          if (a.section === 'project' && a.key === 'dynamic') warnings.push({ path, reason: 'Dynamic Python metadata was not executed' });
          if (a.section.startsWith('tool.pytest')) signal('pytest', 'Test tool', proof);
        } else if (/(^|\.)(?:dev-|build-)?dependencies$/.test(a.section)) dependency(a.key, declaredValue(a.value), 'Rust', proof);
      }
    } else if (base === 'setup.cfg') {
      let section = '', collecting = false;
      lines.forEach((line, index) => {
        const header = line.match(/^\s*\[([^\]]+)\]/); if (header) { section = header[1]; collecting = false; return; }
        const assignment = line.match(/^([\w.-]+)\s*=\s*(.*)$/);
        if (assignment) {
          collecting = section === 'options' && assignment[1] === 'install_requires' || section === 'options.extras_require';
          if (collecting && assignment[2]) requirement(assignment[2], evidence(path, index + 1, section));
        } else if (collecting && /^\s+\S/.test(line) && !/^\s*#/.test(line)) requirement(line.trim(), evidence(path, index + 1, section));
      });
    } else if (base === 'go.mod') {
      lines.forEach((line, index) => {
        const runtime = line.match(/^go\s+([\d.]+)/); if (runtime) runtimes.push({ name: 'Go', declared_version: runtime[1], evidence: evidence(path, index + 1, 'go') });
        const dep = line.match(/^\s*(?:require\s+)?([\w.-]+\/[\w./-]+)\s+(v[\w.+-]+)/);
        if (dep) dependency(dep[1], dep[2], 'Go', evidence(path, index + 1, 'require'));
      });
    } else runtimes.push({ name: base === '.python-version' ? 'Python' : 'Node.js', declared_version: version(source.trim()), evidence: evidence(path, 1, base) });
  }
  const graph = await dependencyGraph(reader, { maxFiles });
  for (const declaration of graph.external_or_unresolved) {
    if (!declaration.specifier || declaration.specifier.startsWith('[')) continue;
    const name = declaration.kind.startsWith('python') ? declaration.specifier.split('.')[0]
      : declaration.specifier.startsWith('@') ? declaration.specifier.split('/').slice(0, 2).join('/') : declaration.specifier.split('/')[0];
    const found = tools[name]; if (found) signal(...found, { path: declaration.path, line: declaration.line, key: name, kind: 'source import signal' });
  }
  const languages = new Map();
  for (const f of reader.files) if (f.language) languages.set(f.language, (languages.get(f.language) || 0) + 1);
  return { schema_version: 2, repository: reader.root, method: 'manifest declarations, source import signals and file conventions',
    scopes, scoped_findings:[...scoped.values()].sort((a,b)=>compareText(a.scope_id,b.scope_id)||compareText(a.name,b.name)),
    compatibility_projection:'findings is the schema-1 aggregate; use scoped_findings to distinguish application and tooling',
    languages: [...languages].map(([name, files]) => ({ name, files })).sort((a, b) => b.files - a.files || a.name.localeCompare(b.name)),
    runtimes, findings: [...findings.values()].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    dependencies, scripts, entrypoints, warnings, coverage: { ...graph.coverage, ...reader.coverage(), partial: graph.coverage.partial || reader.coverage().partial },
    limits: ['Declared versions are not verified installed versions.', 'Configuration files do not prove a service is deployed or running.',
      'Dynamic manifests, shell commands and project code were not executed. Unknown frameworks are left as dependency declarations.',
      'Detailed dependency parsing covers package.json, common Python manifests, Cargo.toml and go.mod; other languages are counted by extension.'] };
}

export function analyzeTrace(text, reader) {
  const frames = [], types = new Set();
  for (const line of text.split('\n')) {
    const type = line.trim().match(/^([\w.]*?(?:Error|Exception|Warning))(?::|$)/); if (type) types.add(type[1]);
    const py = line.match(/File "([^"]+)", line (\d+)(?:, in (.*))?/);
    const js = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/);
    if (!py && !js) continue;
    const raw = (py ? py[1] : js[2]).replace(/^file:\/\//, '').replaceAll('\\', '/');
    const frameLine = Number(py ? py[2] : js[3]), column = py ? null : Number(js[4]);
    if (!Number.isSafeInteger(frameLine) || frameLine < 1 || (column !== null && (!Number.isSafeInteger(column) || column < 1))) continue;
    const matches = reader.files.filter(f => raw === f.path || raw === reader.root + '/' + f.path || raw.endsWith('/' + f.path));
    const longest = Math.max(0, ...matches.map(f => f.path.length));
    const candidates = matches.filter(f => f.path.length === longest).map(f => f.path);
    frames.push({ format: py ? 'Python' : 'Node.js', path: candidates.length === 1 ? candidates[0] : null,
      external_file: candidates.length ? null : posix.basename(raw).split(/[?#]/)[0], line: frameLine,
      column, function: (py ? py[3] : js[1])?.slice(0, 160) || null,
      resolution: candidates.length === 1 ? 'matched by repository path suffix' : candidates.length ? 'ambiguous' : 'outside scanned repository' });
  }
  return { exception_types: [...types], frames, local_frames: frames.filter(f => f.path).length,
    note: 'Frames are reported locations, not proof of the root cause. Error messages and original trace text are not exported.',
    ...(frames.length ? {} : { warning: 'No Python or Node.js frames recognized' }) };
}
