"""Private-grader-only replay of immutable upstream setup HTTP responses.

The task tests and SWE-bench scoring functions are unchanged. Candidate workers
never receive this module or its cache. Only /parser.py activates the adapter.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import sys

if Path(sys.argv[0]).resolve() == Path('/parser.py'):
    import requests

    cache = Path('/opt/benchmark-http-cache')
    mode = os.environ.get('BENCHMARK_HTTP_CACHE_MODE', 'replay')
    original = requests.sessions.Session.send

    def cached_send(self, request, **kwargs):
        if request.method != 'GET':
            raise RuntimeError('Private grader dependency cache permits GET only')
        key = hashlib.sha256(request.url.encode()).hexdigest()
        path = cache / (key + '.json')
        if mode == 'record':
            response = original(self, request, **kwargs)
            cache.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({'request_url': request.url, 'url': response.url,
                'status': response.status_code, 'headers': dict(response.headers),
                'encoding': response.encoding, 'body': base64.b64encode(response.content).decode()}))
            return response
        if not path.is_file():
            raise RuntimeError('Unprepared private-grader dependency URL: ' + request.url)
        value = json.loads(path.read_text())
        if value['request_url'] != request.url:
            raise RuntimeError('Private grader cache identity mismatch')
        response = requests.Response()
        response.status_code = value['status']; response.url = value['url']
        response.headers.update(value['headers']); response.encoding = value['encoding']
        response._content = base64.b64decode(value['body']); response.request = request
        return response

    requests.sessions.Session.send = cached_send
