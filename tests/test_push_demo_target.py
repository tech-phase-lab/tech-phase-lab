"""Nov 17 (owner): the demo price-target notice for filming the PRO video (web_push.demo_price_target).
It must look exactly like a real price-target notice, reach only the owner's own registered device, and be recorded as a real notice."""
import base64
from contextlib import redirect_stdout
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import web_push as push


def b64(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')


def awake(db):
    """Each new device starts outside おやすみモード (the fixtures' hours may fall inside the default quiet hours)."""
    db.execute("CREATE TRIGGER IF NOT EXISTS test_awake AFTER INSERT ON push_devices BEGIN UPDATE push_devices SET quiet_on=0 WHERE id=NEW.id; END")
    return db

OWNER = 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb'
OTHER = 'user_member0001'


def subscription(host='web.push.apple.com', path='owner-phone'):
    return {'endpoint': f'https://{host}/push/{path}', 'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}


class DemoTargetTests(unittest.TestCase):
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

    def demo(self, language='ja', member=OWNER, sub=None, now=None, transport=None):
        sent = []
        def capture(_, message):
            sent.append(message)
            return 201
        with redirect_stdout(StringIO()) as out:
            result = push.demo_price_target(self.db, {'memberId': member, 'subscription': sub or subscription(), 'language': language},
                                            transport or capture, self.now if now is None else now)
        return result, sent, out.getvalue()

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
        _, ja, _ = self.demo('ja')
        _, en, _ = self.demo('en', now=self.now + 61)
        for language, demo in (('ja', ja[0]), ('en', en[0])):
            self.assertEqual({k: demo[k] for k in ('title', 'body', 'url')}, {k: real[language][k] for k in ('title', 'body', 'url')})
            self.assertEqual(set(demo), set(real[language]))
            self.assertRegex(demo['tag'], r'^[a-f0-9]{64}$')
        self.assertEqual(ja[0]['title'], 'NVDA · 目標株価の変更')
        self.assertEqual(en[0]['title'], 'NVDA · Price target update')
        self.assertEqual(ja[0]['body'], 'Sample Securities: $295 → $340')
        self.assertEqual(en[0]['body'], 'Sample Securities: $295 → $340')
        self.assertEqual(ja[0]['url'], '/research/price-targets')
        # The shared builder is the one deliver() uses.
        self.assertEqual(push.price_target_payload('NVDA', 'Sample Securities', 295, 340, True, 'k'),
                         {'title': 'NVDA · 目標株価の変更', 'body': 'Sample Securities: $295 → $340', 'tag': 'k', 'url': '/research/price-targets'})

    def test_one_notice_to_the_owners_own_device_only(self):
        self.register()
        self.register(OTHER, subscription('fcm.googleapis.com', 'member'))
        result, sent, _ = self.demo('ja')
        self.assertTrue(result['accepted'])
        self.assertEqual(len(sent), 1)
        # Another member's device, an unregistered device, or the owner asking for someone else's device: nothing is sent.
        for member, sub in ((OWNER, subscription('fcm.googleapis.com', 'member')), (OTHER, subscription()),
                            (OWNER, subscription('fcm.googleapis.com', 'unknown'))):
            with self.assertRaisesRegex(ValueError, 'not-registered'):
                self.demo('ja', member=member, sub=sub, now=self.now + 120, transport=lambda *_: self.fail('sent to another device'))
        with self.assertRaisesRegex(ValueError, 'invalid-language'):
            self.demo('fr', now=self.now + 120, transport=lambda *_: self.fail('bad language'))
        with self.assertRaisesRegex(ValueError, 'invalid-member'):
            self.demo('ja', member='', now=self.now + 120, transport=lambda *_: self.fail('no member'))
        with patch.dict(os.environ, {'WEB_PUSH_ENABLED': 'false'}), self.assertRaisesRegex(ValueError, 'disabled'):
            self.demo('ja', now=self.now + 120, transport=lambda *_: self.fail('disabled'))

    def test_one_send_per_device_per_minute_with_a_new_tag_each_time(self):
        self.register()
        first, sent, _ = self.demo('ja')
        self.assertTrue(first['accepted'])
        again, more, _ = self.demo('en', now=self.now + 30, transport=lambda *_: self.fail('rate limited'))
        self.assertEqual(again, {'accepted': False, 'retryAfter': 60})
        later, more, _ = self.demo('en', now=self.now + 60)
        self.assertTrue(later['accepted'])
        self.assertNotEqual(sent[0]['tag'], more[0]['tag'])
        # A failed send still uses the minute (no automatic retry), and a gone device is removed.
        failed, _, _ = self.demo('ja', now=self.now + 120, transport=lambda *_: 410)
        self.assertTrue(failed['expired'])
        self.assertIsNone(self.db.execute('SELECT 1 FROM push_devices WHERE id IS NOT NULL AND owner_id=?', (OWNER,)).fetchone())

    def test_recorded_as_a_real_price_target_notice_not_a_test(self):
        self.register()
        self.demo('ja')
        device = push.hashlib.sha256(subscription()['endpoint'].encode()).hexdigest()
        notice = push.recent_notice(self.db, device, self.now + 1)
        self.assertEqual((notice['kind'], notice['page'], notice['title'], notice['state']),
                         ('price-targets', '/research/price-targets', 'NVDA · 目標株価の変更', 'new'))
        self.assertNotEqual(notice['kind'], 'test')

    def test_log_line_has_no_endpoint_key_or_text(self):
        self.register()
        _, _, out = self.demo('en')
        sub = subscription()
        for secret in (sub['endpoint'], 'owner-phone', sub['keys']['p256dh'], sub['keys']['auth'], 'Sample Securities', 'NVDA', OWNER):
            self.assertNotIn(secret, out)
        self.assertEqual(json.loads(out.strip()), {'event': 'push-demo-target', 'language': 'en', 'providerStatus': 201, 'failure': None})

    def test_http_route_needs_the_token_and_the_owner_flag_from_the_site_server(self):
        import service
        self.register()
        self.db.commit()
        app = object.__new__(service.AutomaticMonitor); app.db_path = self.path
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler); server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        sent = []
        def post(token='member-api-token', flag=None, body=None):
            headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
            if flag is not None:
                headers['X-Push-Owner-Demo'] = flag
            payload = body or {'memberId': OWNER, 'subscription': subscription(), 'language': 'ja', 'ownerDemo': True}
            try:
                with urlopen(Request(base + '/push/member/demo-target', data=json.dumps(payload).encode(), headers=headers), timeout=5) as response:
                    return response.status, json.load(response)
            except HTTPError as error:
                return error.code, json.load(error)
        try:
            with patch.dict(os.environ, {'RESEARCH_API_TOKEN': 'member-api-token'}), \
                    patch.object(push, 'send', lambda _, message: sent.append(message) or 201), redirect_stdout(StringIO()):
                self.assertEqual(post(token='wrong', flag='1')[0], 401)
                # Without the flag (a field in the body is never the flag), or with any other value: refused, nothing sent.
                for flag in (None, '0', 'true'):
                    self.assertEqual(post(flag=flag), (400, {'ok': False, 'error': 'owner-required'}))
                self.assertEqual(sent, [])
                status, result = post(flag='1')
                self.assertEqual((status, result['ok'], result['accepted']), (200, True, True))
                self.assertEqual([m['title'] for m in sent], ['NVDA · 目標株価の変更'])
                self.assertEqual(post(flag='1')[1]['retryAfter'], 60)
                self.assertEqual(len(sent), 1)
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)


if __name__ == '__main__':
    unittest.main()
