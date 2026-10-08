"""Scheduled-release burst polling and owner alerts (owner request, Oct 8)."""
from datetime import datetime, timedelta, timezone
import json
import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

import release_watch as watch
import signals

AT = datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)
CPI = {'id': 'cpi-2026-10-14', 'kind': 'economic', 'indicator': 'cpi', 'phase': 'release', 'at': AT,
       'titleJa': '米国CPI（消費者物価指数）'}
ASML = {'id': 'asml-q3-2026-release', 'kind': 'earnings', 'ticker': 'ASML', 'phase': 'release',
        'at': AT - timedelta(hours=7, minutes=30), 'titleJa': 'ASML 決算発表（2026年Q3）'}
CALL = {'id': 'lrcx-call', 'kind': 'earnings', 'ticker': 'LRCX', 'phase': 'call', 'at': AT, 'titleJa': 'Lam 決算説明会'}


def iso(value):
    return value.isoformat().replace('+00:00', 'Z')


class ReleaseWatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db = sqlite3.connect(os.path.join(self.temp.name, 'db.sqlite'))
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        self.db.execute('''CREATE TABLE push_devices (id TEXT PRIMARY KEY, subscription TEXT NOT NULL,
          tickers TEXT NOT NULL, language TEXT NOT NULL, since REAL NOT NULL, active INTEGER NOT NULL DEFAULT 1,
          owner_id TEXT, access_until REAL)''')
        self.db.execute("INSERT INTO push_devices VALUES('owner','{\"endpoint\":\"o\"}','[]','ja',0,1,?,NULL)",
                        (watch.OWNER_MEMBER_ID,))
        self.db.execute("INSERT INTO push_devices VALUES('member','{\"endpoint\":\"m\"}','[\"*\"]','ja',0,1,'user_member',NULL)")
        self.sent = []

    def transport(self, subscription, message):
        self.sent.append((subscription['endpoint'], message))
        return 201

    def test_shipped_schedule_mirrors_the_calendar_and_parses(self):
        events = watch.load_schedule()
        self.assertTrue(any(e['id'] == 'cpi-2026-10-14' and e['at'] == AT for e in events))
        self.assertTrue(all(e['phase'] in {'release', 'call'} for e in events))

    def test_burst_covers_one_minute_before_to_fifteen_after_a_release_only(self):
        self.assertEqual(watch.burst_routes(AT - timedelta(seconds=61), [CPI]), set())
        self.assertEqual(watch.burst_routes(AT - timedelta(seconds=60), [CPI]), {'x-wallstengine'})
        self.assertEqual(watch.burst_routes(AT + timedelta(minutes=15), [CPI]), {'x-wallstengine'})
        self.assertEqual(watch.burst_routes(AT + timedelta(minutes=16), [CPI]), set())
        self.assertEqual(watch.burst_routes(AT, [CALL]), set())
        self.assertEqual(watch.burst_routes(ASML['at'], [ASML]), {'x-wallstengine', 'x-tipranks'})

    def test_burst_route_polls_every_ten_seconds_and_skips_fair_share_pacing(self):
        source = {'id': 'x-wallstengine', 'format': 'x-api', 'intervalSeconds': 30}
        with patch.object(watch, 'load_schedule', return_value=[CPI]):
            self.assertEqual(signals.source_interval_seconds(source, AT), 10)
            self.assertEqual(signals.source_interval_seconds(source, AT + timedelta(hours=1)), 30)

    def test_missing_result_alerts_only_the_owner_once_after_three_minutes(self):
        self.assertEqual(watch.check(self.db, {}, AT + timedelta(minutes=2, seconds=59), self.transport, [CPI]), [])
        alerts = watch.check(self.db, {}, AT + timedelta(minutes=3), self.transport, [CPI])
        self.assertEqual([(a['kind'], a['delivered']) for a in alerts], [('missing', 1)])
        self.assertEqual([endpoint for endpoint, _ in self.sent], ['o'])
        self.assertIn('未掲載', self.sent[0][1]['title'])
        self.assertEqual(watch.check(self.db, {}, AT + timedelta(minutes=4), self.transport, [CPI]), [])

    def test_publication_reports_delay_from_the_scheduled_time(self):
        payload = {'resultBriefs': [{'kind': 'economic', 'ticker': 'ECON', 'titleEn': 'CPI MoM: actual 0.3%',
                                     'titleJa': 'CPI 前月比：結果 0.3%', 'publishedAt': iso(AT + timedelta(seconds=20)),
                                     'publicAt': iso(AT + timedelta(seconds=95))}]}
        alerts = watch.check(self.db, payload, AT + timedelta(minutes=2), self.transport, [CPI])
        self.assertEqual([(a['kind'], a['delaySeconds']) for a in alerts], [('published', 95)])
        self.assertIn('1分35秒', self.sent[0][1]['body'])
        # A later poll neither re-sends nor reports it missing.
        self.assertEqual(watch.check(self.db, payload, AT + timedelta(minutes=5), self.transport, [CPI]), [])

    def test_unrelated_or_stale_results_do_not_count(self):
        payload = {'resultBriefs': [
            {'kind': 'economic', 'titleEn': 'Nonfarm payrolls: actual +29K', 'titleJa': '雇用者数',
             'publishedAt': iso(AT), 'publicAt': iso(AT)},
            {'kind': 'economic', 'titleEn': 'CPI MoM: actual 0.3%', 'titleJa': 'CPI',
             'publishedAt': iso(AT - timedelta(days=30)), 'publicAt': iso(AT - timedelta(days=30))},
            {'kind': 'earnings', 'ticker': 'ASMLX', 'titleEn': 'x', 'titleJa': 'x', 'publishedAt': iso(AT), 'publicAt': iso(AT)},
        ]}
        self.assertIsNone(watch.match(CPI, payload))
        self.assertIsNone(watch.match(ASML, payload))

    def test_official_earnings_release_counts_for_its_ticker(self):
        payload = {'officialUpdates': [{'tickers': ['ASML'], 'researchId': 'ir-result-9', 'title': 'ASML reports Q3',
                                        'publishedAt': iso(ASML['at']), 'observedAt': iso(ASML['at'] + timedelta(seconds=40))}]}
        self.assertEqual(watch.match(ASML, payload), ASML['at'] + timedelta(seconds=40))

    def test_call_event_is_due_at_the_call_and_accepts_earlier_results(self):
        payload = {'resultBriefs': [{'kind': 'earnings', 'ticker': 'LRCX', 'titleEn': 'x', 'titleJa': 'x',
                                     'publishedAt': iso(AT - timedelta(hours=1)), 'publicAt': iso(AT - timedelta(minutes=58))}]}
        alerts = watch.check(self.db, payload, AT - timedelta(minutes=50), self.transport, [CALL])
        self.assertEqual([(a['kind'], a['delaySeconds']) for a in alerts], [('published', -3480)])
        self.assertIn('前', self.sent[0][1]['body'])
        self.assertEqual(watch.check(self.db, {}, AT - timedelta(seconds=1), None, [{**CALL, 'id': 'other'}]), [])
        self.assertEqual([a['kind'] for a in watch.check(self.db, {}, AT, None, [{**CALL, 'id': 'other'}])], ['missing'])

    def test_diagnostics_are_read_only_and_name_no_endpoints(self):
        before = list(self.db.iterdump())
        state = watch.diagnostics(self.db, AT - timedelta(minutes=30), [CPI])
        self.assertEqual(list(self.db.iterdump()), before)
        self.assertEqual(state['ownerDevices'], 1)
        self.assertEqual(state['next'][0]['event'], 'cpi-2026-10-14')
        self.assertNotIn('endpoint', json.dumps(state))


if __name__ == '__main__':
    unittest.main()
