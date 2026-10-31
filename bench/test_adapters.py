"""Contract-shaped Harbor doubles. These are NOT live integration or AI results."""
from __future__ import annotations
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from .protocol import codex_events


class FakeBase:
    def __init__(self, logs_dir, model_name=None, **kwargs):
        self.logs_dir, self.model_name = logs_dir, model_name
        self.mcp_servers = []
        self.kwargs = kwargs
    def version(self): return 'fixture'


class FakeCodex(FakeBase):
    SUPPORTS_ATIF = True
    def __init__(self, *args, **kwargs):
        if not isinstance(kwargs.get('config'), dict):
            raise ValueError('Pinned Harbor expects a dict or a filename, NOT JSON text')
        super().__init__(*args, **kwargs)
        self._resume = False
    def _resolve_auth_json_path(self): return None
    async def setup(self, environment): pass
    async def exec_as_agent(self, environment, command, **kwargs):
        environment.commands.append(command)
        return types.SimpleNamespace(return_code=0, stdout='', stderr='')
    async def run(self, instruction, environment, context):
        environment.resumed.append(self._resume)
        if environment.cancel: raise asyncio.CancelledError()
    def populate_context_post_run(self, context):
        context.n_input_tokens = context.n_output_tokens = 999999


class FakeEnvironment:
    def __init__(self, cancel=False):
        self.commands, self.resumed = [], []
        self.cancel = cancel
    async def exec(self, command, **kwargs):
        self.commands.append(command)
        return types.SimpleNamespace(return_code=0, stdout='', stderr='')
    async def download_file(self, source, destination):
        destination.write_text(json.dumps({'type': 'turn.completed', 'usage': {
            'input_tokens': 10, 'cached_input_tokens': 3, 'output_tokens': 2}}))


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.contract = self.root / 'contract.json'; self.contract.write_text('{"criteria":[]}')
        modules = {name: types.ModuleType(name) for name in (
            'harbor', 'harbor.agents', 'harbor.agents.base', 'harbor.agents.installed',
            'harbor.agents.installed.codex', 'harbor.models', 'harbor.models.agent', 'harbor.models.agent.context')}
        modules['harbor.agents.base'].BaseAgent = FakeBase
        modules['harbor.agents.installed.codex'].Codex = FakeCodex
        modules['harbor.models.agent.context'].AgentContext = types.SimpleNamespace
        spec = importlib.util.spec_from_file_location('bench._fixture_adapter', Path(__file__).with_name('harbor_agents.py'))
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules): spec.loader.exec_module(self.module)
    def tearDown(self): self.tmp.cleanup()
    def agent(self, name='PlainCodex', **kwargs):
        return getattr(self.module, name)(logs_dir=self.root / 'logs', model_name='test-model',
            public_contract=str(self.contract), codex_version='0.1.0', **kwargs)
    def context(self): return types.SimpleNamespace(metadata={})
    def test_native_config_is_dict_and_forces_chatgpt(self):
        a = self.agent(); self.assertEqual(a.kwargs['config']['forced_login_method'], 'chatgpt')
        self.assertFalse(a.kwargs['config']['features']['multi_agent'])
    def test_no_api_fallback(self):
        with self.assertRaisesRegex(RuntimeError, 'API fallback refused'):
            asyncio.run(self.agent().setup(FakeEnvironment()))
    def test_pstack_label_is_honest(self):
        a = self.agent('PstackAdapted', pstack_dir=str(self.root))
        self.assertEqual(a.name(), 'pstack-adapted-single-worker')
        self.assertIn('not official multiagent pstack', a.public_instruction('Fix a bug'))
    def test_cstack_uses_same_model_config(self):
        self.assertEqual(self.agent().kwargs, self.agent('CstackHarbor').kwargs)
    def test_completed_turns_summed_once(self):
        a = self.agent(); env = FakeEnvironment()
        asyncio.run(a.turn('first', env)); asyncio.run(a.turn('repair', env))
        self.assertEqual(env.resumed, [False, True])
        context = self.context(); a.populate_context_post_run(context)
        self.assertEqual(context.n_input_tokens, 20); self.assertEqual(context.n_output_tokens, 4)
        self.assertEqual(context.n_cache_tokens, 6)
    def test_missing_one_turn_prevents_complete_usage(self):
        a = self.agent(); a.turn_attempts = 2
        a.turns = [codex_events('{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}')]
        context = self.context(); a._context(context)
        self.assertFalse(context.metadata['comparison']['usage_complete'])
    def test_cancelled_turn_not_counted_as_complete(self):
        a = self.agent()
        with self.assertRaises(asyncio.CancelledError): asyncio.run(a.turn('interrupted', FakeEnvironment(cancel=True)))
        self.assertEqual(a.turn_attempts, 1); self.assertFalse(a.turns[0]['usage_complete'])
    def test_pipeline_gets_group_deadline(self):
        a = self.agent(); env = FakeEnvironment()
        asyncio.run(a.exec_as_agent(env, 'codex exec --json -- prompt | tee output'))
        self.assertIn('timeout --signal=TERM --kill-after=2s', env.commands[0])
        self.assertIn('bash -o pipefail', env.commands[0])


if __name__ == '__main__': unittest.main()
