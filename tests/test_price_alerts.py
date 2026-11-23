"""ウォッチリストの価格通知 (Nov 21): crossing, re-arm, one notice a day, market hours, credits, splits, quiet mode, PRO and the owner.
Synthetic data only; no network."""
import hashlib
import json
import os
import re
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import favorite_lists
import member_data_retention as retention
import price_alerts as pa
import web_push as push
from test_web_push import subscription

ET = ZoneInfo('America/New_York')
FAV = 'b' * 64
OTHER_FAV = 'c' * 64


def et(day, hour, minute=0):
    return datetime(2026, 11, day, hour, minute, tzinfo=ET).timestamp()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'p.sqlite'
        self.db = push.connect(self.path)
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'f', 'WEB_PUSH_PUBLIC_KEY': 'f',
                                           'WEB_PUSH_SUBJECT': 'mailto:f@example.test', 'PRICE_ALERT_PUSH_ENABLED': 'true'})
        self.env.start()
        self.now = et(17, 10)  # Tuesday 10:00 ET, regular session
        self.payload = {'memberId': 'user_fixture', 'subscription': subscription(), 'accessExpiresAt': self.now + 86400 * 30,
                        'allTargets': True, 'favoritesOwner': FAV}
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)
        # US market hours are night in Japan: most of these tests look at the notice itself, with おやすみモード off.
        push.member_preferences(self.db, {**self.payload, 'preferences': {'quiet': {'on': False, 'start': 23, 'end': 7}}}, save=True, now=self.now)
        self.sent, self.calls = [], []
        self.prices = {}
        self.previous = {}
        self.usage = 0
        self.splits = {}
        self.entitled = True
        for state in pa.STATUS:
            pa.STATUS[state] = 0 if isinstance(pa.STATUS[state], int) else None

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def alerts(self, alerts, owner=FAV):
        with favorite_lists.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO member_favorite_lists VALUES (?,?,?)',
                       (owner, 1, json.dumps({'lists': [{'id': 'default', 'name': '', 'tickers': []}], 'names': {}, 'alerts': alerts})))
            db.commit()

    def transport(self, path, params):
        self.calls.append((path, dict(params)))
        if path == 'api_usage':
            return {'current_usage': self.usage, 'plan_limit': 610}
        if path == 'splits':
            return {'meta': {'symbol': params['symbol']}, 'splits': self.splits.get(params['symbol'], [])}
        assert path == 'quote'
        out = {}
        for symbol in params['symbol'].split(','):
            if symbol in self.prices:
                out[symbol] = {'symbol': symbol, 'currency': 'USD', 'close': str(self.prices[symbol]), 'previous_close': str(self.previous.get(symbol, self.prices[symbol])),
                               'last_quote_at': self.clock - 30}
            else:
                out[symbol] = {'code': 404, 'status': 'error', 'message': 'not found'}
        return out if len(out) > 1 else next(iter(out.values()))

    def run_at(self, when):
        self.clock = when
        return pa.run_once(self.db, transport=self.transport, now=when, send=lambda _s, m: self.sent.append(m) or 201,
                           entitlement=lambda _o: when + 3600 if self.entitled else 0, wall_now=lambda: when)


class Crossing(Base):
    def test_one_notice_when_the_price_crosses_and_none_while_it_stays_there(self):
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        self.prices['NVDA'] = 140
        self.assertEqual(self.run_at(self.now)['sent'], 0)
        self.prices['NVDA'] = 151.5
        self.assertEqual(self.run_at(self.now + 300)['sent'], 1)
        self.assertEqual(self.sent[0]['title'], 'NVDA 価格通知')
        self.assertIn('150.00 USD以上', self.sent[0]['body'])
        self.assertEqual(self.sent[0]['url'], '/research/watchlist')
        self.run_at(self.now + 600)
        self.prices['NVDA'] = 149.5  # back below, but not by 1%: not re-armed
        self.run_at(self.now + 900)
        self.prices['NVDA'] = 152
        self.run_at(self.now + 1200)
        self.assertEqual(len(self.sent), 1, 'a price wobbling around the level sends one notice')

    def test_re_arms_after_going_back_one_percent_but_only_once_a_day(self):
        self.alerts([{'ticker': 'MU', 'price': 100, 'direction': 'below', 'currency': 'USD'}])
        self.prices['MU'] = 105
        self.run_at(self.now)
        self.prices['MU'] = 99; self.run_at(self.now + 300)
        self.prices['MU'] = 102; self.run_at(self.now + 600)   # re-armed (more than 1% above)
        self.prices['MU'] = 98; self.run_at(self.now + 900)    # crossed again the same day: no second notice
        self.assertEqual(len(self.sent), 1)
        self.prices['MU'] = 103; self.run_at(et(18, 10))
        self.prices['MU'] = 97; self.run_at(et(18, 10, 5))
        self.assertEqual(len(self.sent), 2, 'the next trading day it can notify again')
        self.assertIn('以下', self.sent[1]['body'])

    def test_a_gap_through_the_level_at_the_open_counts_and_an_alert_already_met_waits(self):
        self.alerts([{'ticker': 'AMD', 'price': 200, 'direction': 'above', 'currency': 'USD'},
                     {'ticker': 'TSM', 'price': 100, 'direction': 'above', 'currency': 'USD'}])
        self.prices.update(AMD=210, TSM=120)
        self.previous.update(AMD=190, TSM=115)
        self.run_at(self.now)
        self.assertEqual([m['title'] for m in self.sent], ['AMD 価格通知'], 'AMD gapped up through 200; TSM was already above 100 yesterday')

    def test_an_edited_alert_starts_again(self):
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        self.prices['NVDA'] = 140; self.run_at(self.now)
        self.prices['NVDA'] = 151; self.run_at(self.now + 300)
        self.alerts([{'ticker': 'NVDA', 'price': 160, 'direction': 'above', 'currency': 'USD'}])
        self.previous['NVDA'] = 151
        self.run_at(self.now + 600)
        self.prices['NVDA'] = 161
        self.run_at(et(18, 10))
        self.assertEqual(len(self.sent), 2)

    def test_a_different_currency_is_never_compared(self):
        self.alerts([{'ticker': 'NVDA', 'price': 100, 'direction': 'above', 'currency': 'JPY'}])
        self.prices['NVDA'] = 90; self.run_at(self.now)
        self.prices['NVDA'] = 140; self.run_at(self.now + 300)
        self.assertEqual(self.sent, [])


class Scope(Base):
    def test_off_unless_the_flag_is_on_and_only_in_the_regular_session(self):
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        with patch.dict(os.environ, {'PRICE_ALERT_PUSH_ENABLED': ''}):
            self.assertEqual(self.run_at(self.now)['status'], 'disabled')
        for when in (et(17, 9, 29), et(17, 16), et(21, 11), et(26, 11), et(27, 13, 5)):  # pre, close, Saturday, Thanksgiving, early close
            self.assertEqual(self.run_at(when)['status'], 'market-closed', datetime.fromtimestamp(when, ET))
        self.assertEqual(self.calls, [], 'no credits are spent outside the session')
        self.assertTrue(pa.regular_session(et(27, 12, 59)))

    def test_the_holiday_calendar_matches_the_sites(self):
        source = (Path(__file__).resolve().parents[1] / 'lib/research/us-market-session.ts').read_text()
        holidays = set(re.findall(r'"(\d{4}-\d{2}-\d{2})"', source.split('const HOLIDAYS')[1].split(']);')[0]))
        early = set(re.findall(r'"(\d{4}-\d{2}-\d{2})"', source.split('const EARLY_CLOSE')[1].split(']);')[0]))
        self.assertEqual((set(pa.HOLIDAYS), set(pa.EARLY_CLOSE)), (holidays, early))

    def test_one_batched_read_and_it_waits_when_the_minutes_credits_are_used(self):
        self.alerts([{'ticker': t, 'price': 10, 'direction': 'above', 'currency': 'USD'} for t in ('NVDA', 'MU', 'BRK-B')])
        self.alerts([{'ticker': 'NVDA', 'price': 5, 'direction': 'below', 'currency': 'USD'}], owner=OTHER_FAV)
        self.usage = pa.CREDIT_CEILING - 1  # 3 tickers would pass the critical tier's ceiling
        self.assertEqual(self.run_at(self.now)['status'], 'credits-busy')
        self.assertEqual([c[0] for c in self.calls], ['api_usage'])
        self.usage = 100
        self.calls.clear()
        self.run_at(self.now + 300)
        self.assertEqual([c[0] for c in self.calls], ['api_usage', 'quote'])
        self.assertEqual(self.calls[1][1]['symbol'], 'BRK.B,MU,NVDA', "one read for all members' tickers, in the provider's spelling")

    def test_only_this_members_devices_with_the_switch_on_and_pro_or_owner(self):
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}], owner=OTHER_FAV)
        self.prices['NVDA'] = 140; self.run_at(self.now)
        self.prices['NVDA'] = 151; self.run_at(self.now + 300)
        self.assertEqual(self.sent, [], "another member's alert never reaches this device")
        self.alerts([{'ticker': 'MU', 'price': 100, 'direction': 'above', 'currency': 'USD'}])
        push.member_preferences(self.db, {**self.payload, 'preferences': {'priceAlerts': False}}, save=True, now=self.now)
        self.prices['MU'] = 90; self.run_at(self.now + 600)
        self.prices['MU'] = 101; self.run_at(self.now + 900)
        self.assertEqual(self.sent, [], 'the device turned 価格通知 off')
        push.member_preferences(self.db, {**self.payload, 'preferences': {'priceAlerts': True}}, save=True, now=self.now)
        self.entitled = False
        self.prices['MU'] = 90; self.run_at(et(18, 10))
        self.prices['MU'] = 101; self.run_at(et(18, 10, 5))
        self.assertEqual(self.sent, [], 'PRO is checked again right before the send (the owner account always passes that check)')

    def test_quiet_mode_sends_at_once_silently_and_marked(self):
        push.member_preferences(self.db, {**self.payload, 'preferences': {'quiet': {'on': True, 'start': 23, 'end': 7}}}, save=True, now=self.now)
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        self.prices['NVDA'] = 140; self.run_at(et(17, 10))   # 00:00 Japan time
        self.prices['NVDA'] = 151; self.run_at(et(17, 10, 5))
        self.assertEqual([(m['title'], m.get('silent')) for m in self.sent], [('おやすみモード・NVDA 価格通知', True)])

    def test_the_watchlist_key_arrives_with_a_status_check_and_is_erased_with_the_member(self):
        device = hashlib.sha256(subscription()['endpoint'].encode()).hexdigest()
        self.db.execute('UPDATE push_devices SET favorites_owner=NULL')
        self.db.commit()
        push.member_action(self.db, {**self.payload, 'accessExpiresAt': self.now + 3600}, 'status', now=self.now)
        self.assertEqual(self.db.execute('SELECT favorites_owner FROM push_devices WHERE id=?', (device,)).fetchone()[0], FAV)
        self.assertTrue(push.preference_view(self.db, self.db.execute('SELECT * FROM push_devices').fetchone())['priceAlerts'], 'on unless turned off')
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        self.prices['NVDA'] = 140; self.run_at(self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM price_alert_state').fetchone()[0], 1)
        keys = {'savedResearch': 'd' * 64, 'favorites': FAV, 'question': 'e' * 64, 'deskReaction': 'f' * 64}
        with patch.dict(os.environ, {'MEMBER_ERASURE_ENABLED': 'true'}):
            retention.erase_member(self.db, {'memberId': 'user_fixture', 'keys': keys}, now=self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM price_alert_state').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_devices').fetchone()[0], 0)


class Splits(Base):
    def test_a_listed_split_divides_the_alerts_level(self):
        self.alerts([{'ticker': 'NVDA', 'price': 150, 'direction': 'above', 'currency': 'USD'}])
        self.prices['NVDA'] = 140; self.run_at(et(17, 10))
        self.splits['NVDA'] = [{'date': '2026-11-18', 'from_factor': 10, 'to_factor': 1}]
        self.prices['NVDA'] = 14.2; self.previous['NVDA'] = 14
        self.assertEqual(self.run_at(et(18, 10))['sent'], 0, '14.2 after a 10-for-1 split is below 15: no notice')
        self.prices['NVDA'] = 15.1; self.run_at(et(18, 10, 5))
        self.assertEqual(len(self.sent), 1)
        self.assertIn('15.00 USD以上', self.sent[0]['body'])

    def test_the_provider_may_write_the_factors_the_other_way_round(self):
        self.alerts([{'ticker': 'SNDK', 'price': 40, 'direction': 'below', 'currency': 'USD'}])
        self.prices['SNDK'] = 400; self.run_at(et(17, 10))
        self.splits['SNDK'] = [{'date': '2026-11-18', 'from_factor': 1, 'to_factor': 8}]
        self.prices['SNDK'] = 50; self.previous['SNDK'] = 50
        self.run_at(et(18, 10))
        self.assertEqual(self.sent, [], 'an 8-for-1 split: 50 is above the adjusted level of 5, never "below 40"')

    def test_an_unexplained_jump_is_held_before_it_is_believed(self):
        self.alerts([{'ticker': 'MU', 'price': 60, 'direction': 'below', 'currency': 'USD'}])
        self.prices['MU'] = 120; self.run_at(et(17, 10))
        self.prices['MU'] = 50
        self.run_at(et(17, 10, 5)); self.run_at(et(17, 10, 10))
        self.assertEqual(self.sent, [], 'held twice')
        self.run_at(et(17, 10, 15))
        self.assertEqual(len(self.sent), 1, 'then believed: a real fall is still notified')


if __name__ == '__main__':
    unittest.main()
