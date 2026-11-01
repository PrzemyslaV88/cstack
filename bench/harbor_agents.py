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
from harbor.agents.installed.codex import Codex, CodexOptions
from harbor.agents.options import AgentOptions
from harbor.models.agent.context import AgentContext
from .protocol import (archive_candidate, codex_events, dump, extract_candidate,
                       synchronize_candidate)

ROOT = Path(__file__).resolve().parents[1]
REMOTE_REPO = '/testbed'
ARTIFACT = '/logs/artifacts/candidate.tar'
REMOTE_TAR = '/tmp/cstack-comparison-source.tar'


class ComparisonOptions(CodexOptions):
    public_contract: str
    codex_version: str
    trial_seconds: int = 1800


class PstackOptions(ComparisonOptions):
    pstack_dir: str


class ValidationOptions(AgentOptions):
    public_contract: str


class GoldOptions(ValidationOptions):
    solution_dir: str


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
    options_model = ComparisonOptions
    ALLOW_MULTI_AGENT = False

    @staticmethod
    def name() -> str:
        return 'plain-codex'

    def __init__(self, *args, public_contract: str, codex_version: str, trial_seconds: int = 1800, **kwargs):
        if not codex_version or codex_version == 'latest':
            raise ValueError('Pin a concrete Codex CLI version')
        self.public_contract = json.loads(Path(public_contract).read_text())
        self.turns: list[dict] = []
        self.turn_attempts = 0
        self.collect_failed = False
        self.turn_seconds = trial_seconds - 5
        kwargs['version'] = codex_version
        kwargs['public_contract'] = public_contract
        kwargs['codex_version'] = codex_version
        kwargs['trial_seconds'] = trial_seconds
        kwargs.setdefault('reasoning_effort', 'medium')
        kwargs['web_search'] = 'disabled'
        kwargs['config'] = {
            'forced_login_method': 'chatgpt', 'model_provider': 'openai',
            'web_search': 'disabled',
            'features': {'multi_agent': self.ALLOW_MULTI_AGENT, 'multi_agent_v2': self.ALLOW_MULTI_AGENT,
                         'hooks': False, 'plugins': False, 'apps': False, 'goals': False},
            'shell_environment_policy': {'inherit': 'none', 'set': {'PATH': '/usr/local/bin:/usr/bin:/bin:/opt/miniconda3/envs/testbed/bin'}}
        }
        kwargs['config']['agents'] = {'enabled': self.ALLOW_MULTI_AGENT}
        if self.ALLOW_MULTI_AGENT:
            kwargs['config']['agents'] = {'enabled': True, 'default_subagent_model': 'gpt-6.1-sol',
                'default_subagent_reasoning_effort': kwargs['reasoning_effort'], 'max_concurrent_threads_per_session': 2}
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
        controls = ('multi_agent', 'multi_agent_v2', 'hooks', 'plugins', 'apps', 'goals')
        expected = {key: 'true' if key.startswith('multi_agent') and self.ALLOW_MULTI_AGENT else 'false' for key in controls}
        flags = ' '.join('-c features.' + key + '=' + expected[key] for key in controls)
        features = await environment.exec(command='codex ' + flags + ' features list', timeout_sec=10)
        if features.return_code or any(not re.search(r'^' + key + r'\s+.*\b' + expected[key] + r'\s*$', features.stdout or '', re.M) for key in controls):
            raise RuntimeError('Cannot confirm the declared delegation/hooks/plugins/apps/goals policy')
        # No benchmark source/answers or local repo-specific Codex overrides.
        result = await environment.exec(
            command="test ! -e /tests && test ! -e /solution && "
                    "test ! -e /testbed/.codex/config.toml && test ! -e /var/run/docker.sock",
            timeout_sec=10)
        if result.return_code != 0:
            raise RuntimeError('Unsafe task image: hidden tests/solution/config/socket exposed')

    def delegation_instruction(self) -> str:
        return ('Use actual spawn_agent calls for at least two read-only helper agents: one diagnosis/reproduction explorer and one regression reviewer. '
            'Only the parent edits /testbed. All agents must use gpt-6.1-sol. At most two children may run concurrently. '
            'Children must not spawn further agents. Wait for all children and close them before your final response. '
            'Keep all work within the same 30-minute trial deadline. Record unavailable mechanisms; never pretend a sequential pass was delegated. '
            if self.ALLOW_MULTI_AGENT else 'Do not use other agents. ')

    def public_instruction(self, instruction: str) -> str:
        return (instruction + '\n\nWork only in /testbed. Do not use network answer searches. ' + self.delegation_instruction() +
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
    options_model = PstackOptions
    @staticmethod
    def name():
        return 'pstack-adapted-single-worker'

    def __init__(self, *args, pstack_dir: str, **kwargs):
        self.pstack_dir = Path(pstack_dir)
        kwargs['pstack_dir'] = pstack_dir
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


class PlainMultiAgent(PlainCodex):
    ALLOW_MULTI_AGENT = True

    @staticmethod
    def name(): return 'plain-codex-multiagent'


class PstackMultiAgent(PstackAdapted):
    ALLOW_MULTI_AGENT = True

    @staticmethod
    def name(): return 'pstack-codex-multiagent'

    def public_instruction(self, instruction):
        return (PlainCodex.public_instruction(self, instruction) + '\n\n'
            'Use /opt/pstack/skills/poteto-mode/SKILL.md and its referenced playbooks. '
            'For Claude/Cursor tool names and model names, follow /opt/pstack/skills/poteto-mode/references/codex-tools.md. '
            'Read /opt/pstack/pstack-models.md for the user\'s GPT-6.1 Sol role settings. '
            'This is a pstack skills workflow on Codex with real delegation, not the Cursor/Claude plugin runtime. '
            'Use read-only delegates for exploration and review; the parent integrates changes. Respect the concurrency and deadline limits. '
            'Required independent reviews remain pending if they cannot run. Report reduced model diversity because every seat uses GPT-6.1 Sol.')


class CstackHarbor(PlainCodex):
    """Actual cStack controller on host; only its worker is transported into Harbor."""
    @staticmethod
    def name():
        return 'cstack-harbor'

    def worker_instruction(self, prompt):
        return prompt

    async def controller_usage(self, outcome, environment):
        return outcome['usage']

    async def run(self, instruction, environment, context):
        with tempfile.TemporaryDirectory(prefix='cstack-harbor-') as temp:
            root = Path(temp)
            source = await snapshot(environment, root)
            for args in [('init', '-q'), ('config', 'user.name', 'cStack Benchmark'),
                         ('config', 'user.email', 'benchmark@example.invalid'),
                         # The transported snapshot includes ignored test inputs.
                         # Preserve them in the controller's starting worktree.
                         ('add', '-f', '.'), ('commit', '-qm', 'Frozen benchmark input')]:
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
                            prompt = self.worker_instruction(msg['prompt'])
                            prompts = self.logs_dir / 'worker-prompts'
                            prompts.mkdir(exist_ok=True)
                            (prompts / f"{msg['id']:03d}.txt").write_text(prompt)
                            outcome = await asyncio.wait_for(self.turn(prompt, environment), msg['timeout_ms'] / 1000)
                            usage = await self.controller_usage(outcome, environment)
                            with tempfile.TemporaryDirectory(prefix='cstack-sync-') as staging:
                                changed = await snapshot(environment, Path(staging))
                                synchronize_candidate(changed, Path(msg['worktree']), home / 'worktrees')
                            await respond({'op': 'worker_result', 'id': msg['id'], 'result': {
                                'code': 0 if outcome['complete'] else 1, 'usage': usage,
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


class CstackMultiAgent(CstackHarbor):
    """Experimental benchmark arm: one code writer and two native review helpers.

    The shipped CLI stays single-worker. Verification and human review gates are
    unchanged; only the injected benchmark worker's delegation policy differs.
    """
    ALLOW_MULTI_AGENT = True
    _charged_native_usage = None
    DELEGATION = (
        'One coding parent with exactly two actual spawn_agent helpers per initial repair: '
        'a diagnosis/reproduction explorer and a regression reviewer. '
        'Delegate diagnosis before editing and have the reviewer inspect the final candidate. '
        'Only the parent may edit /testbed. Helpers inspect files and run checks; any temporary '
        'reproductions must be outside /testbed under /tmp. '
        'All agents use gpt-6.1-sol with medium reasoning. At most two helpers may run concurrently. '
        'Helpers must not spawn agents. Wait for and close both helpers before returning. '
        'No push, deployment, credential access, controller access or test weakening. '
        'Helper approval never replaces controller checks or human review.'
    )

    @staticmethod
    def name(): return 'cstack-codex-multiagent'

    def delegation_instruction(self):
        # Use the same public task/probes as the single-worker arm. The worker
        # policy is injected explicitly below, not hidden in a truncated goal.
        return ''

    def worker_instruction(self, prompt):
        single = 'One coding worker. No subagents. No push, deployment, credential access, controller access or test weakening.'
        if prompt.count(single) != 1:
            raise RuntimeError('Controller worker policy changed; review multi-agent prompt mapping before inference')
        return prompt.replace(single, self.DELEGATION, 1)

    async def controller_usage(self, outcome, environment):
        # CLI events cover the parent only. Charge final native counters from
        # every distinct parent/helper once; resumed attempts charge the delta.
        from .native_usage import reconcile_sessions, usage_delta
        sessions = self.logs_dir / 'controller-sessions' / f'{self.turn_attempts:03d}'
        await environment.download_dir('/logs/agent/sessions', sessions)
        observed = reconcile_sessions(sessions, self.model_name, require_children=True)
        dump(self.logs_dir / f'controller-usage-{self.turn_attempts:03d}.json', observed)
        if not observed['complete'] or observed['child_count'] < 2:
            raise RuntimeError('Complete parent/helper native usage required before controller continuation: '
                               + '; '.join(observed['errors']))
        delta = usage_delta(self._charged_native_usage, observed['totals'])
        self._charged_native_usage = observed['totals']
        return [delta]


class ControlledRecoveryCstack(CstackHarbor):
    """Explicit Flask recovery exercise; first edit is scripted, never model usage."""
    _injected = False

    @staticmethod
    def name(): return 'cstack-controlled-recovery'

    async def turn(self, instruction, environment):
        if not self._injected:
            self._injected = True
            code = ("from pathlib import Path; p=Path('/testbed/src/flask/blueprints.py'); "
                    "assert p.is_file(); p.write_bytes(p.read_bytes()+b'\\n# Controlled recovery exercise: behavior remains unfixed.\\n')")
            result = await environment.exec(command='/opt/miniconda3/envs/testbed/bin/python -c ' + shlex.quote(code), timeout_sec=10)
            if result.return_code:
                raise RuntimeError('Controlled first edit did not apply')
            dump(self.logs_dir / 'controlled-failure.json', {'kind': 'scripted ineffective first edit',
                'model_invocations': 0, 'path': 'src/flask/blueprints.py',
                'purpose': 'Real public checks must reject this change and request a corrective attempt.'})
            return {'complete': True, 'usage': [], 'quota': False, 'errors': []}
        return await super().turn(instruction, environment)


class Noop(BaseAgent):
    options_model = ValidationOptions

    def __init__(self, *args, public_contract: str, **kwargs):
        kwargs['public_contract'] = public_contract
        super().__init__(*args, **kwargs)
        self.public_contract = json.loads(Path(public_contract).read_text())
        self.logs_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def name(): return 'benchmark-noop'
    def version(self): return '1'
    async def setup(self, environment): pass
    async def public_probe(self, environment):
        rows = []
        for criterion in self.public_contract['criteria']:
            for case in criterion.get('cases', []):
                argv = shlex.join(criterion['argv'])
                # Docker exec combines stderr into stdout. Keep diagnostics out
                # of the JSON channel without suppressing or relaxing checks.
                diagnostic = '/tmp/benchmark-public-probe.stderr'
                command = ('printf %s ' + shlex.quote(case.get('stdin', ''))
                           + ' | timeout 40s ' + argv + ' 2>' + diagnostic)
                result = await environment.exec(command=command, timeout_sec=45)
                stderr = await environment.exec(command='cat ' + diagnostic, timeout_sec=10)
                try: observed = json.loads(result.stdout or '')
                except ValueError: observed = {'invalid_output': (result.stdout or '')[-500:]}
                passed = result.return_code == 0 and json.dumps(observed, sort_keys=True) == json.dumps(case['expect_json'], sort_keys=True)
                rows.append({'criterion': criterion['id'], 'passed': passed, 'observed': observed,
                             'expected': case['expect_json'], 'exit_code': result.return_code,
                             'stderr': stderr.stdout or ''})
        dump(self.logs_dir / 'public-probe.json', {'passed': bool(rows) and all(r['passed'] for r in rows), 'rows': rows})

    async def run(self, instruction, environment, context):
        await self.public_probe(environment)
        await deliver_snapshot(environment, self.logs_dir)


class Gold(Noop):
    """No-model evaluator gate ONLY. Never available to contestant jobs."""
    options_model = GoldOptions
    @staticmethod
    def name(): return 'benchmark-known-repair'
    def __init__(self, *args, solution_dir: str, **kwargs):
        kwargs['solution_dir'] = solution_dir
        super().__init__(*args, **kwargs)
        self.solution_dir = Path(solution_dir)
    async def run(self, instruction, environment, context):
        await environment.upload_dir(self.solution_dir, '/solution')
        result = await environment.exec(command='bash /solution/solve.sh', timeout_sec=300)
        if result.return_code:
            raise RuntimeError('Known repair did not apply')
        await self.public_probe(environment)
        await deliver_snapshot(environment, self.logs_dir)
