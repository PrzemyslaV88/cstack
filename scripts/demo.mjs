#!/usr/bin/env node
// 30-second, model-free demo: an "agent" claims done with a wrong fix, cstack verify says no;
// then it rewrites the checks to pass, verify still says no; then a real fix is verified.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyChange } from '../src/verify.mjs';
import { git } from '../src/snapshot.mjs';

const root = await mkdtemp(join(tmpdir(), 'cstack-demo-')), repo = join(root, 'shop'), home = join(root, 'state');
const show = (title, r) => console.log(`\n${title}\n  → ${r.outcome.toUpperCase()}: ${r.reason}${r.checks_file?.modified ? '\n    (the edited checks were ignored: verify read them from the committed base)' : ''}${r.failing?.length ? '\n    ' + r.failing.map(f => `${f.id}: ${f.diagnostic.split('\n')[0]}`).join('\n    ') : ''}`);
try {
  await mkdir(join(repo, '.cstack'), { recursive: true });
  await writeFile(join(repo, 'price.mjs'), '// Total for a cart, with 20% VAT\nexport const total = items => items.reduce((sum, i) => sum + i.price, 0) * 1.2;\n');
  const driver = "import {readFileSync} from 'node:fs';import {total} from './price.mjs';console.log(JSON.stringify(Math.round(total(JSON.parse(readFileSync(0,'utf8')))*100)/100))";
  await writeFile(join(repo, '.cstack', 'checks.json'), JSON.stringify({ goal: 'Totals must count item quantity', criteria: [{ id: 'QTY', kind: 'probe',
    text: 'Total counts quantity', argv: ['node', '--input-type=module', '-e', driver],
    cases: [{ id: 'two-of', stdin: '[{"price":10,"qty":2}]', expect_json: 24 }, { id: 'mixed', stdin: '[{"price":5,"qty":1},{"price":2.5,"qty":4}]', expect_json: 18 }] }] }, null, 2));
  await git(repo, 'init', '-q'); await git(repo, 'add', '-A');
  await git(repo, '-c', 'user.name=demo', '-c', 'user.email=demo@example.invalid', 'commit', '-qm', 'Bug: totals ignore quantity');
  console.log('A shop computes cart totals but ignores quantity. The checks are committed in .cstack/checks.json.');

  await writeFile(join(repo, 'price.mjs'), '// Total for a cart, with 20% VAT\nexport const total = items => items.reduce((sum, i) => sum + i.price, 0) * 1.2 * items.length;\n');
  console.log('\n1. The agent "fixes" it and says: "Done, all tests pass."');
  show('   cstack verify', await verifyChange({ repo, checks: join(repo, '.cstack', 'checks.json'), home }));

  await writeFile(join(repo, '.cstack', 'checks.json'), JSON.stringify({ goal: 'x', criteria: [{ id: 'QTY', kind: 'probe', text: 'weakened', argv: ['node', '-e', 'console.log(24)'], cases: [{ id: 'two-of', stdin: '', expect_json: 24 }] }] }));
  console.log('\n2. The agent edits the checks so they pass and says "Done" again.');
  show('   cstack verify', await verifyChange({ repo, checks: join(repo, '.cstack', 'checks.json'), home }));

  await git(repo, 'checkout', '--', '.cstack/checks.json');
  await writeFile(join(repo, 'price.mjs'), '// Total for a cart, with 20% VAT\nexport const total = items => items.reduce((sum, i) => sum + i.price * (i.qty ?? 1), 0) * 1.2;\n');
  console.log('\n3. A real fix.');
  const done = await verifyChange({ repo, checks: join(repo, '.cstack', 'checks.json'), home });
  show('   cstack verify', done);
  console.log(`\nNo model was called. Checks ran offline in an OS sandbox, read from the committed base, and the\nresult is bound to the exact files (cstack verify --check ${done.id} re-confirms before merge).`);
} finally { await rm(root, { recursive: true, force: true }); }
