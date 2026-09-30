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
            self.db.execute("UPDATE sources SET title='Micron to Report Fiscal Fourth Quarter Results'")
        self.assertIsNone(measurement.candidate(self.db))
        with self.db:
            self.db.execute("UPDATE sources SET title='Micron Reports Fourth Quarter Results',published_on='2026-06-30'")
        self.assertIsNone(measurement.candidate(self.db))
    def test_two_stages_record_private_draft_once_and_no_invented_publication_time(self):
        calls=[]
        def transport(payload,key):
            calls.append(payload)
            output={'titleJa':'マイクロン、決算を発表'} if len(calls)==1 else {'summaryJa':'売上高は120億ドル。','summaryEn':'Revenue was $12 billion.'}
            return {'output_text': json.dumps(output)}
        with patch.object(measurement, 'stamp', return_value='2026-09-30T20:00:10+00:00'), patch.object(measurement.headline_translation, 'configuration', return_value=('secret-key','model',50)):
            measurement.run_once(self.path,transport=transport)
            measurement.run_once(self.path,transport=transport)
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
        with patch.object(measurement, 'stamp', return_value='2026-10-02T00:00:01+00:00'), patch.object(measurement.headline_translation, 'configuration', return_value=('key','model',50)):
            measurement.run_once(self.path, transport=lambda *_: self.fail('expired request'))
            with monitor.connect(Path(self.temp.name)/'empty.sqlite') as empty:
                metrics=measurement.diagnostics(empty)
        self.assertEqual(metrics['status'],'expired-without-release')
        self.assertIsNone(metrics['detectionToBodyMs'])
        self.assertIsNone(metrics['modelRequestTotalMs'])
