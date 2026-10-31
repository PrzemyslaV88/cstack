"""Harbor adapters. Real integration requires pinned Harbor; fixtures are not model results.

The final evaluator never calls cStack. cStack's local checks use only the public
reproduction shown to all three arms. The host bridge never executes candidate code.
"""
from __future__ import annotations
import asyncio
import json
import os
import re
from pathlib import Path
import shlex
import shutil
import tempfile
import time
from harbor.agents.base import BaseAgent
from harbor.agents.installed.codex import Codex
from harbor.models.agent.context import AgentContext
from .protocol import (archive_candidate, codex_events, dump, extract_candidate,
                       synchronize_candidate)

ROOT = Path(__file__).resolve().parents[1]
REMOTE_REPO = '/testbed'
ARTIFACT = '/logs/artifacts/candidate.tar'
REMOTE_TAR = '/tmp/cstack-comparison-source.tar'


async def snapshot(environment, local: Path) -> Path:
    """Bounded, validated DATA transport. Never import/run downloaded Python on host."""
    check = await environment.exec(command='test ! -e /testbed/.codex && test ! -e /testbed/.cstack', timeout_sec=10)
    if check.return_code != 0:
        raise RuntimeError('Contestant introduced local controller/Codex overrides')
    result = await environment.exec(
        command=f"tar --exclude='./.git' --exclude='./.codex' --exclude='./.cstack' "
                f"--exclude='__pycache__' --exclude='.pytest_cache' -cf {REMOTE_TAR} -C {REMOTE_REPO} .",
        timeout_sec=30)
    if result.return_code != 0:
        raise RuntimeError('Could not freeze candidate: ' + (result.stderr or ''))
    archive = local / 'source.tar'
    await environment.download_file(REMOTE_TAR, archive)
    if archive.stat().st_size > 260 * 1024 * 1024:
        raise ValueError('Candidate archive too large')
    extracted = local / 'source'
    extract_candidate(archive, extracted)
    return extracted


async def deliver_snapshot(environment, logs_dir: Path) -> str:
    """Produce one candidate archive for a fresh private grader, without Git metadata."""
    with tempfile.TemporaryDirectory(prefix='cstack-delivery-') as tmp:
        source = await snapshot(environment, Path(tmp))
        archive = Path(tmp) / 'candidate.tar'
        digest = archive_candidate(source, archive)
        await environment.exec(command='mkdir -p /logs/artifacts', timeout_sec=10)
        await environment.upload_file(archive, ARTIFACT)
        dump(logs_dir / 'candidate-identity.json', {'sha256': digest})
        return digest


class PlainCodex(Codex):
    """Same Codex implementation/model/containment across all three arms."""
    SUPPORTS_ATIF = True

    @staticmethod
    def name() -> str:
        return 'plain-codex'

    def __init__(self, *args, public_contract: str, codex_version: str, **kwargs):
        if not codex_version or codex_version == 'latest':
            raise ValueError('Pin a concrete Codex CLI version')
        self.public_contract = json.loads(Path(public_contract).read_text())
        self.turns: list[dict] = []
        self.turn_attempts = 0
        self.collect_failed = False
        self.turn_seconds = 1795
        kwargs['version'] = codex_version
        kwargs['reasoning_effort'] = 'medium'
        kwargs['web_search'] = 'disabled'
        kwargs['config'] = {
            'forced_login_method': 'chatgpt', 'model_provider': 'openai',
            'web_search': 'disabled',
            'features': {'multi_agent': False, 'hooks': False, 'plugins': False, 'apps': False, 'goals': False},
            'shell_environment_policy': {'inherit': 'none', 'set': {'PATH': '/usr/local/bin:/usr/bin:/bin:/opt/miniconda3/envs/testbed/bin'}}
        }
        super().__init__(*args, **kwargs)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    async def setup(self, environment):
        auth = self._resolve_auth_json_path()
        if auth is None:
            raise RuntimeError('Saved ChatGPT auth is required; API fallback refused')
        if self.mcp_servers:
            raise RuntimeError('Extra tools would invalidate the controlled pilot')
        if 'docker' not in str(environment.type()).lower():
            raise RuntimeError('This adapter is evaluated only with local Docker')
        await super().setup(environment)
        controls = ('multi_agent', 'hooks', 'plugins', 'apps', 'goals')
        flags = ' '.join('-c features.' + key + '=false' for key in controls)
        features = await environment.exec(command='codex ' + flags + ' features list', timeout_sec=10)
        if features.return_code or any(not re.search(r'^' + key + r'\s+.*\bfalse\s*$', features.stdout or '', re.M) for key in controls):
            raise RuntimeError('Cannot confirm disabled delegation/hooks/plugins/apps/goals')
        # No benchmark source/answers or local repo-specific Codex overrides.
        result = await environment.exec(
            command="test ! -e /tests && test ! -e /solution && "
                    "test ! -e /testbed/.codex/config.toml && test ! -e /var/run/docker.sock",
            timeout_sec=10)
        if result.return_code != 0:
            raise RuntimeError('Unsafe task image: hidden tests/solution/config/socket exposed')

    def public_instruction(self, instruction: str) -> str:
        return (instruction + '\n\nWork only in /testbed. Do not use network answer searches or other agents. '
                'The same public reproduction below is available to every contestant. '
                'Private final tests are not available. State clearly what is fixed and what remains.\n'
                + json.dumps({'criteria': self.public_contract['criteria']}, indent=2))

    async def exec_as_agent(self, environment, command, **kwargs):
        # Parent Harbor command uses a pipeline. Put the entire pipeline in a
        # process-group timeout, with pipefail, not just the final tee process.
        if 'codex exec ' in command:
            command = ('timeout --signal=TERM --kill-after=2s '
                       + str(max(1, int(self.turn_seconds))) + 's bash -o pipefail -c '
                       + shlex.quote(command))
        return await super().exec_as_agent(environment, command=command, **kwargs)

    async def turn(self, instruction, environment):
        self.turn_attempts += 1
        index = self.turn_attempts
        error = None
        self._resume = index > 1
        guard = await environment.exec(command='test ! -e /testbed/.codex && rm -f /logs/agent/codex.txt', timeout_sec=10)
        if guard.return_code:
            raise RuntimeError('Codex configuration changed inside candidate')
        try:
            await Codex.run(self, instruction, environment, AgentContext())
        except asyncio.CancelledError:
            error = 'Cancelled or deadline exhausted; usage may be partial'
            raise
        except Exception as exc:
            error = str(exc)
        finally:
            output = self.logs_dir / f'turn-{index:03d}.jsonl'
            try:
                await environment.download_file('/logs/agent/codex.txt', output)
                parsed = codex_events(output.read_text(errors='replace'))
            except Exception:
                parsed = codex_events('')
                self.collect_failed = True
            if error:
                parsed['complete'] = parsed['usage_complete'] = False
                parsed['errors'].append(error)
            self.turns.append(parsed)
            dump(self.logs_dir / 'usage-events.json', self.turns)
        return parsed

    def _context(self, context):
        complete = (bool(self.turns) and len(self.turns) == self.turn_attempts
                    and all(t['usage_complete'] for t in self.turns) and not self.collect_failed)
        for attr, key in [('n_input_tokens', 'input_tokens'), ('n_cache_tokens', 'cached_input_tokens'),
                          ('n_output_tokens', 'output_tokens')]:
            values = [t['totals'][key] for t in self.turns]
            setattr(context, attr, sum(values) if values and all(v is not None for v in values) else None)
        context.cost_usd = None
        context.metadata = {**(context.metadata or {}), 'comparison': {
            'arm': self.name(), 'usage_complete': complete, 'turn_attempts': self.turn_attempts,
            'authentication': 'chatgpt', 'subscription_allowance_consumed': None,
            'final_claims': [m for t in self.turns for m in t['messages']],
            'official_pstack': False if 'pstack' in self.name() else None}}

    def populate_context_post_run(self, context):
        # Harbor may backfill aggregate native trajectories; do not double count
        # cumulative resumed sessions. Keep per-invocation counters authoritative.
        try:
            super().populate_context_post_run(context)
        finally:
            self._context(context)

    async def run(self, instruction, environment, context):
        try:
            observed = await self.turn(self.public_instruction(instruction), environment)
            if not observed['complete']:
                raise RuntimeError('Codex turn incomplete: ' + '; '.join(observed['errors']))
        finally:
            self._context(context)
            await deliver_snapshot(environment, self.logs_dir)


class PstackAdapted(PlainCodex):
    """Pinned upstream playbooks, sequential adaptation. NOT native multiagent pstack."""
    @staticmethod
    def name():
        return 'pstack-adapted-single-worker'

    def __init__(self, *args, pstack_dir: str, **kwargs):
        self.pstack_dir = Path(pstack_dir)
        super().__init__(*args, **kwargs)

    async def setup(self, environment):
        await super().setup(environment)
        if not (self.pstack_dir / 'skills/poteto-mode/SKILL.md').is_file():
            raise ValueError('Pinned pstack skill tree missing')
        await environment.upload_dir(self.pstack_dir, '/opt/pstack')
        await environment.exec(command='chmod -R a-w /opt/pstack', user='root', timeout_sec=10)

    def public_instruction(self, instruction):
        return (super().public_instruction(instruction) + '\n\n'
                'Use /opt/pstack/skills/poteto-mode/SKILL.md and its referenced local playbooks. '
                'This is a SINGLE-WORKER CODEX ADAPTATION: perform delegated roles sequentially yourself; '
                'do not spawn workers, change models, install plugins or call external reviewers. '
                'Record unavailable upstream mechanisms. This run is not official multiagent pstack.')


class CstackHarbor(PlainCodex):
    """Actual cStack controller on host; only its worker is transported into Harbor."""
    @staticmethod
    def name():
        return 'cstack-harbor'

    async def run(self, instruction, environment, context):
        with tempfile.TemporaryDirectory(prefix='cstack-harbor-') as temp:
            root = Path(temp)
            source = await snapshot(environment, root)
            for args in [('init', '-q'), ('config', 'user.name', 'cStack Benchmark'),
                         ('config', 'user.email', 'benchmark@example.invalid'),
                         ('add', '.'), ('commit', '-qm', 'Frozen benchmark input')]:
                proc = await asyncio.create_subprocess_exec('git', '-C', str(source), *args,
                                                          stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                _, err = await proc.communicate()
                if proc.returncode:
                    raise RuntimeError('Git snapshot failed: ' + err.decode(errors='replace'))
            home = root / 'controller'
            contract = {**self.public_contract, 'goal': self.public_instruction(instruction), 'model': self.model_name}
            stderr_path = self.logs_dir / 'controller-stderr.log'
            with stderr_path.open('wb') as errors:
                bridge = await asyncio.create_subprocess_exec('node', str(ROOT / 'bench/cstack_bridge.mjs'),
                    stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=errors,
                    limit=2_000_000, cwd=ROOT)
                async def respond(message):
                    bridge.stdin.write((json.dumps(message) + '\n').encode())
                    await bridge.stdin.drain()
                await respond({'op': 'start', 'repo': str(source), 'home': str(home), 'contract': contract})
                try:
                    while line := await bridge.stdout.readline():
                        msg = json.loads(line)
                        if msg['op'] == 'worker':
                            self.turn_seconds = max(1, msg['timeout_ms'] / 1000 - 3)
                            outcome = await asyncio.wait_for(self.turn(msg['prompt'], environment), msg['timeout_ms'] / 1000)
                            with tempfile.TemporaryDirectory(prefix='cstack-sync-') as staging:
                                changed = await snapshot(environment, Path(staging))
                                synchronize_candidate(changed, Path(msg['worktree']), home / 'worktrees')
                            await respond({'op': 'worker_result', 'id': msg['id'], 'result': {
                                'code': 0 if outcome['complete'] else 1, 'usage': outcome['usage'],
                                'quota': outcome['quota'], 'diagnostic': '; '.join(outcome['errors'])}})
                        elif msg['op'] == 'finished':
                            dump(self.logs_dir / 'controller-result.json', msg)
                        elif msg['op'] == 'error':
                            raise RuntimeError(msg['message'])
                        else:
                            raise RuntimeError('Unknown bridge message')
                    if await bridge.wait():
                        raise RuntimeError('cStack bridge failed; inspect controller-stderr.log')
                finally:
                    if bridge.returncode is None:
                        bridge.terminate()
                        try:
                            await asyncio.wait_for(bridge.wait(), 2)
                        except asyncio.TimeoutError:
                            bridge.kill()
                            await bridge.wait()
                    self._context(context)
                    # Controller logs contain public evidence only, no hidden grader.
                    if (home / 'runs').exists():
                        shutil.copytree(home / 'runs', self.logs_dir / 'cstack-runs', dirs_exist_ok=True,
                                        ignore=shutil.ignore_patterns('snapshots'))
                    await deliver_snapshot(environment, self.logs_dir)


class Noop(BaseAgent):
    @staticmethod
    def name(): return 'benchmark-noop'
    def version(self): return '1'
    async def setup(self, environment): pass
    async def run(self, instruction, environment, context):
        await deliver_snapshot(environment, self.logs_dir)


class Gold(Noop):
    """No-model evaluator gate ONLY. Never available to contestant jobs."""
    @staticmethod
    def name(): return 'benchmark-known-repair'
    def __init__(self, *args, solution_dir: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.solution_dir = Path(solution_dir)
    async def run(self, instruction, environment, context):
        await environment.upload_dir(self.solution_dir, '/solution')
        result = await environment.exec(command='bash /solution/solve.sh', timeout_sec=300)
        if result.return_code:
            raise RuntimeError('Known repair did not apply')
        await deliver_snapshot(environment, self.logs_dir)
