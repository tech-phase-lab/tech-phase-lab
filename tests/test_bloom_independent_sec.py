"""Offline fixtures for Bloom's independently scheduled SEC discovery phase."""
from datetime import datetime, timezone
from email.utils import format_datetime
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals

# Do not cache canonical `service` before test_research_service installs its
# isolated modules during unittest discovery; later signal tests must patch the
# same dependencies as their service instance.
service_spec = importlib.util.spec_from_file_location(
    'bloom_independent_service', Path(__file__).resolve().parents[1] / 'scripts/research/service.py')
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)

BE_URL = 'https://investor.bloomenergy.com/press-releases/press-release-details/2026/Bloom-Energy-Announces-Synthetic-Update/default.aspx'
BE_SEC_JSON = 'https://data.sec.gov/submissions/CIK0001664703.json'
BE_SEC_ATOM = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001664703&type=8-K&owner=exclude&count=40&output=atom'
BE_FILING = 'https://www.sec.gov/Archives/edgar/data/1664703/000166470326000001/be-20261002.htm'
NOW = datetime(2026, 10, 3, 13, 36, tzinfo=timezone.utc)
OBSERVED = NOW.isoformat(timespec='milliseconds')


def rss(items):
    return ('<rss><channel>' + ''.join(
        f'<item><title>{escape(title)}</title><link>{escape(url)}</link>'
        f'<pubDate>{escape(date)}</pubDate></item>'
        for url, title, date, _ in items
    ) + '</channel></rss>').encode()


class BloomIndependentSecDiscoveryTests(unittest.TestCase):
    def company_feed(self):
        return rss([(BE_URL, 'Bloom Energy announces synthetic power capacity update',
                     'Fri, 02 Oct 2026 15:00:00 GMT', '2026-10-02')])

    def sec_json(self):
        return json.dumps({'cik': 1664703, 'filings': {'recent': {
            'form': ['8-K', '10-Q', '8-K/A'],
            'accessionNumber': ['0001664703-26-000001', '0001664703-26-000002', '0001664703-26-000003'],
            'primaryDocument': ['be-20261002.htm', 'be-10q.htm', 'be-amendment.htm'],
            'primaryDocDescription': ['CURRENT REPORT', 'QUARTERLY REPORT', 'AMENDMENT'],
        }}}).encode()

    def test_sec_pair_changes_only_role_and_preserves_scope(self):
        provider = monitor.PROVIDERS['BE']
        self.assertNotIn('fallbackSources', provider)
        self.assertEqual(provider['supplementalSources'], [
            {'url': BE_SEC_JSON, 'format': 'sec-json', 'label': 'SEC submissions 8-K',
             'cik': '0001664703', 'forms': ['8-K'], 'limit': 40},
            {'url': BE_SEC_ATOM, 'format': 'rss', 'label': 'SEC 8-K'},
        ])
        self.assertEqual([source['route'] for source in monitor.monitoring_sources('BE', automatic=True)],
                         ['primary', 'supplemental', 'supplemental-fallback'])

    def test_healthy_rss_collects_sec_independently_with_no_extra_atom_request(self):
        requested = []
        def transport(url, ticker):
            self.assertEqual(ticker, 'BE')
            requested.append(url)
            if url == monitor.INDEXES['BE']:
                return self.company_feed(), 'text/xml'
            if url == BE_SEC_JSON:
                return self.sec_json(), 'application/json'
            self.fail(f'Unexpected request: {url}')
        result, links = monitor.collect_discovery('BE', transport, automatic=True)
        self.assertEqual(requested, [monitor.INDEXES['BE'], BE_SEC_JSON])
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['route'], 'primary+supplemental')
        self.assertEqual(result['sourceFormat'], 'rss+sec-json')
        self.assertEqual(result['sourcesChecked'], 2)
        self.assertEqual(result['sourcesConfigured'], 3)
        self.assertEqual(set(links), {BE_URL, BE_FILING})

    def test_sec_json_failure_uses_atom_once_and_keeps_issuer_feed(self):
        requested = []
        atom = (f'<feed xmlns="http://www.w3.org/2005/Atom"><entry>'
                f'<title>8-K synthetic fixture</title><link href="{BE_FILING}"/>'
                '</entry></feed>').encode()
        def transport(url, _ticker):
            requested.append(url)
            if url == monitor.INDEXES['BE']:
                return self.company_feed(), 'text/xml'
            if url == BE_SEC_JSON:
                raise TimeoutError('Synthetic SEC JSON timeout')
            if url == BE_SEC_ATOM:
                return atom, 'application/atom+xml'
            self.fail(f'Unexpected request: {url}')
        result, links = monitor.collect_discovery('BE', transport, automatic=True)
        self.assertEqual(requested, [monitor.INDEXES['BE'], BE_SEC_JSON, BE_SEC_ATOM])
        self.assertEqual(result['status'], 'fallback')
        self.assertEqual(result['route'], 'primary+supplemental')
        self.assertEqual(result['sourcesChecked'], 3)
        self.assertEqual(set(links), {BE_URL, BE_FILING})

    def test_sec_failure_keeps_issuer_candidates_publishable_without_poll_backoff(self):
        requested = []
        def transport(url, _ticker):
            requested.append(url)
            if url == monitor.INDEXES['BE']:
                return self.company_feed(), 'text/xml'
            raise HTTPError(url, 403, 'Synthetic restriction', {}, None)
        result, links = monitor.collect_discovery('BE', transport, automatic=True)
        self.assertEqual(requested, [monitor.INDEXES['BE'], BE_SEC_JSON, BE_SEC_ATOM])
        self.assertEqual(result['status'], 'degraded')
        self.assertEqual(result['route'], 'primary')
        self.assertEqual(result['error'], 'http-403')
        self.assertFalse(service.discovery_requires_backoff(result))
        self.assertTrue(service.discovery_has_verified_route(result))
        self.assertEqual(set(links), {BE_URL})
        with tempfile.TemporaryDirectory() as tmp:
            with monitor.connect(Path(tmp) / 'monitor.sqlite') as db:
                with patch.object(monitor, 'now', return_value=OBSERVED):
                    new = monitor.save_discovery(db, 'BE', result, links)
                    monitor.add_release_events(db, 'BE', new)
                    row = db.execute('SELECT * FROM sources WHERE url=?', (BE_URL,)).fetchone()
                    monitor.check_source(db, row, lambda *_: (
                        b'<html><main><p>Bloom Energy announced a synthetic power capacity update.</p></main></html>', 'text/html'))
                feed = signals.public_official_updates(db, reference=NOW)
                self.assertEqual([item['url'] for item in feed], [BE_URL])
                self.assertEqual(feed[0]['publishedOn'], '2026-10-02')
                self.assertEqual(datetime.fromisoformat(feed[0]['observedAt']), NOW)

    def test_failed_issuer_still_collects_sec_through_existing_manual_fallback(self):
        requested = []
        def transport(url, _ticker):
            requested.append(url)
            if url == monitor.INDEXES['BE']:
                raise TimeoutError('Synthetic issuer timeout')
            if url == BE_SEC_JSON:
                return self.sec_json(), 'application/json'
            self.fail(f'Unexpected request: {url}')
        result, links = monitor.collect_discovery('BE', transport)
        self.assertEqual(requested, [monitor.INDEXES['BE'], BE_SEC_JSON])
        self.assertEqual(result['status'], 'fallback')
        self.assertEqual(set(links), {BE_FILING})


    def test_automatic_scope_keeps_primary_and_supplemental_requests_separate(self):
        for scope, expected in [('primary', [monitor.INDEXES['BE']]),
                                ('supplemental', [BE_SEC_JSON])]:
            with self.subTest(scope=scope):
                requested = []
                def transport(url, _ticker):
                    requested.append(url)
                    return ((self.company_feed(), 'text/xml') if url == monitor.INDEXES['BE']
                            else (self.sec_json(), 'application/json'))
                result, links = monitor.collect_discovery('BE', transport, automatic=True, source_scope=scope)
                self.assertEqual(requested, expected)
                self.assertEqual(result['status'], 'ok')
                self.assertEqual(result['route'], scope)
                self.assertEqual(set(links), {BE_URL} if scope == 'primary' else {BE_FILING})

    def test_only_bloom_opts_in_to_phased_jobs(self):
        self.assertEqual([ticker for ticker, provider in monitor.PROVIDERS.items()
                          if provider.get('independentSupplemental')], ['BE'])
        jobs = service.discovery_jobs(monitor.PROVIDERS)
        self.assertEqual(len(jobs), len(monitor.PROVIDERS) + 1)
        self.assertEqual(jobs['BE'], ('BE', 'primary'))
        self.assertEqual(jobs['BE:supplemental'], ('BE', 'supplemental'))
        for ticker in monitor.PROVIDERS:
            if ticker != 'BE':
                self.assertEqual(jobs[ticker], (ticker, None))

    def test_late_phase_cache_completion_preserves_other_phases_fresh_validator(self):
        rss_url = monitor.INDEXES['BE']
        current = {rss_url: {'etag': 'rss-fresh'}, BE_SEC_JSON: {'etag': 'sec-old'}}
        delayed = {rss_url: {'etag': 'rss-stale'}, BE_SEC_JSON: {'etag': 'sec-new'}}
        merged = service.discovery_phase_cache('BE', 'supplemental', current, delayed)
        self.assertEqual(merged, {rss_url: {'etag': 'rss-fresh'}, BE_SEC_JSON: {'etag': 'sec-new'}})
        reversed_completion = service.discovery_phase_cache('BE', 'primary', merged, current)
        self.assertEqual(reversed_completion, merged)

    def test_pending_or_failed_sec_is_visible_after_healthy_primary_completion(self):
        primary = {'status': 'ok', 'route': 'primary', 'candidates': 1,
                   'checkedAt': OBSERVED, 'error': None}
        pending = service.combined_discovery_state(primary, None)
        self.assertEqual(pending['status'], 'degraded')
        self.assertEqual(pending['pendingPhases'], ['supplemental'])
        sec = {'status': 'degraded', 'route': 'none', 'candidates': 0,
               'checkedAt': OBSERVED, 'error': 'http-403'}
        failed = service.combined_discovery_state(primary, sec)
        self.assertEqual(failed['status'], 'degraded')
        self.assertEqual(failed['route'], 'primary')
        self.assertEqual(failed['error'], 'http-403')
        recovered = service.combined_discovery_state(primary, {
            **sec, 'status': 'ok', 'route': 'supplemental', 'error': None, 'candidates': 1,
        })
        self.assertEqual(recovered['status'], 'ok')
        self.assertEqual(recovered['route'], 'primary+supplemental')
        self.assertEqual(recovered['candidates'], 2)

    def test_scoped_sec_failure_keeps_durable_phase_identity_under_snapshot_truncation(self):
        def unavailable(url, _ticker):
            raise HTTPError(url, 403, 'Synthetic SEC restriction', {}, None)
        result, links = monitor.collect_discovery('BE', unavailable, automatic=True, source_scope='supplemental')
        self.assertEqual(result['sourceUrl'], BE_SEC_JSON)
        self.assertEqual(result['route'], 'none')
        with tempfile.TemporaryDirectory() as tmp:
            with monitor.connect(Path(tmp) / 'monitor.sqlite') as db:
                monitor.save_discovery(db, 'BE', result, links)
                for count in range(8):
                    monitor.save_discovery(db, 'BE', {
                        'status': 'ok', 'route': 'primary', 'sourceUrl': monitor.INDEXES['BE'],
                        'sourceFormat': 'rss', 'candidates': count,
                        'sourcesChecked': 1, 'sourcesConfigured': 1, 'error': None,
                    }, {})
                runs = monitor.snapshot(db, recent_per_item=1)['discoveryRuns']
                self.assertEqual(len(runs), 2)
                self.assertEqual(runs[0]['index_url'], monitor.INDEXES['BE'])
                self.assertEqual(runs[0]['candidates'], 7)
                self.assertEqual(runs[1]['index_url'], BE_SEC_JSON)
                self.assertEqual(runs[1]['status'], 'degraded')
                self.assertEqual(runs[1]['error'], 'http-403')

    def test_unscoped_oracle_total_failure_keeps_legacy_source_identity(self):
        def unavailable(_url, _ticker):
            raise TimeoutError('Synthetic unavailable source')
        result, links = monitor.collect_discovery('ORCL', unavailable, automatic=True)
        self.assertEqual(result['sourceUrl'], monitor.INDEXES['ORCL'])
        self.assertEqual(result['route'], 'none')
        self.assertEqual(links, {})


class BloomPhaseServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        self.snapshot = Path(self.tmp.name) / 'snapshot.json'
        self.reference = datetime.now(timezone.utc)
        self.feed_body = rss([(BE_URL, 'Bloom Energy announces synthetic power capacity update',
                              format_datetime(self.reference), self.reference.date().isoformat())])
        self.sec_body = BloomIndependentSecDiscoveryTests().sec_json()
        self.body = b'<html><main><p>Bloom Energy announced a synthetic power capacity update for this offline concurrency fixture.</p></main></html>'
        with monitor.connect(self.path) as db:
            # A previously healthy RSS baseline means a newly found issuer
            # release is a detected event, not a bulk baseline announcement.
            monitor.save_discovery(db, 'BE', {
                'status': 'ok', 'route': 'primary', 'candidates': 0, 'error': None,
                'sourceUrl': monitor.INDEXES['BE'], 'sourceFormat': 'rss',
                'sourcesChecked': 1, 'sourcesConfigured': 1,
            }, {})

    def make_app(self, workers=3):
        with patch.dict(os.environ, {'RESEARCH_TICKERS': 'BE', 'RESEARCH_AUTO_DRAFTS': '0'}):
            app = service.AutomaticMonitor(self.path, self.snapshot)
        app.workers = workers
        app.body_interval = 0.05
        app.interval_for = lambda _ticker: 0.05
        return app

    def wait_until(self, condition, timeout=4):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if condition():
                return
            threading.Event().wait(0.01)
        self.fail('Offline monitor condition did not complete in time')

    def feed(self, app):
        with app.db_lock, monitor.connect(self.path) as db:
            return signals.public_official_updates(db, reference=datetime.now(timezone.utc))

    def test_two_worker_slow_sec_does_not_block_issuer_persistence_body_or_repeated_polling(self):
        app = self.make_app(workers=2)
        sec_started, sec_release, sec_finished = (threading.Event() for _ in range(3))
        lock = threading.Lock()
        counts = {}
        active = peak = 0
        primary_persisted_when_sec_started = []
        def transport(url, _ticker, **_kwargs):
            nonlocal active, peak
            with lock:
                counts[url] = counts.get(url, 0) + 1
                active += 1
                peak = max(peak, active)
            try:
                if url == monitor.INDEXES['BE']:
                    return self.feed_body, 'text/xml'
                if url == BE_SEC_JSON:
                    with monitor.connect(self.path) as db:
                        primary_persisted_when_sec_started.append(
                            db.execute('SELECT 1 FROM sources WHERE url=?', (BE_URL,)).fetchone() is not None)
                    sec_started.set()
                    sec_release.wait(5)
                    sec_finished.set()
                    return self.sec_body, 'application/json'
                if url == BE_URL:
                    return self.body, 'text/html'
                # SEC body policy remains unchanged; the fixture models access
                # restriction, not a new workaround for the production 403s.
                if url.startswith('https://www.sec.gov/'):
                    raise HTTPError(url, 403, 'Synthetic restriction', {}, None)
                raise AssertionError(f'Unexpected fixture URL {url}')
            finally:
                with lock:
                    active -= 1
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.assertTrue(sec_started.wait(2))
                self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                self.wait_until(lambda: counts.get(monitor.INDEXES['BE'], 0) >= 3)
                self.assertFalse(sec_release.is_set())
                self.assertEqual(counts[BE_SEC_JSON], 1)
                self.assertEqual(primary_persisted_when_sec_started, [True])
                self.assertLessEqual(peak, app.workers)
                with app.db_lock, monitor.connect(self.path) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM release_events WHERE url=?', (BE_URL,)).fetchone()[0], 1)
                with app.state_lock:
                    self.assertEqual(app.state['companies']['BE']['pendingPhases'], ['supplemental'])
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())
                sec_release.set()
                self.assertTrue(sec_finished.wait(2))
        # No late mutation by a cancelled network worker after the loop stopped.
        with monitor.connect(self.path) as db:
            self.assertIsNone(db.execute('SELECT 1 FROM sources WHERE url=?', (BE_FILING,)).fetchone())

    def test_failed_sec_health_does_not_clear_on_later_primary_success(self):
        app = self.make_app(workers=2)
        def transport(url, _ticker, **_kwargs):
            if url == monitor.INDEXES['BE']:
                return self.feed_body, 'text/xml'
            if url == BE_URL:
                return self.body, 'text/html'
            raise HTTPError(url, 403, 'Synthetic SEC restriction', {}, None)
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                def failed_then_primary():
                    with app.state_lock:
                        company = app.state['companies'].get('BE', {})
                        phases = company.get('phases', {})
                        return (phases.get('supplemental', {}).get('error') == 'http-403'
                                and phases.get('primary', {}).get('checkedAt', '') >
                                phases.get('supplemental', {}).get('checkedAt', 'z'))
                self.wait_until(failed_then_primary)
                with app.state_lock:
                    company = app.state['companies']['BE']
                    self.assertEqual(company['status'], 'degraded')
                    self.assertEqual(company['route'], 'primary')
                    self.assertEqual(company['error'], 'http-403')
                    self.assertEqual(company['phases']['primary']['nextPollSeconds'], 0.05)
                    self.assertGreater(company['phases']['supplemental']['nextPollSeconds'], 0.05)
                with app.db_lock, monitor.connect(self.path) as db:
                    incident = db.execute("SELECT status FROM operational_incidents WHERE incident_key='source:BE:supplemental'").fetchone()
                    self.assertEqual(incident[0], 'open')
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())

    def test_independent_sec_baseline_restart_and_duplicates(self):
        # Initial SEC discovery is baseline-only. On restart a new filing becomes
        # one event; the retained issuer event and first filing are not repeated.
        for phase in (1, 2):
            app = self.make_app()
            filing = BE_FILING if phase == 1 else BE_FILING.replace('000001/', '000002/').replace('20261002', '20261003')
            sec_json = self.sec_body if phase == 1 else self.sec_body.replace(b'26-000001', b'26-000002').replace(b'20261002', b'20261003')
            def transport(url, _ticker, **_kwargs):
                if url == monitor.INDEXES['BE']:
                    return self.feed_body, 'text/xml'
                if url == BE_SEC_JSON:
                    return sec_json, 'application/json'
                if url == BE_URL:
                    return self.body, 'text/html'
                raise HTTPError(url, 403, 'Synthetic SEC restriction', {}, None)
            with patch.object(monitor, 'fetch', new=transport):
                app.thread.start()
                try:
                    def retained():
                        with app.db_lock, monitor.connect(self.path) as db:
                            return db.execute('SELECT 1 FROM sources WHERE url=?', (filing,)).fetchone() is not None
                    self.wait_until(retained)
                    self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                finally:
                    app.stop_event.set()
                    app.thread.join(2)
                    self.assertFalse(app.thread.is_alive())
            with monitor.connect(self.path) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM release_events WHERE url=?', (BE_URL,)).fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT count(*) FROM release_events WHERE url=?', (BE_FILING,)).fetchone()[0], 0)
                self.assertEqual(db.execute('SELECT count(*) FROM release_events WHERE url=?', (filing,)).fetchone()[0], phase - 1)
                self.assertEqual(db.execute("SELECT count(*) FROM sources WHERE ticker='BE'").fetchone()[0], phase + 1)

    def test_slow_be_sec_body_allows_issuer_rss_body_and_publication_with_two_workers(self):
        app = self.make_app(workers=2)
        started, release, finished = (threading.Event() for _ in range(3))
        counts, active, peak = {}, 0, 0
        lock = threading.Lock()
        with monitor.connect(self.path) as db:
            monitor.add_source(db, 'BE', BE_FILING, title='8-K synthetic fixture')
        def transport(url, _ticker, **_kwargs):
            nonlocal active, peak
            with lock:
                counts[url] = counts.get(url, 0) + 1
                active += 1
                peak = max(peak, active)
            try:
                if url == BE_FILING:
                    started.set()
                    release.wait(5)
                    finished.set()
                    raise HTTPError(url, 403, 'Synthetic SEC body restriction', {}, None)
                if url == monitor.INDEXES['BE']:
                    return self.feed_body, 'text/xml'
                if url == BE_URL:
                    return self.body, 'text/html'
                if url == BE_SEC_JSON:
                    return self.sec_body, 'application/json'
                raise AssertionError('Unexpected offline fixture request')
            finally:
                with lock:
                    active -= 1
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.assertTrue(started.wait(2))
                self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                self.wait_until(lambda: counts.get(monitor.INDEXES['BE'], 0) >= 2)
                self.assertFalse(release.is_set())
                self.assertEqual(counts[BE_FILING], 1)
                self.assertEqual(counts.get(BE_SEC_JSON, 0), 0)
                self.assertLessEqual(peak, 2)
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())
                release.set()
                self.assertTrue(finished.wait(2))
        with monitor.connect(self.path) as db:
            # The cancelled body worker cannot persist its late 403 result.
            row = db.execute('SELECT checked_at,error FROM sources WHERE url=?', (BE_FILING,)).fetchone()
            self.assertIsNone(row['checked_at'])
            self.assertIsNone(row['error'])

    def test_sec_phase_does_not_jump_older_issuer_work_or_reserve_unrelated_sec_bodies(self):
        app = self.make_app(workers=2)
        app.tickers = ['BE', 'NVDA']
        started, release, finished, unrelated_started = (threading.Event() for _ in range(4))
        order = []
        unrelated = 'https://www.sec.gov/Archives/edgar/data/1321655/000132165526000001/pltr-20261003.htm'
        original = app.collect_discovery_timed
        def collect(ticker, cached_sources=None, source_scope=None):
            if ticker == 'NVDA':
                order.append('NVDA')
                return ({'ticker': ticker, 'status': 'ok', 'route': 'primary',
                         'sourceUrl': monitor.INDEXES[ticker], 'sourceFormat': 'rss',
                         'sourcesChecked': 1, 'sourcesConfigured': 1, 'candidates': 0, 'error': None}, {}, 0)
            return original(ticker, cached_sources, source_scope)
        def transport(url, _ticker, **_kwargs):
            if url == monitor.INDEXES['BE']:
                order.append('BE')
                return self.feed_body, 'text/xml'
            if url == BE_SEC_JSON:
                order.append('SEC')
                started.set()
                release.wait(5)
                finished.set()
                return self.sec_body, 'application/json'
            if url == BE_URL:
                return self.body, 'text/html'
            if url == unrelated:
                unrelated_started.set()
                raise HTTPError(url, 403, 'Synthetic unrelated SEC restriction', {}, None)
            raise AssertionError('Unexpected offline fixture request')
        with patch.object(app, 'collect_discovery_timed', new=collect), patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.assertTrue(started.wait(2))
                self.assertLess(order.index('NVDA'), order.index('SEC'))
                with app.db_lock, monitor.connect(self.path) as db:
                    monitor.add_source(db, 'PLTR', unrelated, title='8-K synthetic unrelated fixture')
                self.assertTrue(unrelated_started.wait(2))
                self.wait_until(lambda: order.count('NVDA') >= 2)
                self.assertFalse(release.is_set())
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())
                release.set()
                self.assertTrue(finished.wait(2))

    def test_single_worker_keeps_bounded_serial_progress(self):
        app = self.make_app(workers=1)
        counts = {}
        def transport(url, _ticker, **_kwargs):
            counts[url] = counts.get(url, 0) + 1
            if url == monitor.INDEXES['BE']:
                return self.feed_body, 'text/xml'
            if url == BE_URL:
                return self.body, 'text/html'
            if url == BE_SEC_JSON:
                return self.sec_body, 'application/json'
            raise HTTPError(url, 403, 'Synthetic SEC body restriction', {}, None)
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                self.wait_until(lambda: counts.get(BE_SEC_JSON, 0) >= 2)
                self.assertGreaterEqual(counts.get(monitor.INDEXES['BE'], 0), 2)
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())

    def test_same_host_be_body_work_remains_serialized(self):
        app = self.make_app(workers=3)
        started, release, finished = (threading.Event() for _ in range(3))
        second = BE_URL.replace('Synthetic-Update', 'Synthetic-Second-Update')
        calls = []
        with monitor.connect(self.path) as db:
            monitor.add_source(db, 'BE', BE_URL, title='Synthetic first body')
            monitor.add_source(db, 'BE', second, title='Synthetic second body')
        def transport(url, _ticker, **_kwargs):
            if url in {BE_URL, second}:
                calls.append(url)
                if len(calls) == 1:
                    started.set()
                    release.wait(5)
                    finished.set()
                return self.body, 'text/html'
            if url == monitor.INDEXES['BE']:
                return self.feed_body, 'text/xml'
            if url == BE_SEC_JSON:
                return self.sec_body, 'application/json'
            raise HTTPError(url, 403, 'Synthetic SEC body restriction', {}, None)
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.assertTrue(started.wait(2))
                # Several scheduler admission cycles must not overlap same-host
                # bodies merely because BE now has host-scoped reservations.
                threading.Event().wait(0.2)
                self.assertEqual(len(calls), 1)
                release.set()
                self.wait_until(lambda: len(calls) == 2)
            finally:
                app.stop_event.set()
                release.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())
                self.assertTrue(finished.wait(2))

    def test_one_row_body_batch_cannot_be_reserved_by_blocked_be_sec_body(self):
        app = self.make_app(workers=2)
        app.body_batch = 1
        started, release, finished = (threading.Event() for _ in range(3))
        second = BE_URL.replace('Synthetic-Update', 'Synthetic-New-Update')
        requested = []
        def transport(url, _ticker, **_kwargs):
            requested.append(url)
            if url == monitor.INDEXES['BE']:
                return self.feed_body, 'text/xml'
            if url == BE_SEC_JSON:
                started.set()
                release.wait(5)
                finished.set()
                return self.sec_body, 'application/json'
            if url in {BE_URL, second}:
                return self.body, 'text/html'
            raise HTTPError(url, 403, 'Synthetic SEC body restriction', {}, None)
        with patch.object(monitor, 'fetch', new=transport):
            app.thread.start()
            try:
                self.assertTrue(started.wait(2))
                self.wait_until(lambda: any(item['url'] == BE_URL for item in self.feed(app)))
                # Introduce retained SEC backlog while its discovery request is
                # still outstanding, then a newer healthy issuer RSS release.
                with app.db_lock, monitor.connect(self.path) as db:
                    monitor.add_source(db, 'BE', BE_FILING, title='8-K synthetic backlog')
                threading.Event().wait(0.12)
                self.feed_body = rss([(second, 'Bloom Energy announces another synthetic capacity update',
                                      format_datetime(self.reference), self.reference.date().isoformat())])
                self.wait_until(lambda: any(item['url'] == second for item in self.feed(app)))
                self.assertNotIn(BE_FILING, requested)
                self.assertFalse(release.is_set())
            finally:
                app.stop_event.set()
                app.thread.join(2)
                self.assertFalse(app.thread.is_alive())
                release.set()
                self.assertTrue(finished.wait(2))


if __name__ == '__main__':
    unittest.main()
