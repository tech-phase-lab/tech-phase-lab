"""Nov 17 (owner): the scheduled demo price-target notice for filming the PRO video (web_push.scheduled_demo_target).
Set PUSH_DEMO_TARGET_AT="<RFC3339 time> <ja|en>" on the monitor; at that time one notice, exactly like a real price-target notice, goes
to the owner accounts' active devices only, once per value, never more than ten minutes late. Nothing appears on the notifications page."""
import base64
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import web_push as push


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def awake(db):
    """Each new device starts outside おやすみモード (the fixtures' hours may fall inside the default quiet hours)."""
    db.execute("CREATE TRIGGER IF NOT EXISTS test_awake AFTER INSERT ON push_devices BEGIN UPDATE push_devices SET quiet_on=0 WHERE id=NEW.id; END")
    return db


OWNER = 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'
PREVIEW_OWNER = 'user_3JulL4D07KtVl5Eg2zdY1iczKbC'
OTHER = 'user_member0001'
AT = '2026-11-17T03:00:00Z'


def subscription(host='web.push.apple.com', path='owner-phone'):
    return {'endpoint': f'https://{host}/push/{path}', 'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}


class ScheduledDemoTargetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'push.sqlite'
        self.db = awake(push.connect(self.path))
        self.now = datetime(2026, 11, 17, 3, 0, 0, tzinfo=timezone.utc).timestamp()
        self.env = patch.dict(os.environ, {'WEB_PUSH_ALLOW_PILOT': 'true', 'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'test',
                                           'WEB_PUSH_PUBLIC_KEY': 'test', 'WEB_PUSH_SUBJECT': 'mailto:test@example.com'})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def register(self, member=OWNER, sub=None, language='ja'):
        push.register_member(self.db, {'memberId': member, 'accessExpiresAt': self.now + 3600, 'subscription': sub or subscription(),
                                       'allTargets': True, 'language': language}, {'NVDA'}, self.now - 10)

    def fire(self, value=AT + ' ja', now=None, transport=None):
        sent = []
        def capture(sub, message):
            sent.append((sub['endpoint'], message))
            return 201
        with redirect_stdout(StringIO()) as out:
            result = push.scheduled_demo_target(self.db, value, transport or capture, self.now if now is None else now)
        return result, sent, out.getvalue()

    def test_owner_ids_match_the_site(self):
        source = (ROOT / 'lib/membership/entitlements.ts').read_text()
        ids = (re.search(r'export const OWNER_ACCOUNT_ID = "([^"]+)"', source).group(1),
               re.search(r'export const PRODUCTION_OWNER_ACCOUNT_ID = "([^"]+)"', source).group(1))
        self.assertEqual(push.DEMO_OWNER_ACCOUNT_IDS, ids)
        self.assertEqual(push.DEMO_TARGET_VARIABLE, 'PUSH_DEMO_TARGET_AT')

    def test_text_is_the_real_price_target_notice_for_the_same_inputs_in_both_languages(self):
        self.assertEqual(push.DEMO_TARGET, {'ticker': 'NVDA', 'firm': 'Sample Securities', 'previous': 295, 'latest': 340})
        # The real path: deliver() on a price-target event with the same facts, for a Japanese and an English device.
        push.register(self.db, {'subscription': subscription('fcm.googleapis.com', 'ja'), 'tickers': ['NVDA'], 'language': 'ja'}, {'NVDA'}, self.now - 10)
        push.register(self.db, {'subscription': subscription('fcm.googleapis.com', 'en'), 'tickers': ['NVDA'], 'language': 'en'}, {'NVDA'}, self.now - 10)
        real = []
        item = {'ticker': 'NVDA', 'firm': 'Sample Securities', 'previous': 295, 'latest': 340,
                'publishedAt': '2026-11-17T02:59:58+00:00', 'observedAt': '2026-11-17T02:59:59+00:00', 'source': 'first'}
        with redirect_stdout(StringIO()):
            push.deliver(self.db, [item], lambda sub, message: real.append((sub['endpoint'], message)) or 201, self.now)
        real = {('ja' if endpoint.endswith('/ja') else 'en'): message for endpoint, message in real}
        self.register()
        _, ja, _ = self.fire(AT + ' ja')
        _, en, _ = self.fire(AT + ' en', now=self.now + 1)
        for language, (_, demo) in (('ja', ja[0]), ('en', en[0])):
            self.assertEqual({k: demo[k] for k in ('title', 'body')}, {k: real[language][k] for k in ('title', 'body')})
            # Nov 17: only the demo opens the page with its sample row; the real notice keeps the plain page.
            self.assertEqual((demo['url'], real[language]['url']), ('/research/price-targets?demo=nvda', '/research/price-targets'))
            self.assertEqual(set(demo), set(real[language]))
            self.assertRegex(demo['tag'], r'^[a-f0-9]{64}$')
        self.assertEqual(ja[0][1]['title'], 'NVDA · 目標株価の変更')
        self.assertEqual(en[0][1]['title'], 'NVDA · Price target update')
        self.assertEqual(ja[0][1]['body'], 'Sample Securities: $295 → $340')
        self.assertEqual(en[0][1]['body'], 'Sample Securities: $295 → $340')
        self.assertEqual(ja[0][1]['url'], push.DEMO_TARGET_URL)
        self.assertNotEqual(ja[0][1]['tag'], en[0][1]['tag'])

    def test_fires_once_at_the_time_and_never_twice_for_the_same_value(self):
        self.register()
        self.assertEqual(self.fire(now=self.now - 1, transport=lambda *_: self.fail('early'))[0], 'waiting')
        result, sent, _ = self.fire(now=self.now)
        self.assertEqual((result, len(sent)), ('sent', 1))
        for later in (1, 30, 300):
            self.assertEqual(self.fire(now=self.now + later, transport=lambda *_: self.fail('twice'))[0], 'done')
        # Across a restart: a new connection to the same database still knows the value was handled.
        self.db.close()
        self.db = push.connect(self.path)
        self.assertEqual(self.fire(now=self.now + 5, transport=lambda *_: self.fail('twice after restart'))[0], 'done')
        # A new value (another time or language) is a new demo.
        result, sent, _ = self.fire(value='2026-11-17T03:05:00Z en', now=self.now + 300)
        self.assertEqual((result, len(sent)), ('sent', 1))

    def test_only_the_owner_accounts_active_devices_read_at_the_moment_of_sending(self):
        self.register(OTHER, subscription('fcm.googleapis.com', 'member'))
        push.register(self.db, {'subscription': subscription('fcm.googleapis.com', 'anon'), 'tickers': ['NVDA'], 'language': 'ja'}, {'NVDA'}, self.now - 10)
        # Turned on just before the time: still picked up.
        self.register(OWNER)
        self.register(PREVIEW_OWNER, subscription('fcm.googleapis.com', 'preview-owner'))
        self.register(OWNER, subscription('fcm.googleapis.com', 'owner-off'))
        self.db.execute('UPDATE push_devices SET active=0 WHERE subscription LIKE ?', ('%owner-off%',))
        result, sent, _ = self.fire(now=self.now + 2)
        self.assertEqual(result, 'sent')
        self.assertEqual(sorted(endpoint for endpoint, _ in sent),
                         ['https://fcm.googleapis.com/push/preview-owner', 'https://web.push.apple.com/push/owner-phone'])

    def test_no_owner_device_is_skipped_and_not_retried(self):
        self.register(OTHER, subscription('fcm.googleapis.com', 'member'))
        result, sent, out = self.fire(now=self.now + 3)
        self.assertEqual((result, sent), ('no-device', []))
        self.assertEqual(json.loads(out), {'event': 'push-demo-target', 'language': 'ja', 'devices': 0, 'quiet': 0, 'accepted': 0, 'outcome': 'no-device'})
        self.register()
        self.assertEqual(self.fire(now=self.now + 60, transport=lambda *_: self.fail('retried'))[0], 'done')

    def test_more_than_ten_minutes_late_or_malformed_is_never_sent(self):
        self.register()
        result, sent, out = self.fire(now=self.now + 601, transport=lambda *_: self.fail('late'))
        self.assertEqual(result, 'late')
        self.assertEqual(json.loads(out)['devices'], 0)
        self.assertEqual(self.fire(value=AT + ' ja', now=self.now + 600)[0], 'done')
        self.assertEqual(self.fire(value='2026-11-17T03:10:00Z ja', now=self.now + 1200)[0], 'sent')
        for value in ('2026-11-17T03:00:00 ja', AT + ' fr', AT, 'soon ja', AT + ' ja extra'):
            self.assertEqual(self.fire(value=value, now=self.now, transport=lambda *_: self.fail('malformed'))[0], 'invalid', value)
        self.assertIsNone(self.fire(value='  ')[0])
        # A zone other than UTC is the same moment.
        self.assertEqual(push.parse_demo_target('2026-11-17T12:00:00+09:00 en'), (self.now, 'en'))

    def test_recorded_as_a_real_price_target_notice_and_the_log_has_no_device_or_text(self):
        self.register()
        _, _, out = self.fire(AT + ' en')
        device = push.hashlib.sha256(subscription()['endpoint'].encode()).hexdigest()
        notice = push.recent_notice(self.db, device, self.now + 1)
        self.assertEqual((notice['kind'], notice['page'], notice['title'], notice['state']),
                         ('price-targets', '/research/price-targets?demo=nvda', 'NVDA · Price target update', 'new'))
        sub = subscription()
        for secret in (sub['endpoint'], 'owner-phone', sub['keys']['p256dh'], sub['keys']['auth'], 'Sample Securities', 'NVDA', OWNER):
            self.assertNotIn(secret, out)
        self.assertEqual(json.loads(out), {'event': 'push-demo-target', 'language': 'en', 'devices': 1, 'quiet': 0, 'accepted': 1, 'outcome': 'sent'})

    def test_quiet_hours_send_the_notice_silently_and_marked_exactly_as_for_a_real_price_target_notice(self):
        # Nov 20 (owner): おやすみモード never holds a notice back; it arrives at once, silently, marked 「おやすみモード」.
        # 03:00Z is 12:00 Japan time.
        self.register()
        self.register(PREVIEW_OWNER, subscription('fcm.googleapis.com', 'preview-owner'))
        self.db.execute('UPDATE push_devices SET quiet_on=1, quiet_start=11, quiet_end=13 WHERE subscription LIKE ?', ('%owner-phone%',))
        self.db.commit()
        result, sent, out = self.fire(now=self.now + 2)
        self.assertEqual(len(sent), 2)
        by_endpoint = dict(sent)
        asleep = None
        rows = self.db.execute('SELECT * FROM push_devices ORDER BY id').fetchall()
        for row in rows:
            message = by_endpoint[json.loads(row['subscription'])['endpoint']]
            if push.in_quiet_hours(row, self.now + 2, self.now):
                asleep = message
            else:
                self.assertEqual(message['title'], 'NVDA · 目標株価の変更')
                self.assertNotIn('silent', message)
        self.assertEqual((asleep['title'], asleep['body'], asleep['silent'], asleep['url']),
                         ('おやすみモード・NVDA · 目標株価の変更', 'Sample Securities: $295 → $340', True, push.DEMO_TARGET_URL))
        self.assertEqual((result, json.loads(out)['quiet'], json.loads(out)['accepted']), ('sent', 1, 2))
        # Every owner device asleep: still sent to all, quietly.
        self.db.execute('UPDATE push_devices SET quiet_on=1, quiet_start=11, quiet_end=13')
        self.db.commit()
        result, sent, out = self.fire(value='2026-11-17T03:01:00Z ja', now=self.now + 61)
        self.assertEqual((result, [m['silent'] for _, m in sent]), ('sent', [True, True]))
        self.assertEqual(json.loads(out), {'event': 'push-demo-target', 'language': 'ja', 'devices': 2, 'quiet': 2, 'accepted': 2,
                                           'outcome': 'sent'})
        self.assertEqual(self.fire(value='2026-11-17T03:01:00Z ja', now=self.now + 62, transport=lambda *_: self.fail('retried'))[0], 'done')

    def test_a_gone_device_is_removed(self):
        self.register()
        result, _, out = self.fire(transport=lambda *_: 410)
        self.assertEqual((result, json.loads(out)['accepted']), ('sent', 0))
        self.assertIsNone(self.db.execute('SELECT 1 FROM push_devices WHERE owner_id=?', (OWNER,)).fetchone())


class MonitorClockTests(unittest.TestCase):
    def test_the_monitor_checks_right_after_boot_and_at_least_every_ten_seconds(self):
        import service
        self.assertLessEqual(service.PUSH_DEMO_CHECK_SECONDS, 10)
        source = (ROOT / 'scripts/research/service.py').read_text()
        self.assertIn('target=self.run_push_demo', source)
        self.assertIn('self.push_demo_thread.start()', source)
        self.assertNotIn('/push/member/demo-target', source)

    def test_the_monitor_loop_sends_once_when_the_time_comes(self):
        import threading
        import service
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'push.sqlite'
            db = push.connect(path)
            push.register_member(db, {'memberId': OWNER, 'accessExpiresAt': 4102444800, 'subscription': subscription(),
                                      'allTargets': True, 'language': 'ja'}, {'NVDA'})
            db.commit(); db.close()
            app = object.__new__(service.AutomaticMonitor)
            app.db_path, app.web_push_enabled, app.stop_event = path, True, threading.Event()
            sent = []
            def transport(_, message):
                sent.append(message)
                if len(sent) >= 1:
                    app.stop_event.set()
                return 201
            value = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + ' en'
            with patch.dict(os.environ, {'PUSH_DEMO_TARGET_AT': value}), patch.object(push, 'send', transport), \
                    patch.object(service, 'PUSH_DEMO_CHECK_SECONDS', 0.05), redirect_stdout(StringIO()):
                thread = threading.Thread(target=app.run_push_demo, daemon=True)
                thread.start(); thread.join(timeout=5)
                app.stop_event.clear()
                # Running again (a restart) with the same value sends nothing.
                thread = threading.Thread(target=app.run_push_demo, daemon=True)
                thread.start(); app.stop_event.wait(0.3); app.stop_event.set(); thread.join(timeout=5)
            self.assertEqual([m['title'] for m in sent], ['NVDA · Price target update'])

    def test_a_failure_is_logged_once_and_never_stops_the_clock(self):
        import threading
        import service
        app = object.__new__(service.AutomaticMonitor)
        app.db_path, app.web_push_enabled, app.stop_event = Path('/nonexistent'), True, threading.Event()
        calls = []
        def broken(*_):
            calls.append(1)
            if len(calls) >= 3:
                app.stop_event.set()
            raise sqlite3.OperationalError('locked')
        value = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ') + ' ja'
        with patch.dict(os.environ, {'PUSH_DEMO_TARGET_AT': value}), patch.object(push, 'connect', broken), \
                patch.object(service, 'PUSH_DEMO_CHECK_SECONDS', 0.01), redirect_stdout(StringIO()) as out:
            thread = threading.Thread(target=app.run_push_demo, daemon=True)
            thread.start(); thread.join(timeout=5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(calls), 3)
        self.assertEqual([json.loads(line) for line in out.getvalue().splitlines()],
                         [{'event': 'push-demo-target-error', 'error': 'OperationalError'}])

    def test_the_notifications_page_has_no_demo(self):
        self.assertFalse((ROOT / 'app/research/push-demo-panel.tsx').exists())
        self.assertFalse((ROOT / 'lib/research/push-demo-notice.ts').exists())
        for name in ('app/research/notification-settings.tsx', 'app/research/notification-page-view.tsx',
                     'app/api/research/notifications/route.ts'):
            source = (ROOT / name).read_text()
            self.assertNotRegex(source, r'(?i)demo', name)


if __name__ == '__main__':
    unittest.main()
