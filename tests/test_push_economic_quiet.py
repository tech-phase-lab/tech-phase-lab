"""Nov 4 notification rebuild: おやすみモード, economic-indicator notices, new-issue and answered-question notices. Synthetic data only."""
import hashlib
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
from test_web_push import subscription

JST = timezone(timedelta(hours=9))
OWNER_KEY = 'a' * 64


def at(hour, minute=0, day=5):
    return datetime(2026, 11, day, hour, minute, tzinfo=JST).timestamp()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'p.sqlite')
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'f', 'WEB_PUSH_PUBLIC_KEY': 'f', 'WEB_PUSH_SUBJECT': 'mailto:f@example.test'})
        self.env.start()
        self.now = at(12)
        self.payload = {'memberId': 'user_fixture', 'subscription': subscription(), 'accessExpiresAt': self.now + 3600, 'allTargets': True, 'questionOwner': OWNER_KEY}
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)
        self.device = hashlib.sha256(subscription()['endpoint'].encode()).hexdigest()
        self.sent = []

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def save(self, prefs):
        return push.member_preferences(self.db, {**self.payload, 'preferences': prefs}, save=True, now=self.now)['preferences']

    def options(self, now):
        return {'transport': lambda _s, m: self.sent.append(m) or 201, 'now': now, 'wall_now': lambda: now, 'entitlement': lambda _o: now + 3600}


class Defaults(Base):
    def test_new_settings_start_as_the_owner_decided(self):
        prefs = push.member_preferences(self.db, self.payload, now=self.now)['preferences']
        self.assertTrue(prefs['economic'])
        self.assertEqual(prefs['economicKinds'], ['jobs', 'cpi', 'ppi', 'pce', 'fomc', 'adp', 'ism'])
        self.assertFalse(prefs['weeklyIssue']); self.assertFalse(prefs['rizelAnswer'])
        self.assertEqual(prefs['quiet'], {'on': True, 'start': 23, 'end': 7})

    def test_each_choice_is_saved_and_bad_values_are_refused(self):
        saved = self.save({'economicKinds': ['gdp', 'jobs'], 'weeklyIssue': True, 'rizelAnswer': True, 'quiet': {'on': True, 'start': 22, 'end': 6}})
        self.assertEqual(saved['economicKinds'], ['jobs', 'gdp'])
        again = push.member_preferences(self.db, self.payload, now=self.now)['preferences']
        self.assertEqual((again['weeklyIssue'], again['rizelAnswer'], again['quiet']['start']), (True, True, 22))
        for bad in ({'economicKinds': ['nope']}, {'quiet': {'on': True, 'start': 23, 'end': 23}}, {'quiet': {'on': True, 'start': 24, 'end': 7}},
                    {'quiet': {'on': 1, 'start': 23, 'end': 7}}, {'quiet': {'on': True, 'start': 23}}, {'economic': 'yes'}):
            with self.assertRaises(ValueError, msg=bad):
                self.save(bad)


class Quiet(Base):
    def blocks(self, hour, start=23, end=7, on=True):
        self.save({'quiet': {'on': on, 'start': start, 'end': end}})
        device = self.db.execute('SELECT * FROM push_devices').fetchone()
        return push.quiet_blocks(device, at(hour))

    def test_midnight_spanning_window(self):
        self.assertTrue(all(self.blocks(h) for h in (23, 0, 3, 6)))
        self.assertFalse(any(self.blocks(h) for h in (7, 12, 22)))

    def test_same_day_window_and_switch_off(self):
        self.assertTrue(self.blocks(13, 12, 14)); self.assertFalse(self.blocks(14, 12, 14)); self.assertFalse(self.blocks(11, 12, 14))
        self.assertFalse(self.blocks(2, on=False))

    def test_a_notice_made_in_the_night_is_not_sent_when_the_night_ends(self):
        made = at(6, 30)
        items = [{'id': 'i1', 'number': 12, 'publishedAt': datetime.fromtimestamp(made, timezone.utc).isoformat()}]
        self.save({'weeklyIssue': True})
        push.deliver_weekly_issues(self.db, items, **self.options(at(7, 5)))
        self.assertEqual(self.sent, [])
        push.deliver_weekly_issues(self.db, items, **self.options(at(7, 20)))
        self.assertEqual(self.sent, [])

    def test_the_same_notice_in_the_daytime_is_sent_once(self):
        made = at(10)
        items = [{'id': 'i2', 'number': 13, 'publishedAt': datetime.fromtimestamp(made, timezone.utc).isoformat()}]
        self.save({'weeklyIssue': True})
        for _ in range(2):
            push.deliver_weekly_issues(self.db, items, **self.options(at(10, 5)))
        self.assertEqual(len(self.sent), 1)
        self.assertIn('第13号', self.sent[0]['body'])


class Economic(Base):
    def item(self, kind='jobs', ident='jobs-1', released=None):
        released = released or at(22, 30, 6)
        return {'kind': kind, 'id': ident, 'publishedAt': datetime.fromtimestamp(released, timezone.utc).isoformat(), 'ja': '非農業部門雇用者数は+12.3万人、失業率は4.1%', 'en': 'Jobs'}

    def test_only_switched_on_indicators_arrive_and_only_after_the_release(self):
        self.save({'economicKinds': ['jobs']})
        released = at(21, 30, 6)
        push.deliver_economic(self.db, [self.item('jobs', released=released), self.item('cpi', 'cpi-1', released)], **self.options(at(21, 35, 6)))
        self.assertEqual([m['title'] for m in self.sent], ['米国雇用統計'])
        self.assertIn('12.3万人', self.sent[0]['body'])
        self.sent.clear()
        push.deliver_economic(self.db, [self.item('jobs', released=at(21, 30, 6))], **self.options(at(21, 31, 6) - 3 * 3600))
        self.assertEqual(self.sent, [], 'a release that has not happened yet is never announced')

    def test_the_whole_switch_off_and_old_releases(self):
        self.save({'economic': False})
        push.deliver_economic(self.db, [self.item(released=at(21, 30, 6))], **self.options(at(21, 35, 6)))
        self.assertEqual(self.sent, [])
        self.save({'economic': True})
        push.deliver_economic(self.db, [self.item(released=at(8, 30, 6))], **self.options(at(21, 35, 6)))
        self.assertEqual(self.sent, [], 'an old release is not announced')

    def test_release_in_the_night_is_dropped(self):
        push.deliver_economic(self.db, [self.item(released=at(22, 30))], **self.options(at(23, 5)))
        self.assertEqual(self.sent, [])

    def test_items_are_read_from_official_updates_and_the_adp_result(self):
        updates = [
            {'publisher': 'BLS', 'url': 'https://www.bls.gov/news.release/archives/empsit_11062026.htm', 'publishedAt': '2026-11-06T13:30:00+00:00', 'translationJa': '雇用者数は+10万人', 'title': 'T'},
            {'publisher': 'BEA', 'url': 'https://www.bea.gov/news/2026/personal-income-and-outlays-september-2026', 'publishedAt': '2026-10-30T12:30:00+00:00', 'translationJa': 'PCEは前月比+0.3%', 'title': 'T'},
            {'publisher': 'BLS', 'url': 'https://evil.example/news.release/archives/empsit_11062026.htm', 'publishedAt': '2026-11-06T13:30:00+00:00', 'translationJa': 'x', 'title': 'T'},
            {'publisher': 'BLS', 'url': 'https://www.bls.gov/news.release/archives/ppi_11062026.htm', 'publishedAt': '2026-11-06T13:30:00+00:00', 'translationJa': 'x', 'title': 'T'},
        ]
        events = [{'id': 'adp-2026-10', 'releasedAt': '2026-11-04T13:15:00+00:00', 'resultJa': '民間の雇用者数 +86,000人', 'resultEn': 'Private employment +86,000'}, {'id': 'us-midterm-2026-11-03', 'releasedAt': '2026-11-04T05:00:00+00:00', 'resultJa': 'x'}]
        self.assertEqual(sorted(i['kind'] for i in push.economic_items(updates, events)), ['adp', 'jobs', 'pce', 'ppi'])

    def test_ppi_result_with_its_numbers_goes_to_members_who_have_it_on(self):
        released = at(21, 30, 13)
        ja = '米国10月PPI：総合 前月比+0.3%・前年比+2.7%／コア 前月比+0.1%・前年比+2.6%'
        updates = [{'publisher': 'BLS', 'url': 'https://www.bls.gov/news.release/archives/ppi_11132026.htm', 'publishedAt': datetime.fromtimestamp(released, timezone.utc).isoformat(), 'translationJa': ja, 'title': 'U.S. October PPI'}]
        items = push.economic_items(updates, [])
        self.assertEqual([i['kind'] for i in items], ['ppi'])
        push.deliver_economic(self.db, items, **self.options(released + 120))
        self.assertEqual([(m['title'], m['body'], m['url']) for m in self.sent], [('米国PPI', ja, '/research/calendar')])
        self.sent.clear()
        self.save({'economicKinds': ['jobs']})
        push.deliver_economic(self.db, [{**items[0], 'id': 'ppi-other'}], **self.options(released + 120))
        self.assertEqual(self.sent, [], 'switched off for PPI')

    def test_a_device_still_on_the_old_default_list_gets_ppi(self):
        self.db.execute('UPDATE push_devices SET econ_kinds=?', ('["jobs", "cpi", "pce", "fomc", "adp", "ism"]',))
        self.assertIn('ppi', push.economic_kinds(self.db.execute('SELECT * FROM push_devices').fetchone()))
        self.db.execute('UPDATE push_devices SET econ_kinds=?', ('["jobs", "cpi"]',))
        self.assertNotIn('ppi', push.economic_kinds(self.db.execute('SELECT * FROM push_devices').fetchone()))

    def test_fomc_ism_gdp_and_retail_results_are_announced_and_claims_never(self):
        base = {'releasedAt': '2026-12-09T19:00:00+00:00', 'resultJa': '政策金利を据え置き（3.50〜3.75%）', 'resultEn': 'Held'}
        events = [{**base, 'id': 'fomc-2026-12-09'}, {**base, 'id': 'ism-2026-12'}, {**base, 'id': 'gdp-2026-q3-second'}, {**base, 'id': 'retail-2026-10'}, {**base, 'id': 'claims-2026-11-05'},
                  {**base, 'id': 'us-midterm-2026-11-03'}]
        self.assertEqual(sorted(i['kind'] for i in push.economic_items([], events)), ['fomc', 'gdp', 'ism', 'retail'])
        self.save({'economicKinds': ['fomc']})
        released = at(4, 0, 10)
        items = [{'kind': 'fomc', 'id': 'fomc-2026-12-09', 'publishedAt': datetime.fromtimestamp(released, timezone.utc).isoformat(), 'ja': '政策金利を据え置き（3.50〜3.75%）', 'en': 'Held'}]
        push.deliver_economic(self.db, items, **self.options(released + 120 - 4 * 3600 + 4 * 3600))
        self.assertEqual(self.sent, [], 'asleep at 04:00 Japan time: dropped, never held')
        released = at(10, 0, 10)
        items[0]['publishedAt'] = datetime.fromtimestamp(released, timezone.utc).isoformat()
        push.deliver_economic(self.db, items, **self.options(released + 120))
        self.assertEqual([m['title'] for m in self.sent], ['FOMC政策金利'])


class Answers(Base):
    def test_only_the_asker_is_told_and_only_if_switched_on(self):
        made = datetime.fromtimestamp(at(10), timezone.utc).isoformat()
        mine = {'id': 'q-1', 'ownerKey': OWNER_KEY, 'answeredAt': made}
        other = {'id': 'q-2', 'ownerKey': 'b' * 64, 'answeredAt': made}
        push.deliver_answers(self.db, [mine, other], **self.options(at(10, 2)))
        self.assertEqual(self.sent, [], 'off until turned on')
        self.save({'rizelAnswer': True})
        push.deliver_answers(self.db, [mine, other], **self.options(at(10, 3)))
        self.assertEqual(len(self.sent), 1)
        self.assertNotIn('質問の内容', str(self.sent))

    def test_question_owner_key_is_stored_only_when_well_formed(self):
        push.member_preferences(self.db, {**self.payload, 'questionOwner': 'short'}, now=self.now)
        self.assertEqual(self.db.execute('SELECT question_owner FROM push_devices').fetchone()[0], OWNER_KEY)


if __name__ == '__main__':
    unittest.main()
