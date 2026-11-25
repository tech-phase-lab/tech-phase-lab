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
            self.assertRegex(source, r"twelve_allocator\.intercept\(path, params(, tier='background')?\)", name)
            self.assertIn('twelve_allocator.spent(path, params)', source, name)


class MembersFirst(unittest.TestCase):
    """Production log, Nov 25: the comparison's job took ~455 credits at the start of every minute and left members ~25 under 480."""

    def test_the_jobs_always_leave_members_the_minimum_reserve(self):
        a = ta.Allocator(read_meter=lambda: 0, clock=Clock())
        self.assertEqual(a.ceiling('warm'), ta.CEILING['user'] - ta.MEMBER_RESERVE_MIN)
        for _ in range(4):
            self.assertTrue(a.grant(100, 'warm'))  # 1 + 400
        self.assertFalse(a.grant(50, 'warm'))     # 451 > 420
        self.assertTrue(a.grant(79, 'user'))      # members still have 480 - 401 = 79
        self.assertLessEqual(ta.CEILING['warm'] + ta.MEMBER_RESERVE_MIN, ta.CEILING['user'])

    def test_the_warm_job_yields_to_what_members_asked_for_in_the_last_minutes(self):
        clock = Clock()
        a = ta.Allocator(read_meter=lambda: 0, clock=clock)
        for _ in range(10):
            self.assertTrue(a.grant(12, 'user'))   # members asked 120 credits this minute
        clock.t += 60                               # the next minute: a reserve of 2 × 120 for members
        self.assertEqual(a.ceiling('warm'), ta.CEILING['user'] - 240)
        self.assertEqual(a.ceiling('background'), ta.CEILING['user'] - 240)
        self.assertEqual(a.ceiling('critical'), ta.CEILING['critical'])
        self.assertTrue(a.grant(100, 'warm'))
        self.assertTrue(a.grant(100, 'warm'))
        self.assertFalse(a.grant(50, 'warm'))       # 201 + 50 > 240
        clock.t += 60 * ta.MEMBER_WINDOW            # members gone for five minutes: back to the minimum reserve
        self.assertEqual(a.ceiling('warm'), ta.CEILING['warm'])

    def test_a_refused_member_stops_the_jobs_for_the_next_minutes(self):
        clock = Clock()
        a = ta.Allocator(read_meter=lambda: 470, clock=clock)
        self.assertFalse(a.grant(24, 'user'))
        self.assertEqual(a.ceiling('warm'), 0)
        clock.t += 60
        self.assertFalse(a.grant(1, 'warm'))
        self.assertFalse(a.grant(1, 'background'))
        self.assertTrue(a.grant(5, 'user'))
        clock.t += 60 * ta.MEMBER_WINDOW
        self.assertGreater(a.ceiling('warm'), 0)

    def test_the_optional_fast_refresh_is_not_counted_as_members_need(self):
        clock = Clock()
        a = ta.Allocator(read_meter=lambda: 0, clock=clock)
        self.assertTrue(a.grant(100, 'fast'))
        self.assertFalse(a.grant(100, 'fast'))
        clock.t += 60
        self.assertEqual(a.ceiling('warm'), ta.CEILING['warm'])

    def test_the_monitors_background_jobs_see_the_lowered_ceiling(self):
        clock = Clock()
        a = ta.install(ta.Allocator(read_meter=lambda: 100, clock=clock))
        self.addCleanup(lambda: setattr(ta, '_installed', None))
        self.assertEqual(ta.intercept('api_usage', {}, tier='background'), {'current_usage': 101})
        for _ in range(10):
            a.grant(15, 'user')                     # 150 asked: reserve 300, background ceiling 480 - 300 = 180
        self.assertEqual(ta.intercept('api_usage', {}), {'current_usage': 251})
        self.assertEqual(ta.intercept('api_usage', {}, tier='background'), {'current_usage': 251 + 400 - 180})

    def test_one_summary_line_a_minute_by_tier_and_caller_without_keys(self):
        clock, lines = Clock(), []
        a = ta.Allocator(read_meter=lambda: 10, clock=clock)
        a.log = lambda text, flush=False: lines.append(json.loads(text))
        a.grant(12, 'user', 'quote')
        a.grant(50, 'warm', 'compare-statistics')
        a.grant(100, 'user', 'https://api.twelvedata.com/x?apikey=secret')  # not a label: counted under its tier
        a.record(7)
        self.assertEqual(lines, [])
        clock.t += 60
        a.grant(1, 'user', 'quote')
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertEqual(line['event'], 'twelve-minute')
        self.assertEqual(line['granted'], {'user:quote': 12, 'warm:compare-statistics': 50, 'user': 100})
        self.assertEqual(line['monitor'], 7)
        self.assertEqual(line['meter'], 10)
        self.assertNotIn('secret', json.dumps(line))


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
                with post({'cost': 5, 'tier': 'user', 'caller': 'quote'}) as response:
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
