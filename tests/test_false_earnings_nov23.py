"""Nov 23, 2026 incidents: old releases found on a new source route were announced as new earnings, and one event pushed twice.

COHR (00:59 UTC): PR #768 made GlobeNewswire's feed the primary route. Its first fetch listed the Nov 4, Aug 12 and May 6 results
releases; the per-job baseline was already satisfied by older runs of other addresses, so all three became release events, three
"announced" lines (Q1, Q4, Q3) and three phone alerts per device.
LRCX (16:49 UTC Nov 22): PR #759 moved LRCX to the IR-top PDF list; the Oct 21 results PDF came back as a new release.
CRWD (11:04 UTC): real (SEC 8-K Item 2.02 accepted 11:04:51 UTC), but the "announced" line (Q0) and the figures (Q3) were two alerts.
"""
import base64
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor  # noqa: E402
import signals  # noqa: E402
import earnings_announce as announce  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import release_freshness  # noqa: E402
import false_earnings_cleanup as cleanup  # noqa: E402
import web_push as push  # noqa: E402
import service  # noqa: E402

GNW = 'https://www.globenewswire.com/news-release/{}/{}/{}/31{}/11543/en/Coherent-Corp-Reports-{}-Results.html'
COHR_RELEASES = [
    (GNW.format('2026', '11', '04', '00001', 'First-Quarter-Fiscal-2027'), 'Coherent Corp. Reports First Quarter Fiscal 2027 Results'),
    (GNW.format('2026', '08', '12', '00002', 'Fourth-Quarter-Fiscal-2026'), 'Coherent Corp. Reports Fourth Quarter Fiscal 2026 Results'),
    (GNW.format('2026', '05', '06', '00003', 'Third-Quarter-Fiscal-2026'), 'Coherent Corp. Reports Third Quarter Fiscal 2026 Results'),
]
LRCX_PDF = ('https://investor.lamresearch.com/content/dam/newsroom/press_release_pdfs/2026-10-21-Lam-Research-Corporation-Reports-'
            'Financial-Results-for-the-Quarter-Ended-September-27,-2026.pdf')
COHR_SEEN = '2026-11-23T00:59:40+00:00'
COHR_NOW = datetime(2026, 11, 23, 0, 59, 50, tzinfo=timezone.utc)


class Database(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = str(Path(self.tmp.name) / 'db.sqlite')
        with monitor.connect(self.path) as db:
            signals.schema(db)

    def source(self, url, ticker, title, seen, event=True, published_on=None, accepted=None, text=None, form=None):
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,title,discovered_at,sha256,status,published_on,sec_form,'
                       'sec_acceptance_datetime) VALUES(?,?,?,?,?,?,?,?,?)',
                       (url, ticker, title, seen, 'h', 'pending', published_on, form, accepted))
            if event:
                db.execute('INSERT OR REPLACE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (url, ticker, seen))
            if text is not None:
                db.execute('INSERT OR REPLACE INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) '
                           'VALUES(?,?,?,?,?)', (url, 'h', seen, text, len(text)))


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


class Freshness(unittest.TestCase):
    def test_the_release_s_own_date_decides(self):
        self.assertEqual(str(release_freshness.url_date(COHR_RELEASES[0][0])), '2026-11-04')
        self.assertEqual(str(release_freshness.url_date(LRCX_PDF)), '2026-10-21')
        self.assertIsNone(release_freshness.url_date('https://www.sec.gov/Archives/edgar/data/1535527/000153552726000035/crwd-20261123.htm'))
        self.assertTrue(release_freshness.is_stale(COHR_NOW, url=COHR_RELEASES[0][0]))
        self.assertTrue(release_freshness.is_stale(datetime(2026, 11, 22, 16, 49, tzinfo=timezone.utc), url=LRCX_PDF))
        # A release dated today, and one with no date at all, are not stale by this rule.
        self.assertFalse(release_freshness.is_stale(COHR_NOW, url=GNW.format('2026', '11', '22', '9', 'X')))
        self.assertFalse(release_freshness.is_stale(COHR_NOW, url='https://example.com/results'))
        # CRWD: accepted by the SEC minutes ago.
        self.assertFalse(release_freshness.is_stale(datetime(2026, 11, 23, 11, 7, tzinfo=timezone.utc),
                                                    sec_acceptance='2026-11-23T11:04:51.000Z'))
        self.assertTrue(release_freshness.is_stale(COHR_NOW, published_on='2026-11-04'))


class CohrNewRoute(Database):
    def test_a_new_route_s_first_listing_is_baseline_not_three_results(self):
        # The production case: the first fetch of the new feed stored the three past releases with no release event.
        for url, title in COHR_RELEASES:
            self.source(url, 'COHR', title, COHR_SEEN, event=False)
        self.assertEqual(announce.run_once(self.path, COHR_NOW), 0)

    def test_old_releases_with_an_event_are_still_history_by_their_own_date(self):
        for url, title in COHR_RELEASES:
            self.source(url, 'COHR', title, COHR_SEEN, event=True)
        self.assertEqual(announce.run_once(self.path, COHR_NOW), 0)
        with monitor.connect(self.path) as db:
            self.assertEqual(announce.public_feed(db, '2026-11-20T00:00:00+00:00'), [])

    def test_a_quarter_already_announced_is_not_announced_again_from_another_address(self):
        self.source('https://ir.coherent.com/news-releases/news-release-details/q1-fy27', 'COHR',
                    'Coherent Corp. Reports First Quarter Fiscal 2027 Results', '2026-11-04T21:05:10+00:00')
        self.assertEqual(announce.run_once(self.path, datetime(2026, 11, 4, 21, 6, tzinfo=timezone.utc)), 1)
        # Found again weeks later on an undated address: the same quarter, so no second line.
        self.source('https://www.coherent.com/news/press-releases/q1-fy27-results', 'COHR',
                    'Coherent Corp. Reports First Quarter Fiscal 2027 Results', COHR_SEEN)
        self.assertEqual(announce.run_once(self.path, COHR_NOW), 0)

    def test_a_genuinely_new_release_on_the_new_route_is_still_announced(self):
        url = GNW.format('2026', '11', '23', '00009', 'Second-Quarter-Fiscal-2027')
        self.source(url, 'COHR', 'Coherent Corp. Reports Second Quarter Fiscal 2027 Results', COHR_SEEN)
        self.assertEqual(announce.run_once(self.path, COHR_NOW), 1)

    def test_the_figures_lane_skips_baselined_and_stale_releases(self):
        reference = COHR_NOW
        with monitor.connect(self.path) as db:
            flash.schema(db)
            for url, title in COHR_RELEASES:
                db.execute('INSERT INTO sources(url,ticker,title,discovered_at,sha256,status) VALUES(?,?,?,?,?,?)',
                           (url, 'COHR', title, COHR_SEEN, 'h', 'pending'))
            rows = [dict(row) for row in db.execute(
                'SELECT s.url,s.published_on,s.sec_acceptance_datetime,e.detected_at AS event_at FROM sources s '
                'LEFT JOIN release_events e ON e.url=s.url')]
        self.assertEqual([flash.new_release(row, reference) for row in rows], [False] * 3)
        self.assertEqual([flash.new_release({**row, 'event_at': COHR_SEEN}, reference) for row in rows], [False] * 3)
        fresh = {'url': GNW.format('2026', '11', '23', '00009', 'X'), 'published_on': None, 'sec_acceptance_datetime': None,
                 'event_at': COHR_SEEN}
        self.assertTrue(flash.new_release(fresh, reference))


class PerSourceBaseline(unittest.TestCase):
    def result(self, url, status='ok', route='primary'):
        return {'ticker': 'COHR', 'status': status, 'route': route, 'sourceUrl': url, 'candidates': 3, 'error': None}

    def test_the_first_verified_result_of_a_new_address_is_baseline(self):
        old_feed, new_feed = 'https://ir.coherent.com/rss/news-releases.xml', 'https://rss.globenewswire.com/RssFeed/organization/x'
        verified = {('COHR', old_feed)}
        with redirect_stdout(StringIO()) as out:
            # Nov 23: the job had been baselined long ago (older addresses), but the new feed was read for the first time.
            self.assertFalse(service.release_events_allowed(True, 'COHR', self.result(new_feed), ['a', 'b', 'c'], verified))
        self.assertIn('discovery-source-baseline', out.getvalue())
        # From the second fetch on, what the new feed adds is new.
        self.assertTrue(service.release_events_allowed(True, 'COHR', self.result(new_feed), ['d'], verified))
        self.assertTrue(service.release_events_allowed(True, 'COHR', self.result(old_feed, 'fallback', 'fallback'), ['e'], verified))
        # Never before the job's own baseline.
        self.assertFalse(service.release_events_allowed(False, 'COHR', self.result(old_feed), ['f'], verified))
        # A failed fetch records nothing.
        service.release_events_allowed(True, 'COHR', self.result('https://x.example/', 'degraded', 'none'), [], verified)
        self.assertNotIn(('COHR', 'https://x.example/'), verified)

    def test_a_supplemental_route_read_every_cycle_is_known_when_it_becomes_the_named_route(self):
        sec = 'https://data.sec.gov/submissions/CIK0001535527.json'
        verified = set()
        self.assertTrue(service.release_events_allowed(True, 'CRWD', {**self.result(sec, 'fallback', 'fallback'), 'ticker': 'CRWD'},
                                                       ['8k'], verified, cached_sources={sec: {}}))

    def test_known_addresses_come_from_completed_runs(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / 'db.sqlite')
            with monitor.connect(path) as db:
                monitor.save_discovery(db, 'COHR', self.result('https://ir.coherent.com/rss/news-releases.xml'), {})
                monitor.save_discovery(db, 'COHR', self.result('https://broken.example/', 'degraded', 'none'), {})
                self.assertEqual(monitor.verified_discovery_sources(db), {('COHR', 'https://ir.coherent.com/rss/news-releases.xml')})


class OnePushPerEvent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'push.sqlite')
        self.db.execute("CREATE TRIGGER IF NOT EXISTS test_awake AFTER INSERT ON push_devices BEGIN "
                        "UPDATE push_devices SET quiet_on=0 WHERE id=NEW.id; END")
        self.env = patch.dict(os.environ, {'WEB_PUSH_ALLOW_PILOT': 'true', 'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'test',
                                           'WEB_PUSH_PUBLIC_KEY': 'test', 'WEB_PUSH_SUBJECT': 'mailto:test@example.com'})
        self.env.start()
        self.now = datetime(2026, 11, 23, 11, 7, 19, tzinfo=timezone.utc).timestamp()
        sub = {'endpoint': 'https://web.push.apple.com/push/test',
               'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}
        push.register(self.db, {'subscription': sub, 'tickers': ['CRWD', 'COHR'], 'language': 'ja'}, {'CRWD', 'COHR'}, self.now - 60)

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def item(self, ticker, period, rid, at):
        return {'kind': 'earnings', 'ticker': ticker, 'period': period, 'researchId': rid, 'titleJa': f'{ticker} 決算を発表しました',
                'titleEn': f'{ticker} announced its results', 'facts': [], 'publishedAt': at, 'observedAt': at}

    def deliver(self, items, now):
        sent = []
        with redirect_stdout(StringIO()):
            push.deliver(self.db, items, lambda sub, payload: sent.append(payload) or 201, now, wall_now=lambda: now)
        return sent

    def test_crwd_announced_line_and_figures_are_one_alert(self):
        # Nov 23 (owner): the announced line waits for the figures; the one alert is the one with the figures.
        line = self.item('CRWD', 'Latest', 'ir-announce-1', '2026-11-23T11:07:15+00:00')
        self.assertEqual(self.deliver([line], self.now), [])
        figures = {**self.item('CRWD', 'Q3 FY2027', 'ir-flash-1', '2026-11-23T11:07:38+00:00'), 'titleJa': 'CRWD Q3 FY2027決算：売上高$1.4B',
                   'facts': [{'key': 'revenue', 'ja': '売上高', 'en': 'Revenue', 'value': '$1.582B', 'comparisons': {'yearAgo': '$1.297B'}},
                             {'key': 'adjusted-eps', 'ja': '調整後EPS', 'en': 'Adjusted EPS', 'value': '$0.34'},
                             {'key': 'guidance-revenue', 'ja': '会社予想 売上高（Q4 FY27）', 'en': 'Guidance revenue (Q4 FY27)', 'value': '$1.6152B-$1.6252B'}]}
        sent = self.deliver([line, figures], self.now + 21)
        self.assertEqual([p['body'] for p in sent], ['CRWD Q3 FY2027決算：売上高$1.58B（+22%）、調整後EPS$0.34、次期売上予想$1.62B〜$1.63B'])
        # the held line never follows, even after its wait
        self.assertEqual(self.deliver([line, figures], self.now + 700), [])
        self.assertEqual(self.deliver([line], self.now + 700), [])

    def test_announced_line_alone_goes_out_once_after_ten_minutes(self):
        line = self.item('CRWD', 'Latest', 'ir-announce-1', '2026-11-23T11:07:15+00:00')
        self.assertEqual(self.deliver([line], self.now + 300), [])
        sent = self.deliver([line], self.now + 600)
        self.assertEqual([p['body'] for p in sent], ['CRWD 決算を発表しました'])
        self.assertEqual(self.deliver([line], self.now + 660), [])

    def test_cohr_three_quarters_in_one_poll_are_one_alert(self):
        at = '2026-11-23T11:07:10+00:00'
        items = [self.item('COHR', p, 'ir-announce-' + str(n), at) for n, p in enumerate(('Q1 2027', 'Q4 2026', 'Q3 2026'))]
        self.assertEqual(len(self.deliver(items, self.now + 600)), 1)

    def test_the_next_quarter_alerts_again(self):
        self.assertEqual(len(self.deliver([self.item('CRWD', 'Latest', 'ir-announce-1', '2026-11-23T11:07:15+00:00')], self.now + 600)), 1)
        later = self.now + 90 * 86400
        at = datetime.fromtimestamp(later - 5, timezone.utc).isoformat()
        figures = {**self.item('CRWD', 'Q4 FY2027', 'ir-flash-2', at), 'facts': [{'key': 'revenue', 'ja': '売上高', 'en': 'Revenue', 'value': '$1.7B'}]}
        self.assertEqual(len(self.deliver([figures], later)), 1)


class Cleanup(Database):
    def test_dry_run_selects_only_the_late_copies_and_apply_needs_confirmation(self):
        for url, title in COHR_RELEASES:
            self.source(url, 'COHR', title, COHR_SEEN)
        self.source(LRCX_PDF, 'LRCX', 'Lam Research Reports Financial Results', '2026-11-22T16:49:00+00:00')
        crwd = 'https://www.sec.gov/Archives/edgar/data/1535527/000153552726000035/crwd-20261123.htm'
        self.source(crwd, 'CRWD', '8-K · Item 2.02 Results of Operations and Financial Condition', '2026-11-23T11:05:10+00:00',
                    accepted='2026-11-23T11:04:51.000Z', form='8-K')
        with monitor.connect(self.path) as db:
            announce.schema(db)
            for n, (url, _) in enumerate(COHR_RELEASES):
                db.execute('INSERT INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                           (f'k{n}', 'COHR', url, f'Q{n + 1} 2027', COHR_SEEN, COHR_SEEN, 1))
            db.execute('INSERT INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                       ('crwd', 'CRWD', crwd, 'Latest', '2026-11-23T11:05:10+00:00', '2026-11-23T11:05:10+00:00', 1))
            db.execute("INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,observed_at,excerpt,diff,"
                       "truncated) VALUES('primary-ir-LRCX',?,'s','t','[\"LRCX\"]','[]','new','2026-11-22T16:49:00+00:00','','',0)",
                       (LRCX_PDF,))
        db_args = ['--db', self.path, '--tickers', 'COHR,LRCX,CRWD', '--until', '2026-11-23T12:00:00+00:00']
        with redirect_stdout(StringIO()) as out:
            cleanup.main(db_args)
        report = json.loads(out.getvalue())
        self.assertEqual(report['mode'], 'dry-run')
        self.assertEqual(len(report['rows']['earnings_announcements']), 3)
        self.assertEqual(len(report['rows']['signal_events']), 1)
        self.assertEqual(len(report['rows']['release_events']), 4)
        self.assertNotIn(crwd, json.dumps(report))
        with self.assertRaises(SystemExit), redirect_stdout(StringIO()), patch('sys.stderr', StringIO()):
            cleanup.main(db_args + ['--apply', '--backup', str(Path(self.tmp.name) / 'b.json')])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM earnings_announcements').fetchone()[0], 4)
        backup = Path(self.tmp.name) / 'b.json'
        with patch.dict(os.environ, {'CLEANUP_CONFIRM': 'COHR,LRCX,CRWD'}), redirect_stdout(StringIO()):
            cleanup.main(db_args + ['--apply', '--backup', str(backup)])
        with sqlite3.connect(self.path) as db:
            self.assertEqual([r[0] for r in db.execute('SELECT ticker FROM earnings_announcements')], ['CRWD'])
            self.assertEqual(db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM release_events').fetchone()[0], 1)
        self.assertEqual(len(json.loads(backup.read_text())['rows']['earnings_announcements']), 3)


if __name__ == '__main__':
    unittest.main()
