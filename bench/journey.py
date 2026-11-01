"""Frozen, budget-gated single-worker experiments. Preparing never invokes a model."""
import argparse, hashlib, json, math, random, statistics, subprocess, sys, time, os, uuid
from pathlib import Path
ARMS = ['old-cstack', 'new-cstack', 'plain-codex']
OLD_CASES = {'pallets__flask-5014','sympy__sympy-12481','sympy__sympy-24539','pytest-dev__pytest-7236','sphinx-doc__sphinx-9230'}
ROOT = Path(__file__).resolve().parents[1]
def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',', ':'),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def read(path): return json.loads(Path(path).read_text())
def write(path,value):
    path=Path(path);temp=path.with_name(path.name+'.tmp-'+uuid.uuid4().hex)
    with temp.open('x') as stream:
        stream.write(json.dumps(value,indent=2,ensure_ascii=False,allow_nan=False)+'\n');stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path)
    fd=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def schedule(cases,repetitions):
    rows=[]
    for i,case in enumerate(cases):
        for repetition in range(repetitions):
            rotation=(i+repetition)%3
            for arm in ARMS[rotation:]+ARMS[:rotation]:
                rows.append({'id':f'{case["id"]}--r{repetition+1}--{arm}','case':case['id'],'arm':arm,'repetition':repetition+1})
    return rows
def source_digest(root):
    root=Path(root).resolve(); paths=[root/'package.json',*sorted((root/'src').rglob('*'))]
    return digest([{'path':str(p.relative_to(root)),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths if p.is_file() and not p.name.startswith('._')])
def validate_cases(cases,stage):
    if len(cases)!=(2 if stage=='smoke' else 12) or len({c['id'] for c in cases})!=len(cases): raise ValueError('Use exactly 2 smoke or 12 full fresh cases')
    for c in cases:
        required={'id','language','complexity','source_kind','source_url','license','reviewed','repo','image','goal','public_criteria','private_criteria','regression_criteria','gold_patch'}
        if set(c)!=required or c['id'] in OLD_CASES or not c['reviewed']: raise ValueError('Case must be fresh, reviewed and fully specified')
        if c['language'] not in ('python','javascript') or c['complexity'] not in ('single-module','cross-module','test-config') or c['source_kind'] not in ('real-project','synthetic'): raise ValueError('Invalid case classification')
        if not c['public_criteria'] or not c['private_criteria'] or not c['regression_criteria'] or any(x.get('kind')!='probe' for x in c['public_criteria']+c['private_criteria']+c['regression_criteria']): raise ValueError('Primary arms require equivalent independent probes')
        if c['source_kind']=='real-project' and (not c['source_url'].startswith('https://') or not c['license']): raise ValueError('Real defects need source and license')
    if stage=='smoke' and {c['language'] for c in cases}!={'python','javascript'}:raise ValueError('Smoke requires one Python and one JavaScript case')
    if stage=='full':
        if sum(c['source_kind']=='real-project' for c in cases)<8: raise ValueError('Full study requires at least 8 real-project defects')
        if any(sum(c['language']==language for c in cases)!=6 for language in ('python','javascript')): raise ValueError('Full study requires 6 Python and 6 JS cases')
        if any(sum(c['complexity']==kind for c in cases)!=4 for kind in ('single-module','cross-module','test-config')): raise ValueError('Full study requires four cases of each complexity')
def bridge_digest():
    return digest({name:hashlib.sha256((ROOT/'bench'/name).read_bytes()).hexdigest() for name in ('journey-trial.mjs','journey_native.py','native_usage.py','journey.py')})
def prepare(args):
    cases=read(args.cases);validate_cases(cases,args.stage);smoke_gate=None
    if args.stage=='full':
        if not args.smoke_report:raise ValueError('Full study requires a completed six-trial smoke report')
        smoke=read(args.smoke_report);rows=smoke.get('rows',[])
        if len(rows)!=6 or any(not r.get('usage_complete') or not r.get('worker_invocations') or r.get('helper_threads')!=0 or r.get('graded') is None or r.get('status') in ('NOT_RUN','RESERVED','INFRA_ERROR') for r in rows):raise ValueError('Smoke environment/accounting gates have not passed')
        smoke_gate=digest(smoke)
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
    for c in cases:
        c['repo']=str(Path(c['repo']).resolve());c['gold_patch']=str(Path(c['gold_patch']).resolve())
        c['source_head']=subprocess.check_output(['git','-C',c['repo'],'rev-parse','HEAD'],text=True).strip()
        if subprocess.check_output(['git','-C',c['repo'],'status','--porcelain'],text=True).strip(): raise ValueError('Experiment cases must start clean')
        c['gold_sha256']=hashlib.sha256(Path(c['gold_patch']).read_bytes()).hexdigest()
        info=json.loads(subprocess.check_output(['docker','image','inspect',c['image']],text=True))[0];c['image']=info['Id']
    runtimes={name:{'root':str(Path(path).resolve()),'digest':source_digest(path)} for name,path in [('old-cstack',args.old_runtime),('new-cstack',args.new_runtime)]}
    cli=subprocess.check_output([args.codex,'--version'],text=True).strip()
    manifest={'schema_version':1,'stage':args.stage,'cases':cases,'runtimes':runtimes,'model':'gpt-6.1-sol','reasoning':'medium','codex':args.codex,'codex_version':cli,'schedule':schedule(cases,1 if args.stage=='smoke' else 3),'limits':{'max_active_ms':600000,'max_attempts':2,'max_observed_tokens':500000},'token_scope':'Controlled worker and descendants; outer interactive planning chat excluded','generator_version':1,'smoke_gate':smoke_gate,'bridge_sha256':bridge_digest()}
    write(out/'manifest.json',manifest);write(out/'budget.template.json',{'approved':False,'approval':{'by':None,'reference':None},'manifest_digest':digest(manifest),'trial_ids':[],'model':manifest['model'],'limits':manifest['limits'],'max_cumulative_observed_tokens':0})
    print(json.dumps({'manifest':str(out/'manifest.json'),'digest':digest(manifest),'trials':len(manifest['schedule']),'status':'PREPARED_NOT_AUTHORIZED'}))
def verify_manifest(root,expected):
    manifest=read(root/'manifest.json')
    if digest(manifest)!=expected: raise ValueError('Manifest changed')
    for runtime in manifest['runtimes'].values():
        if source_digest(runtime['root'])!=runtime['digest']: raise ValueError('Runtime source changed')
    if bridge_digest()!=manifest['bridge_sha256']: raise ValueError('Experiment bridge changed')
    if subprocess.check_output([manifest['codex'],'--version'],text=True).strip()!=manifest['codex_version']: raise ValueError('Codex version changed')
    for c in manifest['cases']:
        if hashlib.sha256(Path(c['gold_patch']).read_bytes()).hexdigest()!=c['gold_sha256']: raise ValueError('Gold patch changed')
        if subprocess.check_output(['git','-C',c['repo'],'rev-parse','HEAD'],text=True).strip()!=c['source_head'] or subprocess.check_output(['git','-C',c['repo'],'status','--porcelain'],text=True).strip(): raise ValueError('Case source changed')
    return manifest
def invoke(root,manifest,row,validate=False):
    out=root/('validation' if validate else 'trials')/row['id'];out.mkdir(parents=True,exist_ok=False)
    payload={'manifest':manifest,'trial':row,'case':next(c for c in manifest['cases'] if c['id']==row['case']),'output':str(out),'validate_only':validate,'python':sys.executable}
    write(out/'input.json',payload)
    start=time.monotonic();result=subprocess.run(['node',str(ROOT/'bench/journey-trial.mjs'),str(out/'input.json')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=660)
    (out/'driver.log').write_text(result.stderr);(out/'stdout.log').write_text(result.stdout)
    if result.returncode or not (out/'result.json').is_file(): return {**row,'status':'INFRA_ERROR','usage_complete':False,'tokens':None,'graded':None,'delivered':False,'wall_ms':(time.monotonic()-start)*1000}
    return {**row,**read(out/'result.json'),'wall_ms':(time.monotonic()-start)*1000}
def validate(args):
    root=Path(args.work).resolve();m=verify_manifest(root,args.expect_manifest);rows=[]
    for case in m['cases']:
        row=invoke(root,m,{'id':case['id'],'case':case['id'],'arm':'new-cstack','repetition':0},True);rows.append(row)
        if row.get('noop_passed') is not False or row.get('gold_passed') is not True: break
    passed=len(rows)==len(m['cases']) and all(r.get('noop_passed') is False and r.get('gold_passed') is True for r in rows)
    write(root/'validation.json',{'manifest_digest':args.expect_manifest,'passed':passed,'rows':rows});return 0 if passed else 1
def authorize(m,budget,expected):
    if budget.get('approved') is not True or not all(isinstance(budget.get('approval',{}).get(k),str) and budget['approval'][k].strip() for k in ('by','reference')): raise ValueError('Explicit experiment approval provenance is required')
    if budget.get('manifest_digest')!=expected or budget.get('model')!=m['model'] or budget.get('limits')!=m['limits']: raise ValueError('Budget does not match frozen model and limits')
    ids=budget.get('trial_ids',[])
    if not ids or len(set(ids))!=len(ids) or not set(ids)<=set(r['id'] for r in m['schedule']): raise ValueError('Invalid authorized trial IDs')
    cap=budget.get('max_cumulative_observed_tokens');
    if not isinstance(cap,int) or isinstance(cap,bool) or cap<=0: raise ValueError('A positive cumulative token ceiling is required')
    return cap
def run(args):
    root=Path(args.work).resolve();m=verify_manifest(root,args.expect_manifest);budget=read(args.budget);cap=authorize(m,budget,args.expect_manifest)
    v=read(root/'validation.json')
    if v.get('manifest_digest')!=args.expect_manifest or not v.get('passed'): raise ValueError('Fresh no-op/gold validation must pass first')
    rows=read(root/'results.json') if (root/'results.json').exists() else []
    scheduled={r['id']:r for r in m['schedule']}
    if len({r['id'] for r in rows})!=len(rows) or any(r['id'] not in scheduled or any(r.get(k)!=scheduled[r['id']][k] for k in ('case','arm','repetition')) for r in rows):raise ValueError('Invalid or duplicated admission ledger')
    for row in m['schedule']:
        if row['id'] not in budget['trial_ids'] or any(r['id']==row['id'] for r in rows): continue
        if any(not r.get('usage_complete') or r.get('status')=='INFRA_ERROR' or r.get('admission_blocked') for r in rows): break
        if any(not isinstance(r.get('tokens'),int) or isinstance(r['tokens'],bool) or r['tokens']<0 for r in rows): raise ValueError('Invalid ledger usage')
        if sum(r['tokens'] for r in rows)>=cap: break
        # Durable admission precedes any paid work. A killed trial stays unresolved.
        reserved={**row,'status':'RESERVED','usage_complete':False,'tokens':None,'graded':None,'delivered':False};rows.append(reserved);write(root/'results.json',rows)
        try: result=invoke(root,m,row)
        except Exception as exc: result={**reserved,'status':'INFRA_ERROR','diagnostic':str(exc)}
        rows[-1]=result;write(root/'results.json',rows)
    return 0

def summarize(rows):
    valid=lambda r:r.get('usage_complete') is True and isinstance(r.get('tokens'),int) and not isinstance(r['tokens'],bool) and r['tokens']>=0
    complete=bool(rows) and all(valid(r) for r in rows)
    total=sum(r['tokens'] for r in rows) if complete else None
    graded=sum(r.get('graded') is True for r in rows);delivered=sum(r.get('delivered') is True for r in rows)
    times=[r['active_ms'] for r in rows if isinstance(r.get('active_ms'),(int,float)) and not isinstance(r['active_ms'],bool) and math.isfinite(r['active_ms']) and r['active_ms']>=0]
    invoked=[r for r in rows if isinstance(r.get('worker_invocations'),int) and r['worker_invocations']>0]
    invocation_unknown=sum(r.get('worker_invocations') is None and r.get('status') in ('RESERVED','INFRA_ERROR') for r in rows)
    graded_rows=[r for r in rows if r.get('graded') is not None]
    regressions_complete=bool(graded_rows) and all(isinstance(r.get('regression_failed'),bool) for r in graded_rows)
    return {'scheduled_rows':len(rows),'graded_passes':graded,'delivered_fixes':delivered,'tokens':total,'tokens_per_graded_pass':total/graded if total is not None and graded else None,'tokens_per_delivered_fix':total/delivered if total is not None and delivered else None,'median_active_ms':statistics.median(times) if times else None,'p95_active_ms':sorted(times)[math.ceil(.95*len(times))-1] if times else None,'timed_rows':len(times),'model_invoking_trials':len(invoked),'invocation_unknown_trials':invocation_unknown,'accounting_completeness':sum(valid(r) for r in invoked)/len(invoked) if invoked and not invocation_unknown else None,'regression_rate':sum(r['regression_failed'] for r in graded_rows)/len(graded_rows) if regressions_complete else None}
def bootstrap(rows,samples=10000):
    ids=sorted(set(r['case'] for r in rows));rng=random.Random(104729);ratios={'tokens_per_graded_pass':[],'median_active_ms':[]}
    if not ids:return {key:{'interval':None,'defined':0,'samples':samples} for key in ratios}
    for _ in range(samples):
        chosen=[rng.choice(ids) for _ in ids];stats={arm:summarize([r for case in chosen for r in rows if r['case']==case and r['arm']==arm]) for arm in ('old-cstack','new-cstack')}
        for metric in ratios:
            a,b=stats['old-cstack'][metric],stats['new-cstack'][metric]
            if metric=='median_active_ms' and any(stats[arm]['timed_rows']!=stats[arm]['scheduled_rows'] for arm in stats): continue
            if a is not None and b is not None and a>0:ratios[metric].append(b/a)
    result={}
    for metric,values in ratios.items():
        values.sort();n=len(values);result[metric]={'interval':[values[max(0,math.ceil(.025*n)-1)],values[max(0,math.ceil(.975*n)-1)]] if n>=.9*samples else None,'defined':n,'samples':samples}
    return result
def phase_total(segments):
    leaves=[s for s in segments if s.get('leaf',True)]
    if any(s.get('duration_ms') is None for s in leaves): return None
    return sum(s['duration_ms'] for s in leaves)
def report(args):
    root=Path(args.work).resolve();m=read(root/'manifest.json');observed=read(root/'results.json') if (root/'results.json').exists() else [];by_id={r['id']:r for r in observed};rows=[by_id.get(r['id'],{**r,'status':'NOT_RUN','usage_complete':False,'tokens':None,'graded':None,'delivered':False}) for r in m['schedule']]
    paired=[]
    for case in m['cases']:
        a=summarize([r for r in rows if r['case']==case['id'] and r['arm']=='old-cstack'])['median_active_ms'];b=summarize([r for r in rows if r['case']==case['id'] and r['arm']=='new-cstack'])['median_active_ms'];paired.append({'case':case['id'],'new_old_median_time_ratio':b/a if a and b is not None else None})
    result={'schema_version':1,'manifest_digest':digest(m),'model':m['model'],'reasoning':m['reasoning'],'codex_version':m['codex_version'],'token_scope':m['token_scope'],'rows':rows,'arms':{arm:summarize([r for r in rows if r['arm']==arm]) for arm in ARMS},'paired_time_ratios':paired,'bootstrap':bootstrap(rows),'bootstrap_method':'Case-level resampling with all arms/repetitions; Python random.Random seed104729,10000 samples, nearest-rank percentiles; median averages middle pair','human_usability':'NOT_RUN','claim_scope':'Matched frozen single-worker experiment only; no refreshed pstack superiority claim'}
    write(root/'report.json',result);print(json.dumps(result,indent=2));return 0
def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    a=sub.add_parser('prepare');a.add_argument('--cases',required=True);a.add_argument('--old-runtime',required=True);a.add_argument('--new-runtime',required=True);a.add_argument('--codex',default='codex');a.add_argument('--stage',choices=['smoke','full'],default='smoke');a.add_argument('--out',required=True);a.add_argument('--smoke-report')
    for name in ('validate','run'):
        a=sub.add_parser(name);a.add_argument('--work',required=True);a.add_argument('--expect-manifest',required=True)
        if name=='run':a.add_argument('--budget',required=True)
    a=sub.add_parser('report');a.add_argument('--work',required=True)
    args=p.parse_args();return globals()[args.command](args) or 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as exc:print('Journey: '+str(exc),file=sys.stderr);sys.exit(1)
