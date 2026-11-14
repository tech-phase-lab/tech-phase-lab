import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor


def raised(message):
    try:
        raise ValueError(message)
    except ValueError as exc:
        return exc


class DiscoveryFailureDiagnostic(unittest.TestCase):
    def setUp(self):
        monitor._DIAGNOSED_FAILURES.clear()

    def run_once(self, exc, stage='job'):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            monitor.discovery_failure_diagnostic('MU', exc, stage)
        return out.getvalue()

    def test_first_failure_logs_one_masked_json_line(self):
        text = self.run_once(raised('bad https://example.com/p?k=secret me@example.com ' + 'A' * 40 + ' tail'))
        line = json.loads(text)
        self.assertEqual(line['event'], 'discovery-failure-diagnostic')
        self.assertEqual(line['class'], 'ValueError')
        self.assertEqual(line['code'], 'invalid-source-response')
        self.assertEqual(line['message'], 'bad <url> <email> <token> tail')
        self.assertTrue(line['where'].startswith('test_discovery_failure_diagnostic.py:'))
        self.assertLessEqual(len(line['message']), 80)

    def test_same_failure_is_not_logged_twice_but_a_new_one_is(self):
        first = self.run_once(raised('x'))
        self.assertNotEqual(first, '')

        def same_site():
            try:
                raise ValueError('x')
            except ValueError as exc:
                return exc
        self.assertEqual(self.run_once(raised('x')), '')  # same class, same line, same stage
        self.assertNotEqual(self.run_once(raised('x'), stage='source'), '')
        self.assertNotEqual(self.run_once(same_site()), '')

    def test_the_log_is_bounded(self):
        for index in range(60):
            monitor._DIAGNOSED_FAILURES.add(('E', str(index), 'job'))
        self.assertEqual(self.run_once(raised('new')), '')


if __name__ == '__main__':
    unittest.main()
