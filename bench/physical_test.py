"""Opt-in physical regression exercise. Run consumes two real Codex task runs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile

from . import lab
from .protocol import digest_tree, dump

BASELINE = Path('/Volumes/CStack-Comparison/batch-20261101-v6')
CASES = {
    'flask-5014': {
        'arm': 'cstack-controlled-recovery', 'path': 'tests/test_apps/.env',
        'sha256': '3739562018bb8d8aeddbb540fb4c53e61af5385fb4d3b613e784057c3129ccc0',
        'reason': 'Reviewed published Flask test fixture containing FOO, SPAM, EGGS and HAM sample variables.'},
    'sphinx-9230': {
        'arm': 'cstack-harbor', 'path': 'tests/certs/cert.pem',
        'sha256': 'c4bbc1d129e8d8f09fbfd54ed8cf6ba8a40a56759cd7b65def019afac8ddfa20',
        'reason': 'Reviewed published Sphinx test-suite localhost certificate and test private-key bundle; no production credentials.'},
}


def prepare(work):
    for name, spec in CASES.items():
        target = work / name
        if target.exists():
            raise ValueError('Use a fresh experiment; never overwrite existing preparation or jobs')
        old = BASELINE / name
        lock = json.loads((old / 'lock.json').read_text())
        for kind in ('task', 'pstack'):
            if digest_tree(Path(lock[kind + '_path'])) != lock[kind + '_digest']:
                raise ValueError('Original frozen input changed: ' + kind)
        for kind in ('worker_image', 'grader_image', 'public_image'):
            if lab.image_id(lock[kind]) != lock[kind]:
                raise ValueError('Original frozen image changed')
        target.mkdir(parents=True)
        shutil.copytree(Path(lock['task_path']), target / 'task')
        contract = json.loads((old / 'public-contract.json').read_text())
        original_criteria = json.loads(json.dumps(contract['criteria']))
        contract['approved_test_fixtures'] = [{k: spec[k] for k in ('path', 'sha256', 'reason')}]
        dump(target / 'public-contract.json', contract)
        lock.update({'task_path': str(target / 'task'),
                     'contract_digest': hashlib.sha256((target / 'public-contract.json').read_bytes()).hexdigest(),
                     'implementation_digest': lab.implementation_digest(), 'order': [spec['arm']],
                     'derived_from': str(old), 'exercise': 'targeted physical regression, not a matched five-arm comparison'})
        lock['settings'] = {**lock['settings'], 'purpose': lock['exercise'], 'order': lock['order']}
        dump(target / 'lock.json', lock)
        assert digest_tree(target / 'task') == lock['task_digest']
        assert contract['criteria'] == original_criteria
        print('VALIDATING ' + name + ' (no model)', flush=True)
        lab.validate(target)
    with tarfile.open(work / 'source.tar.gz', 'w:gz') as archive:
        for folder in ('src', 'bench', 'test', 'scripts'):
            for path in sorted((lab.ROOT / folder).rglob('*')):
                if path.is_file() and not path.name.startswith('._') and '__pycache__' not in path.parts:
                    archive.add(path, arcname=str(path.relative_to(lab.ROOT)))
        archive.add(lab.ROOT / 'package.json', arcname='package.json')
    dump(work / 'physical-inputs.json', {'baseline': str(BASELINE), 'cases': CASES,
        'implementation_digest': lab.implementation_digest(),
        'scope': 'Original task/grader images and checks; exact fixture approvals; one controlled ineffective edit followed by real Codex; one ordinary real Codex task.'})


def report(work):
    cases = []
    for name, spec in CASES.items():
        folder = work / name
        record = json.loads((folder / 'comparison.json').read_text())
        assert len(record['rows']) == 1
        row = record['rows'][0]
        result_path, result = lab.find_trial(folder / 'jobs' / spec['arm'])
        agent = result_path.parent / 'agent'
        control = json.loads((agent / 'controller-result.json').read_text())
        state_paths = list((agent / 'cstack-runs').glob('*/run.json'))
        assert len(state_paths) == 1
        state = json.loads(state_paths[0].read_text())
        assert row['independent_reward'] == 1 and row['usage_complete']
        assert control['checks_for_snapshot']['automated_checks'] == 'PASS'
        assert control['status'] in ('VERIFIED', 'NEEDS_MANUAL_VERIFICATION')
        assert result['agent_result']['metadata']['comparison']['turn_attempts'] >= 1
        scripted = (agent / 'controlled-failure.json').exists()
        if scripted:
            assert len(state['attempts']) == 2
            assert state['attempts'][0]['proof']['PUBLIC']['status'] == 'FAIL'
            assert state['attempts'][1]['proof']['PUBLIC']['status'] == 'PASS'
            assert json.loads((agent / 'controlled-failure.json').read_text())['model_invocations'] == 0
        cases.append({'case': name, **row, 'controller_attempts': len(state['attempts']),
            'model_turns': result['agent_result']['metadata']['comparison']['turn_attempts'],
            'scripted_ineffective_first_edit': scripted, 'checks_for_snapshot': control['checks_for_snapshot'],
            'metrics': control['metrics'], 'attempts': [{k: a.get(k) for k in
                ('number', 'decision', 'prompt_chars', 'context_files', 'worker_ms')} for a in state['attempts']]})
    summary = {'status': 'PASSED_TARGETED_PHYSICAL_EXERCISE', 'cases': cases,
        'scope': 'Real Docker public checks and separate private graders; real GPT-6.1 Sol; first Flask edit explicitly scripted. Does not establish a new comparative ranking.'}
    dump(work / 'physical-results.json', summary)
    print(json.dumps(summary, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('prepare', 'run', 'report'))
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    work = args.work.resolve(); work.mkdir(parents=True, exist_ok=True)
    if args.action == 'prepare':
        prepare(work)
    elif args.action == 'run':
        # Every no-model gate and lock must still match before any inference.
        for name in CASES:
            lock = lab.read_lock(work / name)
            gate = json.loads((work / name / 'validation.json').read_text())
            assert gate['passed'] and gate['implementation_digest'] == lock['implementation_digest']
            assert gate['task_digest'] == lock['task_digest']
        for name in CASES:
            print('REAL CODEX EXERCISE ' + name, flush=True)
            lab.run(work / name)
        report(work)
    else:
        report(work)


if __name__ == '__main__':
    main()
