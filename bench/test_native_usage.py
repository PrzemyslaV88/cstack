import json
import tempfile
import unittest
from pathlib import Path
from .native_usage import reconcile_sessions, usage_delta, FIELDS

class AccountingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
    def write(self, name, tid='root', parent=None, values=(10,20), model='gpt-6.1-sol', malformed=False):
        meta={'id':tid, 'session_id':'root', 'source':'exec'}
        if parent: meta['source']={'subagent':{'thread_spawn':{'parent_thread_id':parent,'depth':1}}}
        rows=[{'type':'session_meta','payload':meta},{'type':'turn_context','payload':{'model':model,'effort':'medium'}}]
        rows += [{'timestamp':str(i), 'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':{**{k:v for k in FIELDS}, 'total_tokens':2*v,'cache_write_input_tokens':0}}}} for i,v in enumerate(values)]
        rows.append({'timestamp':'z','type':'event_msg','payload':{'type':'task_complete'}})
        (self.root/name).write_text('\n'.join(json.dumps(r) for r in rows)+ ('\n{' if malformed else ''))
    def test_single(self):
        self.write('r.jsonl'); r=reconcile_sessions(self.root,'gpt-6.1-sol'); self.assertTrue(r['complete']); self.assertEqual(r['totals']['input_tokens'],20)
    def test_parent_child_shared_session_id(self):
        self.write('r.jsonl'); self.write('c.jsonl','child','root',values=(3,5)); r=reconcile_sessions(self.root,'gpt-6.1-sol',True); self.assertTrue(r['complete']); self.assertEqual(r['totals']['input_tokens'],25)
    def test_duplicate_copy_once(self):
        self.write('r.jsonl'); self.write('copy.jsonl'); self.assertEqual(reconcile_sessions(self.root,'gpt-6.1-sol')['totals']['total_tokens'],40)
    def test_resume_longer_once(self):
        self.write('r.jsonl'); self.write('copy.jsonl',values=(10,20,30)); self.assertEqual(reconcile_sessions(self.root,'gpt-6.1-sol')['totals']['total_tokens'],60)
    def test_decrease_invalid(self):
        self.write('r.jsonl',values=(20,10)); self.assertFalse(reconcile_sessions(self.root,'gpt-6.1-sol')['complete'])
    def test_missing_child(self):
        self.write('r.jsonl'); self.assertFalse(reconcile_sessions(self.root,'gpt-6.1-sol',True)['complete'])
    def test_missing_telemetry(self):
        self.write('r.jsonl'); self.write('c.jsonl','child','root',values=()); self.assertFalse(reconcile_sessions(self.root,'gpt-6.1-sol')['complete'])
    def test_model_mismatch(self):
        self.write('r.jsonl',model='wrong'); self.assertFalse(reconcile_sessions(self.root,'gpt-6.1-sol')['complete'])
    def test_malformed_tail(self):
        self.write('r.jsonl',malformed=True); self.assertFalse(reconcile_sessions(self.root,'gpt-6.1-sol')['complete'])
    def test_controller_charges_tree_delta_once_on_resume(self):
        first={key:10 for key in FIELDS}; first['total_tokens']=20
        second={key:30 for key in FIELDS}; second['total_tokens']=60
        self.assertEqual(usage_delta(None,first)['total_tokens'],20)
        self.assertEqual(usage_delta(first,second)['total_tokens'],40)
        self.assertEqual(usage_delta(second,second)['total_tokens'],0)
        with self.assertRaisesRegex(ValueError,'decreasing'):
            usage_delta(second,first)
if __name__=='__main__': unittest.main()
