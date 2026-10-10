"""Diagnostic labels preserve the collector's bounded semantic failure codes."""
import ast
import inspect
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import official_research_diagnostics as diagnostics


class ResearchFailureReasonParityTests(unittest.TestCase):
    def test_every_explicit_run_once_validation_failure_has_a_diagnostic_label(self):
        sets = [{item.value for item in node.elts if isinstance(item, ast.Constant)
                 and isinstance(item.value, str)}
                for node in ast.walk(ast.parse(inspect.getsource(research.run_once)))
                if isinstance(node, ast.Set)]
        supported = [values for values in sets if {'invalid-note', 'changed-action-capacity'} <= values]
        self.assertEqual(len(supported), 1)
        for reason in supported[0]:
            with self.subTest(reason=reason):
                self.assertIn(reason, diagnostics.ISSUES)
                self.assertEqual(diagnostics.failure_kind(reason), reason)

    def test_relation_failures_are_not_mislabeled_as_item_shape_errors(self):
        item = {'ja': '検証用の文章', 'en': 'Synthetic review text.',
                'evidenceQuote': 'Synthetic source evidence for the review.'}
        payload = json.dumps({'title': item, 'summary': item, 'purpose': item,
                              'facts': [item, item, item]})
        for reason in ('changed-action-capacity', 'changed-execution-period', 'changed-amount-relation'):
            with self.subTest(reason=reason), \
                    patch.object(research, 'validate', side_effect=ValueError(reason)), \
                    patch.object(research, 'validate_item', side_effect=ValueError(reason)):
                result = diagnostics.validation_report(payload, {'body': item['evidenceQuote'], 'title': 'Review'})
                self.assertEqual(result['status'], 'invalid')
                self.assertEqual(len(result['issues']), 6)
                self.assertEqual({issue['issue'] for issue in result['issues']}, {reason})
                self.assertNotIn('evidenceQuote', json.dumps(result))
        self.assertEqual(diagnostics.failure_kind('unreviewed-private-error-text'), 'unclassified')


if __name__ == '__main__':
    unittest.main()
