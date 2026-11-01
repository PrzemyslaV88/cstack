"""Accounting/report regression checks; no model calls."""
import unittest

from .multiagent_test import aggregate, SINGLE, MULTI


class ExtensionReportTests(unittest.TestCase):
    def row(self, arm, **overrides):
        return {'comparison_arm': arm, 'usage_complete': True, 'independent_reward': 1,
                'total_tokens': 120, 'cached_input_tokens': 80, 'agent_seconds': 10,
                'child_agents': 0, **overrides}

    def test_saved_abort_and_current_single_are_distinct(self):
        rows = [self.row(SINGLE), self.row(SINGLE, usage_complete=False, independent_reward=None,
                total_tokens=None, pre_worker_abort=True), self.row('current/' + SINGLE)]
        saved, current = aggregate(rows)
        self.assertEqual(saved['trials'], 2)
        self.assertEqual(saved['private_passes'], 1)
        self.assertEqual(saved['pre_worker_aborts'], 1)
        self.assertEqual(saved['total_tokens'], 120)
        self.assertEqual(current['trials'], 1)

    def test_missing_usage_is_unknown_not_zero(self):
        [result] = aggregate([self.row('current/' + MULTI, usage_complete=False,
                                     total_tokens=None, child_agents=2)])
        self.assertIsNone(result['total_tokens'])
        self.assertFalse(result['accounting_complete'])
        self.assertEqual(result['children'], 2)


if __name__ == '__main__':
    unittest.main()
