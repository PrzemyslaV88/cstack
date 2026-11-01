import json, tempfile, unittest
from pathlib import Path
from .journey_native import collect_trial
from .native_usage import FIELDS
class NativeJourneyTests(unittest.TestCase):
    def test_BENCH_04_native_tree_excludes_outer_chat_and_counts_helpers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);sessions=root/'sessions';sessions.mkdir()
            def record(name,tid,parent=None):
                meta={'id':tid,'source':'exec'}
                if parent:meta['parent_thread_id']=parent
                usage={key:0 for key in FIELDS};usage.update(input_tokens=10,output_tokens=2,total_tokens=12)
                rows=[{'type':'session_meta','payload':meta},{'type':'turn_context','payload':{'model':'gpt-6.1-sol','effort':'medium'}},{'type':'event_msg','payload':{'type':'token_count','info':{'total_token_usage':usage}}},{'type':'event_msg','payload':{'type':'task_complete'}}]
                (sessions/name).write_text('\n'.join(map(json.dumps,rows)))
            record('outer.jsonl','outer');record('trial.jsonl','trial');a=collect_trial(sessions,root/'one','trial','gpt-6.1-sol');self.assertTrue(a['primary_arm_valid']);self.assertEqual(a['totals']['total_tokens'],12);self.assertFalse(collect_trial(sessions,root/'wrong-effort','trial','gpt-6.1-sol','high')['complete']);self.assertEqual(len(list((root/'one').glob('*'))),1)
            record('helper.jsonl','helper','trial');b=collect_trial(sessions,root/'two','trial','gpt-6.1-sol');self.assertTrue(b['complete']);self.assertFalse(b['primary_arm_valid']);self.assertEqual(b['child_count'],1);self.assertEqual(b['totals']['total_tokens'],24)
            with (sessions/'trial.jsonl').open('a') as f:f.write('\n{')
            self.assertFalse(collect_trial(sessions,root/'three','trial','gpt-6.1-sol')['complete'])
    def test_BENCH_04_missing_root_is_unknown_not_zero_usage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'sessions').mkdir();r=collect_trial(root/'sessions',root/'output','missing','gpt-6.1-sol');self.assertFalse(r['complete']);self.assertFalse(r['primary_arm_valid'])
