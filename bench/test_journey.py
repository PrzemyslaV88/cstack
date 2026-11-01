import copy, unittest
from .journey import schedule, authorize, digest, summarize, bootstrap, phase_total, validate_cases
class JourneyTests(unittest.TestCase):
    def test_BENCH_01_frozen_latin_schedule(self):
        cases=[{'id':'a'},{'id':'b'}]; rows=schedule(cases,3)
        self.assertEqual(len(rows),18);self.assertEqual([r['arm'] for r in rows[:3]],['old-cstack','new-cstack','plain-codex'])
        self.assertEqual([r['arm'] for r in rows[3:6]],['new-cstack','plain-codex','old-cstack']);self.assertEqual(digest(rows),digest(schedule(cases,3)))
    def test_BENCH_03_BENCH_04_BENCH_05_failures_unknown_and_pending_review(self):
        rows=[{'usage_complete':True,'tokens':100,'graded':True,'delivered':False,'active_ms':10},{'usage_complete':True,'tokens':300,'graded':False,'delivered':False,'active_ms':30}]
        stats=summarize(rows);self.assertEqual(stats['tokens_per_graded_pass'],400);self.assertIsNone(stats['tokens_per_delivered_fix']);self.assertEqual(stats['median_active_ms'],20)
        rows[1]['usage_complete']=False;self.assertIsNone(summarize(rows)['tokens']);self.assertIsNone(summarize(rows)['tokens_per_graded_pass'])
    def test_BENCH_06_leaf_phase_arithmetic_keeps_unknown(self):
        self.assertEqual(phase_total([{'leaf':False,'duration_ms':30},{'duration_ms':10},{'duration_ms':20}]),30)
        self.assertIsNone(phase_total([{'duration_ms':None},{'duration_ms':10}]))
    def test_BENCH_07_stable_case_bootstrap(self):
        rows=[{'case':case,'arm':arm,'usage_complete':True,'tokens':tokens,'graded':True,'delivered':False,'active_ms':tokens} for case in ('a','b') for _ in range(3) for arm,tokens in [('old-cstack',100),('new-cstack',50)]]
        a=bootstrap(rows,200);self.assertEqual(a,bootstrap(rows,200));self.assertEqual(a['tokens_per_graded_pass']['interval'],[.5,.5]);rows[0]['usage_complete']=False;self.assertIsNone(bootstrap(rows,200)['tokens_per_graded_pass']['interval'])
    def test_BENCH_08_no_implicit_paid_authorization(self):
        m={'model':'gpt-6.1-sol','limits':{'max_attempts':2},'schedule':[{'id':'one'}]};b={'approved':False,'approval':{'by':None,'reference':None},'manifest_digest':'frozen','model':m['model'],'limits':m['limits'],'trial_ids':['one'],'max_cumulative_observed_tokens':100}
        with self.assertRaises(ValueError):authorize(m,b,'frozen')
        b.update(approved=True,approval={'by':'fixture human','reference':'explicit test authorization'});self.assertEqual(authorize(m,b,'frozen'),100)
        b['limits']={'max_attempts':3}
        with self.assertRaises(ValueError):authorize(m,b,'frozen')
        with self.assertRaises(ValueError):validate_cases([{'id':'synthetic'}]*12,'full')

    def test_BENCH_04_BENCH_06_model_denominator_and_missing_time(self):
        rows=[{'case':'a','arm':'old-cstack','worker_invocations':1,'usage_complete':True,'tokens':100,'active_ms':10,'graded':True}, {'case':'a','arm':'new-cstack','worker_invocations':1,'usage_complete':False,'tokens':None,'graded':False}, {'case':'b','arm':'new-cstack','worker_invocations':0,'usage_complete':True,'tokens':0,'status':'SETUP_FAILED'}]
        stats=summarize(rows);self.assertEqual(stats['model_invoking_trials'],2);self.assertEqual(stats['accounting_completeness'],.5);self.assertIsNone(stats['tokens']);self.assertIsNone(bootstrap(rows,100)['median_active_ms']['interval'])
        self.assertIsNone(summarize([{'usage_complete':True,'tokens':True}])['tokens'])

    def test_BENCH_03_regression_and_unknown_invocation_are_never_invented(self):
        rows=[{'graded':True,'worker_invocations':1,'usage_complete':True,'tokens':10}]
        self.assertIsNone(summarize(rows)['regression_rate'])
        rows[0]['regression_failed']=False;self.assertEqual(summarize(rows)['regression_rate'],0)
        rows.append({'graded':False,'regression_failed':True,'worker_invocations':1,'usage_complete':True,'tokens':20});self.assertEqual(summarize(rows)['regression_rate'],.5)
        rows.append({'status':'INFRA_ERROR','usage_complete':False,'tokens':None});self.assertIsNone(summarize(rows)['accounting_completeness'])
