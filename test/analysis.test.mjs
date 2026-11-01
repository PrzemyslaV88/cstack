import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repository } from '../src/repository.mjs';
import { dependencyGraph, focusedCodeMap, graphDiagram } from '../src/code-map.mjs';
import { importsOf } from '../src/imports.mjs';
import { analyzeStack, analyzeTrace } from '../src/stack-analysis.mjs';
import { exportAnalysis, graphMarkdown, stackMarkdown } from '../src/analysis-report.mjs';
import { command } from '../src/process.mjs';

async function project(t, files) {
  const root = await mkdtemp(join(tmpdir(), 'cstack-analysis-test-')), repo = join(root, 'project');
  await mkdir(repo); t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) { await mkdir(join(repo, path, '..'), { recursive: true }); await writeFile(join(repo, path), text); }
  return { root, repo };
}
const pairs = graph => graph.edges.map(e => e.from + ' -> ' + e.to);

test('maps Python package, src-layout, relative, multiline and aliased imports with evidence', async t => {
  const { repo } = await project(t, {
    'pyproject.toml': '[project]\nname="sample"\n', 'src/app/__init__.py': '',
    'src/app/service.py': '# from fake import missing\n"""import fake_docstring"""\nfrom . import helper\nfrom app.models import (\n Model as Thing,\n)\nimport app.helper as h, app.models\n',
    'src/app/helper.py': 'from .models import Model\n', 'src/app/models.py': 'class Model: pass\n'
  });
  const graph = await dependencyGraph(await repository(repo));
  assert.ok(pairs(graph).includes('src/app/service.py -> src/app/helper.py'));
  assert.ok(pairs(graph).includes('src/app/service.py -> src/app/models.py'));
  assert.ok(pairs(graph).includes('src/app/helper.py -> src/app/models.py'));
  assert.equal(graph.coverage.scanned_source_files, 4);
  assert.ok(graph.edges.find(e => e.to === 'src/app/helper.py' && e.from.endsWith('service.py')).evidence.some(e => e.line === 3));
  assert.ok(!JSON.stringify(graph).includes('fake_docstring'));
  const continued = importsOf('from app.models \\\n import Model\n', 'x.py');
  assert.equal(continued[0].specifier, 'app.models');
});

test('maps TS aliases, JS reexports and literal require without importing code or regex examples', async t => {
  const { root, repo } = await project(t, {
    'tsconfig.json': '{// local aliases\n"compilerOptions":{"baseUrl":".","paths":{"@app/*":["src/*"],},},}',
    'src/main.ts': 'import type {Value} from "@app/types";\nexport {add} from "./math.js";\nconst cfg=require("./config.json");\nconst pattern=/require(".\\/decoy")/;\nconst docs="import fake from \\\"./decoy\\\"";\n// import "./decoy"\nthrow Error("must not execute");',
    'src/types.ts': 'export type Value=number;', 'src/math.ts': 'export const add=(a,b)=>a+b;',
    'src/config.json': '{"enabled":true}', 'src/decoy.ts': 'export const x=1;'
  });
  const graph = await dependencyGraph(await repository(repo));
  for (const target of ['src/types.ts', 'src/math.ts', 'src/config.json']) assert.ok(pairs(graph).includes('src/main.ts -> ' + target), target);
  assert.ok(!graph.edges.some(e => e.to === 'src/decoy.ts'));
  const output = await exportAnalysis(graph, 'map', join(root, 'report'));
  assert.equal(output.files.length, 3);
  assert.match(await readFile(join(root, 'report/graph.mmd'), 'utf8'), /^flowchart LR/);
  await assert.rejects(exportAnalysis(graph, 'map', join(root, 'report')), /EEXIST/);
  await assert.rejects(exportAnalysis(graph, 'map', join(repo, 'reports')), /outside the project/);
  await assert.rejects(exportAnalysis(graph, 'map', join(repo, '..reports')), /outside the project/);
});

test('focused worker context actually includes Python import neighbours within its cap', async t => {
  const { repo } = await project(t, {
    'src/fix_target.py': 'from odd_name import helper\n', 'odd_name.py': 'def helper(): return 1\n',
    'a.py': '', 'b.py': '', 'c.py': '', 'd.py': ''
  });
  const map = await focusedCodeMap(repo, 'fix_target behavior', { maxFiles: 4, maxBytes: 2000 });
  assert.ok(map.files.includes('odd_name.py'));
  assert.ok(map.edges.some(e => e.to === 'odd_name.py'));
  assert.ok(map.files.length <= 4);
});

test('unresolved computed imports and ambiguous Python modules stay explicit', async t => {
  const { repo } = await project(t, {
    'main.py': 'import same\n', 'one/pyproject.toml': '', 'two/pyproject.toml': '',
    'one/src/same.py': '', 'two/src/same.py': '',
    'main.js': 'import(variable); import "./missing.js";'
  });
  const graph = await dependencyGraph(await repository(repo));
  assert.ok(graph.unresolved.some(e => e.reason === 'ambiguous local Python module' && e.candidates.length === 2));
  assert.ok(graph.unresolved.some(e => e.reason.includes('computed')));
  assert.ok(graph.unresolved.some(e => e.specifier === './missing.js'));
  assert.ok(!graph.edges.some(e => e.from === 'main.py'));
});

test('Git inventory includes dirty/untracked work, excludes ignored files and does not run project scripts', async t => {
  const { root, repo } = await project(t, {
    '.gitignore': 'ignored.py\n', 'tracked.py': 'import os\n', 'ignored.py': 'import ignored_secret\n'
  });
  await writeFile(join(repo, 'package.json'), JSON.stringify({ scripts: { postinstall: 'touch ' + join(root, 'executed') } }));
  for (const args of [['init', '-q'], ['add', '.']]) assert.equal((await command(['git', ...args], { cwd: repo })).code, 0);
  await writeFile(join(repo, 'untracked.py'), 'import tracked\n');
  const graph = await dependencyGraph(await repository(repo));
  assert.ok(pairs(graph).includes('untracked.py -> tracked.py'));
  assert.ok(!graph.nodes.some(n => n.path === 'ignored.py'));
  await analyzeStack(await repository(repo));
  await assert.rejects(access(join(root, 'executed')), /ENOENT/);
  assert.equal(await readFile(join(repo, 'tracked.py'), 'utf8'), 'import os\n');
});

test('credential files, dependency trees, symlinks and large reads are excluded or labelled', async t => {
  const { root, repo } = await project(t, {
    '.env': 'password=do-not-report\n', 'auth.json': '{"token":"do-not-report"}',
    'node_modules/evil/index.py': 'import do_not_report\n', 'good.py': 'import os\n', 'large.py': 'x'.repeat(200)
  });
  await writeFile(join(root, 'outside.py'), 'import outside_secret\n');
  await symlink(join(root, 'outside.py'), join(repo, 'link.py'));
  const reader = await repository(repo, { maxFileBytes: 100 });
  const graph = await dependencyGraph(reader);
  assert.deepEqual(reader.files.map(f => f.path), ['good.py', 'large.py']);
  assert.equal(graph.coverage.partial, true);
  assert.equal(graph.nodes.find(n => n.path === 'large.py').scanned, false);
  assert.ok(!JSON.stringify(graph).includes('do-not-report'));
  assert.ok(!JSON.stringify(graph).includes('outside_secret'));
  const limited = await dependencyGraph(await repository(repo), { maxFiles: 1 });
  assert.equal(limited.coverage.partial, true);
});

test('stack findings have manifest evidence and do not export private script commands or URLs', async t => {
  const { repo } = await project(t, {
    'package.json': '{\n"engines":{"node":">=22"},\n"dependencies":{"react":"^19.0.0","express":"https://user:private-password@example.test/repo"},\n"scripts":{"test":"echo password=do-not-export"},\n"bin":{"sample":"src/cli.mjs"}\n}',
    'src/cli.mjs': 'import "node:test";\nimport "https://user:private-token@example.test/mod.js";\n',
    'README.md': 'django fastapi vue next should not become findings', 'Dockerfile': 'FROM example',
    '.github/workflows/test.yml': 'name: tests', 'package-lock.json': '{}'
  });
  const stack = await analyzeStack(await repository(repo));
  assert.ok(stack.findings.some(f => f.name === 'React' && f.evidence[0].line === 3));
  assert.ok(stack.findings.some(f => f.name === 'Express'));
  assert.ok(stack.findings.some(f => f.name === 'Node.js test runner'));
  assert.ok(stack.findings.some(f => f.name === 'Docker'));
  assert.ok(stack.findings.some(f => f.name === 'GitHub Actions'));
  assert.ok(!stack.findings.some(f => f.name === 'Django'));
  assert.ok(stack.entrypoints.some(e => e.path === 'src/cli.mjs'));
  assert.equal(stack.runtimes[0].declared_version, '>=22');
  const exported = JSON.stringify(stack) + stackMarkdown(stack);
  for (const secret of ['private-password', 'private-token', 'do-not-export']) assert.ok(!exported.includes(secret));
});

test('extracts Python modern, Poetry, requirements and setup.cfg declarations without running setup.py', async t => {
  const { repo } = await project(t, {
    'pyproject.toml': '[project]\nrequires-python=">=3.10"\ndependencies=[\n"Flask>=2", # note\n"SQLAlchemy>=2",\n]\n[project.optional-dependencies]\ntest=["pytest>=8"]\n[tool.poetry.dependencies]\nfastapi="^0.115"\n[build-system]\nrequires=["setuptools>=60"]\n',
    'requirements-dev.txt': 'sphinx==7.0\n-r private-path.txt\n',
    'setup.cfg': '[options]\ninstall_requires=\n    numpy>=1.0\n',
    'setup.py': 'raise RuntimeError("must not execute")\n', 'app.py': 'from flask import Flask\n'
  });
  const stack = await analyzeStack(await repository(repo));
  for (const name of ['Flask', 'SQLAlchemy', 'pytest', 'FastAPI', 'setuptools', 'Sphinx', 'NumPy']) assert.ok(stack.findings.some(f => f.name === name), name);
  assert.ok(stack.runtimes.some(r => r.name === 'Python' && r.declared_version === '>=3.10'));
  assert.ok(stack.warnings.some(w => w.reason.includes('not followed')));
});

test('extracts Go and Rust declarations and keeps unsupported languages as file counts', async t => {
  const { repo } = await project(t, {
    'go.mod': 'module example.test/app\ngo 1.23\nrequire github.com/gin-gonic/gin v1.10.0\n',
    'main.go': 'package main\n', 'Cargo.toml': '[dependencies]\ntokio={version="1.40",features=["full"]}\n',
    'src/main.rs': 'fn main() {}', 'App.java': 'class App {}'
  });
  const stack = await analyzeStack(await repository(repo));
  assert.ok(stack.findings.some(f => f.name === 'Gin'));
  assert.ok(stack.findings.some(f => f.name === 'Tokio' && f.declared_versions.includes('1.40')));
  assert.ok(stack.languages.some(l => l.name === 'Java' && l.files === 1));
  assert.ok(stack.runtimes.some(r => r.name === 'Go' && r.declared_version === '1.23'));
});

test('maps supplied Python and Node frames to repository paths without exporting error messages', async t => {
  const { repo } = await project(t, { 'src/app.py': 'pass\n', 'src/main.mjs': '' });
  const reader = await repository(repo);
  const trace = analyzeTrace('Traceback:\n  File "/testbed/src/app.py", line 12, in run\nValueError: password=secret-message\n    at start (/container/src/main.mjs:7:4)\n', reader);
  assert.equal(trace.local_frames, 2);
  assert.deepEqual(trace.frames.map(f => f.path), ['src/app.py', 'src/main.mjs']);
  assert.deepEqual(trace.exception_types, ['ValueError']);
  assert.ok(!JSON.stringify(trace).includes('secret-message'));
  assert.ok(analyzeTrace('no stack frames', reader).warning);
  assert.deepEqual(analyzeTrace('Error: secret-message', reader).exception_types, ['Error']);
  assert.equal(analyzeTrace('  at run (/src/app.py:99999999999999999999:1)', reader).frames.length, 0);
});

test('binary source files leave an explicitly partial map instead of silent complete coverage', async t => {
  const { repo } = await project(t, { 'binary.py': '\0not source', 'normal.py': 'pass\n' });
  const graph = await dependencyGraph(await repository(repo));
  assert.equal(graph.coverage.partial, true);
  assert.equal(graph.coverage.scanned_source_files, 1);
  assert.equal(graph.coverage.supported_source_files, 2);
});

test('diagram output escapes file labels and states when it omits nodes', async t => {
  const { repo } = await project(t, { 'bad"] --> injected["label.py': '', 'normal.py': '' });
  const graph = await dependencyGraph(await repository(repo));
  const diagram = graphDiagram(graph, { maxNodes: 1 });
  assert.equal(diagram.omitted_nodes, 1);
  assert.ok(!diagram.mermaid.includes('"] --> injected'));
  assert.match(graphMarkdown(graph, { maxNodes: 1 }), /omits 1/);
});

test('analysis report export rejects symlinked output parents pointing into the project', async t => {
  const { root, repo } = await project(t, { 'app.py': '' });
  await symlink(repo, join(root, 'alias'));
  const graph = await dependencyGraph(await repository(repo));
  await assert.rejects(exportAnalysis(graph, 'map', join(root, 'alias', 'new-output')), /inside the project|outside the project/);
  await assert.rejects(access(join(repo, 'new-output')), /ENOENT/);
});
