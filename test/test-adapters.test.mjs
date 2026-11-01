import test from 'node:test';import assert from 'node:assert/strict';import {writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';
import {fixture} from './helpers/fixture.mjs';import {createRunner} from '../src/sandbox.mjs';import {executeTestSuite,parseAdapterReport,protocolPrefix} from '../src/test-adapters.mjs';
const suite=(adapter,roots,expected_tests=[])=>({adapter,roots,expected_tests,plugins:[],config:null});
test('ADAPTER-01 ADAPTER-03 ADAPTER-08 ADAPTER-09: pytest pass, teardown, skip, xfail, collection and scratch',async t=>{
 const f=await fixture(t,{'tests/test_calc.py':'def test_add():\n assert 4+2==6\n','pyproject.toml':'[tool.pytest.ini_options]\n'}),runner=await createRunner({image:'cstack-test-pytest:8.3.5'}),c=suite('pytest',['tests'],['tests/test_calc.py::test_add']);
 const result=await executeTestSuite(c,runner,{cwd:f.repo});assert.equal(result.parsed.passed,true,JSON.stringify(result));
 const collected=await executeTestSuite(c,runner,{cwd:f.repo,collect_only:true});assert.deepEqual(collected.parsed.ids,c.expected_tests);assert.equal(collected.parsed.passed,true);
 for(const [name,source,outcome] of [['skip','import pytest\n@pytest.mark.skip\ndef test_add(): pass\n','skipped'],['xfail','import pytest\n@pytest.mark.xfail\ndef test_add(): assert False\n','xfail'],['teardown','import pytest\n@pytest.fixture(autouse=True)\ndef fixture():\n yield\n assert False\ndef test_add(): pass\n','failed']]){
  await writeFile(join(f.repo,'tests/test_calc.py'),source);const r=await executeTestSuite(c,runner,{cwd:f.repo});assert.equal(r.parsed.passed,false,name);assert.equal(r.parsed.cases[0].outcome,outcome);
 }
 await writeFile(join(f.repo,'tests/test_calc.py'),"from pathlib import Path\ndef test_add():\n Path('scratch.txt').write_text('ok')\n assert not Path('/candidate/scratch.txt').exists()\n");assert.equal((await executeTestSuite(c,runner,{cwd:f.repo})).parsed.passed,true);await assert.rejects(readFile(join(f.repo,'scratch.txt')));
});
test('ADAPTER-02 ADAPTER-04: Vitest pass, fail, duplicate names and unhandled errors',async t=>{
 const f=await fixture(t,{'package.json':'{"type":"module"}','tests/calc.test.js':"import {test,expect} from 'vitest';test('add',()=>expect(4+2).toBe(6));"});const runner=await createRunner({image:'cstack-test-vitest:4.0.18'}),id=JSON.stringify(['tests/calc.test.js','',[],'add']),c=suite('vitest',['tests'],[id]);
 const collected=await executeTestSuite(c,runner,{cwd:f.repo,collect_only:true});assert.equal(collected.parsed.passed,true,JSON.stringify(collected));assert.deepEqual(collected.parsed.ids,[id]);
 const result=await executeTestSuite(c,runner,{cwd:f.repo});assert.equal(result.parsed.passed,true,JSON.stringify(result));
 await writeFile(join(f.repo,'tests/calc.test.js'),"import {test,expect} from 'vitest';test('add',()=>expect(1).toBe(6));");assert.equal((await executeTestSuite(c,runner,{cwd:f.repo})).parsed.passed,false);
 await writeFile(join(f.repo,'tests/calc.test.js'),"import {test} from 'vitest';test('add',()=>{});test('add',()=>{});");assert.equal((await executeTestSuite(c,runner,{cwd:f.repo})).parsed.error,true);
 await writeFile(join(f.repo,'tests/calc.test.js'),"import {test} from 'vitest';test('add',async()=>{Promise.reject(new Error('uncaught'));await new Promise(r=>setTimeout(r,30));});");assert.equal((await executeTestSuite(c,runner,{cwd:f.repo})).parsed.passed,false);
});
test('ADAPTER-05 ADAPTER-06 ADAPTER-07: malformed, forged, missing, truncated and incompatible streams never pass',()=>{
 const opts={adapter:'pytest',expected_tests:['a']};for(const stdout of ['PASS',protocolPrefix+'{}',protocolPrefix+'{'])assert.equal(parseAdapterReport(stdout,opts).passed,false);
 const events=[{kind:'collection',ids:['a']},{kind:'case',id:'a',outcome:'passed'},{kind:'complete',adapter:'pytest',version:'8.3.5',counts:{passed:1},exit_status:0,staging_before:'a'.repeat(64),staging_after:'a'.repeat(64)}];const encode=es=>es.map(x=>protocolPrefix+JSON.stringify({schema_version:1,...x})).join('\n');assert.equal(parseAdapterReport(encode(events),opts).passed,true);
 assert.equal(parseAdapterReport(encode(events),{...opts,expected_tests:['missing']}).passed,false);assert.equal(parseAdapterReport(encode(events),{...opts,truncated:true}).error,true);
 for(const modify of [e=>e.push(e[2]),e=>e[0].ids=[],e=>e[2].version='9.0',e=>e[2].counts={passed:2},e=>e[1].outcome='todo']){const e=structuredClone(events);modify(e);assert.equal(parseAdapterReport(encode(e),opts).passed,false);}
});
