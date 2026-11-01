"""No-network regression checks for the private grader's HTTP replay adapter."""
import json
from pathlib import Path
import runpy
import sys
import tempfile
import unittest
from unittest.mock import patch
import requests

MODULE = Path(__file__).resolve().parents[1] / 'bench/grader_offline/sitecustomize.py'

def execute_module():
    namespace = {}
    exec(compile(MODULE.read_text(), str(MODULE), 'exec'), namespace)
    return namespace

class GraderCacheTests(unittest.TestCase):
    def exercise(self, status):
        with tempfile.TemporaryDirectory() as directory:
            response = requests.Response()
            response.status_code = status
            response.url = 'https://example.invalid/commit/requirements.txt'
            response._content = b'package==1.0\n' if status == 200 else b'not found'
            response.encoding = 'utf-8'
            response.headers['Content-Type'] = 'text/plain'
            with patch.object(sys, 'argv', ['/parser.py']), patch.object(requests.sessions.Session, 'send', return_value=response) as transport:
                namespace = execute_module()
                state = namespace['cached_send'].__globals__
                state['cache'] = Path(directory)
                state['mode'] = 'record'
                recorded = requests.get(response.url)
                state['mode'] = 'replay'
                replayed = requests.get(response.url)
                self.assertEqual(replayed.status_code, status)
                self.assertEqual(replayed.content, recorded.content)
                self.assertEqual(replayed.headers, recorded.headers)
                self.assertEqual(transport.call_count, 1)
    def test_successful_response_is_replayed_without_network(self): self.exercise(200)
    def test_missing_upstream_path_preserves_404_for_fallback(self): self.exercise(404)
    def test_uncached_url_fails_without_network(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(sys, 'argv', ['/parser.py']), patch.object(requests.sessions.Session, 'send') as transport:
                namespace = execute_module()
                state = namespace['cached_send'].__globals__
                state['cache'] = Path(directory); state['mode'] = 'replay'
                with self.assertRaisesRegex(RuntimeError, 'Unprepared private-grader'):
                    requests.get('https://example.invalid/missing')
                transport.assert_not_called()
    def test_candidate_python_programs_are_unaffected(self):
        with patch.object(sys, 'argv', ['/tmp/public_probe.py']), patch.object(requests.sessions.Session, 'send') as transport:
            execute_module()
            self.assertIs(requests.sessions.Session.send, transport)

if __name__ == '__main__': unittest.main()
