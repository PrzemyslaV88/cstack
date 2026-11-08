import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { requireThat, dataHome, json } from './util.mjs';
import { renderResult } from './cli-output.mjs';

export const workflowFlags = {
  intake:['repo','out','brief','format'], checkpoint:['out','format','snapshot'],
  retro:['out','format'], architecture:['repo','focus','out','format']
};

export async function workflowCommand(op, flags, rest) {
  if(!Object.hasOwn(workflowFlags,op))return false;
  const format=flags.format||'markdown';requireThat(['json','markdown'].includes(format),'Unsupported output format');
  let result;
  if(op==='intake'){
    requireThat(flags.out,'--out is required');
    const {draftIntake,compileIntake}=await import('./intake.mjs');
    if(rest[0]==='compile'){
      requireThat(rest.length===1&&flags.brief,'Use intake compile --brief FILE --repo PATH --out DIR');
      result=await compileIntake({repo:resolve(flags.repo||'.'),briefPath:flags.brief,output:flags.out});
    }else{
      requireThat(rest.length&&!flags.brief,'Provide an observable goal');
      result=await draftIntake({repo:resolve(flags.repo||'.'),goal:rest.join(' '),output:flags.out});
    }
  }else if(op==='checkpoint'){
    if(rest[0]==='recover'){
      requireThat(rest.length===2&&flags.snapshot&&!flags.out,'Use checkpoint recover RUN_ID --snapshot SHA256');
      const {recoverCheckpoint}=await import('./checkpoint.mjs');
      result=await recoverCheckpoint(rest[1],flags.snapshot,dataHome());
      process.stdout.write(renderResult(result,format));return true;
    }
    requireThat(rest.length===1&&!flags.snapshot,'Select one run');
    const {loadRun}=await import('./store.mjs');const {loadCheckpoint}=await import('./checkpoint.mjs');
    const run=await loadRun(rest[0]),checkpoint=await loadCheckpoint(run,dataHome());
    requireThat(checkpoint,'No durable checkpoint exists for this run');
    if(flags.out){const {newOutputDirectory}=await import('./artifacts.mjs');const directory=await newOutputDirectory(flags.out,[run.repo,run.worktree]);await writeFile(join(directory,'checkpoint.json'),json(checkpoint),{flag:'wx',mode:0o600});result={directory,digest:run.checkpoint.digest};}
    else result=checkpoint;
  }else{
    const {architectureInvestigation,retrospective,exportInvestigation,investigationMarkdown}=await import('./investigations.mjs');
    const report=op==='architecture'?(requireThat(!rest.length,'Use --repo and optional --focus'),await architectureInvestigation(resolve(flags.repo||'.'),{focus:flags.focus})):await retrospective(rest);
    const excluded=op==='architecture'?[report.repository]:[];
    if(op==='retro'&&flags.out){const {loadRun}=await import('./store.mjs');for(const id of rest){const r=await loadRun(id);excluded.push(r.repo,r.worktree);}}
    result=flags.out?await exportInvestigation(report,flags.out,excluded):format==='markdown'?{markdown:investigationMarkdown(report)}:report;
  }
  process.stdout.write(renderResult(result,format));return true;
}
