import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repository } from './repository.mjs';
import { dependencyGraph, graphDiagram } from './code-map.mjs';
import { stronglyConnected } from './impact.mjs';
import { newOutputDirectory } from './artifacts.mjs';
import { json, requireThat, redact } from './util.mjs';
import { html } from './cli-output.mjs';

export async function architectureInvestigation(repo, {focus} = {}) {
  const reader = await repository(repo);
  requireThat(!focus || reader.known.has(focus), 'Architecture focus must name an included project file');
  const graph = await dependencyGraph(reader, {goal:focus||''});
  const cycles = stronglyConnected(graph.nodes.map(n=>n.path),graph.edges);
  const candidates = graph.nodes.filter(n=>n.scanned&&(!focus||n.path===focus)).sort((a,b)=>
    b.imported_by+b.imports-a.imported_by-a.imports||a.path.localeCompare(b.path)).slice(0,8).map(n=>({
    path:n.path,imports:n.imports,consumers:n.imported_by,
    evidence:graph.edges.filter(e=>e.from===n.path||e.to===n.path),
    question:'Does this interface hide useful behavior, or require callers to understand its implementation?',
    proposal:'Inspect callers and public-interface tests before proposing consolidation or a new interface.',
    strength:'INVESTIGATION_TARGET_ONLY'
  }));
  return {schema_version:1,kind:'architecture',repository:reader.root,coverage:graph.coverage,candidates,cycles,
    diagram:graphDiagram(graph,{focus}).mermaid,
    decisions:reader.files.filter(f=>/(^|\/)(GLOSSARY\.md|CONTEXT\.md|AGENTS\.md)$|(^|\/)adr\//i.test(f.path)).map(f=>f.path).slice(0,64),
    note:'Import counts and cycles identify questions, not proven design defects. No semantic architecture review, refactor or behavior verification was performed.'};
}

export async function retrospective(ids, {home} = {}) {
  requireThat(Array.isArray(ids)&&ids.length>0&&ids.length<=20&&new Set(ids).size===ids.length,'Select 1–20 distinct runs');
  const {loadRun}=await import('./store.mjs');
  const runs=[];
  for(const id of ids) runs.push(await loadRun(id,home));
  const findings=[];
  for(const run of runs){
    const add=(severity,problem,proposal)=>findings.push({run:run.id,severity,problem,proposal});
    if(run.attempts.some(a=>a.usage_unknown||a.usage_status==='invalid'))add('high','Some worker usage is unresolved.','Resolve the accounting source before admitting more model work.');
    if(run.status==='STALLED')add('high','The repair stopped without sufficient measured progress.','Improve the reproduction or add a diagnostic probe that distinguishes competing causes.');
    if(run.attempts.some(a=>a.notes?.status==='invalid'))add('medium','A worker handoff was invalid.','Inspect the recorded validation error; keep authoritative state separate from worker notes.');
    if(run.attempts.filter(a=>a.session_action==='fresh').length>2)add('medium','This run crossed several context boundaries.','Check task granularity and repeated exploration before increasing the session-turn limit.');
    if(run.attempts.some(a=>a.prompt_bytes>28000))add('medium','A prompt approached its byte limit.','Narrow the active slice and select fewer relevant project references.');
    if(!run.contract.criteria.some(c=>['node-test','test-suite'].includes(c.kind)))add('low','No project regression suite was configured.','Consider an existing suite adapter if it covers affected interfaces; keep independent probes.');
    if(run.review?.protected_changes?.length)add('low','Existing tests or configuration required human review.','Keep necessary test changes explicit; do not weaken the review gate to reduce waiting.');
  }
  const order={high:0,medium:1,low:2};findings.sort((a,b)=>order[a.severity]-order[b.severity]||a.run.localeCompare(b.run));
  return {schema_version:1,kind:'retrospective',runs:runs.map(r=>({id:r.id,status:r.status,goal:redact(r.contract.goal),attempts:r.attempts.length})),
    findings,note:'Findings use selected recorded runs. This report does not reverify candidates or modify code, tests, policy, approvals or GitHub.'};
}

export function investigationMarkdown(report) {
  if(report.kind==='retrospective')return ['# Selected-run retrospective','',report.note,'',
    ...report.runs.map(r=>`- ${r.id}: ${r.status}; ${r.attempts} attempts — ${html(r.goal)}`),'',
    ...report.findings.map(f=>`- ${f.severity}: ${html(f.problem)} ${html(f.proposal)} (${f.run})`),''].join('\n');
  return ['# Architecture investigation','',report.note,`Partial coverage: ${report.coverage.partial}`,'',
    ...report.candidates.map(c=>`- <code>${html(c.path)}</code>: ${c.imports} imports, ${c.consumers} consumers. ${c.question} ${c.proposal}`),'',
    'Read relevant glossary and decision records before recommending changes:',...report.decisions.map(p=>`- <code>${html(p)}</code>`),'',
    '```mermaid',report.diagram,'```',''].join('\n');
}

export async function exportInvestigation(report, output, excluded=[]) {
  const directory=await newOutputDirectory(output,excluded),markdown=investigationMarkdown(report);
  await writeFile(join(directory,'report.json'),json(report),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'report.md'),markdown,{flag:'wx',mode:0o600});
  await writeFile(join(directory,'report.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Cstack investigation</title><style>body{font:16px/1.6 system-ui;max-width:1000px;margin:40px auto;padding:0 24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Cstack investigation</h1><pre>${html(markdown)}</pre></html>`,{flag:'wx',mode:0o600});
  return {directory,kind:report.kind};
}
