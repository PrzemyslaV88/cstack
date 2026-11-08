import {posix} from 'node:path';import {repository} from './repository.mjs';import {dependencyGraph,focusedCodeMap} from './code-map.mjs';import {tokens,importsOf} from './imports.mjs';import {testPath} from './file-policy.mjs';import {compareText,digestOf} from './util.mjs';
const stops=new Set('the and for with this that from fix bug error test'.split(' '));
export const goalTerms=goal=>[...new Set((goal.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g)||[]).filter(x=>!stops.has(x)))];
export function utf8Lines(text,limit){let result='';for(const line of text.split('\n')){if(Buffer.byteLength(result+line+'\n')>limit)break;result+=line+'\n';}return result;}
function failingTests(results){const paths=[];for(const proof of Object.values(results||{}))for(const detail of proof.details||[])for(const c of detail.cases||[]){if(c.outcome==='passed')continue;try{const id=JSON.parse(c.id);if(Array.isArray(id)&&typeof id[0]==='string')paths.push(id[0]);}catch{paths.push(c.id.split('::')[0]);}}return [...new Set(paths)];}
export async function buildContext(repo,contract,{results={},previous=null,thread=null,maxGraphFiles=2000,conventions=[],byteLimit=16000,matchConventions=false,strictDelta=false}={}){
 const settings=contract.context||{policy:'filename-v1',files:[],frames:[],symbols:[]};
 if(settings.policy==='filename-v1')return {...await focusedCodeMap(repo,contract.goal,{maxFiles:12,maxBytes:40000}),policy:'filename-v1',text:'',manifest:[],bytes:0,digest:digestOf([])};
 const reader=await repository(repo,{maxBytes:20000000}),explicit=settings.files.filter(p=>reader.known.has(p)),frames=settings.frames.filter(f=>reader.known.has(f.path)),failures=failingTests(results).filter(p=>reader.known.has(p));
 const priority=[...new Set([...explicit,...frames.map(f=>f.path),...failures])];
 // Read high-priority inputs before the graph consumes the shared read budget.
 for(const p of priority)await reader.read(p);
 const graph=await dependencyGraph(reader,{maxFiles:maxGraphFiles,goal:contract.goal,priority}),terms=goalTerms(contract.goal),rows=[];
 for(const f of reader.files){const data=await reader.read(f.path);if(!data)continue;const lex=tokens(data.source,/\.pyi?$/.test(f.path)),symbolHits=lex.filter(t=>t.kind==='word'&&settings.symbols.includes(t.value));
  const reasons=[],add=(name,score)=>reasons.push({signal:name,score});
  const convention=conventions.some(c=>c.path===f.path&&c.sha256===data.sha256);
  if(convention)add('selected-project-convention',250);
  if(explicit.includes(f.path))add('explicit-file',1000);if(frames.some(x=>x.path===f.path))add('trace-frame',900);if(failures.includes(f.path))add('failing-test',800);if(symbolHits.length)add('exact-identifier',300);
  const basename=posix.basename(f.path).toLowerCase(),dirname=posix.dirname(f.path).toLowerCase();const baseTerms=terms.filter(t=>basename.includes(t)),pathTerms=terms.filter(t=>!baseTerms.includes(t)&&dirname.includes(t));
  if(baseTerms.length)add('goal-basename',10*Math.min(5,baseTerms.length));if(pathTerms.length)add('goal-path',3*Math.min(5,pathTerms.length));if(f.path.startsWith('src/')||contract.project_scope&&f.path.startsWith(contract.project_scope+'/'))add('application-source',1);
  const points=[...frames.filter(x=>x.path===f.path).map(x=>({line:x.line,kind:'trace'})),...symbolHits.map(t=>({line:t.line,kind:'identifier-token'}))];
  if(convention&&matchConventions){const lines=data.source.split('\n');for(let i=0;i<lines.length&&points.length<3;i++)if(terms.some(t=>lines[i].toLowerCase().includes(t)))points.push({line:i+1,kind:'project-decision-match'});}
  if(failures.includes(f.path)){const t=lex.find(t=>t.kind==='word'&&/^test/.test(t.value));points.push({line:t?.line||1,kind:'failing-test'});}
  const firstImport=importsOf(data.source,f.path)[0];if(firstImport)points.push({line:firstImport.line,kind:'import'});
  if(!points.length){const first=data.source.split('\n').findIndex(x=>x.trim());points.push({line:Math.max(1,first+1),kind:'fallback'});}
  rows.push({path:f.path,sha256:data.sha256,reasons,points,source:data.source,test:testPath(f.path)});
 }
 const seeds=new Set(rows.filter(r=>r.reasons.some(x=>x.score>=300)).map(r=>r.path)),distance=new Map([...seeds].map(p=>[p,0]));
 for(let d=1;d<=2;d++)for(const e of graph.edges){if(distance.get(e.from)===d-1&&!distance.has(e.to))distance.set(e.to,d);if(distance.get(e.to)===d-1&&!distance.has(e.from))distance.set(e.from,d);}
 const direct=new Set();for(const e of graph.edges){if(seeds.has(e.from))direct.add(e.to);if(seeds.has(e.to))direct.add(e.from);}
 for(const row of rows){const d=direct.has(row.path)?1:distance.get(row.path);if(d===1||d===2)row.reasons.push({signal:d===1?'import-neighbor':'distance-two',score:d===1?120:40});row.score=row.reasons.reduce((s,r)=>s+r.score,0);}
 rows.sort((a,b)=>b.score-a.score||compareText(a.path,b.path));const selected=[];
 const partial=graph.coverage.partial||reader.coverage().partial;const fallback=partial?await focusedCodeMap(repo,contract.goal,{maxFiles:12,maxBytes:40000}):null;
 const choose=(list,count)=>{for(const r of list){if(selected.length>=12||count<=0)break;if(!selected.includes(r)){selected.push(r);count--;}}};
 choose(rows.filter(r=>explicit.includes(r.path)||frames.some(x=>x.path===r.path)),12);
 if(matchConventions)choose(rows.filter(r=>r.reasons.some(x=>x.signal==='selected-project-convention')),2);
 if(fallback){choose(rows.filter(r=>r.reasons.some(x=>x.signal==='exact-identifier')),12);choose(fallback.files.map(p=>rows.find(r=>r.path===p)).filter(Boolean),12);}
 choose(rows.filter(r=>r.test&&r.score>0),Math.max(0,3-selected.filter(r=>r.test).length));choose(rows.filter(r=>!r.test),Math.max(0,8-selected.filter(r=>!r.test).length));choose(rows,12);selected.sort((a,b)=>b.score-a.score||compareText(a.path,b.path));
 const prior=previous?.thread===thread&&thread?new Map(previous.manifest.map(x=>[x.path,x])):new Map();const manifest=[],pieces=new Map();let bytes=0;
 for(const row of selected){const lines=row.source.split('\n'),windows=[];for(const p of row.points){const start=Math.max(1,p.line-8),end=Math.min(lines.length,p.kind==='fallback'?p.line+19:p.line+8);if(start>end)continue;const overlap=windows.find(w=>start<=w.end+1&&end>=w.start-1);if(overlap){overlap.start=Math.min(overlap.start,start);overlap.end=Math.max(overlap.end,end);}else if(windows.length<3)windows.push({start,end,kind:p.kind});}
  const old=prior.get(row.path),unchanged=old?.sha256===row.sha256&&(!strictDelta||(old.emitted_bytes>0||old.unchanged)&&old.omitted_lines===0&&digestOf(old.windows)===digestOf(windows));
  manifest.push({path:row.path,sha256:row.sha256,score:row.score,reasons:row.reasons,unchanged,windows,emitted_bytes:0,omitted_lines:0});pieces.set(row.path,[]);
 }
 for(let pass=0;pass<3;pass++)for(const row of selected){const m=manifest.find(m=>m.path===row.path),w=m.windows[pass];if(!w||m.unchanged)continue;
  const lines=row.source.split('\n'),header=`File ${JSON.stringify(row.path)} SHA256 ${row.sha256}; ${m.reasons.map(r=>r.signal).join(', ')}; lines ${w.start}-${w.end} (${w.kind}, untrusted source):\n`;
  const content=lines.slice(w.start-1,w.end).map((s,i)=>`${w.start+i}| ${s}`).join('\n')+'\n';const piece=utf8Lines(header+content,Math.max(0,Math.min(2000-m.emitted_bytes,byteLimit-bytes)));const added=Buffer.byteLength(piece);bytes+=added;m.emitted_bytes+=added;pieces.get(row.path).push(piece);m.omitted_lines+=Math.max(0,w.end-w.start+1-Math.max(0,piece.split('\n').length-2));
 }
 const text=selected.flatMap(r=>pieces.get(r.path)).join('');const record={policy:'evidence-v1',fallback:partial?'available explicit hints and bounded filename/import policy; full graph coverage unavailable':null,manifest,coverage:{...graph.coverage,...reader.coverage(),partial:graph.coverage.partial||reader.coverage().partial},omitted_explicit:priority.filter(p=>!selected.some(r=>r.path===p)),bytes:Buffer.byteLength(text)};
 return {...record,files:selected.map(r=>r.path),edges:graph.edges.filter(e=>selected.some(r=>r.path===e.from)&&selected.some(r=>r.path===e.to)).map(({from,to})=>({from,to})),text,digest:digestOf(record),truncated:graph.coverage.partial||rows.length>12};
}
