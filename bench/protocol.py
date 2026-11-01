"""Pure benchmark protocol: no agent imports, network, billing or code execution."""
from __future__ import annotations
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import random
import shutil
import stat
import tarfile
from datetime import datetime
from typing import Any

MAX_FILES = 30_000
MAX_BYTES = 256 * 1024 * 1024
ARMS = ('plain-codex', 'pstack-adapted-single-worker', 'cstack-harbor')


def dump(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def digest_tree(root: Path, *, exclude_git: bool = True) -> str:
    """Content + executable mode + paths; reject symlinks, devices and huge inputs."""
    entries, total = [], 0
    for path in sorted(root.rglob('*')):
        rel = path.relative_to(root).as_posix()
        if exclude_git and rel.split('/')[0] == '.git':
            continue
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISDIR(mode) or stat.S_ISREG(mode)):
            raise ValueError(f'Unsupported file type: {rel}')
        if path.is_dir():
            continue
        total += path.stat().st_size
        if total > MAX_BYTES or len(entries) >= MAX_FILES:
            raise ValueError('Snapshot exceeds bounded input size')
        entries.append([rel, bool(mode & 0o111), hashlib.sha256(path.read_bytes()).hexdigest()])
    return hashlib.sha256(json.dumps(entries, separators=(',', ':')).encode()).hexdigest()


def extract_candidate(archive: Path, destination: Path) -> None:
    """Never use extractall on a contestant-controlled archive. No links or Git metadata."""
    if destination.exists():
        raise ValueError('Snapshot destination must be new')
    destination.mkdir(parents=True)
    names: set[str] = set()
    total = 0
    try:
        with tarfile.open(archive, 'r:*') as tar:
            for member in tar:
                name = member.name
                parts = PurePosixPath(name).parts
                if name in ('.', './'):
                    continue
                if not parts or name.startswith('/') or '..' in parts or '\\' in name:
                    raise ValueError('Unsafe archive path')
                if '.git' in parts or parts[0] in ('.codex', '.cstack'):
                    raise ValueError('Controller/config/Git metadata in candidate')
                normalized = '/'.join(parts)
                if normalized in names:
                    raise ValueError('Duplicate archive path')
                names.add(normalized)
                if len(names) > MAX_FILES:
                    raise ValueError('Too many archive entries')
                target = destination.joinpath(*parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                if not member.isfile() or member.size < 0:
                    raise ValueError('Links and special files are forbidden')
                total += member.size
                if total > MAX_BYTES:
                    raise ValueError('Archive exceeds bounded input size')
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                if source is None:
                    raise ValueError('Missing archive body')
                with target.open('xb') as out:
                    shutil.copyfileobj(source, out)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    except BaseException:
        shutil.rmtree(destination)
        raise


def archive_candidate(root: Path, output: Path) -> str:
    digest = digest_tree(root)
    with tarfile.open(output, 'w') as tar:
        for path in sorted(root.rglob('*')):
            rel = path.relative_to(root)
            if '.git' in rel.parts or path.is_dir():
                continue
            info = tar.gettarinfo(str(path), arcname=rel.as_posix())
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ''
            with path.open('rb') as source:
                tar.addfile(info, source)
    return digest


def synchronize_candidate(source: Path, destination: Path, allowed_root: Path) -> None:
    """Write only a controller-created worktree, preserving its own .git metadata."""
    target = destination.resolve(strict=True)
    if not target.is_relative_to(allowed_root.resolve()) or target == allowed_root.resolve():
        raise ValueError('Worker target outside controller worktrees')
    if not (target / '.git').exists():
        raise ValueError('Not a controller Git worktree')
    digest_tree(source)
    for path in target.iterdir():
        if path.name == '.git':
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    for path in source.iterdir():
        if path.name == '.git':
            raise ValueError('Candidate Git metadata forbidden')
        if path.is_dir():
            shutil.copytree(path, target / path.name)
        else:
            shutil.copy2(path, target / path.name)


def codex_events(text: str) -> dict:
    """Parse complete per-invocation JSONL only. Missing counters remain unknown."""
    usage, messages, errors = [], [], []
    malformed = False
    completed = False
    quota = False
    for line in text.splitlines():
        if not line.strip():
            continue
        if line == 'Reading additional input from stdin...':
            continue
        try:
            event = json.loads(line)
            if not isinstance(event, dict):
                raise ValueError('event must be object')
        except (ValueError, TypeError):
            malformed = True
            continue
        if event.get('type') == 'turn.completed':
            completed = True
            u = event.get('usage')
            if isinstance(u, dict):
                usage.append(u)
        if event.get('type') in ('error', 'turn.failed'):
            error = event.get('error') or event
            if not isinstance(error, dict):
                error = {'message': str(error)}
            errors.append(str(error.get('message', 'Provider failure')))
            quota |= error.get('code') in {'rate_limit_exceeded', 'usage_limit_reached', 'insufficient_quota', 'credits_exhausted'}
        item = event.get('item', {})
        if event.get('type') == 'item.completed' and isinstance(item, dict) and item.get('type') == 'agent_message':
            messages.append(str(item.get('text', '')))
    keys = ('input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens')
    totals = {}
    for key in keys:
        values = [u.get(key) for u in usage]
        totals[key] = sum(values) if values and all(type(x) is int and x >= 0 for x in values) else None
    complete_usage = completed and len(usage) == 1 and not malformed and not errors and totals['input_tokens'] is not None and totals['output_tokens'] is not None
    # CLI stderr may include warnings in Harbor's combined stream. Preserve
    # incomplete telemetry without misclassifying an otherwise completed turn.
    return {'complete': completed and not errors, 'quota': quota,
            'usage': usage, 'usage_complete': complete_usage, 'totals': totals,
            'messages': messages, 'errors': errors, 'malformed': malformed}


def seconds(timing: dict | None) -> float | None:
    try:
        a = datetime.fromisoformat(timing['started_at'].replace('Z', '+00:00'))
        b = datetime.fromisoformat(timing['finished_at'].replace('Z', '+00:00'))
        return max(0.0, (b - a).total_seconds())
    except (TypeError, KeyError, ValueError):
        return None


def result_row(result: dict, arm: str) -> dict:
    """Use final independent reward, not cStack state or self-reported completion."""
    exception = result.get('exception_info')
    reward = (result.get('verifier_result') or {}).get('rewards', {}).get('reward')
    if type(reward) not in (int, float) or not math.isfinite(reward):
        reward = None
    status = 'VERIFIED' if reward == 1 else 'NOT_RESOLVED' if reward == 0 else 'UNGRADABLE'
    if exception:
        kind = str(exception.get('exception_type', 'unknown'))
        status = 'TIMEOUT' if 'timeout' in kind.lower() else 'EXECUTION_ERROR'
    agent = result.get('agent_result') or {}
    metadata = agent.get('metadata') or {}
    met = metadata.get('comparison', {})
    usage_complete = met.get('usage_complete') is True
    def counter(key):
        value = agent.get(key)
        return value if type(value) is int and value >= 0 else None
    inp, out = counter('n_input_tokens'), counter('n_output_tokens')
    return {'arm': arm, 'task': result.get('task_name'), 'status': status,
            'independent_reward': reward, 'input_tokens': inp,
            'cached_input_tokens': counter('n_cache_tokens'), 'output_tokens': out,
            'total_tokens': inp + out if usage_complete and inp is not None and out is not None else None,
            'usage_complete': usage_complete, 'agent_seconds': seconds(result.get('agent_execution')),
            'setup_seconds': seconds(result.get('agent_setup')), 'grading_seconds': seconds(result.get('verifier')),
            'subscription_allowance_consumed': None, 'false_completion': None,
            'exception': exception.get('exception_type') if exception else None,
            'completion_claim_review': 'manual review of final messages required',
            'verifier_environment': result.get('verifier_environment_mode')}


def execution_order(seed: int) -> list[str]:
    arms = list(ARMS)
    random.Random(seed).shuffle(arms)
    return arms


def blocked_report(blockers: list[str]) -> dict:
    return {'schema_version': 1, 'status': 'BLOCKED', 'live_agent_runs': 0,
            'comparison_conclusion': None, 'blockers': blockers,
            'arms': [{'arm': arm, 'status': 'NOT_STARTED', 'verified': None,
                      'input_tokens': None, 'output_tokens': None, 'agent_seconds': None} for arm in ARMS]}
