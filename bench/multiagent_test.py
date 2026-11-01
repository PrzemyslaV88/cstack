"""Add current single/multi-agent cStack runs beside a preserved five-case batch.

prepare uses no models; run consumes ten real contestant trials. No old run is
modified, and an existing contestant job is never silently repeated.
"""
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import statistics
import tarfile

from . import lab
from .native_usage import reconcile_sessions
from .physical_test import CASES as FIXTURES
from .protocol import digest_tree, dump

SINGLE = 'cstack-harbor'
MULTI = 'cstack-codex-multiagent'
LABELS = {
    'plain-codex': 'Plain Codex (saved)',
    SINGLE: 'cStack single-agent (saved)',
    'pstack-adapted-single-worker': 'pstack single-agent (saved)',
    'plain-codex-multiagent': 'Plain Codex multi-agent (saved)',
    'pstack-codex-multiagent': 'pstack multi-agent (saved)',
    'current/' + SINGLE: 'cStack single-agent (current)',
    'current/' + MULTI: 'cStack multi-agent (current)',
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(work, baseline):
    if any(work.iterdir()):
        raise ValueError('Use a fresh empty work directory; preserve every previous experiment')
    config = json.loads((baseline / 'batch-config.json').read_text())
    old_results = baseline / 'analyzed-results.json'
    inputs = {'baseline': str(baseline), 'baseline_results_sha256': sha256(old_results),
              'model': config['model'], 'cases': [c['id'] for c in config['cases']],
              'implementation_digest': lab.implementation_digest(),
              'created_at': datetime.now(timezone.utc).isoformat(),
              'claim': 'Descriptive token, task-time and correctness comparison; no general winner or causal speedup from one trial per case.',
              'schedule': [], 'scope': 'Updated cStack single versus experimental multi-agent, plus historical five-arm results.'}
    # Freeze all five cases before any validation or inference.
    for index, spec in enumerate(config['cases']):
        name = spec['id']; old = baseline / name; target = work / name
        lock = json.loads((old / 'lock.json').read_text())
        for kind in ('task', 'pstack'):
            if digest_tree(Path(lock[kind + '_path'])) != lock[kind + '_digest']:
                raise ValueError('Original frozen input changed: ' + name + '/' + kind)
        for kind in ('worker_image', 'grader_image', 'public_image'):
            if lab.image_id(lock[kind]) != lock[kind]:
                raise ValueError('Original frozen image changed: ' + name + '/' + kind)
        target.mkdir()
        shutil.copytree(Path(lock['task_path']), target / 'task')
        contract = json.loads((old / 'public-contract.json').read_text())
        if name in FIXTURES:
            contract['approved_test_fixtures'] = [
                {key: FIXTURES[name][key] for key in ('path', 'sha256', 'reason')}]
        dump(target / 'public-contract.json', contract)
        order = [SINGLE, MULTI] if index % 2 == 0 else [MULTI, SINGLE]
        lock.update({'task_path': str(target / 'task'), 'derived_from': str(old),
                     'contract_digest': sha256(target / 'public-contract.json'),
                     'implementation_digest': inputs['implementation_digest'], 'order': order})
        lock['settings'] = {**lock['settings'], 'order': order, 'arms': [SINGLE, MULTI],
                            'purpose': inputs['scope']}
        dump(target / 'lock.json', lock)
        if digest_tree(target / 'task') != lock['task_digest']:
            raise ValueError('Copied task identity changed')
        inputs['schedule'].append({'case': name, 'order': order})
    dump(work / 'inputs.json', inputs)
    with tarfile.open(work / 'source.tar.gz', 'w:gz') as archive:
        for folder in ('src', 'bench', 'test', 'scripts'):
            for path in sorted((lab.ROOT / folder).rglob('*')):
                if path.is_file() and not path.name.startswith('._') and '__pycache__' not in path.parts:
                    archive.add(path, arcname=str(path.relative_to(lab.ROOT)))
        archive.add(lab.ROOT / 'package.json', arcname='package.json')
    for name in inputs['cases']:
        print('VALIDATING ' + name + ' (original/known repair; no model)', flush=True)
        lab.validate(work / name)
    print('ALL FIVE CASES VALIDATED; no contestant models invoked', flush=True)


def aggregate(rows):
    result = []
    for arm, label in LABELS.items():
        selected = [r for r in rows if r['comparison_arm'] == arm]
        if not selected:
            continue
        complete = all(r['usage_complete'] or r.get('pre_worker_abort') for r in selected)
        result.append({'arm': arm, 'label': label, 'trials': len(selected),
            'private_passes': sum(r['independent_reward'] == 1 for r in selected),
            'total_tokens': sum(r['total_tokens'] or 0 for r in selected) if complete else None,
            'cached_input_tokens': sum(r['cached_input_tokens'] or 0 for r in selected) if complete else None,
            'agent_seconds': sum(r['agent_seconds'] for r in selected),
            'median_agent_seconds': statistics.median(r['agent_seconds'] for r in selected),
            'min_agent_seconds': min(r['agent_seconds'] for r in selected),
            'max_agent_seconds': max(r['agent_seconds'] for r in selected),
            'children': sum(r['child_agents'] for r in selected), 'accounting_complete': complete,
            'pre_worker_aborts': sum(bool(r.get('pre_worker_abort')) for r in selected)})
    return result


def report(work):
    inputs = json.loads((work / 'inputs.json').read_text())
    baseline = Path(inputs['baseline']); old_results = baseline / 'analyzed-results.json'
    if sha256(old_results) != inputs['baseline_results_sha256']:
        raise ValueError('Historical comparison changed; preserve the original record')
    old = json.loads(old_results.read_text())
    rows = [{**r, 'comparison_arm': r['arm'], 'cohort': 'saved'} for r in old['rows']]
    audits, warnings, thread_ids, paired = [], [], set(), []
    for name in inputs['cases']:
        path = work / name / 'comparison.json'
        if not path.exists():
            continue
        comparison = json.loads(path.read_text())
        for row in comparison['rows']:
            trial_path, trial = lab.find_trial(work / name / 'jobs' / row['arm'])
            agent = trial_path.parent / 'agent'
            usage = reconcile_sessions(agent / 'sessions', inputs['model'], row['arm'] == MULTI)
            if usage != json.loads((agent / 'native-usage.json').read_text()):
                warnings.append(name + '/' + row['arm'] + ': native audit differs')
            for thread in usage['threads']:
                if thread['id'] in thread_ids:
                    warnings.append('Duplicate native thread: ' + thread['id'])
                thread_ids.add(thread['id'])
            if row['arm'] == MULTI:
                if usage['child_count'] < 2:
                    warnings.append(name + ': fewer than two actual helpers')
                parents = {t['id']: t['parent_thread_id'] for t in usage['threads']}
                if any(parent and parents.get(parent) for parent in parents.values()):
                    warnings.append(name + ': nested delegation observed')
            control_path = agent / 'controller-result.json'
            control = json.loads(control_path.read_text()) if control_path.exists() else None
            files = [{'path': str(p.relative_to(work)), 'sha256': sha256(p)}
                     for p in sorted((agent / 'sessions').rglob('*.jsonl'))]
            audits.append({'case': name, 'arm': row['arm'], 'complete': usage['complete'],
                'errors': usage['errors'], 'models': sorted({m for t in usage['threads'] for m in t['models']}),
                'efforts': sorted({e for t in usage['threads'] for e in t['efforts']}),
                'root_count': usage['root_count'], 'child_count': usage['child_count'], 'session_files': files,
                'controller': control})
            rows.append({'case': name, **row, 'comparison_arm': 'current/' + row['arm'],
                         'cohort': 'current', 'pre_worker_abort': False})
        current = {r['arm']: r for r in rows if r['case'] == name and r['cohort'] == 'current'}
        if set(current) == {SINGLE, MULTI}:
            a, b = current[SINGLE], current[MULTI]
            paired.append({'case': name, 'single_pass': a['independent_reward'], 'multi_pass': b['independent_reward'],
                'multi_to_single_tokens': b['total_tokens'] / a['total_tokens']
                    if a['total_tokens'] and b['total_tokens'] is not None else None,
                'multi_to_single_time': b['agent_seconds'] / a['agent_seconds']})
    current_rows = [r for r in rows if r['cohort'] == 'current']
    finished = len(current_rows) == 2 * len(inputs['cases'])
    errors = any(r['status'] == 'EXECUTION_ERROR' for r in current_rows)
    result = {'status': ('COMPLETED_WITH_EXECUTION_ERROR' if errors else 'COMPLETED_DESCRIPTIVE_EXTENSION')
                         if finished else 'IN_PROGRESS',
              'model': inputs['model'], 'inputs': inputs, 'rows': rows, 'aggregates': aggregate(rows),
              'paired_current_cases': paired, 'native_audit': audits, 'distinct_new_threads': len(thread_ids),
              'warnings': warnings, 'subscription_allowance_consumed': None,
              'limits': 'One trial per workflow per case; historical arms were not rerun; changed controller and cache/time/order effects prevent causal cross-cohort speedup claims. Helper read-only roles are instructions, not OS isolation. All seats share a model family.'}
    dump(work / 'combined-results.json', result)
    with (work / 'combined-results.csv').open('w') as stream:
        fields = sorted({key for row in rows for key in row})
        writer = csv.DictWriter(stream, fieldnames=fields); writer.writeheader(); writer.writerows(rows)
    fmt = lambda value: f'{value:,}' if value is not None else 'unknown'
    text = ['# cStack multi-agent comparison', '',
        'Five new single-agent and five new multi-agent cStack trials, alongside the preserved 25-trial comparison. '
        'Same five bugs, GPT-6.1 Sol, Codex 0.163.0, original task images, public probes and separate private graders. '
        'Current cStack modes alternate order across cases. One trial per mode per case; descriptive results only.', '',
        '| Workflow | Independent bug-test passes | Tokens, all agents | Combined task seconds | Helpers |',
        '|---|---:|---:|---:|---:|']
    for a in result['aggregates']:
        text.append(f"| {a['label']} | {a['private_passes']}/{a['trials']} | {fmt(a['total_tokens'])} | {a['agent_seconds']:.1f} | {a['children']} |")
    text += ['', 'Saved cStack has four model runs and one zero-invocation startup abort. '
             'Current cStack includes the reviewed fixture fixes and newer controller. '
             'Its comparisons against saved workflows cross different execution periods and controller versions. '
             'Tokens include cached input once and do not measure subscription credits or billed cost.', '',
             '| Case | Current cStack mode | Private grade | Tokens | Task seconds | Helpers | Controller result |',
             '|---|---|---:|---:|---:|---:|---|']
    for r in current_rows:
        text.append(f"| {r['case']} | {'Multi' if r['arm'] == MULTI else 'Single'} | {r['independent_reward']} | {fmt(r['total_tokens'])} | {r['agent_seconds']:.1f} | {r['child_agents']} | {r['controller_status'] or 'unavailable'} |")
    text += ['', 'A private test pass and controller approval are separate. Existing test/configuration changes remain pending human review. '
             'No human approval is generated by helper agents. The multi-agent arm uses one coding parent and diagnosis/review helpers; '
             'the shipped plugin default stays single-worker. Every helper contributes to native totals and the controller’s observed-token admission budget. '
             'A complete turn can overshoot that admission ceiling.', '',
             f"New native threads reconciled: {len(thread_ids)}. Audit warnings: {len(warnings)}. Status: `{result['status']}`.", '',
             result['limits'], '', f'Full machine-readable evidence: `{work / "combined-results.json"}`.', '']
    if warnings:
        text.extend(['Audit warnings:', '', *['- ' + w for w in warnings], ''])
    (work / 'comparison.md').write_text('\n'.join(text))
    print(json.dumps({'status': result['status'], 'new_trials': len(current_rows),
                      'aggregates': result['aggregates'], 'warnings': warnings}, indent=2), flush=True)
    return result


def run(work):
    inputs = json.loads((work / 'inputs.json').read_text())
    for name in inputs['cases']:
        lock = lab.read_lock(work / name)
        gate = json.loads((work / name / 'validation.json').read_text())
        if not gate['passed'] or gate['implementation_digest'] != lock['implementation_digest'] or gate['task_digest'] != lock['task_digest']:
            raise ValueError('All five unchanged-fail/known-repair-pass gates must be current')
    for name in inputs['cases']:
        path = work / name / 'comparison.json'
        if path.exists():
            if json.loads(path.read_text())['status'] == 'COMPLETED_SMOKE':
                continue
            raise ValueError('Preserving interrupted/charged case: ' + name)
        print('REAL CODEX SINGLE/MULTI ' + name, flush=True)
        try:
            lab.run(work / name)
        finally:
            report(work)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'run', 'report'))
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--baseline', type=Path, default=Path('/Volumes/CStack-Comparison/batch-20261101-v6'))
    args = parser.parse_args(); work = args.work.resolve(); work.mkdir(parents=True, exist_ok=True)
    if args.action == 'prepare': prepare(work, args.baseline.resolve())
    elif args.action == 'run': run(work)
    else: report(work)


if __name__ == '__main__':
    main()
