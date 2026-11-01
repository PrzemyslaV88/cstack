import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeContract} from '../src/contracts.mjs';
import {canonicalJson,digestOf,hash,json} from '../src/util.mjs';
const fixture=JSON.parse(await readFile(new URL('./fixtures/upgrade/v2-run.json',import.meta.url)));
test('BASE-02 SCHEMA-01: original schema-2 normalization and hash stay unchanged',()=>{
  assert.deepEqual(normalizeContract(fixture.input),fixture.normalized);
  assert.equal(hash(json(normalizeContract(fixture.input))),fixture.contract_hash);
});
test('SCHEMA-02: canonical identities ignore key insertion order, preserve array order',()=>{
  assert.equal(digestOf({b:1,a:{z:2,b:3}}),digestOf({a:{b:3,z:2},b:1}));
  assert.notEqual(digestOf([1,2]),digestOf([2,1])); assert.throws(()=>canonicalJson({a:Infinity}));
});
test('SCHEMA-03: schema 3 is additive, strict, and defaults to clean evidence context',()=>{
  const v3=normalizeContract({...fixture.input,schema_version:3});
  assert.equal(v3.source_mode,'clean');assert.equal(normalizeContract({...fixture.input,schema_version:3,source_mode:'working-copy'}).source_mode,'working-copy'); assert.equal(v3.context.policy,'evidence-v1');
  assert.deepEqual(v3.criteria,fixture.normalized.criteria);
  assert.throws(()=>normalizeContract({...fixture.input,schema_version:3,project:{profile_digest:'a'.repeat(64)}}));
});
test('SCHEMA-04 SCHEMA-05: reject unsafe, unknown, oversized and unsupported contract inputs',()=>{
  const raw={...fixture.input,schema_version:3};
  for(const extra of [{extra:1},{context:{files:['../escape']}},{source_mode:'invalid'},{context:{frames:[{path:'a.py',line:0}]}},{goal:'a'.repeat(4097)}]) assert.throws(()=>normalizeContract({...raw,...extra}));
  assert.throws(()=>normalizeContract({...raw,criteria:[{id:'M',kind:'manual',text:'Human',argv:['true']}]}));
  assert.throws(()=>normalizeContract({...raw,criteria:[{id:'T',kind:'test-suite',text:'Tests',adapter:'vitest',roots:['.'],expected_tests:['one'],plugins:['evil']}]}));
});
