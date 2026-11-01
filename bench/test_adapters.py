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
            'harbor.agents.installed.codex', 'harbor.agents.options', 'harbor.models', 'harbor.models.agent', 'harbor.models.agent.context')}
        modules['harbor.agents.base'].BaseAgent = FakeBase
        modules['harbor.agents.installed.codex'].Codex = FakeCodex
        modules['harbor.agents.installed.codex'].CodexOptions = type('CodexOptions', (), {})
        modules['harbor.agents.options'].AgentOptions = type('AgentOptions', (), {})
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
    def test_multiagent_arms_enable_real_delegation(self):
        for name in ('PlainMultiAgent', 'PstackMultiAgent', 'CstackMultiAgent'):
            a = self.agent(name, **({'pstack_dir': str(self.root)} if name == 'PstackMultiAgent' else {}))
            self.assertTrue(a.kwargs['config']['features']['multi_agent'])
            self.assertEqual(a.kwargs['config']['agents']['max_concurrent_threads_per_session'], 2)
            self.assertTrue(a.kwargs['config']['features']['multi_agent_v2'])
            self.assertIn('actual spawn_agent', a.worker_instruction('One coding worker. No subagents. No push, deployment, credential access, controller access or test weakening.')
                          if name == 'CstackMultiAgent' else a.public_instruction('Fix a bug'))
            self.assertNotIn('perform delegated roles sequentially', a.public_instruction('Fix a bug'))
    def test_cstack_uses_same_model_config(self):
        self.assertEqual(self.agent().kwargs, self.agent('CstackHarbor').kwargs)
    def test_cstack_multiagent_mapping_preserves_checks_and_requires_known_policy(self):
        agent = self.agent('CstackMultiAgent')
        original = ('Objective: fix bug\nOne coding worker. No subagents. No push, deployment, credential access, controller access or test weakening.\n'
                    'PUBLIC: unchanged probe\nDo not commit, change Git HEAD, edit Codex configuration, or perform unrelated refactoring.')
        mapped = agent.worker_instruction(original)
        self.assertIn('PUBLIC: unchanged probe', mapped)
        self.assertIn('Do not commit, change Git HEAD', mapped)
        self.assertIn('Only the parent may edit /testbed', mapped)
        self.assertNotIn('No subagents', mapped)
        with self.assertRaisesRegex(RuntimeError, 'policy changed'):
            agent.worker_instruction('unrecognised prompt')
    def test_single_worker_disables_both_agent_features(self):
        config = self.agent('CstackHarbor').kwargs['config']
        self.assertFalse(config['features']['multi_agent_v2'])
        self.assertFalse(config['agents']['enabled'])
    def test_cstack_multiagent_public_goal_has_no_conflicting_agent_ban(self):
        text = self.agent('CstackMultiAgent').public_instruction('Fix the actual issue')
        self.assertIn('Fix the actual issue', text)
        self.assertIn('"criteria"', text)
        self.assertNotIn('Do not use other agents', text)
    def test_cstack_multiagent_charges_helpers_and_refuses_missing_rollouts(self):
        agent = self.agent('CstackMultiAgent')

        class NativeEnvironment:
            calls = 0
            include_children = True
            async def download_dir(env, remote, local):
                env.calls += 1; local.mkdir(parents=True)
                for tid, parent in [('root', None)] + ([('child1', 'root'), ('child2', 'root')] if env.include_children else []):
                    amount = env.calls * 10
                    rows = [
                        {'type': 'session_meta', 'payload': {'id': tid, 'parent_thread_id': parent}},
                        {'type': 'turn_context', 'payload': {'model': 'test-model', 'effort': 'medium'}},
                        {'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {
                            'input_tokens': amount, 'cached_input_tokens': 0, 'cache_write_input_tokens': 0,
                            'output_tokens': 2, 'reasoning_output_tokens': 0, 'total_tokens': amount + 2}}}},
                        {'type': 'event_msg', 'payload': {'type': 'task_complete'}}]
                    (local / (tid + '.jsonl')).write_text('\n'.join(json.dumps(r) for r in rows))

        env = NativeEnvironment(); agent.turn_attempts = 1
        first = asyncio.run(agent.controller_usage({'usage': [{'input_tokens': 1}]}, env))
        self.assertEqual(first[0]['total_tokens'], 36)
        agent.turn_attempts = 2
        second = asyncio.run(agent.controller_usage({'usage': []}, env))
        self.assertEqual(second[0]['total_tokens'], 30)
        agent.turn_attempts = 3; env.include_children = False
        with self.assertRaisesRegex(RuntimeError, 'Complete parent/helper native usage required'):
            asyncio.run(agent.controller_usage({'usage': []}, env))
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
