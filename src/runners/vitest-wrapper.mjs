import {readFile} from 'node:fs/promises';import {relative,resolve} from 'node:path';import {stageProject} from './stage-project.mjs';
const emit=(kind,values)=>process.stdout.write('CSTACK_TEST_EVENT '+JSON.stringify({schema_version:1,kind,...values})+'\n');
let runner;
try {
 const spec=JSON.parse(process.argv[2]),staging=await stageProject();
 const version=JSON.parse(await readFile('/opt/cstack-deps/node_modules/vitest/package.json','utf8')).version;
 if(version!=='4.0.18')throw Error('TEST_RUNNER_VERSION_UNSUPPORTED');
 const {createVitest}=await import('/opt/cstack-deps/node_modules/vitest/dist/node.js');
 runner=await createVitest('test',{root:'/tmp/project',watch:false,run:true,reporters:[{}],config:spec.config?resolve(spec.config):undefined,
  fileParallelism:false,maxWorkers:1,allowOnly:false,passWithNoTests:false,update:false,cache:false,coverage:{enabled:false}}, {cacheDir:'/tmp/vite-cache'});
 const result=await (spec.collect_only?runner.collect(spec.roots):runner.start(spec.roots));
 const cases=[],errors=[...result.unhandledErrors];
 function walk(entity,suites=[],file=null){
  if(entity.type==='module')file=relative('/tmp/project',entity.moduleId).replaceAll('\\','/');
  if(entity.type==='test'){
   const id=JSON.stringify([file,entity.project.name||'',suites,entity.name]),state=entity.result().state;
   let outcome=spec.collect_only?'todo':state==='passed'?'passed':state==='failed'?'failed':entity.options.mode==='todo'?'todo':state==='skipped'?'skipped':'error';
   if(!spec.collect_only&&entity.options.fails)outcome=state==='passed'?'xfail':'xpass';
   cases.push({id,outcome});return;
  }
  errors.push(...entity.errors());for(const child of entity.children)walk(child,entity.type==='suite'?[...suites,entity.name]:suites,file);
 }
 for(const m of result.testModules)walk(m);
 cases.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);emit('collection',{ids:cases.map(c=>c.id)});
 const counts={};for(const c of cases){counts[c.outcome]=(counts[c.outcome]||0)+1;emit('case',c);}
 for(const error of errors)emit('error',{message:String(error?.message||error).slice(0,6000)});
 const code=errors.length||cases.some(c=>['failed','error','xpass'].includes(c.outcome))?1:0;
 await runner.close();runner=null;emit('complete',{adapter:'vitest',version,counts,exit_status:code,...staging});process.exitCode=code;
}catch(error){emit('error',{message:String(error.message||error).slice(0,6000)});process.exitCode=2;}
finally{if(runner)await runner.close();}
