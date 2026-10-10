"""Retained-source recovery tests. No live API, translation or publication call."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import x_replay
import x_api


class ReplayTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        signals.schema(self.db)
        self.now = datetime(2026, 10, 2, 16, tzinfo=timezone.utc)
        self.source = next(s for s in signals.SOURCES if s['id'] == 'x-wallstengine')

    def tearDown(self):
        self.db.close()

    def add(self, post_id, text='$MU PT increased to $110 from $100 by Citi', **changes):
        title = ' '.join(text.split())[:500]
        row = {'source_id': self.source['id'], 'url': f'https://x.com/wallstengine/status/{post_id}',
               'sha': hashlib.sha256((title+'\n'+text).encode()).hexdigest(),
               'title': title, 'text': text, 'published_at': '2026-10-02T08:43:48+00:00',
               'first_seen_at': '2026-10-02T08:44:16.476+00:00',
               'last_seen_at': '2026-10-02T09:00:00+00:00',
               'truncated': 0, 'selected_for_processing': 0, **changes}
        self.db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)', tuple(row.values()))
        self.db.commit()
        return row

    def replay(self, sources=None):
        return x_replay.replay_acquired(self.db, sources or [self.source], ['MU'], now=self.now)

    def test_recovers_parser_repair_idempotently_and_preserves_original_clocks(self):
        row = self.add(1)
        self.db.execute("INSERT INTO signal_routes(id,next_check_at) VALUES(?,?)", (self.source['id'], 'later'))
        self.db.execute('INSERT INTO signal_index_state VALUES(?,?)', (self.source['id'], '{"sinceId":"9999"}'))
        self.db.commit()
        self.assertEqual(self.replay(), {'examined': 1, 'recovered': 1, 'invalidated': 0})
        saved = self.db.execute('SELECT * FROM signal_events').fetchone()
        self.assertEqual(saved['event_kind'], 'baseline')
        self.assertEqual(saved['observed_at'], row['first_seen_at'])
        self.assertEqual(saved['published_at'], row['published_at'])
        self.assertEqual(saved['sha'], row['sha'])
        self.assertEqual(self.db.execute('SELECT next_check_at FROM signal_routes').fetchone()[0], 'later')
        self.assertEqual(self.db.execute('SELECT body FROM signal_index_state').fetchone()[0], '{"sinceId":"9999"}')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_x_request_attempts').fetchone()[0], 0)
        self.assertEqual(self.replay(), {'examined': 0, 'recovered': 0, 'invalidated': 0})
        targets = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual((targets[0]['previous'], targets[0]['latest']), (100, 110))
        self.assertEqual(datetime.fromisoformat(targets[0]['observedAt']), datetime.fromisoformat(row['first_seen_at']))

    def test_unrecognized_posts_do_not_starve_later_recoverable_post(self):
        for post_id in range(1, 205):
            self.add(post_id, 'Commentary with no supported ticker or news fact')
        self.add(205)
        self.assertEqual(self.replay(), {'examined': 205, 'recovered': 1, 'invalidated': 0})

    def test_invalid_and_newer_evidence_is_not_overwritten(self):
        self.add(1, sha='corrupted')
        self.add(2, truncated=1)
        self.add(3, published_at='2026-10-03T08:43:48+00:00')
        self.add(4, first_seen_at=(self.now-timedelta(days=8)).isoformat())
        self.add(5, url='https://x.com/theflynews/status/5')
        self.add(6, url='https://evil.example/wallstengine/status/6')
        row = self.add(7)
        self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                        (row['source_id'], row['url'], 'newer-sha', 'Correction',
                         'No target change', row['first_seen_at'], self.now.isoformat()))
        self.db.commit()
        self.assertEqual(self.replay()['recovered'], 0)
        self.assertEqual(self.db.execute('SELECT text FROM signal_documents').fetchone()[0], 'No target change')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 0)

    def test_only_latest_retained_revision_is_replayed(self):
        self.add(1)
        latest = self.add(1, '$MU PT reduced to $90 from $100 by Citi',
                          first_seen_at='2026-10-02T09:00:00+00:00')
        self.assertEqual(self.replay()['recovered'], 1)
        self.assertEqual(self.db.execute('SELECT sha FROM signal_events').fetchone()[0], latest['sha'])
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'][0]['latest'], 90)

    def test_disabled_source_and_unselected_ambiguous_copy_never_bypass_public_gate(self):
        self.add(1, '$MU PT increased to $90 from $100 by Citi')
        self.assertEqual(self.replay([{**self.source, 'enabled': False}])['recovered'], 0)
        self.assertEqual(self.replay()['recovered'], 1)
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_unsupported_withdrawal_invalidates_old_numbers_during_intake_and_replay(self):
        original = self.add(1)
        self.replay()
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 1)
        correction = '$MU Correction: withdraw our earlier Citi report; no analyst change occurred.'
        payload = {'data': [{'id': '1', 'author_id': 'one', 'text': correction,
                            'created_at': original['published_at']}],
                   'includes': {'users': [{'id': 'one', 'username': 'wallstengine'}]}}
        acquired = x_api.acquired_posts(self.source, payload)
        admitted = x_api.parse_response(self.source, payload, ['MU'])
        self.assertEqual(admitted, [])
        signals.save(self.db, self.source, admitted, {'_acquired_posts': acquired},
                     '2026-10-02T09:30:00+00:00', 'synthetic', 1)
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        # Recreate the pre-fix state: old document remains beside acquired but
        # unselected withdrawal. Startup replay repairs this without admission.
        self.db.execute('''UPDATE signal_documents SET sha=?,title=?,text=?,last_seen_at=?''',
                        (original['sha'], original['title'], original['text'], original['last_seen_at']))
        self.db.commit()
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 1)
        replay = self.replay()
        self.assertEqual(replay, {'examined': 1, 'recovered': 0, 'invalidated': 1})
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_x_request_attempts').fetchone()[0], 0)

    def test_unsupported_withdrawal_removes_a_previously_published_earnings_result(self):
        import market_results
        original = self.add(1, '$MU Q4 2026 earnings Revenue: $54.23B; Adjusted EPS: $33.42')
        self.replay()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'earnings.sqlite'
            with sqlite3.connect(path) as target:
                self.db.backup(target)
            market_results.run_once(path, [self.source], reference=self.now)
            with sqlite3.connect(path) as db:
                db.row_factory = sqlite3.Row
                self.assertEqual(len(market_results.public_feed(db, reference=self.now)), 1)
                payload = {'data': [{'id': '1', 'author_id': 'one',
                            'text': '$MU Correction: withdraw our earlier figures. Do not rely on that report.',
                            'created_at': original['published_at']}],
                           'includes': {'users': [{'id': 'one', 'username': 'wallstengine'}]}}
                self.assertEqual(x_api.parse_response(self.source, payload, ['MU']), [])
                signals.save(db, self.source, [], {'_acquired_posts': x_api.acquired_posts(self.source, payload)},
                             '2026-10-02T09:30:00+00:00', 'synthetic', 1)
                self.assertEqual(market_results.public_feed(db, reference=self.now), [])

    def test_recorded_jobs_format_replays_actuals_without_estimates_or_invented_fields(self):
        # Recorded incident format from test_market_results.py; original source
        # https://x.com/wallstengine/status/2105998888536846505. This is recovery,
        # never evidence of on-time source acquisition or a new browser arrival.
        text = ('SEPTEMBER U.S. JOBS REPORT\nNONFARM PAYROLLS +29K, (Est. +90K)\n'
                'UNEMPLOYMENT RATE 4.2%, (Est. 4.1%)\nAVG. HOURLY EARNINGS YoY 3.0%, (Est. 3.1%)')
        self.add(2105998888536846505, text, published_at='2026-10-02T12:30:37+00:00',
                 first_seen_at='2026-10-02T12:49:12.663+00:00', last_seen_at='2026-10-02T12:49:12.663+00:00')
        self.assertEqual(self.replay()['recovered'], 1)
        saved = self.db.execute('SELECT * FROM signal_events').fetchone()
        self.assertEqual(json.loads(saved['tickers_json']), ['ECON'])
        import market_results
        result = market_results.projection(text, ['ECON'])
        self.assertEqual({fact['key']: fact['value'] for fact in result['facts']}, {
            'nonfarm-payrolls': '+29K', 'unemployment-rate': '4.2%', 'hourly-earnings-yoy': '3.0%'})
        self.assertNotIn('90K', result['titleEn'])
        self.assertNotIn('前月比', result['titleJa'])
        self.assertEqual(saved['observed_at'], '2026-10-02T12:49:12.663+00:00')
        # Replay through durable publication as well as the parser. No provider
        # key is configured or needed for these deterministic bilingual labels.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'recovery.sqlite'
            with sqlite3.connect(path) as target:
                self.db.backup(target)
            market_results.run_once(path, [self.source], reference=self.now)
            with sqlite3.connect(path) as published:
                published.row_factory = sqlite3.Row
                feed = market_results.public_feed(published, reference=self.now)
            self.assertEqual(len(feed), 1)
            self.assertEqual({fact['key']: fact['value'] for fact in feed[0]['facts']},
                             {fact['key']: fact['value'] for fact in result['facts']})
            self.assertEqual(feed[0]['sourceToDetectionMs'], 1115663)
            self.assertIn('+29K', feed[0]['titleJa'])
            self.assertIn('+29K', feed[0]['titleEn'])


if __name__ == '__main__':
    unittest.main()
