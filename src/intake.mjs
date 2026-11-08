import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repository } from './repository.mjs';
import { readJson, newOutputDirectory } from './artifacts.mjs';
import { normalizeContract } from './contracts.mjs';
import { workflowPolicy } from './workflow.mjs';
import { exactKeys, requireThat, json, digestOf, redact } from './util.mjs';

const boundedText = (value, name, max = 800) => {
  requireThat(typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= max && !value.includes('\0'), 'Invalid ' + name);
  return redact(value.trim());
};
const strings = (value, name, max = 8) => {
  requireThat(Array.isArray(value) && value.length <= max, 'Invalid ' + name);
  return value.map(x => boundedText(x, name, 300));
};

export function normalizePreparation(value, criteria, tasks) {
  exactKeys(value, ['schema_version','non_goals','assumptions','decisions','outcome_sources','integration_criteria','brief_digest'], 'preparation');
  requireThat(value.schema_version === 1 && /^[a-f0-9]{64}$/.test(value.brief_digest), 'Invalid preparation identity');
  const result = { schema_version: 1, non_goals: strings(value.non_goals,'non_goals'),
    assumptions: strings(value.assumptions,'assumptions'), decisions: strings(value.decisions,'decisions'),
    outcome_sources: value.outcome_sources, integration_criteria: strings(value.integration_criteria,'integration_criteria',100), brief_digest: value.brief_digest };
  requireThat(Array.isArray(result.outcome_sources) && result.outcome_sources.length <= 100, 'Invalid outcome sources');
  const ids = new Set();
  result.outcome_sources = result.outcome_sources.map(s => {
    exactKeys(s,['id','source','seam'],'outcome source');
    requireThat(criteria.some(c => c.id===s.id) && !ids.has(s.id),'Unknown or duplicate outcome source'); ids.add(s.id);
    return {id:s.id,source:boundedText(s.source,'expectation source'),seam:boundedText(s.seam,'test interface',300)};
  });
  for (const id of result.integration_criteria) {
    requireThat(criteria.some(c => c.id===id && c.required!==false),'Integration outcome must be required');
    requireThat(tasks.some(t => t.criteria.includes(id)),'Integration outcome has no task');
  }
  const integrationTasks=tasks.filter(t=>t.criteria.some(id=>result.integration_criteria.includes(id)));
  const implementationTasks=tasks.filter(t=>!integrationTasks.includes(t));
  for(const task of integrationTasks){
    const ancestors=new Set();const visit=id=>{if(ancestors.has(id))return;ancestors.add(id);for(const dep of tasks.find(t=>t.id===id)?.depends_on||[])visit(dep);};
    for(const dep of task.depends_on)visit(dep);
    requireThat(implementationTasks.every(t=>ancestors.has(t.id)),'Integration tasks must depend on all implementation tasks');
  }
  requireThat(Buffer.byteLength(JSON.stringify({non_goals:result.non_goals,assumptions:result.assumptions,decisions:result.decisions}))<=2400,
    'Project constraints exceed the starting context allowance; shorten or split the work');
  return result;
}

export async function draftIntake({repo,goal,output}) {
  const reader = await repository(repo);
  boundedText(goal,'goal',4096);
  const brief = {schema_version:1,goal,type:'FIX',non_goals:[],assumptions:[],decisions:[],questions:[],
    outcomes:[],tasks:[],integration_criteria:[],execution:{},context:{policy:'evidence-v1',files:[],symbols:[],frames:[]},workflow:workflowPolicy()};
  const directory = await newOutputDirectory(output,[reader.root]);
  await writeFile(join(directory,'brief.json'),json(brief),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'brief.md'),[
    '# Prepare the requested outcome','',goal,'',
    'This is a draft, not executable acceptance. Inspect the public interface and relevant project decisions.',
    'For each outcome add {criterion, source, seam}. criterion uses an existing cStack probe/test/manual criterion; source names the user requirement or independent specification establishing its expected value; seam names the public interface exercised.',
    'Resolve material questions; infer routine engineering choices. Use one independently verifiable behavior per task, with explicit depends_on edges and criterion IDs. Include the full integration path for work spanning several interfaces.',
    'Do not derive expected results from the buggy implementation or mark a test passed without execution. Compile the completed brief, then use setup and plan to reproduce and freeze it.',''
  ].join('\n'),{flag:'wx',mode:0o600});
  return {code:'INTAKE_DRAFT',ready:false,directory,brief:join(directory,'brief.json'),next_action:'Complete the observable outcomes, expectation sources and task graph; compile the brief.'};
}

export async function compileIntake({repo,briefPath,output}) {
  const reader=await repository(repo),brief=await readJson(briefPath,200000);
  exactKeys(brief,['schema_version','goal','type','non_goals','assumptions','decisions','questions','outcomes','tasks','integration_criteria','execution','context','workflow'],'brief');
  requireThat(brief.schema_version===1,'Unsupported brief version');
  const questions=strings(brief.questions,'questions');
  requireThat(!questions.length,'Resolve material questions before freezing: '+questions.join('; '),'OUTCOME_UNRESOLVED');
  requireThat(Array.isArray(brief.outcomes)&&brief.outcomes.length>0&&brief.outcomes.length<=100,'Supply independent observable outcomes; empty drafts cannot execute');
  const sources=brief.outcomes.map(o=>{
    exactKeys(o,['criterion','source','seam'],'outcome');
    return {id:o.criterion?.id,source:o.source,seam:o.seam};
  });
  exactKeys(brief.execution,['model','reasoning','attempt_limit','budget','policy','implementation_paths'],'execution');
  const contract=normalizeContract({...brief.execution,schema_version:3,goal:brief.goal,type:brief.type,
    criteria:brief.outcomes.map(o=>o.criterion),tasks:brief.tasks,context:brief.context,runner:{backend:'docker'}});
  requireThat([...contract.context.files,...contract.context.frames.map(f=>f.path)].every(p=>reader.known.has(p)),'Context must name included project files');
  const preparation=normalizePreparation({schema_version:1,non_goals:brief.non_goals,assumptions:brief.assumptions,decisions:brief.decisions,
    outcome_sources:sources,integration_criteria:brief.integration_criteria,brief_digest:digestOf(brief)},contract.criteria,contract.tasks);
  const acceptance={...brief.execution,type:contract.type,criteria:contract.criteria,tasks:contract.tasks,context:contract.context,
    preparation,workflow:workflowPolicy(brief.workflow)};
  const directory=await newOutputDirectory(output,[reader.root]);
  await writeFile(join(directory,'acceptance.json'),json(acceptance),{flag:'wx',mode:0o600});
  await writeFile(join(directory,'brief.json'),json(brief),{flag:'wx',mode:0o600});
  const lines=['# Outcome brief','',redact(contract.goal),'','Preparation compiled; baseline and behavior remain unverified.','',
    ...contract.tasks.map(t=>`- ${t.id}: ${redact(t.title)}; blocked by ${t.depends_on.join(', ')||'none'}; outcomes ${t.criteria.join(', ')}`),'',
    ...preparation.outcome_sources.map(s=>`- ${s.id}: ${s.seam}; expectation source: ${s.source}`),'',
    'Next: setup the verifier, then plan with this acceptance file. Planning reproduces the baseline without a model invocation.',''];
  await writeFile(join(directory,'brief.md'),lines.join('\n'),{flag:'wx',mode:0o600});
  return {code:'ACCEPTANCE_PREPARED',ready:true,acceptance:join(directory,'acceptance.json'),brief_digest:preparation.brief_digest,
    tasks:contract.tasks.length,next_action:'Run setup and plan to reproduce and freeze these outcomes.'};
}
