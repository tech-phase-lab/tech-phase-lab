"""Synthetic rotating-index regressions; no network requests or real posts."""
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals
from html_signals import collect, sanitize_queue_overflow


class HtmlSignalRetryRetentionTests(unittest.TestCase):
    def setUp(self):
        self.source = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')
        self.calls = []
        self.checked = '2026-10-02T18:05:00+00:00'
        self.article = ('<main><article><h1>NVIDIA infrastructure update</h1><p>'
                        + 'NVIDIA announced infrastructure partnerships. ' * 8 + '</p></article></main>').encode()

    def url(self, value):
        return f'https://www.prnewswire.com/news-releases/synthetic-{value}.html'

    def failure(self, **changes):
        return {'baseline': False, 'checked': '2026-10-02T17:05:00+00:00',
                'next_check': '2026-10-02T18:10:00+00:00', 'failures': 3,
                'error': 'signal-article-body-invalid',
                'first_failed_at': '2026-10-02T17:05:00+00:00', 'failure_attempts': 3, **changes}

    def run_index(self, children, generation=0, previous=None, fail=False):
        self.calls = []
        urls = [self.url(f'{generation}-{i}') for i in range(100)]
        def request(source, _validators):
            if source['url'] == self.source['url']:
                return {'body': ''.join(f'<a href="{url}">Story</a>' for url in urls).encode()}
            self.calls.append(source['url'])
            if fail:
                raise TimeoutError('private-provider-detail')
            return {'body': self.article}
        result = collect(self.source, {'index_state': previous or json.dumps({
            'initialized': True, 'children': children})}, ['NVDA'], request, lambda: self.checked)
        self.assertLessEqual(len(self.calls), 3)
        self.assertLessEqual(len(result['index_state']), 2_000_000)
        return result, json.loads(result['index_state'])

    def test_deferred_failure_survives_successive_full_index_rotations_and_reload(self):
        old = self.url('old-error')
        original = self.failure()
        response, state = self.run_index({old: original})
        for generation in range(1, 4):
            response, state = self.run_index({}, generation, response['index_state'])
            self.assertIn(old, state['children'])
            self.assertEqual(state['children'][old]['next_check'], original['next_check'])
            self.assertEqual(state['children'][old]['failure_attempts'], 3)
            self.assertNotIn(old, self.calls)
            self.assertEqual(state['recoveries'], [])
            self.assertGreaterEqual(response['article_errors'], 1)
            self.assertLessEqual(len(state['children']), 200)
        self.assertGreater(response['article_queue_overflow'], 0)

    def test_due_rotated_fresh_failure_gets_reserved_slot_amid_new_urls(self):
        old = self.url('old-error')
        response, state = self.run_index({old: self.failure()})
        self.checked = '2026-10-02T18:10:00+00:00'
        response, state = self.run_index({}, 1, response['index_state'])
        self.assertIn(old, self.calls)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(state['children'][old]['succeeded'], self.checked)
        self.assertIsNone(state['children'][old]['error'])
        self.assertEqual(len(state['recoveries']), 1)
        self.assertEqual(state['recoveries'][0]['attempts'], 4)

    def test_saturated_unresolved_queue_reports_overflow_but_still_makes_progress(self):
        children = {self.url(f'held-{i}'): self.failure(
            error='http-403', next_check='2026-10-03T18:00:00+00:00') for i in range(197)}
        children.update({self.url(f'due-{i}'): {'baseline': True} for i in range(3)})
        response, state = self.run_index(children)
        self.assertEqual(response['article_queue_overflow'], 100)
        self.assertEqual(set(state['children']), set(children))
        self.assertEqual(self.calls, [self.url(f'due-{i}') for i in range(3)])
        self.assertEqual(state['queueOverflow']['observations'], 1)
        for i in range(197):
            self.assertEqual(state['children'][self.url(f'held-{i}')]['next_check'], '2026-10-03T18:00:00+00:00')
        response, later = self.run_index({}, 1, response['index_state'])
        self.assertEqual(response['article_queue_overflow'], 97)
        self.assertEqual(later['queueOverflow']['observations'], 2)
        self.assertEqual(later['recoveries'], [])

    def test_completed_history_is_evicted_before_unresolved_retries(self):
        old = self.url('old-error')
        complete = {'baseline': True, 'succeeded': self.checked,
                    'checked': self.checked, 'next_check': '2026-10-02T19:05:00+00:00'}
        children = {self.url(f'done-{i}'): complete.copy() for i in range(199)}
        children[old] = self.failure()
        response, state = self.run_index(children)
        self.assertIn(old, state['children'])
        self.assertEqual(len(state['children']), 200)
        self.assertEqual(response['article_queue_overflow'], 0)
        self.assertEqual(sum('/synthetic-0-' in url for url in state['children']), 100)
        self.assertEqual(sum('/synthetic-done-' in url for url in state['children']), 99)

    def test_overflow_persists_explicit_route_error_and_safe_historical_observations(self):
        children = {self.url(f'pending-{i}'): {'baseline': True} for i in range(200)}
        response, state = self.run_index(children)
        with tempfile.TemporaryDirectory() as tmp:
            db = monitor.connect(Path(tmp) / 'monitor.sqlite')
            try:
                signals.schema(db)
                signals.save(db, self.source, response['_items'], response, self.checked,
                             signals.fingerprint(self.source, ['NVDA']), 1)
                row = db.execute('SELECT error FROM signal_routes WHERE id=?', (self.source['id'],)).fetchone()
                self.assertEqual(row['error'], 'article-queue-overflow')
                self.assertEqual(monitor.persisted_route_error_code(row['error']), row['error'])
                summary = signals.operational_summary(db, sources=[self.source], reference=datetime(2026,10,2,18,5,tzinfo=timezone.utc))
                coverage = summary['articleRetrieval']['admissionOverflow']
                self.assertEqual(coverage, {'routes':1,'unadmitted':100,'observations':1,'maxUnadmitted':100,'lastAt':self.checked})
                self.assertEqual(summary['routes']['error'],1)
                self.assertNotIn('synthetic-',json.dumps(coverage))
            finally:
                db.close()
        # A later unsaturated response retains the coverage-gap evidence; it
        # never manufactures article recovery measurements.
        state['children'] = {self.url('completed'): {'baseline':True,'succeeded':self.checked}}
        response, state = self.run_index({}, 1, json.dumps(state))
        self.assertEqual(response['article_queue_overflow'],0)
        self.assertEqual(state['queueOverflow']['observations'],1)
        self.assertEqual(state['queueOverflow']['lastAt'],self.checked)
        self.assertEqual(state['recoveries'],[])
        sanitized = sanitize_queue_overflow({'current':True,'observations':'private','maxUnadmitted':999999,'lastAt':'private-url'})
        self.assertEqual(sanitized,{'current':0,'observations':0,'maxUnadmitted':0,'lastAt':None})


if __name__ == '__main__':
    unittest.main()
