import importlib.util, json, subprocess, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cstack_ci_gate',ROOT/'scripts/test-bench-ci.py');gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)
class RequiredCITests(unittest.TestCase):
    def test_CI_01_missing_harbor_fails_required_mode(self):
        result=subprocess.run([sys.executable,'-S',str(ROOT/'scripts/test-bench-ci.py'),'--require-harbor','--check-only'],text=True,capture_output=True)
        self.assertNotEqual(result.returncode,0);self.assertIn('Harbor',result.stderr)
    def test_CI_02_skip_is_failure_in_required_mode(self):
        @unittest.skip('Intentional simulated unavailable integration')
        class Missing(unittest.TestCase):
            def test_missing(self): pass
        suite=unittest.defaultTestLoader.loadTestsFromTestCase(Missing)
        with tempfile.TemporaryDirectory() as directory:
            report=Path(directory)/'report.json'
            with patch.object(sys,'argv',['gate','--fail-on-skip','--report',str(report)]),patch.object(unittest.defaultTestLoader,'discover',return_value=suite):
                self.assertEqual(gate.main(),1)
            observed=json.loads(report.read_text());self.assertFalse(observed['passed']);self.assertEqual(observed['skipped'],1)
