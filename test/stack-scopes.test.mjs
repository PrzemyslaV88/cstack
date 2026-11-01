import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {repository} from '../src/repository.mjs';
import {analyzeStack} from '../src/stack-analysis.mjs';
import {stackMarkdown} from '../src/analysis-report.mjs';
test('SCOPE-01 SCOPE-02 SCOPE-03 SCOPE-04: manifest scopes prevent benchmark frameworks becoming application dependencies',async t=>{
  const root=await mkdtemp(join(tmpdir(),'cstack-scopes-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [p,s] of Object.entries({'package.json':'{"dependencies":{"react":"18"}}','bench/requirements.lock':'fastapi==0.100.0\nstarlette==0.27.0\n','apps/web/package.json':'{"dependencies":{"react":"19"},"devDependencies":{"vitest":"4.0.18"}}','tests/example.py':'import unittest\n'})) {await mkdir(dirname(join(root,p)),{recursive:true});await writeFile(join(root,p),s);}
  const a=await analyzeStack(await repository(root));
  const fast=a.scoped_findings.find(f=>f.name==='FastAPI'); assert.equal(fast.scope_id,'bench');assert.deepEqual(fast.dependency_relations,['lockfile-only']);
  assert.equal(a.scoped_findings.filter(f=>f.name==='React').length,2);
  assert.equal(a.scopes.find(s=>s.id==='bench').kind,'benchmark');assert.match(stackMarkdown(a),/Lockfile-only declarations/);
  assert.equal(a.scoped_findings.find(f=>f.name==='Vitest').dependency_relations[0],'declared-development');
});
test('SCOPE-05 SCOPE-06: malformed manifests remain warnings and scoped results are stable',async t=>{
  const root=await mkdtemp(join(tmpdir(),'cstack-scope-bad-'));t.after(()=>rm(root,{recursive:true,force:true})); await writeFile(join(root,'package.json'),'{broken');
  const a=await analyzeStack(await repository(root)),b=await analyzeStack(await repository(root));
  assert.ok(a.warnings.length); assert.deepEqual(a.scoped_findings,b.scoped_findings); assert.ok(Array.isArray(a.findings)); assert.equal(a.schema_version,2);
});
