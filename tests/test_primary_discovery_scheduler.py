"""Offline regressions for bounded, independent issuer/body scheduling."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
spec = importlib.util.spec_from_file_location('primary_scheduler_service', ROOT / 'scripts/research/service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)
monitor = service.monitor


class PrimaryDiscoverySchedulerTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        folder = self.stack.enter_context(tempfile.TemporaryDirectory())
        self.app = service.AutomaticMonitor(Path(folder) / 'db.sqlite', Path(folder) / 'snapshot.json')
        self.app.tickers = ['ASML', 'MU', 'NBIS']
        self.app.workers = 3
        self.gates = []
        self.threads = []
        self.errors = []
        self.stack.enter_context(patch.object(socket, 'create_connection', side_effect=AssertionError('network forbidden')))
        self.stack.enter_context(patch.object(monitor, 'fetch', side_effect=AssertionError('live fetch forbidden')))
        self.stack.enter_context(patch.object(self.app, 'persist_priority_source_coverage_if_due'))
        self.addCleanup(self.stop)

    def stop(self):
        self.app.stop_event.set()
        for gate in self.gates:
            gate.set()
        for thread in self.threads:
            thread.join(3)
        self.assertFalse(any(thread.is_alive() for thread in self.threads))
        self.assertEqual(self.errors, [])

    def gate(self):
        gate = threading.Event()
        self.gates.append(gate)
        return gate

    def start(self, target=None):
        def run():
            try:
                (target or self.app.run)()
            except Exception as exc:
                self.errors.append(exc)
        thread = threading.Thread(target=run)
        self.threads.append(thread)
        thread.start()
        return thread

    def wait_until(self, predicate, timeout=3):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if predicate():
                return
            time.sleep(0.01)
        self.fail('expected scheduler progress did not arrive')

    def result(self, ticker, status='ok', route='primary'):
        return ({'ticker': ticker, 'status': status, 'route': route,
                 'sourceUrl': monitor.INDEXES[ticker], 'candidates': 0,
                 'error': 'timeout' if status == 'degraded' else None}, {}, 7)

    def no_bodies(self):
        self.stack.enter_context(patch.object(self.app, 'begin_body_batch', return_value=None))

    def saved_tickers(self):
        with self.app.db_lock, monitor.connect(self.app.db_path) as db:
            return {row[0] for row in db.execute('SELECT ticker FROM discovery_runs')}

    def add_body(self, ticker, suffix='scheduler-test'):
        url = monitor.INDEXES[ticker].split('?')[0].rstrip('/') + '/' + suffix
        with self.app.db_lock, monitor.connect(self.app.db_path) as db:
            monitor.add_source(db, ticker, url, title='Offline scheduler fixture')
        return url

    def body_saved(self, url):
        with self.app.db_lock, monitor.connect(self.app.db_path) as db:
            row = db.execute('SELECT sha256 FROM sources WHERE url=?', (url,)).fetchone()
            return bool(row and row['sha256'])

    def test_fast_issuers_commit_and_repeat_while_asml_is_slow(self):
        self.no_bodies()
        release, slow_started = self.gate(), threading.Event()
        counts, active, maximum = {}, {}, {}
        lock = threading.Lock()
        committed_at_wake = []
        def collect(ticker, *_):
            with lock:
                counts[ticker] = counts.get(ticker, 0) + 1
                active[ticker] = active.get(ticker, 0) + 1
                maximum[ticker] = max(maximum.get(ticker, 0), active[ticker])
            if ticker == 'ASML':
                slow_started.set()
                release.wait(5)
            with lock:
                active[ticker] -= 1
            return self.result(ticker)
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.stack.enter_context(patch.object(self.app, 'wake_publication_workers', side_effect=lambda: committed_at_wake.append(self.saved_tickers())))
        self.start()
        self.assertTrue(slow_started.wait(2))
        self.wait_until(lambda: {'MU', 'NBIS'} <= self.saved_tickers())
        self.wait_until(lambda: counts.get('MU', 0) >= 2 and counts.get('NBIS', 0) >= 2)
        self.assertNotIn('ASML', self.saved_tickers())
        self.assertEqual(counts['ASML'], 1)
        self.assertTrue(any({'MU', 'NBIS'} <= tickers for tickers in committed_at_wake))
        self.assertEqual(set(maximum.values()), {1})
        snapshot = json.loads(self.app.snapshot_path.read_text())
        self.assertTrue({'MU', 'NBIS'} <= {row['ticker'] for row in snapshot['discoveryRuns']})

    def test_oldest_due_issuer_wins_over_immediately_repeating_first_issuer(self):
        self.no_bodies()
        self.app.workers = 2
        self.app.tickers = ['MU', 'NBIS', 'NVDA', 'AMD', 'ASML']
        order = []
        def collect(ticker, *_):
            order.append(ticker)
            return self.result(ticker)
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0))
        self.start()
        self.wait_until(lambda: len(order) >= 7)
        self.assertEqual(order[:5], self.app.tickers)
        self.assertEqual(order[5:7], self.app.tickers[:2])

    def test_stop_returns_promptly_and_discards_late_completion(self):
        self.no_bodies()
        self.app.tickers = ['ASML']
        release, started, finished = self.gate(), threading.Event(), threading.Event()
        def collect(ticker, *_):
            started.set()
            release.wait(5)
            finished.set()
            return self.result(ticker)
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        thread = self.start()
        self.assertTrue(started.wait(2))
        self.app.stop_event.set()
        thread.join(0.5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(release.is_set())
        release.set()
        self.assertTrue(finished.wait(1))
        self.assertEqual(self.saved_tickers(), set())

    def test_restart_drains_old_pool_before_dispatching_same_ticker(self):
        self.no_bodies()
        self.app.tickers = ['ASML', 'MU']
        release, faulted = self.gate(), threading.Event()
        counts, active, peak = {}, {}, {}
        lock = threading.Lock()
        original_save = monitor.save_discovery
        def collect(ticker, *_):
            with lock:
                counts[ticker] = counts.get(ticker, 0) + 1
                active[ticker] = active.get(ticker, 0) + 1
                peak[ticker] = max(peak.get(ticker, 0), active[ticker])
            if ticker == 'ASML' and counts[ticker] == 1:
                release.wait(5)
            with lock:
                active[ticker] -= 1
            return self.result(ticker)
        def save(db, ticker, *args):
            if ticker == 'MU' and not faulted.is_set():
                faulted.set()
                raise RuntimeError('offline persistence fault')
            return original_save(db, ticker, *args)
        real_wait = self.app.stop_event.wait
        self.stack.enter_context(patch.object(self.app.stop_event, 'wait', side_effect=lambda timeout: real_wait(min(timeout, 0.05))))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(monitor, 'save_discovery', side_effect=save))
        self.stack.enter_context(patch('builtins.print'))
        self.start(self.app.run_supervised)
        self.assertTrue(faulted.wait(2))
        time.sleep(0.15)
        self.assertEqual(counts, {'ASML': 1, 'MU': 1})
        release.set()
        self.wait_until(lambda: counts.get('ASML', 0) >= 2 and counts.get('MU', 0) >= 2)
        self.assertEqual(set(peak.values()), {1})

    def test_fast_body_commits_while_slow_body_and_discovery_continue(self):
        self.app.tickers = ['NBIS']
        self.app.workers = 4
        self.app.body_batch = 2
        fast_url, slow_url = self.add_body('MU'), self.add_body('ASML')
        release, slow_started = self.gate(), threading.Event()
        discovery = []
        def fetch(url, *_args, **_kwargs):
            if url == slow_url:
                slow_started.set()
                release.wait(5)
            return b'<main><h1>Offline release</h1><p>Source evidence.</p></main>', 'text/html'
        def collect(ticker, *_):
            discovery.append(ticker)
            return self.result(ticker)
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.start()
        self.assertTrue(slow_started.wait(2))
        self.wait_until(lambda: self.body_saved(fast_url))
        self.wait_until(lambda: len(discovery) >= 2)
        self.assertFalse(self.body_saved(slow_url))
        with self.app.state_lock:
            self.assertEqual(self.app.state['sourceChecks'], 1)
        release.set()
        self.wait_until(lambda: self.app.state['bodyFetch']['lastBatchChecks'] == 2)
        self.assertTrue(self.body_saved(slow_url))

    def test_body_progress_has_reserved_slot_and_total_pool_is_bounded(self):
        self.app.tickers = ['MU', 'NBIS', 'ASML', 'AMD', 'NVDA']
        self.app.workers = 3
        url = self.add_body('VRT')
        release, all_started = self.gate(), threading.Event()
        active = 0
        peak = 0
        submitted = []
        lock = threading.Lock()
        def enter():
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
                if active == 3:
                    all_started.set()
        def leave():
            nonlocal active
            with lock:
                active -= 1
        def fetch(*_args, **_kwargs):
            enter()
            all_started.wait(2)
            leave()
            return b'<main>Offline body evidence.</main>', 'text/html'
        def collect(ticker, *_):
            enter()
            release.wait(5)
            leave()
            return self.result(ticker)
        original_submit = ThreadPoolExecutor.submit
        def submit(pool, function, *args, **kwargs):
            submitted.append(function.__name__ if hasattr(function, '__name__') else str(function))
            return original_submit(pool, function, *args, **kwargs)
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(ThreadPoolExecutor, 'submit', new=submit))
        self.start()
        self.assertTrue(all_started.wait(2))
        self.wait_until(lambda: self.body_saved(url))
        self.assertEqual(peak, 3)
        self.assertEqual(len(submitted), 3, 'extra issuers must remain outside the executor queue')

    def test_one_worker_progresses_both_lanes_without_overlap(self):
        self.app.tickers = ['MU', 'NBIS']
        self.app.workers = 1
        url = self.add_body('ASML')
        order = []
        def fetch(*_args, **_kwargs):
            order.append('body')
            return b'<main>Offline source evidence.</main>', 'text/html'
        def collect(ticker, *_):
            order.append(ticker)
            return self.result(ticker)
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0))
        self.start()
        self.wait_until(lambda: self.body_saved(url) and len(order) >= 3)
        self.assertEqual(order[:3], ['MU', 'body', 'NBIS'])

    def test_total_failure_backs_off_but_verified_partial_route_resets_it(self):
        self.no_bodies()
        self.app.tickers = ['MU']
        outcomes = [('degraded', 'none'), ('degraded', 'supplemental'), ('ok', 'primary')]
        calls = []
        def collect(ticker, *_):
            status, route = outcomes[min(len(calls), 2)]
            calls.append(ticker)
            return self.result(ticker, status, route)
        delays = []
        def wake():
            delays.append(self.app.state['companies']['MU']['nextPollSeconds'])
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.stack.enter_context(patch.object(self.app, 'wake_publication_workers', side_effect=wake))
        self.start()
        self.wait_until(lambda: len(delays) >= 3)
        self.assertEqual(delays[:3], [0.2, 0.1, 0.1])

    def test_pending_body_reserves_same_ticker_and_host_until_committed(self):
        self.app.tickers = ['MU', 'NBIS']
        url = self.add_body('MU')
        release, body_started = self.gate(), threading.Event()
        discoveries = []
        def fetch(*_args, **_kwargs):
            body_started.set()
            release.wait(5)
            return b'<main>Offline source evidence.</main>', 'text/html'
        def collect(ticker, *_):
            discoveries.append(ticker)
            self.assertTrue(self.body_saved(url))
            return self.result(ticker)
        # Different issuers can share a lawful official host. A body in flight
        # must reserve that host as well as its own issuer.
        self.stack.enter_context(patch.object(monitor, 'monitoring_sources', return_value=[{'url': url}]))
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.start()
        self.assertTrue(body_started.wait(2))
        time.sleep(0.1)
        self.assertEqual(discoveries, [])
        release.set()
        self.wait_until(lambda: set(discoveries) == {'MU', 'NBIS'})

    def test_slow_bodies_cannot_take_the_last_discovery_slot(self):
        self.app.tickers = ['NBIS']
        self.app.workers = 3
        self.app.body_batch = 3
        urls = {self.add_body(ticker) for ticker in ['MU', 'ASML', 'VRT']}
        release = self.gate()
        body_started, discovery = [], []
        def fetch(url, *_args, **_kwargs):
            body_started.append(url)
            release.wait(5)
            return b'<main>Offline source evidence.</main>', 'text/html'
        def collect(ticker, *_):
            discovery.append(ticker)
            return self.result(ticker)
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.start()
        self.wait_until(lambda: len(body_started) == 2 and len(discovery) >= 2)
        self.assertEqual(len(body_started), 2)
        self.assertTrue(set(body_started) < urls)

    def test_telemetry_is_batched_independently_of_immediate_commits(self):
        self.no_bodies()
        self.app.tickers = ['MU', 'NBIS', 'NVDA']
        self.app.workers = 4
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=lambda ticker, *_: self.result(ticker)))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0))
        thread = self.start()
        self.wait_until(lambda: self.app.state['cycles'] >= 30)
        self.assertEqual(self.saved_tickers(), set(self.app.tickers))
        with self.app.db_lock, monitor.connect(self.app.db_path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM discovery_poll_batches').fetchone()[0], 0)
        self.app.stop_event.set()
        thread.join(1)
        with monitor.connect(self.app.db_path) as db:
            rows = db.execute('SELECT * FROM discovery_poll_batches').fetchall()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['checks'], self.app.state['cycles'])
        self.assertEqual(rows[0]['request_duration_total_ms'], 7 * rows[0]['checks'])

    def test_telemetry_flushes_on_interval_without_waiting_for_slow_issuer(self):
        self.no_bodies()
        self.app.tickers = ['ASML', 'MU']
        release = self.gate()
        def collect(ticker, *_):
            if ticker == 'ASML':
                release.wait(5)
            return self.result(ticker)
        self.stack.enter_context(patch.object(service, 'DISCOVERY_METRICS_FLUSH_SECONDS', 0.15))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.05))
        def recorded_checks():
            with self.app.db_lock, monitor.connect(self.app.db_path) as db:
                return db.execute('SELECT COALESCE(SUM(checks),0) FROM discovery_poll_batches').fetchone()[0]
        self.start()
        self.wait_until(lambda: recorded_checks() >= 2)
        self.assertNotIn('ASML', self.saved_tickers())

    def test_metric_buffer_ceiling_flushes_without_losing_checks(self):
        self.no_bodies()
        self.app.tickers = ['MU', 'NBIS']
        self.stack.enter_context(patch.object(service, 'DISCOVERY_METRICS_MAX_CHECKS', 3))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=lambda ticker, *_: self.result(ticker)))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0))
        thread = self.start()
        self.wait_until(lambda: self.app.state['cycles'] >= 10)
        self.app.stop_event.set()
        thread.join(1)
        with monitor.connect(self.app.db_path) as db:
            counts = [row[0] for row in db.execute('SELECT checks FROM discovery_poll_batches')]
        self.assertTrue(all(1 <= count <= 3 for count in counts))
        self.assertEqual(sum(counts), self.app.state['cycles'])

    def test_body_save_fault_does_not_restart_or_block_discovery(self):
        self.app.tickers = ['MU']
        self.add_body('ASML')
        calls = []
        def collect(ticker, *_):
            calls.append(ticker)
            return self.result(ticker)
        def fetch(*_args, **_kwargs):
            return b'<main>Offline body evidence.</main>', 'text/html'
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.stack.enter_context(patch.object(self.app, 'save_body_completion', side_effect=RuntimeError('offline save fault')))
        self.start()
        self.wait_until(lambda: len(calls) >= 2 and self.app.state['bodyFetch']['healthy'] is False)
        self.assertEqual(self.app.state['bodyFetch']['consecutiveFailures'], 1)
        self.assertEqual(self.app.state['bodyFetch']['lastError'], 'body-fetch-failed')

    def test_new_body_is_admitted_while_older_batch_peer_stays_slow(self):
        self.app.tickers = ['NBIS']
        self.app.workers = 3
        self.app.body_batch = 2
        self.app.body_interval = 0.15
        first_url, slow_url = self.add_body('MU'), self.add_body('ASML')
        release, slow_started = self.gate(), threading.Event()
        requests = []
        admissions = []
        original_begin = self.app.begin_body_batch
        def begin(**selection):
            admissions.append((time.monotonic(), selection['max_candidates']))
            return original_begin(**selection)
        def fetch(url, *_args, **_kwargs):
            requests.append(url)
            if url == slow_url:
                slow_started.set()
                release.wait(5)
            return b'<main>Offline source evidence.</main>', 'text/html'
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'begin_body_batch', side_effect=begin))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=lambda ticker, *_: self.result(ticker)))
        self.start()
        self.assertTrue(slow_started.wait(2))
        self.wait_until(lambda: self.body_saved(first_url))
        second_url = self.add_body('MU', 'newly-discovered')
        self.wait_until(lambda: self.body_saved(second_url))
        self.assertFalse(self.body_saved(slow_url))
        self.assertEqual(requests.count(slow_url), 1)
        self.assertEqual(requests.count(first_url), 1)
        self.assertEqual(requests.count(second_url), 1)
        self.assertEqual(admissions[0][1], 2)
        self.assertTrue(all(capacity == 1 for _at, capacity in admissions[1:]))
        self.assertTrue(all(b[0] - a[0] >= 0.14 for a, b in zip(admissions, admissions[1:])))

    def test_pending_sec_body_does_not_globally_reserve_unused_sec_fallbacks(self):
        self.app.tickers = ['ASML', 'MU', 'NBIS']
        self.app.workers = 4
        self.app.body_interval = 0.1
        release, slow_started, body_started = self.gate(), threading.Event(), threading.Event()
        calls = {}
        sec_url = 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000001/offline.htm'
        def collect(ticker, *_):
            calls[ticker] = calls.get(ticker, 0) + 1
            if ticker == 'ASML':
                slow_started.set()
                release.wait(5)
            return self.result(ticker)
        def body(row):
            self.assertEqual(row['url'], sec_url)
            body_started.set()
            release.wait(5)
            return service.utc_now(), 7, None, TimeoutError('offline SEC body fixture')
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=collect))
        self.stack.enter_context(patch.object(self.app, 'collect_body_timed', side_effect=body))
        self.stack.enter_context(patch.object(self.app, 'interval_for', return_value=0.1))
        self.start()
        self.assertTrue(slow_started.wait(2))
        with self.app.db_lock, monitor.connect(self.app.db_path) as db:
            monitor.add_source(db, 'NVDA', sec_url, title='Offline SEC fixture')
        self.assertTrue(body_started.wait(2))
        self.wait_until(lambda: calls.get('MU', 0) >= 3 and calls.get('NBIS', 0) >= 3)
        self.assertEqual(calls['ASML'], 1)
        self.assertFalse(release.is_set())

    def test_successful_peer_clears_worker_retry_hold_and_preserves_admission_cadence(self):
        self.app.tickers = ['NBIS']
        self.app.workers = 3
        self.app.body_batch = 2
        self.app.body_interval = 0.1
        slow_url = self.add_body('ASML')
        release, slow_started, failed = self.gate(), threading.Event(), threading.Event()
        original_save = self.app.save_body_completion
        def fetch(url, *_args, **_kwargs):
            if url == slow_url:
                slow_started.set()
                release.wait(5)
            return b'<main>Offline source evidence.</main>', 'text/html'
        def save(batch, completed):
            if completed[0]['ticker'] == 'MU' and not failed.is_set():
                # An existing failure streak makes the held worker deadline
                # unmistakably later than its normal admission cadence.
                with self.app.state_lock:
                    self.app.state['bodyFetch']['consecutiveFailures'] = 4
                failed.set()
                raise RuntimeError('offline newer-batch persistence fault')
            return original_save(batch, completed)
        self.stack.enter_context(patch.object(monitor, 'fetch', new=fetch))
        self.stack.enter_context(patch.object(self.app, 'save_body_completion', side_effect=save))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=lambda ticker, *_: self.result(ticker)))
        self.start()
        self.assertTrue(slow_started.wait(2))
        self.add_body('MU')
        self.wait_until(lambda: failed.is_set() and self.app.state['bodyFetch']['retrySeconds'] >= 3)
        newest_url = self.add_body('VRT')
        release.set()
        self.wait_until(lambda: self.body_saved(newest_url), timeout=1.5)
        self.wait_until(lambda: self.app.state['bodyFetch']['healthy'] is True)
        self.assertEqual(self.app.state['bodyFetch']['retrySeconds'], 0)
        self.assertIsNone(self.app.state['bodyFetch']['nextRetryAt'])

    def test_body_selection_fault_does_not_stop_discovery(self):
        self.app.tickers = ['MU']
        self.stack.enter_context(patch.object(self.app, 'body_candidates', side_effect=RuntimeError('offline selection fault')))
        self.stack.enter_context(patch.object(self.app, 'collect_discovery_timed', side_effect=lambda ticker, *_: self.result(ticker)))
        self.start()
        self.wait_until(lambda: 'MU' in self.saved_tickers())
        self.assertFalse(self.app.state['bodyFetch']['healthy'])
        self.assertEqual(self.app.state['bodyFetch']['lastError'], 'body-fetch-failed')


if __name__ == '__main__':
    unittest.main()
