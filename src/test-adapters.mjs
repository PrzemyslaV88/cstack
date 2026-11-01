import {requireThat,compareText,relativePath,digestOf} from './util.mjs';
export const adapterVersions={pytest:'8.3.5',vitest:'4.0.18'};
export const protocolPrefix='CSTACK_TEST_EVENT ';
const outcomes=['passed','failed','skipped','todo','xfail','xpass','error'];
export function parseAdapterReport(stdout,{adapter,expected_tests=[],collect_only=false,exit_code=0,truncated=false,timedOut=false,aborted=false}={}){
 const invalid=diagnostic=>({passed:false,error:true,diagnostic,ids:[],cases:[],missing:expected_tests});
 if(truncated||timedOut||aborted)return invalid('Incomplete adapter execution');
 let events;try{events=stdout.split(/\r?\n/).filter(x=>x.startsWith(protocolPrefix)).map(x=>JSON.parse(x.slice(protocolPrefix.length)));}catch{return invalid('Malformed adapter stream');}
 if(events.some(e=>!e||e.schema_version!==1||!['collection','case','error','complete'].includes(e.kind)))return invalid('Unknown adapter event');
 const collections=events.filter(e=>e.kind==='collection'),ends=events.filter(e=>e.kind==='complete');
 if(collections.length!==1||ends.length!==1||events.at(-1)!==ends[0])return invalid('Missing or duplicate collection/completion');
 const end=ends[0],ids=collections[0].ids,cases=events.filter(e=>e.kind==='case'),errors=events.filter(e=>e.kind==='error');
 if(!Array.isArray(ids)||!ids.length||ids.length>10000||ids.some(x=>typeof x!=='string'||!x.length||x.length>1024)||new Set(ids).size!==ids.length)return invalid('Empty, duplicate or invalid collected test IDs');
 if(digestOf([...ids].sort(compareText))!==digestOf(ids))return invalid('Unsorted collection');
 if(events.indexOf(collections[0])>events.findIndex(e=>e.kind==='case'))return invalid('Case before collection');
 if(cases.length!==ids.length||new Set(cases.map(c=>c.id)).size!==ids.length||cases.some(c=>!ids.includes(c.id)||!outcomes.includes(c.outcome)))return invalid('Missing, duplicate or unknown test outcomes');
 const counts={};for(const c of cases)counts[c.outcome]=(counts[c.outcome]||0)+1;
 if(end.adapter!==adapter||end.version!==adapterVersions[adapter])return invalid('TEST_RUNNER_VERSION_UNSUPPORTED');
 if(digestOf(end.counts)!==digestOf(counts)||end.exit_status!==exit_code)return invalid('Completion counts/exit status disagree');
 if(!/^[a-f0-9]{64}$/.test(end.staging_before)||end.staging_before!==end.staging_after)return invalid('Disposable staging identity mismatch');
 const missing=expected_tests.filter(id=>!cases.some(c=>c.id===id&&c.outcome==='passed'));
 const passed=!errors.length&&exit_code===0&&(collect_only||!missing.length&&!cases.some(c=>['failed','error','xpass'].includes(c.outcome)));
 return {passed,error:errors.length>0,ids,cases,missing,counts,staging:{before:end.staging_before,after:end.staging_after},diagnostic:passed?(collect_only?'Tests collected in isolation':'Expected tests actually passed'):errors.map(e=>String(e.message)).join('; ')||'Missing or non-passing expected tests: '+missing.join(', ')};
}
export async function executeTestSuite(criterion,runner,{cwd,timeoutMs=30000,signal,collect_only=false}={}){
 requireThat(adapterVersions[criterion.adapter],'Unsupported test adapter');
 for(const path of criterion.roots)relativePath(path,{dot:true});if(criterion.config)relativePath(criterion.config);
 const spec={roots:criterion.roots,plugins:criterion.plugins||[],config:criterion.config||null,collect_only};
 const argv=criterion.adapter==='pytest'?['python','-I','/runner/pytest-wrapper.py',JSON.stringify(spec)]:['node','/runner/vitest-wrapper.mjs',JSON.stringify(spec)];
 const result=await runner.execute(argv,{cwd,timeoutMs,signal});
 return {...result,argv,parsed:parseAdapterReport(result.stdout,{adapter:criterion.adapter,expected_tests:criterion.expected_tests,collect_only,exit_code:result.code,...result})};
}
