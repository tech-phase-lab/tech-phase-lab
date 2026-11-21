"""Every phone notification names the page a tap opens, and that page is on the service worker's list (owner, Nov 15:
a 銘柄手帳 tap showed the page the app was last on)."""
import ast
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import incident_delivery  # noqa: E402
import release_watch  # noqa: E402
import web_push as push  # noqa: E402

TARGETS = json.loads((ROOT / 'lib/research/push-targets.json').read_text())
OPENABLE = set(TARGETS['openable'])
FRAGMENT = re.compile(TARGETS['fragment'])


QUERIES = TARGETS['queries']


def openable(url):
    before, _, fragment = url.partition('#')
    path, mark, query = before.partition('?')
    return (path in OPENABLE and (not fragment or bool(FRAGMENT.fullmatch('#' + fragment)))
            and (not mark or '?' + query in QUERIES.get(path, [])))


# The modules that build phone notifications: web_push itself, and the two that service.py hands web_push.send to.
SENDERS = ('web_push.py', 'release_watch.py', 'incident_delivery.py', 'price_alerts.py')


def payload_dicts():
    """Every dict literal in the sender modules that looks like a push payload (has both a title and a body)."""
    found = []
    for path in (ROOT / 'scripts/research' / name for name in SENDERS):
        for node in ast.walk(ast.parse(path.read_text(), str(path))):
            if not isinstance(node, ast.Dict):
                continue
            keys = {k.value: v for k, v in zip(node.keys, node.values) if isinstance(k, ast.Constant) and isinstance(k.value, str)}
            if {'title', 'body'} <= set(keys):
                found.append((f'{path.name}:{node.lineno}', keys.get('url')))
    return found


class PushTargetTests(unittest.TestCase):
    def test_the_service_worker_list_is_the_shared_list(self):
        source = (ROOT / 'public/research-sw.js').read_text()
        block = re.search(r'const OPENABLE = new Set\(\[(.*?)\]\)', source, re.S).group(1)
        self.assertEqual(set(re.findall(r'"([^"]+)"', block)), OPENABLE)
        for path in OPENABLE:
            page = ROOT / 'app' / path.lstrip('/') / 'page.tsx'
            self.assertTrue(page.is_file(), path)

    def test_only_the_known_modules_send_notifications(self):
        users = {path.name for path in (ROOT / 'scripts/research').glob('*.py') if re.search(r'\bweb_push\b', path.read_text())}
        # price_alerts.py (Nov 21) sends through web_push.announce, its payload checked below with the others.
        self.assertEqual(users, {'service.py', 'price_alerts.py'})
        wiring = (ROOT / 'scripts/research/service.py').read_text()
        handed = set(re.findall(r'(\w+)\.\w+\([^\n]*web_push\.send\)', wiring)) | set(re.findall(r'(\w+)\.check\(db, payload, now, transport\)', wiring))
        self.assertEqual(handed, {'incident_delivery', 'release_watch'})

    def test_every_payload_carries_an_explicit_url_on_the_list(self):
        found = payload_dicts()
        # web_push (news, earnings, price targets, test, notebook, notes, weekly x3, answers, economic x3), release watch x2, incidents.
        self.assertGreaterEqual(len(found), 20)
        for where, url in found:
            self.assertIsNotNone(url, f'{where}: payload without a url falls back to the legacy page')
            if isinstance(url, ast.Constant):
                self.assertTrue(openable(url.value), f'{where}: {url.value}')
            else:
                self.assertEqual(ast.unparse(url), 'url', where)  # the answer notice: checked by sending one below

    def test_the_demo_notice_page_is_the_only_listed_query_and_is_kept_in_the_send_log(self):
        self.assertEqual(QUERIES, {'/research/price-targets': ['?demo=nvda']})
        self.assertTrue(openable(push.DEMO_TARGET_URL))
        for url in ('/research/price-targets?demo=amd', '/research/calendar?demo=nvda', '/research/price-targets?demo=nvda&x=1'):
            self.assertFalse(openable(url), url)
            self.assertIsNone(push.SEND_PAGE.fullmatch(url), url)
        self.assertIsNotNone(push.SEND_PAGE.fullmatch(push.DEMO_TARGET_URL))
        self.assertEqual(push.notice_kind({'tag': 'x'}, push.DEMO_TARGET_URL), 'price-targets')


class SentPayloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = push.connect(Path(self.tmp.name) / 'push.sqlite')
        self.db.execute("CREATE TRIGGER test_awake AFTER INSERT ON push_devices BEGIN UPDATE push_devices SET quiet_on=0 WHERE id=NEW.id; END")
        self.env = patch.dict(os.environ, {'WEB_PUSH_ALLOW_PILOT': 'true', 'WEB_PUSH_ENABLED': 'true', 'WEB_PUSH_PRIVATE_KEY': 'test',
                                           'WEB_PUSH_PUBLIC_KEY': 'test', 'WEB_PUSH_SUBJECT': 'mailto:test@example.com'})
        self.env.start()
        self.now = datetime(2026, 9, 26, 14, 0, 2, tzinfo=timezone.utc).timestamp()
        self.sent = []

    def tearDown(self):
        self.env.stop()
        self.db.close()
        self.tmp.cleanup()

    def transport(self, _subscription, payload):
        self.sent.append(payload)
        return 201

    def subscription(self):
        import base64
        b64 = lambda value: base64.urlsafe_b64encode(value).decode().rstrip('=')
        return {'endpoint': 'https://fcm.googleapis.com/push/test', 'keys': {'p256dh': b64(b'\x04' + b'k' * 64), 'auth': b64(b'a' * 16)}}

    def test_price_target_earnings_and_news_notices_open_their_own_pages(self):
        push.register(self.db, {'subscription': self.subscription(), 'tickers': ['MU', 'TSM'], 'language': 'ja'}, {'MU', 'TSM'}, self.now - 10)
        items = [
            {'ticker': 'MU', 'firm': 'BofA', 'previous': 100, 'latest': 120, 'publishedAt': '2026-09-26T14:00:00+00:00',
             'observedAt': '2026-09-26T14:00:01+00:00'},
            {'kind': 'earnings', 'ticker': 'TSM', 'period': 'Q3', 'titleJa': 'TSM Q3決算', 'titleEn': 'TSM Q3 earnings',
             'publishedAt': '2026-09-26T13:59:50+00:00', 'observedAt': '2026-09-26T14:00:01+00:00'},
            {'kind': 'news', 'id': 'n1', 'tickers': ['MU'], 'summaryJa': 'MUのニュース', 'summaryEn': 'MU news', 'approvedAt': '2026-09-26T14:00:01+00:00'},
        ]
        push.deliver(self.db, items, self.transport, self.now, wall_now=lambda: self.now)
        urls = {payload['title'].split(' · ')[-1]: payload['url'] for payload in self.sent}
        self.assertEqual(urls, {'目標株価の変更': '/research/price-targets', '決算速報': '/research/news', 'ニュース': '/research/news'})

    def test_an_answered_question_opens_ask_rizel_at_that_question(self):
        owner = 'a' * 64
        push.register_member(self.db, {'memberId': 'user_a', 'accessExpiresAt': self.now + 600, 'subscription': self.subscription(),
                                       'allTargets': True, 'language': 'ja'}, {'MU'}, self.now - 10)
        device = self.db.execute('SELECT id FROM push_devices').fetchone()['id']
        self.db.execute('UPDATE push_devices SET answer_posts=1, question_owner=? WHERE id=?', (owner, device))
        self.db.commit()
        answered = datetime.fromtimestamp(self.now - 60, timezone.utc).isoformat()
        question = 'q-' + '0123456789abcdef' * 2
        push.deliver_answers(self.db, [{'id': question, 'ownerKey': owner, 'answeredAt': answered}],
                             transport=self.transport, now=self.now, wall_now=lambda: self.now, entitlement=lambda _owner: self.now + 600)
        self.assertEqual([payload['url'] for payload in self.sent], ['/research/qa#' + question])
        self.assertTrue(openable(self.sent[0]['url']))

    def test_owner_incident_and_release_notices_open_listed_pages(self):
        claims = [{'key': 'k', 'transition': transition, 'errorCode': code, 'category': category}
                  for transition in ('opened', 'resolved')
                  for code, category in [('monitor-stale', 'monitor'), ('deep-analysis-overdue:MU:facts', 'analysis'),
                                         ('company-wire-translation-budget:400', 'company-wire'), ('company-wire-translation-failing:idle', 'company-wire'),
                                         ('company-wire-translation-stalled:idle', 'company-wire'), ('stock-news-intake-stale', 'stock-news'),
                                         *[(code, 'monitor') for code in incident_delivery.PUSH_TEXT]]]
        for claim in claims:
            message = incident_delivery.push_message(claim)
            self.assertTrue(openable(message['url']), (claim, message['url']))
        event = {'id': 'e1', 'titleJa': '米国CPI', 'phase': 'release'}
        for kind in ('missing', 'published'):
            self.assertTrue(openable(release_watch.notification(event, kind, 30)['url']))


if __name__ == '__main__':
    unittest.main()
