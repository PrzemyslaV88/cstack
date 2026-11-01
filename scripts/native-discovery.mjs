import {spawn} from 'node:child_process';import {mkdir} from 'node:fs/promises';import {join} from 'node:path';import {command,cleanEnv} from '../src/process.mjs';import {requireThat} from '../src/util.mjs';
export async function nativeDiscovery({marketplaceRoot,home,cwd,codex=process.env.CSTACK_CODEX_BIN||'codex'}){
 await mkdir(home,{recursive:true,mode:0o700});const env=cleanEnv({HOME:home,CODEX_HOME:join(home,'codex')});await mkdir(env.CODEX_HOME,{mode:0o700});
 for(const args of [['plugin','marketplace','add',marketplaceRoot,'--json'],['plugin','add','cstack@cstack-local','--json']]){const r=await command([codex,...args],{cwd,env,timeoutMs:30000});requireThat(r.code===0,'Isolated native plugin setup failed: '+r.stderr);}
 return new Promise((resolve,reject)=>{const child=spawn(codex,['app-server','--stdio'],{cwd,env,stdio:['pipe','pipe','pipe']});let buffer='',errors='',done=false;const timer=setTimeout(()=>finish(Error('Native discovery timeout')),20000);
 function finish(error,value){if(done)return;done=true;clearTimeout(timer);child.stdin.end();child.kill('SIGTERM');error?reject(error):resolve(value);}
 child.on('error',e=>finish(e));child.on('exit',code=>{if(!done)finish(Error('Native discovery exited '+code+': '+errors.slice(-1000)));});child.stderr.on('data',d=>{errors=(errors+d).slice(-4000);});
 const send=x=>child.stdin.write(JSON.stringify(x)+'\n');child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line);}catch{continue;}if(msg.error){finish(Error(JSON.stringify(msg.error)));return;}if(msg.id===1){send({method:'initialized',params:{}});send({id:2,method:'skills/list',params:{cwds:[cwd],forceReload:true}});}if(msg.id===2)finish(null,msg.result);}});
 send({id:1,method:'initialize',params:{clientInfo:{name:'cstack-isolated-discovery',version:'1'},capabilities:{experimentalApi:true}}});
 });
}
