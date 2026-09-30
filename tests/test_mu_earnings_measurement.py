"""Finite MU measurement safety, retry and timing tests; no live requests."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import mu_earnings_measurement as measurement

ENV = {
    'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true',
    'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
    'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'synthetic-model',
}

class MeasurementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name)/'db.sqlite'
        self.db = monitor.connect(self.path)
        self.url = 'https://investors.micron.com/news/press-release/2026/results/default.aspx'
        self.add(self.url, 'Micron Reports Fiscal Fourth Quarter 2026 Results')
    def tearDown(self):
        self.db.close()
        self.temp.cleanup()
    def add(self, url, title):
        with self.db:
            self.db.execute("INSERT INTO sources(url,ticker,title,published_on,discovered_at,extracted_text,fetched_at) VALUES(?,?,?,?,?,?,?)", (url,'MU',title,'2026-09-30','2026-09-30T20:00:01+00:00','Revenue 12 billion. '*100,'2026-09-30T20:00:02+00:00'))
            self.db.execute("INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)", (url,'MU','2026-09-30T20:00:01+00:00'))
    def test_only_actual_official_results_are_eligible(self):
        self.assertEqual(measurement.candidate(self.db)['url'], self.url)
        with self.db:
            self.db.execute("UPDATE sources SET title='Micron Reports Results for the Fourth Quarter and Full Year of Fiscal 2026'")
        self.assertEqual(measurement.candidate(self.db)['url'], self.url)
        with self.db:
            self.db.execute("UPDATE sources SET published_on=NULL")
        self.assertEqual(measurement.candidate(self.db)['url'], self.url)
        with self.db:
            self.db.execute("UPDATE sources SET title='Micron to Report Fiscal Fourth Quarter Results'")
        self.assertIsNone(measurement.candidate(self.db))
        with self.db:
            self.db.execute("UPDATE sources SET title='Micron Reports Fourth Quarter Results',published_on='2026-06-30'")
        self.assertIsNone(measurement.candidate(self.db))

    def test_exact_same_url_signal_time_enables_publication_latency(self):
        with self.db:
            self.db.execute("""CREATE TABLE signal_events(
              url TEXT NOT NULL, published_at TEXT)""")
            self.db.execute("INSERT INTO signal_events VALUES(?,?)",
                            (self.url, '2026-09-30T13:00:00-07:00'))
        source = measurement.candidate(self.db)
        self.assertEqual(source['published_at'], '2026-09-30T13:00:00-07:00')
        with patch.object(measurement, 'stamp', return_value='2026-09-30T20:00:10+00:00'):
            outputs = iter((
                {'output_text': json.dumps({'titleJa':'マイクロン、決算を発表'})},
                {'output_text': json.dumps({'summaryJa':'売上高は120億ドル。','summaryEn':'Revenue was $12 billion.'})},
            ))
            measurement.run_once(self.path, env=ENV, transport=lambda *_: next(outputs))
        metrics = measurement.diagnostics(self.db)
        self.assertEqual(metrics['publicationPrecision'], 'timestamp')
        self.assertEqual(metrics['publicationToDetectionMs'], 1000)

    def test_naive_future_or_different_url_signal_time_is_not_exact(self):
        with self.db:
            self.db.execute("CREATE TABLE signal_events(url TEXT NOT NULL,published_at TEXT)")
            self.db.executemany("INSERT INTO signal_events VALUES(?,?)", [
                (self.url, '2026-09-30T20:00:00'),
                (self.url, '2026-09-30T20:00:02+00:00'),
                (self.url + '?other=1', '2026-09-30T20:00:00+00:00'),
            ])
        self.assertIsNone(measurement.candidate(self.db)['published_at'])
    def test_two_stages_record_private_draft_once_and_no_invented_publication_time(self):
        calls=[]
        def transport(payload,key):
            calls.append(payload)
            output={'titleJa':'マイクロン、決算を発表'} if len(calls)==1 else {'summaryJa':'売上高は120億ドル。','summaryEn':'Revenue was $12 billion.'}
            return {'output_text': json.dumps(output)}
        with patch.object(measurement, 'stamp', return_value='2026-09-30T20:00:10+00:00'):
            measurement.run_once(self.path,env=ENV,transport=transport)
            measurement.run_once(self.path,env=ENV,transport=transport)
        self.assertEqual(len(calls),2)
        metrics=measurement.diagnostics(self.db)
        self.assertEqual(metrics['status'],'complete')
        self.assertIsNone(metrics['publicationToDetectionMs'])
        self.assertEqual(metrics['detectionToBodyMs'],1000)
        self.assertEqual(metrics['bodyToSummaryMs'],8000)
        self.assertEqual(metrics['detectionToSummaryMs'],9000)
        self.assertIsInstance(metrics['modelRequestTotalMs'],int)
        self.assertGreaterEqual(metrics['modelRequestTotalMs'],0)
        self.assertEqual(metrics['summaryPublication'],'private-draft')
        self.assertNotIn('売上高',json.dumps(metrics,ensure_ascii=False))
        self.assertNotIn('secret',json.dumps(metrics))
    def test_experiment_expires_without_billable_requests(self):
        with patch.object(measurement, 'stamp', return_value='2026-10-02T00:00:01+00:00'):
            measurement.run_once(self.path, env=ENV, transport=lambda *_: self.fail('expired request'))
            with monitor.connect(Path(self.temp.name)/'empty.sqlite') as empty:
                metrics=measurement.diagnostics(empty)
        self.assertEqual(metrics['status'],'expired-without-release')
        self.assertIsNone(metrics['detectionToBodyMs'])
        self.assertIsNone(metrics['modelRequestTotalMs'])

    def test_scoped_configuration_uses_explicit_enable_without_general_approval(self):
        self.assertEqual(measurement.configuration(ENV),
                         ('synthetic-test-key-only-1234', 'synthetic-model'))
        self.assertIsNone(measurement.configuration({**ENV,
                                                     'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'false'}))
        self.assertIsNone(measurement.configuration({
            **ENV, 'OPENAI_API_KEY': '',
            'OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON': '2026-12-01',
        }))

    def test_missing_general_approval_does_not_block_authorised_mu_measurement(self):
        calls = []
        outputs = iter((
            {'output_text': json.dumps({'titleJa': 'マイクロン、決算を発表'})},
            {'output_text': json.dumps({'summaryJa': '売上高は120億ドル。',
                                        'summaryEn': 'Revenue was $12 billion.'})},
        ))
        with patch.object(measurement, 'stamp', return_value='2026-09-30T20:00:10+00:00'):
            measurement.run_once(
                self.path, env=ENV,
                transport=lambda *_: calls.append(1) or next(outputs),
            )
        self.assertEqual(len(calls), 2)
