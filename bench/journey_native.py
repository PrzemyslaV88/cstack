"""Copy/reconcile only one trial's native thread tree. Never inspect auth/config."""
import argparse, json, shutil
from pathlib import Path
try:
    from .native_usage import reconcile_sessions
except ImportError:
    from native_usage import reconcile_sessions

def collect_trial(sessions, destination, root_id, model, reasoning='medium'):
    sessions, destination = Path(sessions), Path(destination)
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    candidates=[]
    paths=list(sessions.rglob('*.jsonl'))
    if len(paths)>50000: raise ValueError('Native session discovery limit exceeded')
    for path in paths:
        if path.is_symlink(): continue
        with path.open() as stream:
            line=stream.readline(1024*1024)
        try: row=json.loads(line)
        except (ValueError,TypeError): continue
        if row.get('type')!='session_meta': continue
        meta=row.get('payload',{});source=meta.get('source',{})
        spawn=source.get('subagent',{}).get('thread_spawn',{}) if isinstance(source,dict) else {}
        parent=meta.get('parent_thread_id') or spawn.get('parent_thread_id')
        if meta.get('id'): candidates.append((path,meta['id'],parent))
    selected={root_id}
    while True:
        expanded=selected|{tid for _,tid,parent in candidates if parent in selected}
        if expanded==selected: break
        selected=expanded
    # Fresh per-turn directory avoids counting stale copies or previous attempts twice.
    for number,(path,tid,_) in enumerate(candidates):
        if tid in selected:
            if path.stat().st_size>64*1024*1024: raise ValueError('Native rollout exceeds accounting limit')
            target=destination/f'{number:05d}.jsonl';shutil.copyfile(path,target);target.chmod(0o600)
    result=reconcile_sessions(destination,model)
    if not any(r['id']==root_id and r['parent_thread_id'] is None for r in result['threads']):
        result['errors'].append('Requested root thread absent or has a parent');result['complete']=False
    if any(r['efforts']!=[reasoning] for r in result['threads']):
        result['errors'].append('Native reasoning effort differs from the frozen arm');result['complete']=False
    result['primary_arm_valid']=result['complete'] and result['child_count']==0
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--sessions',required=True);p.add_argument('--out',required=True);p.add_argument('--thread',required=True);p.add_argument('--model',required=True);p.add_argument('--reasoning',required=True);a=p.parse_args()
    print(json.dumps(collect_trial(a.sessions,a.out,a.thread,a.model,a.reasoning)))
