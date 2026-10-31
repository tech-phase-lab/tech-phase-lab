"""Public target reads stay fresh without waiting for ingestion/schema writes."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import price_target_reader
import service


class PriceTargetReaderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.db'
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA journal_mode=WAL')
        signals.schema(self.db)
        self.now = datetime.now(timezone.utc)
        self.insert(1)
        self.db.commit()

    def insert(self, index, ticker='MU'):
        at = (self.now - timedelta(seconds=30)).isoformat()
        self.db.execute('''INSERT INTO signal_events
          (id,source_id,url,sha,title,tickers_json,matches_json,event_kind,
           published_at,observed_at,excerpt,diff,truncated)
          VALUES (?, 'x-wallstengine', ?, ?, ?, ?, '{}', 'new', ?, ?, '', '', 0)''',
          (index, f'https://x.com/wallstengine/status/{index}', str(index),
           f'${ticker} PT raised to $110 from $100 at Citi', '["'+ticker+'"]', at, at))

    def test_same_projection_without_schema_or_database_writes(self):
        expected = signals.public_price_targets(self.db, now=self.now)['items']
        self.assertEqual(len(expected), 1)
        before = self.db.execute('PRAGMA schema_version').fetchone()[0]
        with patch.object(signals, 'schema', side_effect=AssertionError('read must not migrate')):
            self.assertEqual(price_target_reader.read(self.path, now=self.now)['items'], expected)
        self.assertEqual(self.db.execute('PRAGMA schema_version').fetchone()[0], before)

    def test_first_read_does_not_wait_for_ingestion_lock_or_writer(self):
        app = object.__new__(service.AutomaticMonitor)
        app.db_path = self.path
        app.db_lock = threading.Lock()
        # Both the Python lock and a SQLite write transaction remain held.
        self.db.execute('BEGIN IMMEDIATE')
        self.insert(2, 'NVDA')
        with app.db_lock, patch.object(service.monitor, 'connect', side_effect=AssertionError('no full initialization')):
            start = time.monotonic()
            result = app.public_price_targets()
            duration = time.monotonic() - start
        self.assertLess(duration, 1, 'read waited for a writer or the ingestion lock')
        self.assertEqual([item['ticker'] for item in result['items']], ['MU'])
        self.db.commit()
        self.assertEqual({item['ticker'] for item in app.public_price_targets()['items']}, {'MU', 'NVDA'})

    def test_expiry_and_removal_are_visible_without_cache_or_restart(self):
        self.assertEqual(len(price_target_reader.read(self.path, now=self.now)['items']), 1)
        self.assertEqual(price_target_reader.read(self.path, now=self.now+timedelta(days=8))['items'], [])
        self.db.execute('DELETE FROM signal_events')
        self.db.commit()
        self.assertEqual(price_target_reader.read(self.path, now=self.now)['items'], [])

    def test_missing_or_uninitialized_database_is_not_created_or_reported_as_empty_success(self):
        missing = Path(self.tmp.name) / 'missing.db'
        with self.assertRaises(sqlite3.OperationalError):
            price_target_reader.read(missing)
        self.assertFalse(missing.exists())
        empty = Path(self.tmp.name) / 'empty.db'
        sqlite3.connect(empty).close()
        with self.assertRaises(sqlite3.OperationalError):
            price_target_reader.read(empty)
