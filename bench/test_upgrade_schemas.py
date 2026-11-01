"""Structural schema checks plus the controller's semantic validator, without models."""
import hashlib
import copy
import json
from pathlib import Path
import subprocess
import unittest
import jsonschema

ROOT = Path(__file__).resolve().parents[1]

class UpgradeSchemaTests(unittest.TestCase):
    def test_schema_02_structural_and_runtime_agree_on_shared_corpus(self):
        schema = json.loads((ROOT / 'docs/schemas/contract-v3.schema.json').read_text())
        jsonschema.Draft202012Validator.check_schema(schema)
        base = json.loads((ROOT / 'test/fixtures/upgrade/v2-run.json').read_text())['normalized']
        base.update(schema_version=3, source_mode='clean', context={'policy':'evidence-v1','files':[],'symbols':[],'frames':[]})
        cases = [(base, True)]
        for extra in ({'unknown':True}, {'source_mode':'unsafe'}, {'context':{'files':['../escape']}}, {'budget':{'max_attempts':0}}):
            cases.append(({**copy.deepcopy(base), **extra}, False))
        for value, valid in cases:
            errors = list(jsonschema.Draft202012Validator(schema).iter_errors(value))
            self.assertEqual(not errors, valid, errors)
            result = subprocess.run(['node','--input-type=module','-e',
                "import{normalizeContract}from'./src/contracts.mjs';import{readFileSync}from'node:fs';normalizeContract(JSON.parse(readFileSync(0,'utf8')));"],
                input=json.dumps(value),cwd=ROOT,text=True,capture_output=True)
            self.assertEqual(result.returncode == 0, valid, result.stderr)

    def test_SCHEMA_02_new_artifact_schemas_share_structural_corpus(self):
        from .journey import digest
        sha='a'*64
        profile={'schema_version':1,'scope':'.','evidence':[],'runtime':{'kind':'node','declared_version':None},'test':{'adapter':'none','roots':[],'expected_tests':[],'plugins':[]},'environment':{'mode':'existing-image','image':'node:fixture','lockfiles':[]},'conventions':[],'readiness':'draft','missing':[]}
        versions={'plan':1,'context':'evidence-v1','adapters':1,'profile':1}
        plan={'schema_version':1,'ready':False,'code':'PLAN_NOT_READY','contract_digest':sha,'profile_digest':sha,'environment_digest':sha,'origin':{'root_id':sha,'head':'a'*40,'ref':'refs/heads/main','index_digest':sha,'inventory_digest':sha,'source_mode':'clean'},'model':'gpt-6.1-sol','reasoning':'medium','context_policy':'evidence-v1','versions':versions,'verifier_identity':sha,'baseline':[],'next_action':'Prepare project'}
        env={'schema_version':1,'ready':True,'recipe':'existing-image','template_version':1,'base_image_id':'sha256:'+sha,'base_reference':'node:fixture','platform':'linux/arm64','network_required':False,'inputs':[],'dockerfile_sha256':hashlib.sha256(b'FROM node:fixture\n').hexdigest(),'profile':profile,'profile_digest':digest(profile),'install_argv':[]}
        env['environment_key']=digest({k:env[k] for k in ('template_version','platform','base_image_id','inputs','install_argv')})
        for schema_name,module,validator,value in [('project-profile','project-profile','profileShape',profile),('job-plan','job-plan','validateJobPlan',plan),('environment-plan','environment-plan','validateEnvironmentPlan',env)]:
            schema=json.loads((ROOT/f'docs/schemas/{schema_name}.schema.json').read_text());jsonschema.Draft202012Validator.check_schema(schema)
            for record,valid in [(value,True),({**value,'unexpected':'not allowed'},False)]:
                self.assertEqual(not list(jsonschema.Draft202012Validator(schema).iter_errors(record)),valid)
                script=f"import{{{validator}}}from'./src/{module}.mjs';import{{readFileSync}}from'node:fs';{validator}(JSON.parse(readFileSync(0,'utf8')));"
                result=subprocess.run(['node','--input-type=module','-e',script],input=json.dumps(record),cwd=ROOT,text=True,capture_output=True)
                self.assertEqual(result.returncode==0,valid,result.stderr)
