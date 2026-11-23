"""The single Twelve Data credit allocator (scripts/research/twelve_allocator.py) and its endpoint POST /twelve/lease."""
import json
import os
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import service
import twelve_allocator as ta

T0 = 1_795_000_020.0  # 20 seconds into a minute


class Clock:
    def __init__(self, t=T0):
        self.t = t

    def __call__(self):
        return self.t


class Allocator(unittest.TestCase):
    def setUp(self):
        self.addCleanup(lambda: setattr(ta, '_installed', None))

    def test_grants_all_or_nothing_under_each_tier_and_counts_them(self):
        clock, used = Clock(), {'n': 400}
        a = ta.Allocator(read_meter=lambda: used['n'], clock=clock)
        self.assertTrue(a.grant(70, 'user'))     # 400 + 1 (the reading) + 70 = 471 <= 480
        self.assertFalse(a.grant(10, 'user'))    # 481 > 480
        self.assertFalse(a.grant(1, 'background'))
        self.assertTrue(a.grant(100, 'critical'))
        self.assertFalse(a.grant(30, 'critical'))
        self.assertFalse(a.grant(0, 'user'))
        self.assertFalse(a.grant(5, 'everything'))
        self.assertFalse(a.grant(ta.MAX_COST + 1, 'critical'))

    def test_the_meter_is_read_every_few_seconds_and_a_new_minute_starts_from_its_own_reading(self):
        clock, reads = Clock(), []
        a = ta.Allocator(read_meter=lambda: reads.append(clock.t) or 470, clock=clock)
        self.assertFalse(a.grant(20, 'user'))
        a.grant(5, 'user')
        self.assertEqual(len(reads), 1)
        clock.t = T0 + 41  # the next minute
        self.assertTrue(a.grant(5, 'user'))  # 470 + 1 + 5: the previous minute's grants are not carried over
        self.assertEqual(len(reads), 2)

    def test_an_unreadable_meter_grants_nothing_to_the_website(self):
        a = ta.Allocator(read_meter=lambda: None, clock=Clock())
        self.assertFalse(a.grant(1, 'user'))
        self.assertIsNone(a.usage())

    def test_many_threads_asking_at_once_never_pass_the_ceiling(self):
        a = ta.Allocator(read_meter=lambda: 0, clock=Clock())
        granted = []

        def ask():
            for _ in range(50):
                if a.grant(3, 'user'):
                    granted.append(3)
        threads = [threading.Thread(target=ask) for _ in range(20)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertLessEqual(1 + sum(granted), ta.CEILING['user'])
        self.assertGreater(sum(granted), ta.CEILING['user'] - 4)

    def test_the_monitors_own_calls_are_counted_and_its_usage_reads_come_from_the_allocator(self):
        clock = Clock()
        a = ta.install(ta.Allocator(read_meter=lambda: 300, clock=clock))
        self.assertEqual(ta.intercept('api_usage', {}), {'current_usage': 301})
        self.assertIsNone(ta.intercept('quote', {'symbol': 'NVDA'}))
        ta.spent('quote', {'symbol': 'NVDA,MU,AVGO'})
        ta.spent('statistics', {'symbol': 'NVDA'})
        self.assertEqual(a.usage(), 301 + 3 + 50)
        self.assertFalse(a.grant(130, 'user'))  # 354 + 130 > 480

    def test_price_alerts_and_value_check_clients_go_through_it(self):
        for name in ('price_alerts.py', 'value_check.py'):
            source = (Path(__file__).resolve().parents[1] / 'scripts/research' / name).read_text()
            self.assertIn('twelve_allocator.intercept(path, params)', source, name)
            self.assertIn('twelve_allocator.spent(path, params)', source, name)


class Endpoint(unittest.TestCase):
    def test_only_the_sites_server_token_and_a_valid_request_get_an_answer(self):
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace()
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f'http://127.0.0.1:{server.server_port}/twelve/lease'
        previous = ta._installed
        ta.install(ta.Allocator(read_meter=lambda: 470, clock=Clock()))
        post = lambda body, auth='Bearer synthetic-site-token': urlopen(Request(url, method='POST', data=json.dumps(body).encode(), headers={'Authorization': auth, 'Content-Type': 'application/json'}), timeout=3)
        try:
            with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'synthetic-site-token'}):
                with self.assertRaises(HTTPError) as error:
                    post({'cost': 1, 'tier': 'user'}, auth='Bearer wrong')
                self.assertEqual(error.exception.code, 401)
                with post({'cost': 5, 'tier': 'user'}) as response:
                    self.assertEqual(json.loads(response.read()), {'ok': True, 'granted': True})
                with post({'cost': 50, 'tier': 'user'}) as response:
                    self.assertEqual(json.loads(response.read()), {'ok': True, 'granted': False})
            ta._installed = None
            with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'synthetic-site-token'}), self.assertRaises(HTTPError) as error:
                post({'cost': 1, 'tier': 'user'})
            self.assertEqual(error.exception.code, 503)
        finally:
            ta._installed = previous
            server.shutdown()


if __name__ == '__main__':
    unittest.main()
