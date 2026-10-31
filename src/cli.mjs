#!/usr/bin/env node
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { command, normalizeContract, beginRun, loadRun, processRun, dataHome, writeReport, effectiveStatus } from './core.mjs';

function options(argv){const flags={},rest=[];for(let i=0;i<argv.length;i++){if(argv[i].startsWith('--')){const key=argv[i].slice(2);if(['help'].includes(key)){flags[key]=true;continue;}if(!argv[i+1])throw new Error('Missing value for '+argv[i]);flags[key]=argv[++i];}else rest.push(argv[i]);}return {flags,rest};}
const usage=`cStack — completion-first Codex engineering harness

Commands:
  cstack doctor
  cstack run "Goal" --repo /path/to/repo --contract /path/to/contract.json
  cstack resume <run-id>
  cstack status <run-id>
  cstack report <run-id>

Acceptance checks MUST be declared in the contract. cStack never silently
approves itself, pushes changes, deploys, or switches to paid API usage.
See docs/CONTRACT.md for the contract format.
`;
async function main(){const [op,...args]=process.argv.slice(2),{flags,rest}=options(args);if(!op||flags.help||op==='help'){console.log(usage);return;}
  await mkdir(dataHome(),{recursive:true});
  if(op==='doctor'){for(const bin of ['node','git','codex']){const result=await command([bin,'--version'],{timeoutMs:15000});console.log(`${bin}: ${result.code===0?result.stdout.trim()||result.stderr.trim():'not available ('+result.stderr.trim()+')'}`);}console.log('Data home: '+dataHome());return;}
  if(op==='run'){if(!rest.length)throw new Error('Goal argument required');if(!flags.contract)throw new Error('--contract is required to define independent acceptance oracles');const raw=JSON.parse(await readFile(resolve(flags.contract),'utf8'));if(rest.join(' ').trim()!==raw.goal.trim())throw new Error('Goal differs from contract; update the contract first to prevent hidden goal drift');const contract=normalizeContract(raw),repo=resolve(flags.repo||'.');const run=await beginRun({repo,contract});console.log('Run: '+run.id+'\nWorktree: '+run.worktree);const result=await processRun(run);console.log(`Status: ${result.status}\nReport: ${join(dataHome(),'runs',result.id,'report.md')}`);if(result.status!=='VERIFIED'&&result.status!=='INVESTIGATED')process.exitCode=2;return;}
  if(op==='status'||op==='report'||op==='resume'){if(!rest[0])throw new Error('Run ID required');const run=await loadRun(rest[0]);if(op==='status'){console.log(JSON.stringify({id:run.id,status:await effectiveStatus(run),goal:run.contract.goal,attempts:run.attempts.length,changed_paths:run.changed_paths,reason:run.reason||null,worktree:run.worktree},null,2));return;}if(op==='report'){console.log(await writeReport(run));return;}if(op==='resume'){const out=await processRun(run);console.log(`Status: ${out.status}\nReport: ${join(dataHome(),'runs',out.id,'report.md')}`);if(out.status!=='VERIFIED'&&out.status!=='INVESTIGATED')process.exitCode=2;return;}}
  throw new Error('Unknown command: '+op);
}
main().catch(e=>{console.error('cStack: '+e.message);process.exitCode=1;});
