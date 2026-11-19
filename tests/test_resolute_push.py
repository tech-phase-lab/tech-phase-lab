"""RESOLUTE ③/④ by phone notification (owner, Nov 17): the "resolute" kind in web_push.py, its own eligibility (independent of
Tech Phase PRO), the owner accounts, the monitor's endpoint and the notice pages."""
import base64
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import web_push as push  # noqa: E402

OWNER = 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'
EVENT = 'a' * 32


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def subscription(name='one'):
    return {'endpoint': f'https://web.push.apple.com/{name}', 'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}


class ResolutePushTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'push.sqlite')
        self.now = datetime(2026, 11, 17, 23, 0, tzinfo=timezone.utc).timestamp()
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'k', 'WEB_PUSH_PUBLIC_KEY': 'k',
                                           'WEB_PUSH_SUBJECT': 'mailto:test@example.com'})
        self.env.start()
        self.sent = []

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def transport(self, code=201):
        def send(sub, payload):
            self.sent.append(payload)
            return code
        return send

    def register(self, member='user_free', *, pro=False, resolute=True, name='one', **extra):
        payload = {'memberId': member, 'subscription': subscription(name), 'allTargets': True, 'language': 'ja', **extra}
        if pro:
            payload['accessExpiresAt'] = self.now + 3600
        if resolute is not None:
            payload['resoluteUntil'] = self.now + 86400 if resolute else 0
        return push.register_member(self.db, payload, {'MU'}, self.now - 10)

    def notice(self, member='user_free', **extra):
        return {'memberId': member, 'event': EVENT, 'title': 'RESOLUTE', 'body': 'NVDAが計画の下落ライン -10% に届きました',
                'url': '/resolute/alerts/latest', **extra}

    def send(self, member='user_free', code=201, **extra):
        with redirect_stdout(StringIO()):
            return push.resolute_push(self.db, self.notice(member, **extra), self.transport(code), self.now)

    def test_a_free_member_with_resolute_can_turn_this_device_on_and_gets_the_resolute_notice(self):
        self.assertEqual(self.register(), {'registered': True})
        self.assertEqual(self.send(), {'devices': 1, 'accepted': 1, 'failed': 0})
        self.assertEqual(self.sent[0]['title'], 'RESOLUTE')
        self.assertEqual(self.sent[0]['url'], '/resolute/alerts/latest')
        # Once per device: the same notice asked again is not sent twice and still counts as accepted.
        self.assertEqual(self.send(), {'devices': 1, 'accepted': 1, 'failed': 0})
        self.assertEqual(len(self.sent), 1)

    def test_a_free_member_with_resolute_gets_no_pro_notices(self):
        self.register()
        out = push.deliver(self.db, [{'ticker': 'MU', 'firm': 'BofA', 'previous': 100, 'latest': 120,
                                      'publishedAt': datetime.fromtimestamp(self.now - 5, timezone.utc).isoformat(),
                                      'observedAt': datetime.fromtimestamp(self.now - 1, timezone.utc).isoformat(), 'source': 'x'}],
                           self.transport(), self.now, wall_now=lambda: self.now, entitlement=lambda owner: 0)
        self.assertEqual(out['attempted'], 0)
        self.assertEqual(self.sent, [])

    def test_a_free_member_without_resolute_cannot_turn_notifications_on(self):
        with self.assertRaisesRegex(ValueError, 'expired-membership'):
            self.register(resolute=False)
        with self.assertRaisesRegex(ValueError, 'expired-membership'):
            self.register(resolute=None)

    def test_a_pro_member_without_resolute_gets_none_of_the_resolute_notices(self):
        self.register('user_pro', pro=True, resolute=False)
        self.assertEqual(self.send('user_pro'), {'devices': 0, 'accepted': 0, 'failed': 0})
        self.assertEqual(self.sent, [])

    def test_the_owner_gets_both_in_every_environment(self):
        # The owner account, PRO and RESOLUTE, even when the website could not confirm RESOLUTE rights (a preview, no purchase).
        self.register(OWNER, pro=True, resolute=False)
        self.assertEqual(self.send(OWNER)['accepted'], 1)
        out = push.deliver(self.db, [{'ticker': 'MU', 'firm': 'BofA', 'previous': 100, 'latest': 120,
                                      'publishedAt': datetime.fromtimestamp(self.now - 5, timezone.utc).isoformat(),
                                      'observedAt': datetime.fromtimestamp(self.now - 1, timezone.utc).isoformat(), 'source': 'x'}],
                           self.transport(), self.now, wall_now=lambda: self.now, entitlement=lambda owner: self.now + 3600)
        self.assertEqual(out['accepted'], 1)

    def test_lapsed_rights_or_the_switch_off_stop_the_notice(self):
        self.register()
        with self.db:
            self.db.execute('UPDATE push_devices SET resolute_until=?', (self.now - 1,))
        self.assertEqual(self.send()['devices'], 0)
        self.register()
        with redirect_stdout(StringIO()):
            push.member_preferences(self.db, {'memberId': 'user_free', 'subscription': subscription(), 'resoluteUntil': self.now + 60,
                                              'preferences': {'resolute': False}}, save=True, now=self.now)
        self.assertEqual(self.send()['devices'], 0)
        self.assertEqual(self.sent, [])

    def test_the_resolute_row_starts_on_and_a_resolute_only_member_may_change_only_it(self):
        self.register()
        view = push.member_preferences(self.db, {'memberId': 'user_free', 'subscription': subscription(), 'resoluteUntil': self.now + 60},
                                       now=self.now)
        self.assertTrue(view['preferences']['resolute'])
        with self.assertRaisesRegex(ValueError, 'invalid-preferences'):
            push.member_preferences(self.db, {'memberId': 'user_free', 'subscription': subscription(), 'resoluteUntil': self.now + 60,
                                              'preferences': {'targets': True}}, save=True, now=self.now)

    def test_every_failed_device_is_reported_so_resolute_sends_its_email(self):
        self.register()
        self.register(name='two')
        self.assertEqual(self.send(code=500), {'devices': 2, 'accepted': 0, 'failed': 2})
        self.assertEqual(self.send(member='user_nobody'), {'devices': 0, 'accepted': 0, 'failed': 0})

    def test_a_gone_subscription_is_removed(self):
        self.register()
        self.assertEqual(self.send(code=410)['accepted'], 0)
        self.assertIsNone(self.db.execute('SELECT 1 FROM push_devices').fetchone())

    def test_lookup_counts_devices_that_already_accepted(self):
        self.register()
        self.send()
        out = push.resolute_push(self.db, {'memberId': 'user_free', 'event': EVENT, 'mode': 'lookup'}, self.transport(), self.now)
        self.assertEqual(out['accepted'], 1)
        self.assertEqual(len(self.sent), 1)

    def test_only_resolute_notices_in_the_resolute_form_are_sent(self):
        self.register()
        for bad in ({'title': 'Tech Phase'}, {'url': '/research'}, {'body': ''}, {'body': 'x' * 121}, {'body': 'a\nb'}, {'event': 'zz'}):
            with self.assertRaisesRegex(ValueError, 'invalid-notice'):
                push.resolute_push(self.db, {**self.notice(), **bad}, self.transport(), self.now)
        self.assertEqual(self.sent, [])

    def test_status_and_test_work_for_a_resolute_only_member(self):
        self.register()
        payload = {'memberId': 'user_free', 'subscription': subscription(), 'resoluteUntil': self.now + 60}
        self.assertEqual(push.member_action(self.db, payload, 'status', now=self.now), {'registered': True})
        with redirect_stdout(StringIO()):
            self.assertTrue(push.member_action(self.db, payload, 'test', transport=self.transport(), now=self.now)['accepted'])
        # Rights gone (the website says 0): the device is no longer reported on.
        with patch.object(push, 'member_expiry', return_value=0):
            self.assertEqual(push.member_action(self.db, {**payload, 'resoluteUntil': 0}, 'status', now=self.now), {'registered': False})

    def test_the_accepted_notice_is_written_down_for_the_app_with_its_resolute_page(self):
        self.register()
        self.send()
        row = self.db.execute('SELECT kind,page,title FROM push_notices').fetchone()
        self.assertEqual((row['kind'], row['page'], row['title']), ('resolute-alert', '/resolute/alerts/latest', 'RESOLUTE'))
        self.send(event='b' * 32, url='/resolute/morning', body='昨日のお知らせのあと、どうでしたか？')
        rows = [tuple(r) for r in self.db.execute('SELECT kind,page FROM push_notices ORDER BY rowid')]
        self.assertEqual(rows[-1], ('resolute-morning', '/resolute/morning'))

    def test_the_renewal_notice_opens_the_account_page(self):
        # Nov 19 (owner): RESOLUTE automatic renewal - the 7-days-before notice opens the account page (stop anytime).
        self.register()
        self.assertEqual(self.send(event='c' * 32, url='/research/account', body='2027年12月16日に通知機能が自動で更新されます。'),
                         {'devices': 1, 'accepted': 1, 'failed': 0})
        self.assertEqual(self.sent[-1]['url'], '/research/account')
        row = self.db.execute('SELECT kind,page FROM push_notices ORDER BY rowid DESC').fetchone()
        self.assertEqual((row['kind'], row['page']), ('resolute-renewal', '/research/account'))

    def test_the_dedicated_token_is_required_and_is_never_another_token(self):
        token = 'r' * 40
        with patch.dict(os.environ, {'RESOLUTE_PUSH_TOKEN': token, 'RESEARCH_API_TOKEN': 'p' * 40}):
            self.assertTrue(push.resolute_token_ok('Bearer ' + token))
            self.assertFalse(push.resolute_token_ok('Bearer ' + 'p' * 40))
        with patch.dict(os.environ, {'RESOLUTE_PUSH_TOKEN': 'p' * 40, 'RESEARCH_API_TOKEN': 'p' * 40}):
            self.assertFalse(push.resolute_token_ok('Bearer ' + 'p' * 40))
        with patch.dict(os.environ, {'RESOLUTE_PUSH_TOKEN': 'short'}):
            self.assertFalse(push.resolute_token_ok('Bearer short'))

    def test_both_pages_are_on_the_shared_notification_list(self):
        targets = json.loads((ROOT / 'lib/research/push-targets.json').read_text())
        for page in push.RESOLUTE_PAGES:
            self.assertIn(page, targets['openable'])
            self.assertTrue(push.SEND_PAGE.fullmatch(page))

    def test_the_owner_ids_match_the_website(self):
        source = (ROOT / 'lib/membership/entitlements.ts').read_text()
        for owner in push.DEMO_OWNER_ACCOUNT_IDS:
            self.assertIn(owner, source)


if __name__ == '__main__':
    unittest.main()
