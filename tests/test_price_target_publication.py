"""Target publication and eligibility diagnostics use the same strict evidence."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import x_comparison


class TargetPublicationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        signals.schema(self.db)
        self.now = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
        self.source = next(source for source in signals.SOURCES if source['id'] == 'x-wallstengine')

    def tearDown(self):
        self.db.close()

    def add(self, index, text='$MU PT raised to $110 from $100 at Citi', *, age=60,
            tickers='["MU"]', kind='new', truncated=False, body=None):
        url = f'https://x.com/wallstengine/status/{index}'
        published = (self.now - timedelta(seconds=age + 10)).isoformat()
        observed = (self.now - timedelta(seconds=age)).isoformat()
        self.db.execute('''INSERT INTO signal_events
          (id,source_id,url,sha,title,tickers_json,matches_json,event_kind,
           published_at,observed_at,excerpt,diff,truncated)
          VALUES(?,?,?,?,?,?,'{}',?,?,?,'','',?)''',
          (index, self.source['id'], url, str(index), text, tickers, kind,
           published, observed, int(truncated)))
        if body is not None:
            self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                            (self.source['id'], url, str(index), text, body, observed, observed))

    def row(self, index):
        return next(row for row in signals.price_target_rows(
            self.db, self.now - timedelta(days=7), self.now) if row['id'] == index)

    def test_non_targets_cannot_crowd_out_recent_target_or_first_detection(self):
        self.add(1, age=3600)
        self.add(2, age=20)
        # Both accounts/repeated observations of an action keep the first seen.
        self.db.execute('UPDATE signal_events SET published_at=?',
                        ((self.now - timedelta(hours=2)).isoformat(),))
        for index in range(3, 353):
            self.add(index, '$MU Q4 earnings highlights Revenue $10B', age=1)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['id'], 1)
        self.assertEqual((items[0]['previous'], items[0]['latest']), (100, 110))

    def test_outside_window_stays_private_after_removing_page_limit(self):
        self.add(1, age=8 * 86400)
        self.add(2, age=1)
        self.db.execute('UPDATE signal_events SET published_at=? WHERE id=2',
                        ((self.now - timedelta(days=7)).isoformat(),))
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual([item['id'] for item in items], [2])

    def test_rejection_reasons_preserve_safety_gates(self):
        cases = [
            ('$MU PT boosted to $110 from $100 at Citi', {}, 'unsupported-target-syntax'),
            ('$MU PT raised to $110 from $100 at Unknown Bank', {}, 'firm-not-recognized'),
            ('$MU PT raised to $110 from $100 at Citi and by UBS', {}, 'ambiguous-firms'),
            ('$MU PT raised to $90 from $100 at Citi', {}, 'inconsistent-direction'),
            ('$MU PT to $100 from $100 at Citi', {}, 'invalid-target-values'),
            ('$MU PT to $0 from $100 at Citi', {}, 'invalid-target-values'),
            ('$MU PT to $110 from $100 at Citi; PT to $120 from $110', {}, 'ambiguous-target-actions'),
            ('$MU and $AMD PT to $110 from $100 at Citi', {'tickers': '["MU","AMD"]'}, 'ambiguous-subject'),
            ('$MU PT to $110 from $100 at Citi', {'tickers': 'malformed'}, 'invalid-tickers'),
            ('$MU PT to $110 from $100 at Citi', {'tickers': '[{}]'}, 'invalid-tickers'),
            ('$MU PT to $110 from $100 at Citi', {'truncated': True}, 'truncated-evidence'),
            ('$MU PT to $110 from $100 at Citi', {'kind': 'changed'}, 'revision-evidence-missing'),
        ]
        for index, (text, kwargs, reason) in enumerate(cases, 1):
            with self.subTest(reason=reason, text=text):
                self.add(index, text, **kwargs)
                item, status = signals.price_target_observation(self.row(index), self.source, self.now)
                self.assertIsNone(item)
                self.assertEqual(status, reason)
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_current_revision_replaces_old_target_and_unsafe_revision_removes_it(self):
        self.add(1, body='$MU PT raised to $110 from $100 at Citi')
        row = dict(self.row(1))
        self.db.execute("UPDATE signal_documents SET sha='2',text=?", ('$MU PT raised to $120 from $100 at Citi',))
        self.add(2, '$MU PT raised to $120 from $100 at Citi', kind='changed', age=30)
        self.db.execute('UPDATE signal_events SET url=? WHERE id=2', (row['url'],))
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual([(item['id'], item['previous'], item['latest']) for item in items], [(2, 100, 120)])
        old_row = self.row(1)
        self.assertEqual(signals.price_target_observation(old_row, self.source, self.now), (None, 'superseded-revision'))
        summary = signals.price_target_publication_summary(self.db, now=self.now)
        self.assertEqual(summary['eligiblePosts'], 1)
        self.assertEqual(summary['withheldReasons'], {'superseded-revision': 1})
        # Corrected body contradicts its direction: neither the current nor the
        # historical title may remain visible as a fallback.
        self.db.execute('UPDATE signal_documents SET text=?', ('$MU PT raised to $90 from $100 at Citi',))
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_changed_revision_requires_full_matching_evidence(self):
        self.add(1, kind='changed')
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'revision-evidence-missing'))
        self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                        (self.source['id'], 'https://x.com/wallstengine/status/1', 'other',
                         'Other title', '$MU PT to $120 from $100 at Citi',
                         self.now.isoformat(), self.now.isoformat()))
        self.assertEqual(signals.price_target_observation(self.row(1), self.source, self.now),
                         (None, 'superseded-revision'))

    def test_same_broker_syndication_combines_sources_but_different_actions_stay_separate(self):
        self.add(1, '$MU PT raised to $110 from $100 at BofA', age=120)
        self.db.execute("UPDATE signal_events SET source_id='x-tipranks',url='https://x.com/TipRanks/status/1' WHERE id=1")
        self.add(2, '$MU PT raised to $110 from $100 at Bank of America', age=90)
        self.add(3, '$MU PT raised to $110 from $100 at BofA', age=60)
        # One post seen through two query routes is still one source link.
        self.db.execute("UPDATE signal_events SET url='https://x.com/TipRanks/status/1' WHERE id=3")
        self.add(4, '$MU PT raised to $110 from $100 at Citi', age=50)
        self.add(5, '$MU PT raised to $120 from $100 at Bank of America', age=40)
        self.add(6, '$MU PT cut to $110 from $100 at BofA', age=30)
        items = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual({(item['firm'], item['latest']) for item in items},
                         {('BofA', 110), ('BofA', 120), ('Citi', 110)})
        combined = next(item for item in items if item['firm'] == 'BofA' and item['latest'] == 110)
        self.assertEqual(combined['id'], 1)
        self.assertEqual(combined['source'], 'X · TipRanks')
        self.assertEqual([source['id'] for source in combined['sources']], [1, 2])
        self.assertEqual([source['source'] for source in combined['sources']],
                         ['X · TipRanks', 'X · Wall St Engine'])
        self.assertEqual({source['url'] for source in combined['sources']},
                         {'https://x.com/TipRanks/status/1', 'https://x.com/wallstengine/status/2'})
        for source in combined['sources']:
            self.assertEqual(set(source), {'id', 'source', 'url', 'publishedAt', 'observedAt'})

    def test_explicit_broker_aliases_share_one_identity(self):
        for first, second, canonical in [
            ('Citi', 'Citigroup', 'Citi'),
            ('J.P. Morgan', 'JPMorgan', 'JPMorgan'),
            ('RBC', 'RBC Capital', 'RBC'),
            ('Evercore', 'Evercore ISI', 'Evercore'),
            ('Cantor', 'Cantor Fitzgerald', 'Cantor Fitzgerald'),
            ('BMO', 'BMO Capital', 'BMO'),
        ]:
            with self.subTest(first=first, second=second):
                self.db.execute('DELETE FROM signal_events')
                self.add(1, f'$MU PT raised to $110 from $100 at {first}', age=120)
                self.add(2, f'$MU PT raised to $110 from $100 at {second}', age=60)
                items = signals.public_price_targets(self.db, now=self.now)['items']
                self.assertEqual(len(items), 1)
                self.assertEqual(items[0]['firm'], canonical)
                self.assertEqual([source['id'] for source in items[0]['sources']], [1, 2])

    def test_superseded_source_is_removed_from_combined_evidence(self):
        self.add(1, age=120, body='$MU PT raised to $110 from $100 at Citi')
        self.add(2, age=60)
        before = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual([source['id'] for source in before['sources']], [1, 2])
        self.db.execute("UPDATE signal_documents SET sha='corrected',text='Unsupported correction'")
        after = signals.public_price_targets(self.db, now=self.now)['items'][0]
        self.assertEqual(after['id'], 2)
        self.assertEqual([source['id'] for source in after['sources']], [2])

    def test_timing_and_source_rejections_are_diagnostic(self):
        self.add(1)
        original = dict(self.row(1))
        cases = [
            ({'published_at': None}, 'invalid-timestamp'),
            ({'published_at': '2026-10-02T11:00:00'}, 'invalid-timestamp'),
            ({'observed_at': (self.now + timedelta(seconds=1)).isoformat()}, 'future-observation'),
            ({'published_at': (self.now - timedelta(days=8)).isoformat()}, 'outside-publication-window'),
            ({'published_at': self.now.isoformat()}, 'observation-before-publication'),
            ({'url': 'https://unapproved.example/status/1'}, 'source-url-not-approved'),
            ({'url': 'https://x.com/theflynews/status/1'}, 'source-url-not-approved'),
        ]
        for update, reason in cases:
            with self.subTest(reason=reason, update=update):
                self.assertEqual(signals.price_target_observation({**original, **update}, self.source, self.now),
                                 (None, reason))
        self.assertEqual(signals.price_target_observation(original, None, self.now),
                         (None, 'source-not-approved'))

    def test_full_revision_drives_comparison_and_summary_without_exposing_body(self):
        body = 'Private commentary. ' * 30 + '$MU price target raised to $110 from $100 at Citi'
        self.add(1, body[:500], body=body)
        self.add(2, '$MU price target boosted to $120 from $100 at Citi')
        observed = (self.now - timedelta(seconds=10)).isoformat()
        self.db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                        (self.source['id'], 'https://x.com/wallstengine/status/3', '3',
                         'private title', '$ZZZZ PT increased to $30 from $20 by Citi', observed,
                         observed, observed, 0, 0))
        report = x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]
        self.assertEqual(report['targetMentions'], 2)
        self.assertEqual(report['publication'], {
            'eligiblePosts': 1, 'withheldPosts': 1,
            'withheldReasons': {'unsupported-target-syntax': 1}})
        self.assertEqual({sample['publicationStatus'] for sample in report['samples']},
                         {'eligible', 'unsupported-target-syntax'})
        self.assertNotIn('Private commentary', json.dumps(report))
        summary = signals.x_operational_summary(self.db, reference=self.now)['priceTargetPublication']
        self.assertEqual(summary['candidatePosts'], 2)
        self.assertEqual(summary['eligiblePosts'], 1)
        self.assertEqual(summary['withheldReasons'], {'unsupported-target-syntax': 1})
        self.assertEqual(summary['acquiredTargetPosts'], 1)
        self.assertEqual(summary['unselectedAcquiredTargetPosts'], 1)
        for secret in ('Private commentary', 'ZZZZ', 'MU', 'Citi', 'https://', self.source['id']):
            self.assertNotIn(secret, json.dumps(summary))
        self.db.execute("UPDATE signal_documents SET sha='later-revision'")
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        # A different revision's full body must never supplement the old title.
        self.assertEqual(x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]['targetMentions'], 1)

    def test_comparison_ignores_future_rows_and_tolerates_invalid_tickers(self):
        self.add(1, tickers='malformed')
        self.add(2, age=-100)
        result = x_comparison.report(self.db, now=self.now)['sources'][self.source['id']]
        self.assertEqual(result['newPosts'], 1)
        self.assertEqual(result['publication']['withheldReasons'], {'invalid-tickers': 1})
        self.assertEqual(result['tickerCounts'], {})

    def test_comparison_does_not_write_to_read_only_database(self):
        self.add(1)
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'saved.sqlite'
            with sqlite3.connect(path) as writable:
                self.db.commit()
                self.db.backup(writable)
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as readonly:
                readonly.row_factory = sqlite3.Row
                result = x_comparison.report(readonly, now=self.now)
                self.assertEqual(result['sources'][self.source['id']]['publication']['eligiblePosts'], 1)
                self.assertEqual(readonly.total_changes, 0)


if __name__ == '__main__':
    unittest.main()
