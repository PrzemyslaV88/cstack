"""Explicit five-case comparison. Preparation/validation never invokes a model."""
import argparse
import csv
import hashlib
import json
from pathlib import Path

from .lab import ROOT, prepare, validate, run, read_lock
from .protocol import dump

CONFIG = ROOT / 'bench/batch_cases.json'


def summarize(work: Path, config: dict) -> dict:
    rows, cases = [], []
    for case in config['cases']:
        report_path = work / case['id'] / 'comparison.json'
        report = json.loads(report_path.read_text()) if report_path.exists() else {'status': 'NOT_STARTED', 'rows': []}
        cases.append({'case': case['id'], 'status': report['status']})
        rows.extend({'case': case['id'], **row} for row in report.get('rows', []))
    completed = sum(case['status'] == 'COMPLETED_SMOKE' for case in cases)
    result = {'status': 'COMPLETED_DESCRIPTIVE_BATCH' if completed == len(cases) else 'IN_PROGRESS',
              'purpose': 'Five selected public bug-fix tasks; one trial per arm; no general winner.',
              'model': config['model'], 'cases': cases, 'rows': rows,
              'expected_trials': sum(len(case['order']) for case in config['cases']),
              'recorded_trials': len(rows), 'subscription_allowance_consumed': None}
    dump(work / 'batch-results.json', result)
    if rows:
        with (work / 'batch-results.csv').open('w') as output:
            writer = csv.DictWriter(output, fieldnames=list(rows[0]))
            writer.writeheader(); writer.writerows(rows)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'run', 'report'])
    parser.add_argument('--work', required=True, type=Path)
    args = parser.parse_args()
    work = args.work.expanduser().resolve(); work.mkdir(parents=True, exist_ok=True)
    config = json.loads(CONFIG.read_text())
    identity = hashlib.sha256(CONFIG.read_bytes()).hexdigest()
    identity_path = work / 'batch-config.sha256'
    if identity_path.exists() and identity_path.read_text().strip() != identity:
        raise ValueError('Batch configuration changed; use a fresh directory')
    identity_path.write_text(identity + '\n')
    dump(work / 'batch-config.json', config)
    if args.action == 'prepare':
        for case in config['cases']:
            case_work = work / case['id']; case_work.mkdir(exist_ok=True)
            if case.get('repetitions') != 1:
                raise ValueError('This batch explicitly supports one trial per arm')
            print('PREPARING ' + case['id'], flush=True)
            if not (case_work / 'lock.json').exists():
                prepare(case_work, config['model'], config['codex_version'], spec=case)
            if not (case_work / 'validation.json').exists():
                validate(case_work)
            if json.loads((case_work / 'validation.json').read_text())['passed'] is not True:
                raise ValueError('Validation failed: ' + case['id'])
            print('VALIDATED ' + case['id'], flush=True)
    elif args.action == 'run':
        # Every case must have a passing evaluator before any account spend.
        for case in config['cases']:
            case_work = work / case['id']
            lock = read_lock(case_work)
            record = json.loads((case_work / 'validation.json').read_text())
            if record['passed'] is not True or record['implementation_digest'] != lock['implementation_digest'] or record['task_digest'] != lock['task_digest']:
                raise ValueError('All cases must pass current validation first')
        for case in config['cases']:
            case_work = work / case['id']
            report_path = case_work / 'comparison.json'
            if report_path.exists():
                if json.loads(report_path.read_text())['status'] == 'COMPLETED_SMOKE': continue
                raise ValueError('Preserving an incomplete/charged experiment: ' + case['id'])
            print('RUNNING ' + case['id'], flush=True)
            try: run(case_work)
            finally: summarize(work, config)
            print('COMPLETED ' + case['id'], flush=True)
    result = summarize(work, config)
    print(json.dumps({'status': result['status'], 'recorded_trials': result['recorded_trials'],
                      'expected_trials': result['expected_trials']}, indent=2))


if __name__ == '__main__':
    main()
