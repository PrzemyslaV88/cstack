"""Bounded, opt-in Harbor pilot. `doctor` never reads auth contents or calls a model.

prepare: download/pin upstream tasks and provision Docker images (no model).
validate: original bug must fail, known repair must pass (no model).
run: explicit allowance-consuming, sequential three-arm comparison.
"""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from .protocol import ARMS, blocked_report, digest_tree, dump, execution_order, result_row

ROOT = Path(__file__).resolve().parents[1]
PILOT = json.loads((ROOT / 'bench/pilot.json').read_text())
UV_WHEEL = 'uv-0.7.13-py3-none-manylinux_2_17_x86_64.manylinux2014_x86_64.whl'
UV_WHEEL_URL = 'https://files.pythonhosted.org/packages/d8/ef/f2e96cec5e4cf65d7fde89b5dcf9540ddacf42e8e39de2fa0332614e55a8/' + UV_WHEEL
UV_WHEEL_SHA256 = '5786a29e286f2cc3cbda13a357fd9a4dd5bf1d7448a9d3d842b26b4f784a3a86'
CLASSES = {'plain-codex': 'PlainCodex', 'pstack-adapted-single-worker': 'PstackAdapted',
           'cstack-harbor': 'CstackHarbor', 'plain-codex-multiagent': 'PlainMultiAgent',
           'pstack-codex-multiagent': 'PstackMultiAgent', 'cstack-controlled-recovery': 'ControlledRecoveryCstack',
           'cstack-codex-multiagent': 'CstackMultiAgent',
           'noop': 'Noop', 'gold': 'Gold'}
TOKEN_KEYS = ('OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_BASE_URL',
              'OPENAI_API_BASE', 'CODEX_API_KEY', 'NODE_OPTIONS', 'BASH_ENV', 'ENV')


def child_env(auth: bool = False) -> dict[str, str]:
    # Start with an allowlist, not os.environ.copy(): no cloud/API credentials.
    keys = ('PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONTEXT',
            'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'XDG_RUNTIME_DIR', 'SSH_AUTH_SOCK', 'SSL_CERT_FILE')
    env = {k: os.environ[k] for k in keys if k in os.environ}
    # Task images/builds explicitly use amd64. Let Harbor's networking sidecar
    # use the daemon's native architecture on Apple Silicon.
    env['PYTHONPATH'] = str(ROOT)
    if auth:
        env['CODEX_AUTH_JSON_PATH'] = str(auth_path())
        env['CODEX_FORCE_AUTH_JSON'] = 'true'
    return env


def auth_path() -> Path:
    return Path(os.environ.get('CODEX_AUTH_JSON_PATH', str(Path.home() / '.codex/auth.json'))).expanduser().resolve()


def command(argv: list[str], *, timeout=120, auth=False, cwd=ROOT) -> str:
    result = subprocess.run(argv, cwd=cwd, env=child_env(auth), text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} failed ({result.returncode}): {result.stderr[-2000:]}\n{result.stdout[-2000:]}')
    return result.stdout.strip()


def grader_dockerfile(build_base: str, python_bin: str) -> str:
    wheel = '/tmp/' + UV_WHEEL
    return (
        f'FROM {build_base}\nUSER root\nCOPY tests /tests\nCOPY build-requirements.txt /build-requirements.txt\n'
        'COPY grader_offline /opt/benchmark-grader\n'
        f'RUN curl -fsSL {UV_WHEEL_URL} -o {wheel} && '
        f'echo "{UV_WHEEL_SHA256}  {wheel}" | sha256sum -c - && '
        f'{python_bin} -m pip install --no-index --no-deps {wheel} && rm -f {wheel}\n'
        f'RUN {python_bin} -m pip download --dest /opt/benchmark-wheels -r /build-requirements.txt\n'
        'RUN chmod +x /tests/test.sh && mkdir -p /logs/verifier\n'
        'ENV PYTHONPATH=/opt/benchmark-grader BENCHMARK_HTTP_CACHE_MODE=record\n'
        'RUN bash /tests/upstream-test.sh; test "$(cat /logs/verifier/reward.txt)" = 0 && test -s /logs/verifier/report.json\n'
        'ENV UV_OFFLINE=1 PIP_NO_INDEX=1 PIP_FIND_LINKS=/opt/benchmark-wheels UV_PYTHON_DOWNLOADS=never BENCHMARK_HTTP_CACHE_MODE=replay\n'
        'RUN rm -f /logs/verifier/reward.txt /logs/verifier/report.json\n')


def doctor() -> dict:
    blockers, checks = [], {}
    for name in ('git', 'node', 'docker', 'harbor', 'codex'):
        checks[name] = bool(shutil.which(name))
        if not checks[name]: blockers.append(f'{name}: executable not installed')
    checks['saved_chatgpt_auth_present'] = auth_path().is_file()
    if not checks['saved_chatgpt_auth_present']:
        blockers.append('Codex: saved ChatGPT authentication unavailable; no API fallback')
    if checks['node']:
        try:
            version = command(['node', '--version'], timeout=10)
            checks['node_version'] = version
            if tuple(map(int, version.lstrip('v').split('.')[:2])) < (22, 13):
                blockers.append('Node 22.13 or newer required by cStack')
        except Exception as exc:
            blockers.append(str(exc))
    if checks['docker']:
        try:
            checks['docker_server'] = command(['docker', 'info', '--format', '{{.ServerVersion}}'], timeout=15)
        except Exception:
            blockers.append('Docker engine unavailable to this process')
        for plugin, argv in (('compose', ['docker', 'compose', 'version', '--short']),
                             ('buildx', ['docker', 'buildx', 'version'])):
            try:
                checks['docker_' + plugin] = command(argv, timeout=15)
            except Exception:
                blockers.append('Docker ' + plugin + ' plugin unavailable')
    if checks['harbor']:
        try:
            dist = importlib.metadata.distribution('harbor')
            checks['harbor_version'] = dist.version
            provenance = json.loads(dist.read_text('direct_url.json') or '{}')
            pin = provenance.get('vcs_info', {}).get('commit_id')
            checks['harbor_commit'] = pin
            if pin != PILOT['harbor_commit']:
                blockers.append('Harbor is not installed from the pinned Git commit')
        except Exception:
            blockers.append('Pinned Harbor is not importable in this Python environment')
    if checks['codex'] and checks['saved_chatgpt_auth_present']:
        try:
            login = subprocess.run(['codex', '-c', 'forced_login_method="chatgpt"', 'login', 'status'],
                                   env=child_env(True), capture_output=True, text=True, timeout=15)
            checks['confirmed_chatgpt_login'] = login.returncode == 0 and 'chatgpt' in (login.stdout + login.stderr).lower()
            if not checks['confirmed_chatgpt_login']:
                blockers.append('Codex login is not confirmed as ChatGPT')
        except Exception:
            blockers.append('Codex login status check failed')
    checks['api_credentials_forwarded'] = False
    return {**blocked_report(blockers), 'status': 'BLOCKED' if blockers else 'READY_FOR_PREPARATION',
            'checked_at': datetime.now(timezone.utc).isoformat(), 'checks': checks}


def implementation_digest() -> str:
    digest = hashlib.sha256()
    for folder in ('src', 'bench'):
        for path in sorted((ROOT / folder).rglob('*')):
            if path.is_file() and not path.name.startswith('._') and '__pycache__' not in path.parts and path.suffix in ('.mjs', '.py', '.json', '.sh'):
                digest.update(str(path.relative_to(ROOT)).encode() + b'\0' + path.read_bytes())
    return digest.hexdigest()


def image_id(image: str) -> str:
    value = command(['docker', 'image', 'inspect', '--format', '{{.Id}}', image], timeout=20)
    if not re.fullmatch(r'sha256:[a-f0-9]{64}', value): raise ValueError('Unpinned image identity')
    return value


def task_image(task: Path, configured: str | None) -> str:
    if configured:
        return configured
    # This registry task declares its prebuilt image in the upstream Dockerfile.
    # Only the reviewed SymPy smoke recipe is supported; never invent a base.
    recipe = (task / 'environment/Dockerfile').read_text()
    images = re.findall(r'^FROM\s+(\S+)\s*$', recipe, re.MULTILINE)
    expected = 'swebench/sweb.eval.x86_64.sympy_1776_sympy-20590:latest'
    if images != [expected]:
        raise ValueError('Unsupported upstream Dockerfile; review the prebuilt task image first')
    return images[0]


def read_lock(work: Path) -> dict:
    lock = json.loads((work / 'lock.json').read_text())
    for name in ('task', 'pstack'):
        if digest_tree(Path(lock[name + '_path'])) != lock[name + '_digest']:
            raise ValueError(f'{name} changed after preparation; reprepare and validate')
    if implementation_digest() != lock['implementation_digest']:
        raise ValueError('Harness code changed after preparation')
    for name in ('worker_image', 'grader_image', 'public_image'):
        if image_id(lock[name]) != lock[name]: raise ValueError('Image changed')
    return lock


def prepare(work: Path, model: str, codex_version: str, spec: dict | None = None) -> None:
    settings = {**PILOT, **(spec or {})}
    if not re.fullmatch(r'(?:openai/)?[a-zA-Z0-9._-]+', model):
        raise ValueError('Use an explicit OpenAI model identifier')
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:[-.][A-Za-z0-9.-]+)?', codex_version):
        raise ValueError('Supply the concrete Codex CLI version, not latest')
    preflight = doctor()
    dump(work / 'preflight.json', preflight)
    # Preparation does not need auth; those gates are enforced before run.
    setup_blockers = [b for b in preflight['blockers'] if not b.startswith(('Codex:', 'codex:', 'Codex login'))]
    if setup_blockers: raise RuntimeError('; '.join(setup_blockers))
    if (work / 'lock.json').exists(): raise ValueError('Use a new directory; never replace a prepared experiment')
    download = work / 'upstream'
    command(['harbor', 'tasks', 'download', settings['task'] + '@' + settings['task_ref'],
             '--output-dir', str(download)], timeout=300)
    matches = list(download.rglob('task.toml'))
    if len(matches) != 1: raise ValueError('Expected exactly one upstream task')
    task_source = matches[0].parent
    original_digest = digest_tree(task_source)
    task = work / 'task'
    shutil.copytree(task_source, task)
    from harbor.models.task.config import TaskConfig
    config = TaskConfig.model_validate_toml((task / 'task.toml').read_text())
    if config.steps: raise ValueError('Pilot supports only a single-step task')
    if not (task / 'tests/test.sh').is_file() or not (task / 'solution/solve.sh').is_file():
        raise ValueError('Expected upstream verifier and known repair are missing')
    upstream_image = task_image(task, config.environment.docker_image or settings.get('image'))
    command(['docker', 'pull', '--platform', 'linux/amd64', upstream_image], timeout=900)
    public_image = image_id(upstream_image)
    build_base = command(['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', upstream_image], timeout=20)
    if not re.fullmatch(r'[A-Za-z0-9._/:-]+@sha256:[a-f0-9]{64}', build_base):
        raise ValueError('An immutable upstream repository digest is required')
    python_bin = settings.get('python_bin', '/opt/miniconda3/envs/testbed/bin/python')
    command(['docker', 'run', '--rm', '--network=none', public_image,
             python_bin, '--version'], timeout=60)
    project_toml = command(['docker', 'run', '--rm', '--network=none', public_image,
        python_bin, '-c', 'from pathlib import Path; p=Path("/testbed/pyproject.toml"); print(p.read_text() if p.exists() else "")'], timeout=30)
    build_requirements = list(dict.fromkeys(['setuptools', 'wheel'] +
        tomllib.loads(project_toml).get('build-system', {}).get('requires', [])))

    pstack_checkout = work / 'pstack-upstream'
    command(['git', 'clone', '--filter=blob:none', '--no-checkout', 'https://github.com/cursor/plugins.git', str(pstack_checkout)], timeout=300)
    command(['git', '-C', str(pstack_checkout), 'checkout', '--detach', settings['pstack_commit']], timeout=120)
    if command(['git', '-C', str(pstack_checkout), 'rev-parse', 'HEAD']) != settings['pstack_commit']:
        raise ValueError('Pstack pin mismatch')
    pstack = pstack_checkout / 'pstack'
    if not (pstack / 'skills/poteto-mode/SKILL.md').is_file(): raise ValueError('Pstack skill missing')
    if settings.get('codex_pstack_mapping'):
        compat = ROOT / 'bench/compat'
        shutil.copy2(compat / 'codex-tools.md', pstack / 'skills/poteto-mode/references/codex-tools.md')
        shutil.copy2(compat / 'pstack-models.md', pstack / 'pstack-models.md')
    toolchain_tag = 'node:22.16.0-bookworm-slim'
    command(['docker', 'pull', '--platform', 'linux/amd64', toolchain_tag], timeout=300)
    toolchain = command(['docker', 'image', 'inspect', '--format', '{{index .RepoDigests 0}}', toolchain_tag], timeout=20)
    if not re.fullmatch(r'[A-Za-z0-9._/:-]+@sha256:[a-f0-9]{64}', toolchain):
        raise ValueError('Pinned Node toolchain image required')
    context = work / 'worker-build'
    context.mkdir()
    # Keep the task's existing test tooling; add only a pinned coding executable.
    (context / 'Dockerfile').write_text(
        f'FROM {toolchain} AS toolchain\n'
        f'RUN npm install -g @openai/codex@{codex_version}\n'
        f'FROM {build_base}\nUSER root\n'
        'COPY --from=toolchain /usr/local/bin/node /usr/local/bin/node\n'
        'COPY --from=toolchain /usr/local/lib/node_modules /usr/local/lib/node_modules\n'
        'RUN ln -sf /usr/local/lib/node_modules/@openai/codex/bin/codex.js /usr/local/bin/codex\n'
        'RUN command -v timeout && codex --version && test ! -e /tests && test ! -e /solution\n'
        'WORKDIR /testbed\n'
        # Remove object history/refs so neither arm can inspect an answer revision.
        'RUN rm -rf /testbed/.git && git init -q && git config user.name Benchmark && '
        'git config user.email benchmark@example.invalid && git add . && git commit -qm baseline\n')
    worker_tag = 'cstack-bench-worker:' + original_digest[:12]
    command(['docker', 'build', '--platform', 'linux/amd64', '-t', worker_tag, str(context)], timeout=900)
    worker_image = image_id(worker_tag)
    # Grader has original Git history/tests. Worker receives neither grader image nor tests.
    grader = work / 'grader-build'
    shutil.copytree(task / 'tests', grader / 'tests')
    shutil.copytree(ROOT / 'bench/grader_offline', grader / 'grader_offline', ignore=shutil.ignore_patterns('__pycache__', '._*'))
    (grader / 'build-requirements.txt').write_text('\n'.join(build_requirements) + '\n')
    (grader / 'tests/test.sh').rename(grader / 'tests/upstream-test.sh')
    shutil.copy2(ROOT / 'bench/protocol.py', grader / 'tests/bench_protocol.py')
    (grader / 'tests/restore.py').write_text(
        "from pathlib import Path\nimport shutil\nfrom bench_protocol import extract_candidate\n"
        "root=Path('/testbed')\nnew=Path('/tmp/benchmark-restored')\n"
        "extract_candidate(Path('/logs/artifacts/candidate.tar'),new)\n"
        "for p in root.iterdir():\n"
        " if p.name == '.git': continue\n"
        " if p.is_dir() and not p.is_symlink(): shutil.rmtree(p)\n"
        " else: p.unlink()\n"
        "for p in new.iterdir(): shutil.move(str(p),str(root/p.name))\n")
    (grader / 'tests/test.sh').write_text(
        '#!/bin/bash\nset -euo pipefail\n'
        'python3 /tests/restore.py\ncd /testbed\n'
        'git config core.hooksPath /dev/null\n'
        'exec bash /tests/upstream-test.sh\n')
    # Install the reviewed uv wheel only after verifying its repository-pinned
    # digest, then warm the remaining dependencies before network is disabled.
    (grader / 'Dockerfile').write_text(grader_dockerfile(build_base, python_bin))
    grader_tag = 'cstack-bench-grader:' + original_digest[:12]
    command(['docker', 'build', '--platform', 'linux/amd64', '-t', grader_tag, str(grader)], timeout=900)
    grader_image = image_id(grader_tag)
    data = config.model_dump(mode='json', exclude_none=True)
    data['environment']['docker_image'] = worker_image
    data['environment']['network_mode'] = 'public'  # setup only; agent policy overrides it
    data['environment'].pop('allow_internet', None)
    data['environment'].pop('allowed_hosts', None)
    data['verifier'].pop('allowed_hosts', None)
    data['agent'].update({'timeout_sec': settings['max_seconds_per_arm'], 'network_mode': 'allowlist',
        'allowed_hosts': ['chatgpt.com', 'auth.openai.com', 'api.openai.com']})
    data['verifier'].update({'environment_mode': 'separate', 'network_mode': 'no-network',
        'timeout_sec': 600, 'collect': [], 'environment': {'docker_image': grader_image, 'network_mode': 'no-network'}})
    data['artifacts'] = []  # Harbor always transfers /logs/artifacts; no source/test/control mounts.
    (task / 'task.toml').write_text(TaskConfig.model_validate(data).model_dump_toml())
    contract = {'schema_version': 2, 'type': 'FIX', 'goal': settings.get('goal', 'Restore documented Symbol slot behavior'),
        'attempt_limit': 3, 'runner': {'backend': 'docker', 'image': public_image},
        'budget': {'max_attempts': 3, 'max_active_ms': 1_795_000, 'worker_timeout_ms': 600_000,
                   'max_observed_tokens': 500_000}, 'reasoning': 'medium',
        'criteria': [{'id': 'SLOTS', 'kind': 'probe', 'text': 'A Symbol instance has no __dict__',
          'argv': [python_bin, '-c', 'import sys,json; from sympy import Symbol; print(json.dumps(hasattr(Symbol(json.load(sys.stdin)), "__dict__")))'],
          'cases': [{'stdin': '"s"', 'expect_json': False}, {'stdin': '"z"', 'expect_json': False}]}]}
    if settings.get('criteria'):
        contract['criteria'] = settings['criteria']
    if settings.get('approved_test_fixtures'):
        contract['approved_test_fixtures'] = settings['approved_test_fixtures']
    contract['reasoning'] = settings['reasoning']
    contract['budget']['max_active_ms'] = settings['max_seconds_per_arm'] * 1000 - 5000
    contract['budget']['worker_timeout_ms'] = min(600_000, contract['budget']['max_active_ms'])
    dump(work / 'public-contract.json', contract)
    lock = {'schema_version': 1, 'model': model, 'codex_version': codex_version,
        'harbor_commit': PILOT['harbor_commit'], 'pstack_commit': PILOT['pstack_commit'],
        'upstream_task_digest': original_digest, 'task_path': str(task), 'task_digest': digest_tree(task),
        'pstack_path': str(pstack), 'pstack_digest': digest_tree(pstack),
        'worker_image': worker_image, 'grader_image': grader_image, 'public_image': public_image, 'node_toolchain': toolchain,
        'contract_digest': hashlib.sha256((work / 'public-contract.json').read_bytes()).hexdigest(),
        'implementation_digest': implementation_digest(), 'settings': settings,
        'order': settings.get('order') or execution_order(settings['seed']),
        'host_python': sys.version, 'host_node': command(['node', '--version']),
        'dependency_lock_sha256': hashlib.sha256((ROOT / 'bench/requirements.lock').read_bytes()).hexdigest()}
    dump(work / 'lock.json', lock)


def job_config(work: Path, lock: dict, arm: str) -> dict:
    gate = arm in ('noop', 'gold')
    settings = lock.get('settings', PILOT)
    kwargs = {'public_contract': str(work / 'public-contract.json')}
    if not gate: kwargs['codex_version'] = lock['codex_version']
    if arm in ('pstack-adapted-single-worker', 'pstack-codex-multiagent'): kwargs['pstack_dir'] = lock['pstack_path']
    if arm == 'gold': kwargs['solution_dir'] = str(Path(lock['task_path']) / 'solution')
    if not gate:
        kwargs.update({'trial_seconds': settings['max_seconds_per_arm'], 'reasoning_effort': settings['reasoning']})
    agent = {'import_path': 'bench.harbor_agents:' + CLASSES[arm],
             'override_timeout_sec': settings['max_seconds_per_arm'], 'max_timeout_sec': settings['max_seconds_per_arm'], 'kwargs': kwargs}
    if not gate: agent['model_name'] = lock['model']
    return {'job_name': arm, 'jobs_dir': str(work / 'jobs'), 'n_attempts': 1,
        'n_concurrent_trials': 1, 'retry': {'max_retries': 0},
        'environment': {'type': 'docker'}, 'agents': [agent],
        'tasks': [{'path': lock['task_path']}], 'verifier': {'max_timeout_sec': 600}}


def find_trial(job: Path) -> tuple[Path, dict]:
    trials = []
    for path in job.rglob('result.json'):
        value = json.loads(path.read_text())
        if 'task_name' in value and 'agent_info' in value:
            trials.append((path, value))
    if len(trials) != 1: raise ValueError(f'Expected one trial result, found {len(trials)}')
    return trials[0]


def execute_job(work: Path, lock: dict, arm: str) -> dict:
    from harbor.models.job.config import JobConfig
    from . import harbor_agents
    config = job_config(work, lock, arm)
    JobConfig.model_validate(config)  # Fail on API/schema drift before model use.
    getattr(harbor_agents, CLASSES[arm]).preflight(config['agents'][0]['kwargs'])
    job = work / 'jobs' / arm
    if job.exists(): raise ValueError('Refusing to repeat/overwrite a charged or completed job')
    cfg = work / 'configs' / (arm + '.json')
    dump(cfg, config)
    gate = arm in ('noop', 'gold')
    # Allow setup + 30min editing + grader. Actual editing timer is Harbor's 1800s.
    try:
        output = command(['harbor', 'run', '-c', str(cfg)], timeout=3300, auth=not gate)
        (work / (arm + '.log')).write_text(output)
    except Exception as exc:
        (work / (arm + '.error.log')).write_text(str(exc))
        if not job.exists(): raise
    trial_path, result = find_trial(job)
    row = result_row(result, arm)
    if gate:
        probe_path = trial_path.parent / 'agent/public-probe.json'
        row['public_probe_passed'] = json.loads(probe_path.read_text())['passed'] if probe_path.exists() else None
    if not gate:
        from .native_usage import reconcile_sessions
        usage = reconcile_sessions(trial_path.parent / 'agent/sessions', lock['model'], require_children='multiagent' in arm)
        if 'multiagent' not in arm and usage['child_count']:
            usage['complete'] = False
            usage['errors'].append('Unexpected delegation in a single-worker arm')
        if 'multiagent' in arm and usage['child_count'] < 2:
            usage['complete'] = False
            usage['errors'].append('Two actual child agents required by this arm')
        dump(trial_path.parent / 'agent/native-usage.json', usage)
        totals = usage['totals']
        row.update({'input_tokens': totals['input_tokens'], 'cached_input_tokens': totals['cached_input_tokens'],
            'output_tokens': totals['output_tokens'], 'total_tokens': totals['total_tokens'] if usage['complete'] else None,
            'usage_complete': usage['complete'], 'child_agents': usage['child_count'], 'thread_count': usage['thread_count'],
            'telemetry_errors': usage['errors'], 'controller_status': None, 'human_review_required': None})
        control_path = trial_path.parent / 'agent/controller-result.json'
        if control_path.exists():
            control = json.loads(control_path.read_text())
            row['controller_status'] = control['status']
            row['human_review_required'] = control['status'] == 'NEEDS_MANUAL_VERIFICATION'
    return row


def validate(work: Path) -> None:
    lock = read_lock(work)
    rows = [execute_job(work, lock, arm) for arm in ('noop', 'gold')]
    good = rows[0]['independent_reward'] == 0 and rows[1]['independent_reward'] == 1 and all(
        r['exception'] is None and r['verifier_environment'] == 'separate' for r in rows)
    good = good and rows[0]['public_probe_passed'] is False and rows[1]['public_probe_passed'] is True
    dump(work / 'validation.json', {'passed': good, 'task_digest': lock['task_digest'],
        'implementation_digest': lock['implementation_digest'], 'rows': rows, 'model_calls': 0})
    if not good: raise RuntimeError('No-op/gold validation failed. Do not run contestants or weaken the evaluator.')


def run(work: Path) -> None:
    existing = work / 'comparison.json'
    if existing.exists():
        raise ValueError('Experiment already has a run record; preserve it and use a fresh experiment')
    preflight = doctor()
    dump(work / 'preflight.json', preflight)
    if preflight['blockers']:
        dump(work / 'comparison.json', preflight)
        raise RuntimeError('; '.join(preflight['blockers']))
    lock = read_lock(work)
    validation = json.loads((work / 'validation.json').read_text())
    if not validation['passed'] or validation['task_digest'] != lock['task_digest'] or validation['implementation_digest'] != lock['implementation_digest']:
        raise ValueError('Successful current no-model validation required')
    if hashlib.sha256((work / 'public-contract.json').read_bytes()).hexdigest() != lock['contract_digest']:
        raise ValueError('Public contract changed')
    report = {'status': 'RUNNING', 'purpose': lock.get('settings', PILOT)['purpose'], 'order': lock['order'],
              'model': lock['model'], 'rows': [], 'comparison_conclusion': None}
    dump(work / 'comparison.json', report)
    for arm in lock['order']:
        read_lock(work)  # Inputs must remain identical across arms.
        try:
            row = execute_job(work, lock, arm)
        except Exception as exc:
            report['status'] = 'BLOCKED'
            report['blocker'] = str(exc)
            dump(work / 'comparison.json', report)
            raise
        report['rows'].append(row)
        dump(work / 'comparison.json', report)
        if row['status'] == 'EXECUTION_ERROR':
            report['status'] = 'PAUSED_EXECUTION_ERROR'
            dump(work / 'comparison.json', report)
            raise RuntimeError('Execution failure; stopped before spending on more contestants')
        if 'multiagent' in arm and row.get('child_agents', 0) == 0:
            report['status'] = 'PAUSED_DELEGATION_UNVERIFIED'
            dump(work / 'comparison.json', report)
            raise RuntimeError('No actual child-agent telemetry; stopped before spending on more contestants')
    report['status'] = 'COMPLETED_SMOKE'
    report['comparison_conclusion'] = 'One task, one run per arm: descriptive plumbing results only; no general winner.'
    dump(work / 'comparison.json', report)
    with (work / 'comparison.csv').open('w') as output:
        writer = csv.DictWriter(output, fieldnames=list(report['rows'][0]))
        writer.writeheader(); writer.writerows(report['rows'])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['doctor', 'prepare', 'validate', 'run', 'report'])
    parser.add_argument('--work', type=Path, default=ROOT / '.bench-work')
    parser.add_argument('--model')
    parser.add_argument('--codex-version')
    args = parser.parse_args()
    work = args.work.expanduser().resolve()
    work.mkdir(parents=True, exist_ok=True)
    try:
        if args.action == 'doctor':
            value = doctor(); dump(work / 'preflight.json', value)
            print(json.dumps(value, indent=2)); return 2 if value['blockers'] else 0
        if args.action == 'prepare':
            if not args.model or not args.codex_version: raise ValueError('--model and --codex-version are required')
            prepare(work, args.model, args.codex_version)
        elif args.action == 'validate': validate(work)
        elif args.action == 'run': run(work)
        else: print((work / 'comparison.json').read_text())
        return 0
    except Exception as exc:
        print(f'BLOCKED: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
