"""Durable copies of the site's costly Twelve Data answers (scripts/research/twelve_copies.py) and POST /twelve/copies/get and /put."""
import base64
import gzip
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

    def test_a_large_value_arrives_in_parts_and_is_stored_once_every_part_is_there(self):
        statements = {'income': {'income_statement': [{'fiscal_date': f'2026-{i:04d}', 'sales': i} for i in range(4000)]}}
        packed = base64.b64encode(gzip.compress(os.urandom(70_000) + json.dumps(statements).encode())).decode()
        chunks = [packed[i:i + 40 * 1024] for i in range(0, len(packed), 40 * 1024)]
        self.assertGreaterEqual(len(chunks), 2)
        base = {'kind': 'compare-statements', 'key': 'ASML', 'at': MS, 'parts': len(chunks)}
        for part, chunk in list(enumerate(chunks))[:-1]:
            self.assertFalse(tc.put(self.db, {**base, 'part': part, 'chunk': chunk}, now=NOW))
        self.assertEqual(tc.get(self.db, {'kind': 'compare-statements', 'keys': ['ASML']}, now=NOW), {}, 'nothing until the last part')
        self.assertTrue(tc.put(self.db, {**base, 'part': len(chunks) - 1, 'chunk': chunks[-1]}, now=NOW))
        got = tc.get(self.db, {'kind': 'compare-statements', 'keys': ['ASML']}, now=NOW)['ASML']
        self.assertEqual(got['value'], {'$gz': packed})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM parts').fetchone()[0], 0, 'the parts are removed once put together')

    def test_bad_parts_are_refused_and_parts_that_never_complete_are_removed(self):
        base = {'kind': 'compare-statements', 'key': 'ASML', 'at': MS}
        for extra in ({'part': 0, 'parts': 1, 'chunk': 'QQ=='}, {'part': 2, 'parts': 2, 'chunk': 'QQ=='}, {'part': 0, 'parts': tc.MAX_PARTS + 1, 'chunk': 'QQ=='},
                      {'part': 0, 'parts': 2, 'chunk': 'not base64!'}, {'part': 0, 'parts': 2, 'chunk': 'A' * (tc.MAX_VALUE_BYTES + 1)}, {'part': 0, 'parts': 2}):
            with self.assertRaises(ValueError, msg=str(extra)[:60]):
                tc.put(self.db, {**base, **extra}, now=NOW)
        self.assertFalse(tc.put(self.db, {**base, 'part': 0, 'parts': 2, 'chunk': 'QUJD'}, now=NOW))
        later = NOW + tc.PART_SECONDS + 1
        tc.put(self.db, {**base, 'key': 'TSM', 'part': 0, 'parts': 2, 'chunk': 'QUJD'}, now=later)
        self.assertEqual([r[0] for r in self.db.execute('SELECT key FROM parts')], ['TSM'])

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
