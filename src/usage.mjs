const valid = n => Number.isSafeInteger(n) && n >= 0;
export function classifyUsage(events, source = 'native') {
  if (!Array.isArray(events) || !events.length) return { status: 'unknown', diagnostic: 'Missing usage vector', totals: null, source };
  const totals = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, reasoning_output_tokens: 0 };
  for (const e of events) {
    if (!e || !valid(e.input_tokens) || !valid(e.output_tokens)) return { status: 'invalid', diagnostic: 'Missing or invalid input/output count', totals: null, source };
    for (const [key, parent] of [['cached_input_tokens', 'input_tokens'], ['reasoning_output_tokens', 'output_tokens']]) {
      if (e[key] !== undefined && e[key] !== null && (!valid(e[key]) || e[key] > e[parent])) return { status: 'invalid', diagnostic: 'Invalid token subset: ' + key, totals: null, source };
      if (e[key] === undefined || e[key] === null) totals[key] = null;
      else if (totals[key] !== null) totals[key] += e[key];
    }
    totals.input_tokens += e.input_tokens; totals.output_tokens += e.output_tokens;
    if (!valid(totals.input_tokens + totals.output_tokens)) return { status: 'invalid', diagnostic: 'Token sum exceeds safe integer range', totals: null, source };
  }
  totals.total_tokens = totals.input_tokens + totals.output_tokens;
  return { status: 'complete', diagnostic: null, totals, source };
}
export function accountingForRun(attempts = []) {
  let known = 0; const unknown = [];
  for (const attempt of attempts) {
    const accounting = classifyUsage(attempt.usage, attempt.accounting_source || 'legacy');
    if (accounting.totals && attempt.usage_status !== 'invalid') known += accounting.totals.total_tokens;
    if (accounting.status !== 'complete' || attempt.usage_status && attempt.usage_status !== 'complete' || ['RESERVED','RUNNING','INTERRUPTED'].includes(attempt.status) && !attempt.usage?.length) unknown.push(attempt.id);
  }
  return { accounting_complete: !unknown.length, known_total_tokens: known, total_tokens: unknown.length ? null : known,
    unknown_attempt_ids: unknown, can_admit: !unknown.length, diagnostic: unknown.length ? 'USAGE_UNRESOLVED' : null };
}
