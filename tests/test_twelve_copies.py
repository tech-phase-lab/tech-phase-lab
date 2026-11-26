"""Durable copies of the site's costly Twelve Data answers (scripts/research/twelve_copies.py) and POST /twelve/copies/get and /put."""
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import service
import twelve_copies as tc

NOW = 1_795_680_000.0  # 2026-11-26 08:00 UTC
MS = int(NOW * 1000)
STATS = {'meta': {'symbol': 'ASML'}, 'statistics': {'valuations_metrics': {'market_capitalization': 502230134286}}}


class Store(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.db = tc.connect(Path(self.dir.name) / 'twelve-copies.sqlite')
        self.addCleanup(self.db.close)

    def test_a_stored_copy_is_read_back_and_only_a_newer_one_replaces_it(self):
        self.assertTrue(tc.put(self.db, {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS - 7 * 3_600_000, 'value': STATS}, now=NOW))
        self.assertFalse(tc.put(self.db, {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS - 8 * 3_600_000, 'value': {'old': True}}, now=NOW))
        got = tc.get(self.db, {'kind': 'compare-statistics', 'keys': ['ASML', 'TSM', 'ASML']}, now=NOW)
        self.assertEqual(got, {'ASML': {'at': MS - 7 * 3_600_000, 'value': STATS}})
        self.assertTrue(tc.put(self.db, {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS, 'value': {'new': 1}}, now=NOW))
        self.assertEqual(tc.get(self.db, {'kind': 'compare-statistics', 'keys': ['ASML']}, now=NOW)['ASML']['value'], {'new': 1})

    def test_kinds_are_separate_and_a_null_value_is_a_valid_copy(self):
        tc.put(self.db, {'kind': 'md-facts-next-earnings-v2', 'key': 'NVDA', 'at': MS, 'value': None}, now=NOW)
        self.assertEqual(tc.get(self.db, {'kind': 'md-facts-next-earnings-v2', 'keys': ['NVDA']}, now=NOW), {'NVDA': {'at': MS, 'value': None}})
        self.assertEqual(tc.get(self.db, {'kind': 'md-facts-stats-v2', 'keys': ['NVDA']}, now=NOW), {})

    def test_only_listed_kinds_valid_keys_sane_times_and_small_values_are_accepted(self):
        bad = [
            {'kind': 'anything', 'key': 'ASML', 'at': MS, 'value': 1},
            {'kind': 'compare-statistics', 'key': 'AS ML', 'at': MS, 'value': 1},
            {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS + 3_600_000, 'value': 1},
            {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS - 41 * 86_400_000, 'value': 1},
            {'kind': 'compare-statistics', 'key': 'ASML', 'at': True, 'value': 1},
            {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS},
            {'kind': 'compare-statistics', 'key': 'ASML', 'at': MS, 'value': 'x' * (tc.MAX_VALUE_BYTES + 1)},
        ]
        for payload in bad:
            with self.assertRaises(ValueError, msg=json.dumps(payload)[:80]):
                tc.put(self.db, payload, now=NOW)
        for keys in ([], ['A'] * (tc.MAX_KEYS + 1), ['A B'], 'ASML'):
            with self.assertRaises(ValueError):
                tc.get(self.db, {'kind': 'compare-statistics', 'keys': keys}, now=NOW)

    def test_copies_older_than_the_keep_window_are_removed(self):
        tc.put(self.db, {'kind': 'compare-statistics', 'key': 'OLD', 'at': MS - 39 * 86_400_000, 'value': 1}, now=NOW)
        later = NOW + 2 * 86_400
        tc.put(self.db, {'kind': 'compare-statistics', 'key': 'NEW', 'at': int(later * 1000), 'value': 2}, now=later)
        self.assertEqual(list(tc.get(self.db, {'kind': 'compare-statistics', 'keys': ['OLD', 'NEW']}, now=later)), ['NEW'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM copies').fetchone()[0], 1)

    def test_the_file_sits_beside_the_monitors_database(self):
        self.assertEqual(tc.path_for('/data/automatic.sqlite'), Path('/data/twelve-copies.sqlite'))


class Endpoint(unittest.TestCase):
    def test_the_sites_server_token_reads_and_writes_copies(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace(db_path=str(Path(folder.name) / 'automatic.sqlite'))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.shutdown)
        base = f'http://127.0.0.1:{server.server_port}/twelve/copies'

        def post(path, body, auth='Bearer synthetic-site-token'):
            return urlopen(Request(base + path, method='POST', data=json.dumps(body).encode(),
                                   headers={'Authorization': auth, 'Content-Type': 'application/json'}), timeout=3)

        import time
        at = int(time.time() * 1000)
        with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'synthetic-site-token'}):
            with self.assertRaises(HTTPError) as error:
                post('/put', {'kind': 'compare-statistics', 'key': 'ASML', 'at': at, 'value': STATS}, auth='Bearer wrong')
            self.assertEqual(error.exception.code, 401)
            with post('/put', {'kind': 'compare-statistics', 'key': 'ASML', 'at': at, 'value': STATS}) as response:
                self.assertEqual(json.loads(response.read()), {'ok': True, 'stored': True})
            with post('/get', {'kind': 'compare-statistics', 'keys': ['ASML', 'TSM']}) as response:
                self.assertEqual(json.loads(response.read()), {'ok': True, 'copies': {'ASML': {'at': at, 'value': STATS}}})
            with self.assertRaises(HTTPError) as error:
                post('/put', {'kind': 'other', 'key': 'ASML', 'at': at, 'value': 1})
            self.assertEqual(error.exception.code, 400)
        self.assertTrue((Path(folder.name) / 'twelve-copies.sqlite').exists())
        with patch.dict(os.environ, {'RESEARCH_API_TOKEN': ''}), self.assertRaises(HTTPError) as error:
            post('/get', {'kind': 'compare-statistics', 'keys': ['ASML']})
        self.assertEqual(error.exception.code, 401)


if __name__ == '__main__':
    unittest.main()
