"""Offline protocol tests. No model calls; none of these are contestant scores."""
from __future__ import annotations
import importlib
import io
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch
from . import lab
from .protocol import (archive_candidate, blocked_report, codex_events, digest_tree,
    execution_order, extract_candidate, result_row, seconds, synchronize_candidate)


class TempTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()


class ProtocolTests(TempTest):
    def test_known_stdin_status_does_not_hide_usage(self):
        result = codex_events('Reading additional input from stdin...\n' + self.event({'input_tokens': 10, 'output_tokens': 2}))
        self.assertTrue(result['usage_complete'])
    def test_duplicate_completion_is_not_complete_usage(self):
        event = self.event({'input_tokens': 10, 'output_tokens': 2})
        self.assertFalse(codex_events(event + '\n' + event)['usage_complete'])
    def event(self, usage):
        return json.dumps({'type': 'turn.completed', 'usage': usage})
    def test_empty_usage_unknown(self):
        p = codex_events('')
        self.assertIsNone(p['totals']['input_tokens']); self.assertFalse(p['usage_complete'])
    def test_legitimate_zero_tokens(self):
        p = codex_events(self.event({'input_tokens': 0, 'output_tokens': 0}))
        self.assertTrue(p['usage_complete']); self.assertEqual(p['totals']['input_tokens'], 0)
    def test_cache_is_subset(self):
        p = codex_events(self.event({'input_tokens': 100, 'cached_input_tokens': 60, 'output_tokens': 20}))
        self.assertEqual(p['totals']['input_tokens'] + p['totals']['output_tokens'], 120)
    def test_missing_cache_is_unknown(self):
        p = codex_events(self.event({'input_tokens': 100, 'output_tokens': 20}))
        self.assertIsNone(p['totals']['cached_input_tokens'])
    def test_negative_counter_not_trusted(self):
        self.assertFalse(codex_events(self.event({'input_tokens': -1, 'output_tokens': 2}))['usage_complete'])
    def test_boolean_not_token_count(self):
        self.assertFalse(codex_events(self.event({'input_tokens': True, 'output_tokens': 2}))['usage_complete'])
    def test_quota_in_message_not_error(self):
        p = codex_events(json.dumps({'type': 'item.completed', 'item': {'type': 'agent_message', 'text': 'Fixed the quota code'}}))
        self.assertFalse(p['quota'])
    def test_structured_quota(self):
        self.assertTrue(codex_events(json.dumps({'type': 'turn.failed', 'error': {'code': 'insufficient_quota'}}))['quota'])
    def test_malformed_log_cannot_claim_full_telemetry(self):
        p = codex_events('bad\n' + self.event({'input_tokens': 1, 'output_tokens': 1}))
        self.assertFalse(p['usage_complete'])
    def test_warning_does_not_invent_worker_failure(self):
        p = codex_events('runtime warning\n' + self.event({'input_tokens': 1, 'output_tokens': 1}))
        self.assertTrue(p['complete']); self.assertFalse(p['usage_complete'])
    def test_failed_turn_after_complete_remains_failed(self):
        p = codex_events(self.event({'input_tokens': 1, 'output_tokens': 1}) + '\n' + json.dumps({'type': 'turn.failed'}))
        self.assertFalse(p['complete'])
    def test_missing_final_usage_partial(self):
        p = codex_events('{"type":"thread.started","thread_id":"a"}')
        self.assertFalse(p['usage_complete'])
    def test_blocked_is_not_zero_success(self):
        b = blocked_report(['missing auth'])
        self.assertEqual(b['live_agent_runs'], 0)
        self.assertTrue(all(x['verified'] is None for x in b['arms']))
    def test_seed_reproducible_all_arms(self):
        self.assertEqual(execution_order(7), execution_order(7))
        self.assertEqual(set(execution_order(7)), set(lab.ARMS))
    def test_final_grader_is_authority(self):
        row = result_row({'verifier_result': {'rewards': {'reward': 0}},
            'agent_result': {'metadata': {'controller_status': 'VERIFIED'}}}, 'cstack-harbor')
        self.assertEqual(row['status'], 'NOT_RESOLVED')
    def test_missing_reward_is_ungradable(self):
        self.assertEqual(result_row({}, 'a')['status'], 'UNGRADABLE')
    def test_nan_reward_is_ungradable(self):
        self.assertEqual(result_row({'verifier_result': {'rewards': {'reward': float('nan')}}}, 'a')['status'], 'UNGRADABLE')
    def test_failure_keeps_usage(self):
        row = result_row({'verifier_result': {'rewards': {'reward': 0}}, 'agent_result': {
            'n_input_tokens': 100, 'n_cache_tokens': 50, 'n_output_tokens': 20,
            'metadata': {'comparison': {'usage_complete': True}}}}, 'a')
        self.assertEqual(row['total_tokens'], 120)
    def test_partial_usage_not_full_cost(self):
        row = result_row({'agent_result': {'n_input_tokens': 100, 'n_output_tokens': 20}}, 'a')
        self.assertIsNone(row['total_tokens'])
    def test_timeout_not_hidden_in_aggregate(self):
        row = result_row({'exception_info': {'exception_type': 'AgentTimeoutError'}}, 'a')
        self.assertEqual(row['status'], 'TIMEOUT')
    def test_time_phases_separate(self):
        row = result_row({'agent_execution': {'started_at': '2026-01-01T00:00:00Z', 'finished_at': '2026-01-01T00:00:05Z'}}, 'a')
        self.assertEqual(row['agent_seconds'], 5); self.assertIsNone(row['setup_seconds'])


class ArchiveTests(TempTest):
    def archive(self, names):
        path = self.root / 'input.tar'
        with tarfile.open(path, 'w') as tar:
            for name, kind in names:
                item = tarfile.TarInfo(name); item.type = kind
                if kind == tarfile.REGTYPE:
                    item.size = 1; tar.addfile(item, io.BytesIO(b'x'))
                else:
                    item.linkname = '/etc/passwd'; tar.addfile(item)
        return path
    def test_traversal(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('../outside', tarfile.REGTYPE)]), self.root / 'out')
    def test_absolute(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('/tmp/outside', tarfile.REGTYPE)]), self.root / 'out')
    def test_symlink(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('link', tarfile.SYMTYPE)]), self.root / 'out')
    def test_hardlink(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('link', tarfile.LNKTYPE)]), self.root / 'out')
    def test_duplicate(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('x', tarfile.REGTYPE)] * 2), self.root / 'out')
    def test_git_metadata(self):
        with self.assertRaises(ValueError): extract_candidate(self.archive([('.git/hooks/post-checkout', tarfile.REGTYPE)]), self.root / 'out')
    def test_roundtrip_digest_and_modes(self):
        src = self.root / 'src'; src.mkdir(); (src / 'file').write_text('hello'); (src / 'file').chmod(0o755)
        archive_candidate(src, self.root / 'out.tar'); extract_candidate(self.root / 'out.tar', self.root / 'restored')
        self.assertEqual(digest_tree(src), digest_tree(self.root / 'restored'))
    def test_content_mutation_changes_identity(self):
        src = self.root / 'src'; src.mkdir(); p = src / '.ignored'; p.write_text('a'); a = digest_tree(src); p.write_text('b')
        self.assertNotEqual(a, digest_tree(src))
    def test_modes_change_identity(self):
        src = self.root / 'src'; src.mkdir(); p = src / 'a'; p.write_text('a'); p.chmod(0o644); a = digest_tree(src); p.chmod(0o755)
        self.assertNotEqual(a, digest_tree(src))
    def test_sync_refuses_outside_root(self):
        source = self.root / 'src'; source.mkdir(); target = self.root / 'other'; target.mkdir()
        with self.assertRaises(ValueError): synchronize_candidate(source, target, self.root / 'allowed')
    def test_sync_keeps_git(self):
        source = self.root / 'src'; source.mkdir(); (source / 'new').write_text('new')
        target = self.root / 'allowed/w1'; target.mkdir(parents=True); (target / '.git').write_text('preserve'); (target / 'old').write_text('old')
        synchronize_candidate(source, target, self.root / 'allowed')
        self.assertEqual((target / '.git').read_text(), 'preserve'); self.assertFalse((target / 'old').exists())


class RunnerTests(TempTest):
    def test_existing_results_are_preserved_before_preflight(self):
        result = {'status': 'COMPLETED_SMOKE', 'rows': [{'independent_reward': 1}]}
        (self.root / 'comparison.json').write_text(json.dumps(result))
        with patch.object(lab, 'doctor') as doctor:
            with self.assertRaisesRegex(ValueError, 'already has a run record'): lab.run(self.root)
            doctor.assert_not_called()
        self.assertEqual(json.loads((self.root / 'comparison.json').read_text()), result)
    def test_five_arm_settings_are_applied(self):
        lock = {'model': 'gpt-6.1-sol', 'codex_version': '0.163.0', 'task_path': '/task', 'pstack_path': '/pstack',
                'settings': {'max_seconds_per_arm': 7, 'reasoning': 'high'}}
        for arm in (*lab.ARMS, 'plain-codex-multiagent', 'pstack-codex-multiagent'):
            cfg = lab.job_config(self.root, lock, arm)
            self.assertEqual(cfg['agents'][0]['override_timeout_sec'], 7)
            self.assertEqual(cfg['agents'][0]['kwargs']['trial_seconds'], 7)
            self.assertEqual(cfg['agents'][0]['kwargs']['reasoning_effort'], 'high')
    def test_upstream_dockerfile_uses_reviewed_task_image(self):
        environment = self.root / 'environment'; environment.mkdir()
        image = 'swebench/sweb.eval.x86_64.sympy_1776_sympy-20590:latest'
        (environment / 'Dockerfile').write_text('# FROM unrelated\nFROM ' + image + '\nWORKDIR /testbed\n')
        self.assertEqual(lab.task_image(self.root, None), image)
        (environment / 'Dockerfile').write_text('FROM unrelated:latest\n')
        with self.assertRaisesRegex(ValueError, 'Unsupported upstream Dockerfile'):
            lab.task_image(self.root, None)
    def test_configured_image_needs_no_recipe_inference(self):
        self.assertEqual(lab.task_image(self.root, 'sha256:explicit'), 'sha256:explicit')
    def test_credentials_not_forwarded(self):
        with patch.dict(os.environ, {'OPENAI_API_KEY': 'CANARY', 'ANTHROPIC_API_KEY': 'CANARY', 'NODE_OPTIONS': 'bad', 'DOCKER_DEFAULT_PLATFORM': 'linux/amd64'}):
            env = lab.child_env()
        self.assertNotIn('OPENAI_API_KEY', env); self.assertNotIn('NODE_OPTIONS', env)
        self.assertNotIn('DOCKER_DEFAULT_PLATFORM', env)
    def test_all_arms_equal_time_model_and_no_retries(self):
        lock = {'model': 'test-model', 'codex_version': '0.1.0', 'task_path': '/task', 'pstack_path': '/pstack'}
        for arm in lab.ARMS:
            cfg = lab.job_config(self.root, lock, arm)
            self.assertEqual(cfg['agents'][0]['override_timeout_sec'], 1800)
            self.assertEqual(cfg['agents'][0]['model_name'], 'test-model')
            self.assertEqual(cfg['retry']['max_retries'], 0)
            self.assertNotIn('solution_dir', cfg['agents'][0]['kwargs'])
    def test_gold_no_model(self):
        cfg = lab.job_config(self.root, {'task_path': '/task'}, 'gold')
        self.assertNotIn('model_name', cfg['agents'][0])
    def test_run_stops_before_models_when_blocked(self):
        with patch.object(lab, 'doctor', return_value=blocked_report(['auth missing'])), patch.object(lab, 'execute_job') as execute:
            with self.assertRaises(RuntimeError): lab.run(self.root)
            execute.assert_not_called()
        self.assertEqual(json.loads((self.root / 'comparison.json').read_text())['live_agent_runs'], 0)
    def test_invalid_model_rejected_before_setup(self):
        with self.assertRaises(ValueError): lab.prepare(self.root, 'model; rm -rf /', '0.1.0')
    def test_unpinned_cli_rejected(self):
        with self.assertRaises(ValueError): lab.prepare(self.root, 'test-model', 'latest')
    def test_no_model_gate_required(self):
        lock = {'implementation_digest': 'a', 'task_digest': 'b'}
        (self.root / 'validation.json').write_text('{"passed":false}')
        with patch.object(lab, 'doctor', return_value={'blockers': []}), patch.object(lab, 'read_lock', return_value=lock), patch.object(lab, 'execute_job') as execute:
            with self.assertRaises(ValueError): lab.run(self.root)
            execute.assert_not_called()
    def test_trial_reader_ignores_job_aggregate(self):
        (self.root / 'result.json').write_text('{"stats":{}}')
        trial = self.root / 'trial'; trial.mkdir(); (trial / 'result.json').write_text('{"task_name":"x","agent_info":{}}')
        self.assertEqual(lab.find_trial(self.root)[0], trial / 'result.json')


class BridgeTests(TempTest):
    """Real controller + real Linux verifier, scripted worker. Not AI performance."""
    def exercise(self, fix: bool):
        repo = self.root / 'repo'; repo.mkdir()
        (repo / 'calc.mjs').write_text('export const add=(a,b)=>a-b;\n')
        for args in (['init', '-q'], ['config', 'user.name', 'Test'], ['config', 'user.email', 'test@example.invalid'], ['add', '.'], ['commit', '-qm', 'baseline']):
            subprocess.run(['git', '-C', str(repo), *args], check=True, capture_output=True)
        backend = os.environ.get('CSTACK_TEST_RUNNER', 'linux' if sys.platform == 'linux' else 'docker')
        contract = {'type': 'FIX', 'goal': 'Fix addition in the fixture', 'attempt_limit': 1,
            'runner': {'backend': backend, **({'image': os.environ.get('CSTACK_TEST_IMAGE', 'node:22.16.0-bookworm-slim')} if backend == 'docker' else {})}, 'criteria': [{'id': 'ADD', 'kind': 'probe', 'text': 'Addition works',
            'argv': ['node', '--input-type=module', '-e', "import {add} from './calc.mjs'; console.log(JSON.stringify(add(2,3)))"],
            'cases': [{'stdin': '', 'expect_json': 5}]}]}
        proc = subprocess.Popen(['node', str(lab.ROOT / 'bench/cstack_bridge.mjs')], stdin=subprocess.PIPE,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        selector = selectors.DefaultSelector(); selector.register(proc.stdout, selectors.EVENT_READ)
        def read():
            if not selector.select(20):
                proc.kill(); raise AssertionError('Bridge timed out')
            line = proc.stdout.readline()
            if not line: raise AssertionError(proc.stderr.read())
            return json.loads(line)
        def send(value): proc.stdin.write(json.dumps(value) + '\n'); proc.stdin.flush()
        try:
            send({'op': 'start', 'repo': str(repo), 'home': str(self.root / 'home'), 'contract': contract})
            worker = read(); self.assertEqual(worker['op'], 'worker')
            if fix: (Path(worker['worktree']) / 'calc.mjs').write_text('export const add=(a,b)=>a+b;\n')
            send({'op': 'worker_result', 'id': worker['id'], 'result': {'code': 0, 'usage': []}})
            end = read(); self.assertEqual(end['op'], 'finished')
            self.assertEqual(proc.wait(timeout=10), 0)
            self.assertEqual((repo / 'calc.mjs').read_text(), 'export const add=(a,b)=>a-b;\n')
            return end
        finally:
            if proc.poll() is None: proc.kill(); proc.wait()
            selector.close(); proc.stdin.close(); proc.stdout.close(); proc.stderr.close()
    def test_actual_controller_accepts_verified_fixture(self):
        self.assertEqual(self.exercise(True)['status'], 'VERIFIED')
    def test_actual_controller_does_not_accept_a_claim(self):
        self.assertNotEqual(self.exercise(False)['status'], 'VERIFIED')


if __name__ == '__main__': unittest.main()
