#!/usr/bin/env python3
"""Required pinned integration test gate; offline mode remains explicit."""
import argparse, importlib.metadata, importlib.util, json, sys, unittest, subprocess, time
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PIN = '5eb713ff9500daced4e143b98765a7c732744a1b'
def harbor_pin():
    if importlib.util.find_spec('harbor') is None:
        raise RuntimeError('Pinned Harbor is missing; install bench/requirements.lock')
    metadata = importlib.metadata.distribution('harbor')
    direct = json.loads(metadata.read_text('direct_url.json') or '{}')
    if direct.get('vcs_info', {}).get('commit_id') != PIN:
        raise RuntimeError('Harbor installed commit differs from the frozen lock')
    return PIN
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--require-harbor', action='store_true')
    parser.add_argument('--fail-on-skip', action='store_true')
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    if args.require_harbor:
        harbor_pin()
    if args.check_only:
        return 0
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'bench'), 'test_*.py', top_level_dir=str(ROOT))
    records=[]
    class RecordedResult(unittest.TextTestResult):
        def startTest(self,test): self.started=time.monotonic();super().startTest(test)
        def record(self,test,status): records.append({'schema_version':1,'kind':'test','name':test.id(),'status':status,'duration_ms':(time.monotonic()-self.started)*1000})
        def addSuccess(self,test): super().addSuccess(test);self.record(test,'PASS')
        def addFailure(self,test,err): super().addFailure(test,err);self.record(test,'FAIL')
        def addError(self,test,err): super().addError(test,err);self.record(test,'FAIL')
        def addSkip(self,test,reason): super().addSkip(test,reason);self.record(test,'SKIP')
    result = unittest.TextTestRunner(verbosity=2,resultclass=RecordedResult).run(suite)
    report = {'schema_version': 1, 'kind': 'benchmark-tests', 'tests': result.testsRun,
              'failures': len(result.failures), 'errors': len(result.errors), 'skipped': len(result.skipped),
              'harbor_commit': PIN if args.require_harbor else None,
              'passed': result.wasSuccessful() and not (args.fail_on_skip and result.skipped)}
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + '\n')
        fingerprint=subprocess.check_output(['node',str(ROOT/'scripts/source-fingerprint.mjs')],text=True).strip()
        (args.report.parent/'benchmark-tests.jsonl').write_text('\n'.join(json.dumps(r) for r in [{'kind':'run_metadata','source_digest':fingerprint},*records])+'\n')
    return 0 if report['passed'] else 1
if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as exc:
        print('Benchmark prerequisite: ' + str(exc), file=sys.stderr)
        sys.exit(1)
