import { html } from './cli-output.mjs';
import { workflowSummary } from './workflow.mjs';

export function requirementCoverage(run, stale = false) {
  return run.contract.criteria.map(c => {
    const before = run.baseline[c.id], after = run.results[c.id];
    const source = run.preparation?.outcome_sources.find(s => s.id === c.id);
    const evidence = p => p?.evidence_hash ? { record: p.evidence_hash, output: p.output_hash, candidate: p.fingerprint } : null;
    return { id: c.id, text: c.text, required: c.required,
      before: before?.status || 'NOT_RUN', after: stale ? 'STALE' : after?.status || 'NOT_RUN',
      baseline_evidence: evidence(before), candidate_evidence: evidence(after),
      expectation_source: source?.source || null, interface: source?.seam || null,
      integration: run.preparation?.integration_criteria.includes(c.id) || false };
  });
}

export function standardsReview(files) {
  return { status: 'NOT_SEMANTICALLY_REVIEWED', note: 'Text-change signals are advisory. No independent model or human standards review was performed.',
    findings: files.flatMap(f => f.syntax_flags.map(flag => ({ path: f.path, flag, kind: 'text-signal' }))) };
}

export function summaryMarkdown(r) {
  return ['## Requirements','',...r.requirements.map(c =>
    `- <code>${html(c.id)}</code>: ${html(c.before)} → ${html(c.after)}${c.integration?' (integration)':''} — ${html(c.text)}`+
    (!r.stale&&c.candidate_evidence?` ([candidate evidence](evidence/${c.candidate_evidence.record}.json))`:'')+
    (!r.stale&&c.baseline_evidence?` ([baseline evidence](evidence/${c.baseline_evidence.record}.json))`:'')),
    '', '## Standards', '', r.standards.note,
    ...r.standards.findings.map(f => `- <code>${html(f.path)}</code>: ${html(f.flag)}`),
    '', '## Workflow', '', `Phase: ${html(r.workflow.phase || 'legacy')}; context occupancy: unknown.`,
    ...r.workflow.sessions.map(s => `- ${html(s.task)}: ${html(s.action || 'legacy')}; ${html(s.reason || 'continuity')}; notes ${html(s.notes)}`), ''].join('\n');
}

export function pullRequestMarkdown(r) {
  return ['## Summary','',`<p>${html(r.goal)}</p>`, '',
    `Result: **${html(r.status)}**. Candidate: <code>${html(r.candidate)}</code>.`, '',
    '## Evidence','',...r.requirements.map(c => `- <code>${html(c.id)}</code>: before **${html(c.before)}**, after **${html(c.after)}** — ${html(c.text)}`),
    '',`Automated checks: ${html(r.automated_checks)}. Human review: ${html(r.human_review)}. Delivery: ${html(r.delivery)}.`,
    '', '## Review and delivery considerations','',
    `Changed files: ${r.files.length}. Protected changes: ${r.files.filter(f=>f.protected).length}.`,
    ...r.pending.map(p => `- Pending ${html(p.criterion)}: ${html(p.reason)}`),
    'Rollback and production effects need project-specific assessment. This local summary does not create or publish a pull request.', ''].join('\n');
}

export { workflowSummary };
