"""Nov 16: every notice the push service accepted is written down per device, so the app can show its own banner (or open the page
after a tap) without relying on the service worker, which iOS does not reliably wake for a tap."""
import base64
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def subscription(path='device-a', host='web.push.apple.com'):
    return {'endpoint': f'https://{host}/{path}', 'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}


class PushNoticeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'push.sqlite')
        self.now = datetime(2026, 11, 16, 6, 31, tzinfo=timezone.utc).timestamp()
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'test', 'WEB_PUSH_PUBLIC_KEY': 'test',
                                           'WEB_PUSH_SUBJECT': 'mailto:test@example.com'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def member(self, owner='user_owner', sub=None):
        return {'memberId': owner, 'accessExpiresAt': self.now + 3600, 'subscription': sub or subscription(), 'allTargets': True}

    def join(self, owner='user_owner', sub=None):
        payload = self.member(owner, sub)
        push.register_member(self.db, payload, {'MU'}, self.now - 60)
        return payload

    def note(self, payload=None, code=201, at=None, sub=None):
        message = payload or {'title': 'テスト通知', 'body': '通知は正しく届いています。', 'tag': 'tech-phase-test', 'url': '/research/notifications'}
        return push.remember_notice(self.db, sub or subscription(), message, code, self.now if at is None else at)

    def test_an_accepted_send_is_kept_per_device_without_endpoint_key_or_body(self):
        notice = self.note()
        self.assertRegex(notice, r'^[a-f0-9]{32}$')
        row = dict(self.db.execute('SELECT * FROM push_notices').fetchone())
        self.assertEqual(set(row), {'id', 'device_id', 'kind', 'page', 'title', 'sent_at', 'opened_at', 'dismissed_at'})
        self.assertEqual((row['kind'], row['page'], row['title'], row['sent_at'], row['opened_at']),
                         ('test', '/research/notifications', 'テスト通知', self.now, None))
        stored = json.dumps(row, ensure_ascii=False)
        for secret in ('web.push.apple.com', 'device-a', b64(b'a' * 16), '正しく届いています'):
            self.assertNotIn(secret, stored)
        # Refused, failed or malformed sends are not kept; an unknown page falls back to /research.
        for code in (0, 400, 404, 410, 500, None, True):
            self.assertIsNone(self.note(code=code))
        self.assertIsNone(self.note({'title': '', 'url': '/research/news'}))
        other = self.note({'title': 'MU · ニュース\n', 'body': 'x', 'tag': 'k', 'url': 'https://evil.example/'})
        row = self.db.execute('SELECT kind,page,title FROM push_notices WHERE id=?', (other,)).fetchone()
        self.assertEqual(tuple(row), ('research', '/research', 'MU · ニュース'))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_notices').fetchone()[0], 2)

    def test_kind_follows_the_page_and_title_is_cut_like_the_worker(self):
        notice = self.note({'title': 'あ' * 150, 'body': 'x', 'tag': 'k', 'url': '/research/qa#q-0123456789abcdef0123456789abcdef'})
        row = self.db.execute('SELECT kind,title FROM push_notices WHERE id=?', (notice,)).fetchone()
        self.assertEqual(row['kind'], 'qa')
        self.assertEqual(len(row['title']), 100)

    def test_notices_are_kept_seven_days(self):
        self.note(at=self.now - 7 * 86400 - 1)
        self.note(at=self.now - 7 * 86400 + 60)
        self.note()
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_notices').fetchone()[0], 2)

    def test_a_write_failure_never_fails_the_send(self):
        self.db.execute('DROP TABLE push_notices')
        self.db.execute('CREATE TABLE push_notices (id TEXT)')
        self.assertIsNone(self.note())

    def test_recent_notice_is_the_newest_unopened_one_within_30_minutes_for_the_members_own_device(self):
        payload = self.join()
        self.assertEqual(push.member_action(self.db, payload, 'recent-notice', now=self.now), {'notice': None, 'registered': True})
        self.note(at=self.now - 31 * 60)
        self.assertIsNone(push.member_action(self.db, payload, 'recent-notice', now=self.now)['notice'])
        first = self.note(at=self.now - 120)
        second = self.note({'title': 'MU · ニュース', 'body': 'x', 'tag': 'k', 'url': '/research/news'}, at=self.now - 60)
        notice = push.member_action(self.db, payload, 'recent-notice', now=self.now)['notice']
        self.assertEqual({k: notice[k] for k in ('id', 'kind', 'page', 'title', 'ageMs', 'state')},
                         {'id': second, 'kind': 'news', 'page': '/research/news', 'title': 'MU · ニュース', 'ageMs': 60000, 'state': 'new'})
        self.assertNotIn('endpoint', json.dumps(notice))
        # Another device of the same member, or the same device asked by another member, sees nothing.
        other_device = self.join(sub=subscription('device-b'))
        self.assertIsNone(push.member_action(self.db, other_device, 'recent-notice', now=self.now)['notice'])
        stranger = self.member('user_stranger')
        self.assertEqual(push.member_action(self.db, stranger, 'recent-notice', now=self.now), {'notice': None, 'registered': False})
        with self.assertRaisesRegex(ValueError, 'not-owned'):
            push.member_action(self.db, {**stranger, 'noticeId': second}, 'notice-opened', now=self.now)
        # Opened: no longer offered, and the older one is not offered in its place (only the newest notice counts).
        self.assertEqual(push.member_action(self.db, {**payload, 'noticeId': second}, 'notice-opened', now=self.now), {'marked': True})
        self.assertIsNone(push.member_action(self.db, payload, 'recent-notice', now=self.now)['notice'])
        self.assertEqual(push.member_action(self.db, {**payload, 'noticeId': second}, 'notice-dismissed', now=self.now), {'marked': False})
        self.assertEqual(push.member_action(self.db, {**payload, 'noticeId': first}, 'notice-dismissed', now=self.now), {'marked': True})
        status = push.member_action(self.db, payload, 'notice-status', now=self.now + 5)['notice']
        self.assertEqual((status['id'], status['state'], status['openedAt'], status['dismissedAt']), (second, 'opened', self.now, None))

    def test_dismissed_notices_are_not_offered_and_bad_ids_are_refused(self):
        payload = self.join()
        notice = self.note()
        with self.assertRaisesRegex(ValueError, 'invalid-notice'):
            push.member_action(self.db, {**payload, 'noticeId': 'x'}, 'notice-dismissed', now=self.now)
        self.assertEqual(push.refusal_reason(ValueError('invalid-notice')), 'invalid-notice')
        push.member_action(self.db, {**payload, 'noticeId': notice}, 'notice-dismissed', now=self.now + 3)
        self.assertIsNone(push.member_action(self.db, payload, 'recent-notice', now=self.now + 5)['notice'])
        status = push.member_action(self.db, payload, 'notice-status', now=self.now + 5)['notice']
        self.assertEqual((status['state'], status['dismissedAt']), ('dismissed', self.now + 3))

    def test_notice_reads_need_no_current_pro_but_do_need_the_member(self):
        payload = self.join()
        self.note()
        with patch.object(push, 'member_expiry', side_effect=AssertionError('no membership lookup')):
            self.assertIsNotNone(push.member_action(self.db, {**payload, 'accessExpiresAt': 0}, 'recent-notice', now=self.now)['notice'])
        with self.assertRaisesRegex(ValueError, 'invalid-member'):
            push.member_action(self.db, {**payload, 'memberId': 'nobody'}, 'recent-notice', now=self.now)

    def test_removing_the_device_removes_its_notices(self):
        payload = self.join()
        self.note()
        push.member_action(self.db, payload, 'remove', now=self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_notices').fetchone()[0], 0)

    def test_every_sender_writes_its_accepted_notices_down(self):
        payload = self.join()
        with patch.object(push, 'member_expiry', return_value=self.now + 3600):
            self.assertTrue(push.member_action(self.db, payload, 'test', lambda *_: 201, self.now)['accepted'])
        notice = push.member_action(self.db, payload, 'recent-notice', now=self.now + 1)['notice']
        self.assertEqual((notice['kind'], notice['page'], notice['title']), ('test', '/research/notifications', 'テスト通知'))
        # A refused test is not written down.
        self.db.execute('DELETE FROM push_notices')
        self.db.execute('DELETE FROM push_test_attempts')
        with patch.object(push, 'member_expiry', return_value=self.now + 3600):
            push.member_action(self.db, payload, 'test', lambda *_: 400, self.now)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_notices').fetchone()[0], 0)
        # The scheduled senders (here announce, used by the weekly-issue, answer and economic notices) too, at the send time.
        self.db.execute('UPDATE push_devices SET quiet_on=0')
        result = push.announce(self.db, 'k-1', push.MEMBERS, (), lambda ja: {'title': '週刊PRO', 'body': 'x', 'url': '/research/weekly'},
                               (self.now,), transport=lambda *_: 201, now=self.now, wall_now=lambda: self.now + 2,
                               entitlement=lambda _: self.now + 3600)
        self.assertEqual(result['accepted'], 1)
        notice = push.member_action(self.db, payload, 'recent-notice', now=self.now + 10)['notice']
        self.assertEqual((notice['kind'], notice['title'], notice['sentAt']), ('weekly', '週刊PRO', self.now + 2))

    def test_noting_passes_failures_through_and_writes_nothing(self):
        def broken(*_):
            raise ConnectionError('x')
        with self.assertRaises(ConnectionError):
            push.noting(self.db, broken, self.now)(subscription(), {'title': 't', 'body': 'b', 'url': '/research'})
        self.assertEqual(push.noting(self.db, lambda *_: 201, self.now)(subscription(), {'title': 't', 'body': 'b', 'url': '/research'}), 201)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM push_notices').fetchone()[0], 1)


    def test_the_monitor_serves_the_notice_actions_and_notes_owner_alerts(self):
        source = (Path(__file__).resolve().parents[1] / 'scripts/research/service.py').read_text()
        for action in push.NOTICE_ACTIONS:
            self.assertIn(f'"/push/member/{action}"', source)
        self.assertIn('incident_delivery.send_owner_push(claim, devices, self.noted(web_push.send))', source)
        self.assertIn('transport = web_push.noting(db, transport, now.timestamp())', source)


if __name__ == '__main__':
    unittest.main()
