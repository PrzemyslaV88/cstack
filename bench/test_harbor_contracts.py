"""Real pinned Harbor option validation. No container or model invocation."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys
from types import SimpleNamespace

from .lab import ARMS, CLASSES, job_config


@unittest.skipUnless(importlib.util.find_spec('harbor'), 'Pinned Harbor installation required')
class HarborContractTests(unittest.TestCase):
    def test_every_generated_job_passes_actual_agent_preflight(self):
        from harbor.models.job.config import JobConfig
        from . import harbor_agents
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            lock = {'model': 'gpt-6.1-sol', 'codex_version': '0.163.0',
                    'task_path': str(work / 'task'), 'pstack_path': str(work / 'pstack')}
            (work / 'public-contract.json').write_text(json.dumps({'criteria': []}))
            for arm in (*ARMS, 'plain-codex-multiagent', 'pstack-codex-multiagent', 'cstack-codex-multiagent', 'cstack-controlled-recovery', 'noop', 'gold'):
                with self.subTest(arm=arm):
                    config = job_config(work, lock, arm)
                    JobConfig.model_validate(config)
                    cls = getattr(harbor_agents, CLASSES[arm])
                    kwargs = config['agents'][0]['kwargs']
                    cls.preflight(kwargs)
                    cls(logs_dir=work / arm, model_name=None if arm in ('noop', 'gold') else lock['model'], **kwargs)

    def test_missing_comparison_contract_is_rejected(self):
        from .harbor_agents import CstackHarbor
        with self.assertRaisesRegex(ValueError, 'public_contract'):
            CstackHarbor.preflight({'codex_version': '0.163.0'})

    def test_unknown_options_remain_rejected(self):
        from .harbor_agents import PlainCodex
        with self.assertRaisesRegex(ValueError, 'Unknown option'):
            PlainCodex.preflight({'public_contract': '/contract', 'codex_version': '0.163.0', 'typo': True})


@unittest.skipUnless(importlib.util.find_spec('harbor'), 'Pinned Harbor installation required')
class PublicProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_combined_container_stream_preserves_json_and_warning(self):
        from .harbor_agents import Noop

        class CombinedEnvironment:
            async def exec(self, command, **kwargs):
                # The Linux task has timeout; macOS test hosts may not.
                command = command.replace('timeout 40s ', '')
                result = subprocess.run(command, shell=True, text=True,
                                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                return SimpleNamespace(return_code=result.returncode, stdout=result.stdout)

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract = root / 'contract.json'
            contract.write_text(json.dumps({'criteria': [{'id': 'PUBLIC',
                'argv': [sys.executable, '-c', 'import sys; print("diagnostic", file=sys.stderr); print("true")'],
                'cases': [{'stdin': '', 'expect_json': True}, {'stdin': '', 'expect_json': False}]}]}))
            agent = Noop(logs_dir=root / 'logs', public_contract=str(contract))
            await agent.public_probe(CombinedEnvironment())
            report = json.loads((root / 'logs/public-probe.json').read_text())
            self.assertTrue(report['rows'][0]['passed'])
            self.assertEqual(report['rows'][0]['stderr'].strip(), 'diagnostic')
            self.assertFalse(report['rows'][1]['passed'])
            self.assertFalse(report['passed'])


if __name__ == '__main__':
    unittest.main()
