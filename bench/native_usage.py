"""Conservative Codex native rollout accounting; CLI JSON totals are never added."""
import json
from pathlib import Path

FIELDS = ('input_tokens', 'cached_input_tokens', 'cache_write_input_tokens',
          'output_tokens', 'reasoning_output_tokens', 'total_tokens')


def usage_delta(previous: dict | None, current: dict) -> dict:
    """Controller admission charge for a cumulative parent/helper session tree."""
    previous = previous or {key: 0 for key in FIELDS}
    if any(not isinstance(current.get(key), int) or isinstance(current[key], bool)
           or current[key] < previous.get(key, 0) for key in FIELDS):
        raise ValueError('Missing or decreasing native usage; refusing budget undercount')
    delta = {key: current[key] - previous.get(key, 0) for key in FIELDS}
    if delta['total_tokens'] != delta['input_tokens'] + delta['output_tokens']:
        raise ValueError('Inconsistent native usage delta')
    return delta

def reconcile_sessions(sessions_dir: Path, expected_model: str, require_children: bool = False) -> dict:
    errors, threads, expected_children = [], {}, set()
    for path in sorted(Path(sessions_dir).rglob('*.jsonl')):
        rows = []
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except (ValueError, TypeError):
                errors.append(f'{path}:{lineno}: malformed JSON')
        metas = [r.get('payload', {}) for r in rows if r.get('type') == 'session_meta']
        if not metas or not metas[0].get('id'):
            errors.append(f'{path}: missing thread id'); continue
        meta = metas[0]
        tid = meta['id']  # session_id is shared by the entire V2 tree!
        spawn = meta.get('source', {})
        spawn = spawn.get('subagent', {}).get('thread_spawn', {}) if isinstance(spawn, dict) else {}
        parent = meta.get('parent_thread_id') or spawn.get('parent_thread_id')
        if meta.get('parent_thread_id') and spawn.get('parent_thread_id') and meta['parent_thread_id'] != spawn['parent_thread_id']:
            errors.append(f'{tid}: inconsistent parent identities')
        source_child = bool(spawn) or meta.get('thread_source') == 'subagent'
        if source_child and not parent:
            errors.append(f'{tid}: subagent without known parent')
        record = threads.setdefault(tid, {'id': tid, 'parent_thread_id': parent, 'paths': [], 'models': set(),
                                         'efforts': set(), 'snapshots': [], 'terminal_events': [], 'metadata': meta})
        if record['parent_thread_id'] != parent:
            errors.append(f'{tid}: conflicting duplicate thread metadata')
        record['paths'].append(str(path))
        boundary = meta.get('subagent_history_start_ordinal')
        spawn_calls = set()
        for r in rows:
            payload = r.get('payload', {})
            if not isinstance(payload, dict):
                continue
            # Copied inherited context must never become child usage.
            inherited = boundary is not None and r.get('ordinal', boundary) < boundary
            if r.get('type') == 'response_item':
                kind = payload.get('type')
                if kind in ('function_call', 'custom_tool_call') and str(payload.get('name', '')).split('.')[-1] == 'spawn_agent':
                    spawn_calls.add(payload.get('call_id'))
                if kind in ('function_call_output', 'custom_tool_call_output') and payload.get('call_id') in spawn_calls:
                    output = payload.get('output')
                    try: output = json.loads(output) if isinstance(output, str) else output
                    except ValueError: output = None
                    if isinstance(output, dict):
                        child = output.get('agent_id') or output.get('thread_id')
                        if child: expected_children.add(child)
            if r.get('type') == 'turn_context' and not inherited:
                if payload.get('model'): record['models'].add(payload['model'])
                if payload.get('effort'): record['efforts'].add(payload['effort'])
            if r.get('type') == 'event_msg':
                if payload.get('type') in ('task_started', 'task_complete', 'turn_aborted') and not inherited:
                    record['terminal_events'].append((r.get('timestamp', ''), payload['type']))
                if payload.get('type') in ('collab_agent_spawn_end', 'subagent_session_started'):
                    child = payload.get('new_thread_id') or payload.get('agent_id') or payload.get('thread_id')
                    if child: expected_children.add(child)
                if payload.get('type') == 'token_count' and not inherited:
                    usage = (payload.get('info') or {}).get('total_token_usage')
                    if isinstance(usage, dict):
                        if not all(isinstance(usage.get(k), int) and not isinstance(usage[k], bool) and usage[k] >= 0 for k in FIELDS):
                            errors.append(f'{tid}: incomplete or invalid token vector'); continue
                        if usage['total_tokens'] != usage['input_tokens'] + usage['output_tokens']:
                            errors.append(f'{tid}: inconsistent native token total'); continue
                        record['snapshots'].append((r.get('timestamp', ''), r.get('ordinal', 0), dict(usage)))
        if parent and meta.get('forked_from_id') and boundary is None:
            errors.append(f'{tid}: forked child lacks usage ownership boundary')
    totals = {k: 0 for k in FIELDS}
    for tid, record in threads.items():
        parent = record['parent_thread_id']
        if parent and parent not in threads: errors.append(f'{tid}: parent rollout missing: {parent}')
        if record['models'] != {expected_model}: errors.append(f'{tid}: model identity mismatch or missing: {sorted(record["models"])}')
        terminal = sorted(record.pop('terminal_events'))
        record['finished'] = bool(terminal) and terminal[-1][1] == 'task_complete'
        if not record['finished']: errors.append(f'{tid}: final completed thread event missing')
        snapshots = sorted(record.pop('snapshots'), key=lambda x: (x[0], x[1]))
        previous = None
        for _, _, vector in snapshots:
            if previous and any(vector[k] < previous[k] for k in FIELDS):
                errors.append(f'{tid}: cumulative counters decreased or duplicate copies conflict')
            previous = vector
        record['totals'] = previous
        record['models'] = sorted(record['models']); record['efforts'] = sorted(record['efforts'])
        if previous is None: errors.append(f'{tid}: no usable native cumulative token counters')
        else:
            for k in FIELDS: totals[k] += previous[k]
    roots = sum(r['parent_thread_id'] is None for r in threads.values())
    children = len(threads) - roots
    if roots != 1: errors.append(f'expected one root thread, observed {roots}')
    if require_children and not children: errors.append('actual child rollout required but none found')
    for child in expected_children - threads.keys(): errors.append(f'spawned child rollout missing: {child}')
    # A model/tool request can name a child even when the lifecycle event is absent.
    return {'totals': totals, 'complete': not errors, 'root_count': roots, 'child_count': children,
            'thread_count': len(threads), 'errors': sorted(set(errors)), 'threads': list(threads.values()),
            'accounting_basis': 'one final cumulative native token vector per session_meta.id; CLI/Harbor totals excluded',
            'limitation': 'native counters only; undisclosed/unflushed provider usage and children absent from all telemetry cannot be recovered'}
