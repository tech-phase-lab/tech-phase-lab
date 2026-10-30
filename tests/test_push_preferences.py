"""Synthetic subscriptions only. No network delivery and no real endpoint/key output."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
from test_web_push import subscription, event


class PreferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.sqlite'
        self.db = push.connect(self.path)
        self.now = datetime(2026, 9, 26, 14, 0, 2, tzinfo=timezone.utc).timestamp()
        self.payload = {'memberId': 'user_fixture', 'subscription': subscription(),
                        'accessExpiresAt': self.now + 60, 'allTargets': True}
        self.device = hashlib.sha256(subscription()['endpoint'].encode()).hexdigest()
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'fixture',
                                         'WEB_PUSH_PUBLIC_KEY': 'fixture', 'WEB_PUSH_SUBJECT': 'mailto:fixture@example.test'})
        self.env.start()
        push.register_member(self.db, self.payload, {'MU', 'NVDA'}, self.now - 10)

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def save(self, prefs, payload=None):
        return push.member_preferences(self.db, {**(payload or self.payload), 'preferences': prefs}, save=True, now=self.now)['preferences']

    def read(self):
        return push.member_preferences(self.db, self.payload, now=self.now)['preferences']

    def deliver(self, items, entitlement=None):
        sent = []
        push.deliver(self.db, items, lambda _sub, msg: sent.append(msg) or 201,
                     self.now, wall_now=lambda: self.now, entitlement=entitlement or (lambda _: self.now + 60))
        return sent

    def earnings(self):
        return {'kind': 'earnings', 'ticker': 'MU', 'period': 'Q3', 'titleJa': '決算結果',
                'titleEn': 'Results', 'publishedAt': event()['publishedAt'], 'observedAt': event()['observedAt']}

    def test_defaults_and_old_database_migrate_without_changing_existing_delivery(self):
        prefs = self.read()
        self.assertTrue(all(prefs[k] for k in ('targets', 'earnings', 'news', 'weeklyNotebook')))
        self.assertEqual(set(prefs['newsTickers']), set(push.monitored_news_tickers()))
        self.assertTrue(push.notification_allowed(self.db, self.device, 'news', ['OUTSIDE']))
        self.db.execute('DROP TABLE push_device_preferences')
        self.db.commit()
        self.db.close()
        self.db = push.connect(self.path)
        self.assertEqual(len(self.deliver([event(), self.earnings()])), 2)

    def test_each_category_off_blocks_only_that_category_before_transport_and_ledger(self):
        for category, allowed_title in [('targets', '決算速報'), ('earnings', '目標株価')]:
            with self.subTest(category=category):
                self.db.execute('DELETE FROM push_deliveries')
                self.db.commit()
                self.save({'targets': True, 'earnings': True, category: False})
                sent = self.deliver([event(), self.earnings()])
                self.assertEqual(len(sent), 1)
                self.assertIn(allowed_title, sent[0]['title'])
                self.assertEqual(self.db.execute('SELECT count(*) FROM push_deliveries').fetchone()[0], 1)

    def news(self, tickers=('MU',), ident='n1', approved='2026-09-26T14:00:00+00:00'):
        return {'kind': 'news', 'id': ident, 'tickers': list(tickers), 'title': 'Title', 'summaryJa': '要約', 'summaryEn': 'Summary', 'approvedAt': approved}

    def test_news_push_follows_selection_switch_freshness_and_dedupe(self):
        self.save({'newsTickers': ['MU']})
        sent = self.deliver([self.news(['MU', 'NVDA'])])
        self.assertEqual(len(sent), 1)
        self.assertEqual(sent[0]['url'], '/research/news')
        self.assertEqual(self.deliver([self.news(['MU', 'NVDA'])]), [])  # same article is never sent twice
        self.assertEqual(self.deliver([self.news(['NVDA'], 'n2')]), [])  # not a selected company
        self.save({'newsTickers': ['MU', 'NVDA']})
        self.assertEqual(len(self.deliver([self.news(['NVDA'], 'n3')])), 1)
        self.save({'news': False})
        self.assertEqual(self.deliver([self.news(['MU'], 'n4')]), [])  # switch off
        self.save({'news': True, 'targets': False})
        self.assertEqual(len(self.deliver([self.news(['MU'], 'n5')])), 1)  # other switches do not stop news
        self.assertEqual(self.deliver([self.news(['MU'], 'n6', '2026-09-26T13:00:00+00:00')]), [])  # backlog is not pushed
        self.assertEqual(self.deliver([self.news([], 'n7')]), [])

    def test_news_gate_off_selection_multiticker_and_empty_selection(self):
        self.save({'news': False, 'newsTickers': ['MU']})
        self.assertFalse(push.notification_allowed(self.db, self.device, 'news', ['MU']))
        self.save({'news': True})
        self.assertTrue(push.notification_allowed(self.db, self.device, 'news', ['NVDA', 'MU']))
        self.assertFalse(push.notification_allowed(self.db, self.device, 'news', ['NVDA']))
        self.save({'newsTickers': []})
        self.assertFalse(push.notification_allowed(self.db, self.device, 'news', ['MU']))
        self.assertEqual(len(self.deliver([event(), self.earnings()])), 2)

    def test_invalid_settings_and_other_member_or_key_cannot_read_or_write(self):
        before = self.read()
        for bad in [{'targets': 0}, {'news': 'false'}, {'newsTickers': '*'}, {'newsTickers': ['UNKNOWN']},
                    {'weeklyNotebook': None}, {'newsTickers': [12]}, {'extra': True}, {}, None]:
            with self.assertRaises(ValueError): self.save(bad)
            self.assertEqual(self.read(), before)
        other_sub = subscription()
        other_sub['keys']['auth'] = other_sub['keys']['auth'][::-1]
        for change in [{'memberId': 'user_other'}, {'subscription': other_sub}, {'accessExpiresAt': self.now}, {'accessExpiresAt': True}]:
            for save in (False, True):
                with self.assertRaises(ValueError):
                    push.member_preferences(self.db, {**self.payload, **change, 'preferences': {'targets': False}}, save=save, now=self.now)

    def test_partial_update_preserves_weekly_baseline_history_and_other_devices(self):
        second = {**self.payload, 'subscription': {**subscription(), 'endpoint': subscription()['endpoint'] + '2'}}
        push.register_member(self.db, second, {'MU'}, self.now - 10)
        self.deliver([event()])
        since = self.db.execute('SELECT since FROM push_devices WHERE id=?', (self.device,)).fetchone()[0]
        self.save({'weeklyNotebook': False})
        self.save({'targets': False, 'newsTickers': ['MU', 'MU']})
        self.assertFalse(self.read()['weeklyNotebook'])
        self.assertEqual(self.read()['newsTickers'], ['MU'])
        self.assertEqual(self.db.execute('SELECT since FROM push_devices WHERE id=?', (self.device,)).fetchone()[0], since)
        self.assertEqual(self.db.execute('SELECT count(*) FROM push_deliveries').fetchone()[0], 2)
        self.assertTrue(push.member_preferences(self.db, second, now=self.now)['preferences']['targets'])
        self.db.close()
        self.db = push.connect(self.path)
        push.register_member(self.db, self.payload, {'MU'}, self.now)
        self.assertFalse(self.read()['targets'])
        self.assertFalse(self.read()['weeklyNotebook'])

    def test_unreadable_settings_fail_open_but_membership_still_fails_closed(self):
        self.save({'targets': False, 'earnings': False, 'news': False})
        self.db.execute("UPDATE push_device_preferences SET news_tickers='broken'")
        self.db.commit()
        self.assertTrue(push.notification_allowed(self.db, self.device, 'news', ['NVDA']))
        self.assertEqual(self.deliver([event()], entitlement=lambda _: 0), [])
        self.assertEqual(len(self.deliver([event()])), 1)
        self.db.execute('DROP TABLE push_device_preferences')
        self.db.commit()
        self.assertTrue(push.notification_allowed(self.db, self.device, 'earnings'))

    def test_send_time_change_is_observed_after_entitlement_check(self):
        def entitlement(_):
            self.save({'targets': False})
            return self.now + 60
        self.assertEqual(self.deliver([event()], entitlement), [])

    def test_weekly_off_and_send_time_change_use_existing_column(self):
        sunday = datetime(2026, 10, 25, 12, 0, tzinfo=timezone.utc).timestamp()
        payload = {**self.payload, 'accessExpiresAt': sunday + 100}
        push.register_member(self.db, payload, {'MU'}, sunday - 10)
        push.member_preferences(self.db, {**payload, 'preferences': {'weeklyNotebook': False}}, save=True, now=sunday)
        calls = []
        send = lambda *_: calls.append(True) or 201
        push.deliver_weekly(self.db, send, sunday, wall_now=lambda: sunday, entitlement=lambda _: sunday+100)
        self.assertEqual(calls, [])
        push.member_preferences(self.db, {**payload, 'preferences': {'weeklyNotebook': True}}, save=True, now=sunday)
        def entitlement(_):
            push.member_preferences(self.db, {**payload, 'preferences': {'weeklyNotebook': False}}, save=True, now=sunday)
            return sunday+100
        push.deliver_weekly(self.db, send, sunday, wall_now=lambda: sunday, entitlement=entitlement)
        self.assertEqual(calls, [])

    def test_registration_can_atomically_apply_preferences_and_remove_cleans_up(self):
        push.register_member(self.db, {**self.payload, 'preferences': {'targets': False}}, {'MU'}, self.now-5)
        self.assertFalse(self.read()['targets'])
        before = self.db.execute('SELECT since FROM push_devices WHERE id=?', (self.device,)).fetchone()[0]
        with self.assertRaises(ValueError):
            push.register_member(self.db, {**self.payload, 'preferences': {'news': 'off'}}, {'MU'}, self.now)
        self.assertEqual(self.db.execute('SELECT since FROM push_devices WHERE id=?', (self.device,)).fetchone()[0], before)
        push.member_action(self.db, self.payload, 'remove', now=self.now)
        self.assertEqual(self.db.execute('SELECT count(*) FROM push_device_preferences').fetchone()[0], 0)

    def test_http_paths_require_service_auth_and_return_only_preferences(self):
        import service
        from types import SimpleNamespace
        for action in ('preferences', 'save-preferences'):
            handler = object.__new__(service.Handler)
            handler.path = '/push/member/' + action
            handler.headers = {}
            handler.server = SimpleNamespace(app=SimpleNamespace(db_path=self.path))
            handler.authorized = lambda: False
            handler.read_json = lambda: self.fail('unauthorized body was read')
            replies = []
            handler.send_json = lambda status, body: replies.append((status, body))
            handler.do_POST()
            self.assertEqual(replies[0][0], 401)
            handler.authorized = lambda: True
            handler.read_json = lambda: {**self.payload, 'accessExpiresAt': 4102444800, 'preferences': {'targets': False}}
            handler.do_POST()
            self.assertEqual(replies[-1][0], 200)
            self.assertEqual(set(replies[-1][1]), {'ok', 'preferences'})
            rendered = json.dumps(replies[-1][1])
            for secret in ('endpoint', 'p256dh', 'auth', 'user_fixture', self.device): self.assertNotIn(secret, rendered)
