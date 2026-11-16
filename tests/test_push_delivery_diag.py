"""Nov 16: preferences answered 503 then 200 (database locked), and a test notice after a reinstall never arrived with nothing to say why.
Synthetic subscriptions only. No network delivery and no real endpoint/key output."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push
from test_web_push import subscription, awake


def wal(path):
    # Production opens the shared database in WAL mode (monitor.connect); the 503 only happens there.
    db = sqlite3.connect(path)
    db.execute('PRAGMA journal_mode=WAL')
    db.close()


class LockedPreferencesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.sqlite'
        wal(self.path)
        self.db = awake(push.connect(self.path))
        self.db.execute('CREATE TABLE other_worker (x)')
        self.db.commit()
        self.now = datetime(2026, 11, 16, 3, 18, 13, tzinfo=timezone.utc).timestamp()
        self.payload = {'memberId': 'user_fixture', 'subscription': subscription('web.push.apple.com'),
                        'accessExpiresAt': self.now + 3600, 'allTargets': True, 'questionOwner': 'a' * 64}
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'fixture',
                                           'WEB_PUSH_PUBLIC_KEY': 'fixture', 'WEB_PUSH_SUBJECT': 'mailto:fixture@example.test'})
        self.env.start()
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def test_the_old_deferred_read_then_write_fails_at_once_when_another_connection_commits_in_between(self):
        # The mechanism behind the 503: no busy timeout helps a stale WAL snapshot that tries to write.
        other = sqlite3.connect(self.path, timeout=10)
        with self.assertRaises(sqlite3.OperationalError) as caught:
            with self.db:
                self.db.execute('BEGIN')
                self.db.execute('SELECT * FROM push_devices').fetchall()
                with other:
                    other.execute('INSERT INTO other_worker VALUES (1)')
                self.db.execute("UPDATE push_devices SET question_owner='x'")
        other.close()
        self.assertTrue(push.is_busy(caught.exception))

    def test_reading_preferences_holds_the_write_lock_from_the_start_so_a_concurrent_commit_cannot_break_it(self):
        other = sqlite3.connect(self.path, timeout=0)
        blocked = []
        original = push.remember_question_owner

        def between(db, device_id, payload):
            # Another worker tries to commit between the read and the question-board write.
            try:
                with other:
                    other.execute('INSERT INTO other_worker VALUES (1)')
                blocked.append(False)
            except sqlite3.OperationalError:
                blocked.append(True)
            return original(db, device_id, payload)

        with patch.object(push, 'remember_question_owner', between):
            prefs = push.member_preferences(self.db, self.payload, now=self.now)['preferences']
        other.close()
        self.assertEqual(blocked, [True], 'the read took the write lock first, so the other writer waited instead of breaking it')
        self.assertTrue(prefs['targets'])
        # And once it is done the other writer gets through.
        with sqlite3.connect(self.path, timeout=0) as later:
            later.execute('INSERT INTO other_worker VALUES (2)')

    def test_two_overlapping_reads_from_separate_connections_both_succeed(self):
        import threading
        results, errors = [], []
        start = threading.Barrier(2)

        def read():
            db = push.connect(self.path)
            try:
                start.wait()
                for _ in range(20):
                    results.append(push.member_preferences(db, self.payload, now=self.now)['preferences']['targets'])
            except Exception as exc:  # pragma: no cover - the failure being guarded against
                errors.append(type(exc).__name__ + ': ' + str(exc))
            finally:
                db.close()

        threads = [threading.Thread(target=read) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(errors, [])
        self.assertEqual(results, [True] * 40)


class HandlerRetryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.sqlite'
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'fixture',
                                           'WEB_PUSH_PUBLIC_KEY': 'fixture', 'WEB_PUSH_SUBJECT': 'mailto:fixture@example.test'})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def call(self, path, action):
        import service
        from types import SimpleNamespace
        handler = object.__new__(service.Handler)
        handler.path = path
        handler.headers = {}
        handler.server = SimpleNamespace(app=SimpleNamespace(db_path=self.path, tickers=['MU']))
        handler.authorized = lambda: True
        handler.read_json = lambda: {'memberId': 'user_fixture'}
        replies = []
        handler.send_json = lambda status, body: replies.append((status, body))
        out = io.StringIO()
        with patch.object(service.Handler, 'push_action', lambda self, p, payload: action()), \
                patch.object(service.time, 'sleep', lambda seconds: None), contextlib.redirect_stdout(out):
            handler.do_POST()
        return replies[-1], [json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]

    def test_a_locked_database_is_tried_again_instead_of_answering_503(self):
        calls = []

        def action():
            calls.append(1)
            if len(calls) == 1:
                raise sqlite3.OperationalError('database is locked')
            return {'preferences': {'targets': True}}
        reply, lines = self.call('/push/member/preferences', action)
        self.assertEqual(reply, (200, {'ok': True, 'preferences': {'targets': True}}))
        self.assertEqual(len(calls), 2)
        self.assertEqual(lines, [{'event': 'push-action-retry', 'action': 'preferences', 'attempt': 1, 'error': 'database-busy'}])

    def test_a_lock_that_does_not_clear_ends_in_one_logged_503(self):
        calls = []

        def action():
            calls.append(1)
            raise sqlite3.OperationalError('database is locked')
        reply, lines = self.call('/push/member/save-preferences', action)
        self.assertEqual(reply, (503, {'ok': False}))
        self.assertEqual(len(calls), 3)
        self.assertEqual(lines[-1], {'event': 'push-action-failed', 'action': 'save-preferences', 'error': 'OperationalError', 'busy': True})

    def test_a_test_notice_is_never_tried_twice(self):
        calls = []

        def action():
            calls.append(1)
            raise sqlite3.OperationalError('database is locked')
        reply, lines = self.call('/push/member/test', action)
        self.assertEqual(reply[0], 503)
        self.assertEqual(len(calls), 1)

    def test_other_failures_are_not_retried_and_a_refusal_stays_400(self):
        calls = []

        def broken():
            calls.append(1)
            raise RuntimeError('boom user_fixture')
        reply, lines = self.call('/push/member/preferences', broken)
        self.assertEqual((reply[0], len(calls)), (503, 1))
        self.assertEqual(lines, [{'event': 'push-action-failed', 'action': 'preferences', 'error': 'RuntimeError', 'busy': False}])

        def refused():
            raise ValueError('not-owned')
        reply, _ = self.call('/push/member/preferences', refused)
        self.assertEqual(reply, (400, {'ok': False, 'error': 'not-owned'}))


class SendLogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'test.sqlite'
        self.db = awake(push.connect(self.path))
        self.now = datetime(2026, 11, 16, 3, 18, 34, tzinfo=timezone.utc).timestamp()
        self.sub = subscription('web.push.apple.com')
        self.payload = {'memberId': 'user_fixture', 'subscription': self.sub, 'accessExpiresAt': self.now + 3600, 'allTargets': True}
        self.device = hashlib.sha256(self.sub['endpoint'].encode()).hexdigest()
        self.env = patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'fixture',
                                           'WEB_PUSH_PUBLIC_KEY': 'fixture', 'WEB_PUSH_SUBJECT': 'mailto:fixture@example.test'})
        self.env.start()
        push.SEND_LOG.clear()

    def tearDown(self):
        push.SEND_LOG.clear()
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def fake_pywebpush(self, status=201, error=None):
        module = types.ModuleType('pywebpush')

        class WebPushException(Exception):
            def __init__(self, message, response=None):
                super().__init__(message)
                self.response = response

        def webpush(**kwargs):
            if error:
                raise error
            if status >= 400:
                raise WebPushException('Push failed: secret provider text', response=types.SimpleNamespace(status_code=status))
            return types.SimpleNamespace(status_code=status)
        module.webpush = webpush
        module.WebPushException = WebPushException
        return patch.dict(sys.modules, {'pywebpush': module})

    def send(self, payload, **fake):
        out = io.StringIO()
        with self.fake_pywebpush(**fake), contextlib.redirect_stdout(out):
            try:
                code = push.send(self.sub, payload)
            except Exception as exc:
                code = type(exc).__name__
        return code, [json.loads(line) for line in out.getvalue().splitlines() if line.startswith('{')]

    def test_each_send_logs_one_line_with_the_device_hash_host_and_push_service_status_only(self):
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)
        code, lines = self.send({'title': 'テスト通知', 'body': 'secret body', 'tag': 'tech-phase-test', 'url': '/research/notifications'})
        self.assertEqual(code, 201)
        self.assertEqual(len(lines), 1)
        line = lines[0]
        self.assertEqual({k: line[k] for k in ('event', 'device', 'host', 'status', 'kind', 'page', 'failure', 'gone')},
                         {'event': 'push-send', 'device': self.device[:12], 'host': 'web.push.apple.com', 'status': 201,
                          'kind': 'test', 'page': '/research/notifications', 'failure': None, 'gone': False})
        rendered = json.dumps(lines) + json.dumps(push.send_log(self.db))
        for secret in (self.sub['endpoint'], self.sub['keys']['p256dh'], self.sub['keys']['auth'], 'secret body', 'テスト通知',
                       'secret provider text', 'user_fixture', self.device):
            self.assertNotIn(secret, rendered)

    def test_the_owner_panel_sees_the_last_ten_newest_first_and_whether_each_device_is_still_registered(self):
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)
        for _ in range(11):
            self.send({'title': 't', 'body': 'b', 'tag': 'k', 'url': '/research/news'})
        code, lines = self.send({'title': 't', 'body': 'b', 'tag': 'tech-phase-test', 'url': '/research/notifications'}, status=410)
        self.assertEqual(code, 410)
        self.assertTrue(lines[0]['gone'])
        items = push.send_log(self.db)
        self.assertEqual(len(items), 10)
        self.assertEqual((items[0]['status'], items[0]['kind'], items[0]['registered']), (410, 'test', True))
        # The sender removes a device the push service says is gone; the panel then shows it as no longer registered.
        push.remove(self.db, self.payload)
        self.assertEqual({item['registered'] for item in push.send_log(self.db)}, {False})
        self.assertEqual(set(items[0]), {'at', 'device', 'host', 'status', 'kind', 'page', 'ms', 'failure', 'gone', 'registered'})

    def test_a_network_failure_is_recorded_with_its_class_and_still_raised_for_the_caller(self):
        class ConnectTimeout(Exception):
            pass
        code, lines = self.send({'title': 't', 'body': 'b', 'tag': 'k'}, error=ConnectTimeout('host secret'))
        self.assertEqual(code, 'ConnectTimeout')
        self.assertEqual((lines[0]['status'], lines[0]['failure'], lines[0]['page']), (0, 'ConnectTimeout', None))
        self.assertNotIn('host secret', json.dumps(lines))

    def test_the_test_notice_after_a_reinstall_goes_to_the_new_device(self):
        # 「通知の仕組みを入れ直す」: register(new) then remove(old); the test is sent to the subscription the page holds now.
        old = self.payload
        new_sub = {**subscription('web.push.apple.com'), 'endpoint': 'https://web.push.apple.com/push/new-device'}
        new = {**self.payload, 'subscription': new_sub}
        push.register_member(self.db, old, {'MU'}, self.now - 10)
        push.register_member(self.db, new, {'MU'}, self.now - 5)
        push.member_action(self.db, old, 'remove', now=self.now)
        sent = []
        with patch.object(push, 'member_expiry', lambda owner: self.now + 3600):
            result = push.member_action(self.db, new, 'test', transport=lambda sub, payload: sent.append(sub) or 201, now=self.now)
        self.assertTrue(result['accepted'])
        self.assertEqual([sub['endpoint'] for sub in sent], [new_sub['endpoint']])
        with patch.object(push, 'member_expiry', lambda owner: self.now + 3600), self.assertRaises(ValueError):
            push.member_action(self.db, old, 'test', transport=lambda sub, payload: 201, now=self.now)

    def test_the_monitor_serves_the_send_log_only_with_the_service_token(self):
        import service
        from types import SimpleNamespace
        push.register_member(self.db, self.payload, {'MU'}, self.now - 10)
        self.send({'title': 't', 'body': 'b', 'tag': 'tech-phase-test', 'url': '/research/notifications'})
        handler = object.__new__(service.Handler)
        handler.path = '/push/send-log'
        handler.headers = {}
        handler.server = SimpleNamespace(app=SimpleNamespace(db_path=self.path))
        replies = []
        handler.send_json = lambda status, body: replies.append((status, body))
        handler.authorized = lambda: False
        handler.do_GET()
        self.assertEqual(replies[-1], (401, {'ok': False}))
        handler.authorized = lambda: True
        handler.do_GET()
        status, body = replies[-1]
        self.assertEqual(status, 200)
        self.assertEqual([(item['device'], item['status'], item['registered']) for item in body['items']], [(self.device[:12], 201, True)])
        self.assertNotIn(self.sub['endpoint'], json.dumps(body))


if __name__ == '__main__':
    unittest.main()
