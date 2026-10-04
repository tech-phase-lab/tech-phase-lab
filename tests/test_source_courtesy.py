"""Offline SEC rolling-window/concurrency regressions; no provider requests."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor


class Clock:
    def __init__(self):
        self.value = 0.0
        self.lock = threading.Lock()
        self.sleeps = []

    def now(self):
        with self.lock:
            return self.value

    def sleep(self, duration):
        with self.lock:
            self.sleeps.append(duration)
            self.value += duration


class SourceCourtesyTests(unittest.TestCase):
    def test_rolling_window_does_not_reset_at_wall_clock_boundary(self):
        clock = Clock()
        gate = monitor.SourceRequestWindow(clock=clock.now, sleeper=clock.sleep)
        starts = [gate.wait() for _ in range(10)]
        self.assertEqual(starts, [0.0] * 10)
        clock.value = 0.99
        self.assertEqual(gate.wait(), 1.0)
        self.assertAlmostEqual(clock.sleeps[-1], 0.01)
        self.assertEqual(len(gate.started), 1)

    def test_concurrent_request_admissions_share_one_bounded_window(self):
        clock = Clock()
        gate = monitor.SourceRequestWindow(clock=clock.now, sleeper=clock.sleep)
        barrier = threading.Barrier(20)
        def request(_):
            barrier.wait(timeout=5)
            return gate.wait()
        with ThreadPoolExecutor(max_workers=20) as pool:
            starts = sorted(pool.map(request, range(20)))
        for start in starts:
            self.assertLessEqual(sum(start <= other < start + 1.0 for other in starts), 10)
        self.assertGreaterEqual(starts[-1], 1.0)
        self.assertLessEqual(len(gate.started), 10)

    def test_sec_hosts_share_gate_and_other_issuer_requests_do_not(self):
        with patch.object(monitor, '_SEC_REQUEST_WINDOW') as gate:
            monitor.wait_for_source_courtesy('https://data.sec.gov/submissions/CIK0000723125.json')
            monitor.wait_for_source_courtesy('https://www.sec.gov/Archives/edgar/data/723125/report.htm')
            monitor.wait_for_source_courtesy('https://investors.micron.com/news/example')
            monitor.wait_for_source_courtesy('https://www.sec.gov.evil.example/post')
            self.assertEqual(gate.wait.call_count, 2)

    def test_initial_request_is_gated_before_transport_failure(self):
        events = []
        def gated(_):
            events.append('gate')
        class Opener:
            def open(self, *_args, **_kwargs):
                events.append('request')
                raise TimeoutError('synthetic failure')
        with patch.object(monitor, 'wait_for_source_courtesy', side_effect=gated), \
                patch.object(monitor, 'build_opener', return_value=Opener()):
            with self.assertRaises(TimeoutError):
                monitor.fetch('https://data.sec.gov/submissions/CIK0000723125.json', 'MU')
        self.assertEqual(events, ['gate', 'request'])

    def test_approved_redirects_are_counted_but_unsafe_redirects_never_send(self):
        request = Request('https://data.sec.gov/submissions/CIK0000723125.json')
        with patch.object(monitor, '_SEC_REQUEST_WINDOW') as gate:
            redirected = monitor.Redirects('MU').redirect_request(request, None, 301, 'Moved', {},
                'https://www.sec.gov/Archives/edgar/data/723125/report.htm')
            self.assertIsNotNone(redirected)
            self.assertEqual(gate.wait.call_count, 1)
            with self.assertRaises(ValueError):
                monitor.Redirects('MU').redirect_request(request, None, 301, 'Moved', {},
                    'https://unknown.example/report')
            self.assertEqual(gate.wait.call_count, 1)


if __name__ == '__main__':
    unittest.main()
