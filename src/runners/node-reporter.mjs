// Trusted parent reporter. Candidate stdout is diagnostic data, never a test verdict.
export default async function* report(source) {
  for await (const event of source) {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const d = event.data;
      yield JSON.stringify({ type: event.type, name: d.name, nesting: d.nesting,
        skip: Boolean(d.skip), todo: Boolean(d.todo), error: d.details?.error?.message || null }) + '\n';
    }
  }
  yield JSON.stringify({ type: 'cstack:test-stream-complete' }) + '\n';
}
