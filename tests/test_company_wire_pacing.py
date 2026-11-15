"""Owner, Nov 16: drop what the site would hide before translating, and pace model calls across the day with a token bucket
(a burst of 12, one call every 3.7 minutes at 400 a day) without ever exceeding the rolling 24-hour limit."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402
import monitor  # noqa: E402

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}
MIN = 60

REAL_NEWS = (
    'Nvidia wins a large order from Microsoft',
    'Micron raises fiscal Q1 guidance on HBM demand',
    'Nvidia shares fall 3% after tighter export curbs',
    'Apple to invest $500 billion in U.S. manufacturing',
    'TSMC October revenue rises 17% year on year',
    'AMD agrees to buy ZT Systems for $4.9 billion',
    'Broadcom reports third-quarter results; revenue beats estimates',
    'Oil jumps 4% as Strait of Hormuz tensions rise',
    'Fed holds rates steady, signals two cuts this year',
    'Trump says tariffs on chips will start next month',
    'Intel names new chief executive',
    'Arista Networks stock falls 8% after weak outlook',
    'Microsoft settles antitrust case with EU regulators',
    'Meta signs $10 billion cloud deal with Google',
    'Tesla recalls 200,000 vehicles over camera issue',
    'Palantir wins $480 million Army contract',
    'Wall Street ends lower as Treasury yields climb',
    'Nvidia CEO Huang says demand for Blackwell is insane',
    'Credo shares jump following strong earnings',
    'Alphabet hit with $2.4 billion fine by EU',
)
JUNK = (
    'Why Nvidia stock is soaring today',
    'Is Nvidia stock a buy now?',
    '3 Top AI Stocks to Buy in November',
    'Nvidia is up 40% this year. Here\'s why',
    'Should You Buy Micron Stock Before Earnings',
    'AMD Q3 earnings preview: what to expect',
    'How Nvidia became the most valuable company',
    'Better AI Stock: Nvidia vs. AMD',
    'Is this a buying opportunity for Broadcom investors',
    'Nvidia Corporation (NVDA) Q3 2026 Earnings Call Transcript',
    'Stocks making the biggest moves midday: Nvidia, Tesla, Apple',
    'Rosen Law Firm encourages Super Micro investors to secure counsel',
    'Super Micro class action lawsuit filed; lead plaintiff deadline December 1',
    'Apple Inc. Form 8-K: November 3',
    'The week in review: chips, cloud and AI',
    'What it means for investors as Nvidia reports',
    'Nvidia trades at 160 EUR in weekend trading',
    'Micron Technology shares rise 5% on cut...',
    'Lobbying Update: $50,000 NVIDIA lobbying',
)


def answer(payload, key):
    items = json.loads(payload['input'])
    out = [{'id': i['id'], 'titleJa': '日本語の見出し', 'shortJa': '短い見出し', 'kind': 'news'} for i in items]
    return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'items': out}, ensure_ascii=False)}]}]}


class PrefilterTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.start = datetime(2026, 11, 16, 3, 0, tzinfo=timezone.utc).timestamp()
        monitor.connect(self.path).close()

    def tearDown(self):
        self.dir.cleanup()

    def test_real_news_is_kept_and_junk_the_site_hides_is_dropped(self):
        self.assertEqual([t for t in REAL_NEWS if company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in JUNK if not company_wire.hidden_title(t)], [])

    def test_prefiltered_headlines_are_never_sent_marked_and_counted(self):
        sent = []
        def send(payload, key):
            sent.extend(i['title'] for i in json.loads(payload['input']))
            return answer(payload, key)
        at = datetime.fromtimestamp(self.start, timezone.utc)
        rows = [{'ticker': 'NVDA', 'source': 'stocknews', 'title': t, 'publisher': 'Reuters', 'url': f'https://news.example/{n}',
                 'published': at} for n, t in enumerate(REAL_NEWS[:3] + JUNK)]
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'NVIDIA', seen_at=at)
        self.assertEqual(company_wire.run_round(self.path, transport=send, env=ENV, now_ts=self.start + 1), ['done'])
        self.assertEqual(sorted(sent), sorted(REAL_NEWS[:3]))
        with company_wire.connect(self.path) as db:
            reasons = {r[0]: r[1] for r in db.execute('SELECT reason, COUNT(*) FROM company_wire_article_attempts GROUP BY reason')}
            feed = company_wire.public_feed(db, now_ts=self.start + 2)
        self.assertEqual(reasons, {'prefilter': len(JUNK)})
        self.assertEqual(sorted(i['titleEn'] for i in feed['items']['NVDA']), sorted(REAL_NEWS[:3]))
        with monitor.connect(self.path) as db:
            daily = company_wire.translation_health(db, self.start + 2, ENV)['daily']['today']
        self.assertEqual((daily['prefiltered'], daily['headlinesSent'], daily['calls']), (len(JUNK), 3, 1))
        # Nothing is sent again later.
        self.assertEqual(company_wire.run_round(self.path, transport=send, env=ENV, now_ts=self.start + 9999), ['idle'])

    def test_an_article_with_one_clean_copy_is_not_prefiltered(self):
        at = datetime.fromtimestamp(self.start, timezone.utc)
        rows = [{'ticker': 'NVDA', 'source': 'yahoo', 'title': 'Nvidia wins order from Microsoft...', 'publisher': '',
                 'url': 'https://news.example/1', 'published': at},
                {'ticker': 'MSFT', 'source': 'stocknews', 'title': 'Nvidia wins order from Microsoft', 'publisher': 'Reuters',
                 'url': 'https://news.example/2', 'published': at}]
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'x', seen_at=at)
            company_wire.schema_translation(db)
            self.assertEqual(company_wire.prefilter(db, self.start + 1), 0)
            self.assertEqual(len(company_wire.pending_rows(db, self.start + 1)), 1)


class PacingTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.start = datetime(2026, 11, 16, 3, 0, tzinfo=timezone.utc).timestamp()
        monitor.connect(self.path).close()
        self.n = 0
        self.sent = []

    def tearDown(self):
        self.dir.cleanup()

    def send(self, payload, key):
        self.sent.append([i['title'] for i in json.loads(payload['input'])])
        return answer(payload, key)

    def arrive(self, at, count=1, source='stocknews'):
        rows = []
        for _ in range(count):
            self.n += 1
            words = ' '.join(f'w{self.n}x{k}' for k in range(6))
            rows.append({'ticker': 'AAPL', 'source': source, 'title': f'Apple story {words}', 'publisher': 'Reuters',
                         'url': f'https://news.example/{self.n}', 'published': datetime.fromtimestamp(at, timezone.utc)})
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'Apple', seen_at=datetime.fromtimestamp(at, timezone.utc))

    def pace(self, at, limit=400):
        with company_wire.connect(self.path) as db:
            company_wire.schema_translation(db)
            return company_wire.pacer(db, at, limit)

    def test_a_burst_of_12_calls_then_one_every_3_7_minutes(self):
        results = []
        for k in range(13):
            self.arrive(self.start + k)
            results += company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + k)
        self.assertEqual(results, ['done'] * 12 + ['paced'])
        state = self.pace(self.start + 12)
        self.assertFalse(state['allowed'])
        # 400 a day: the bucket refills 388 a day (one token every 222.7 seconds), so a burst plus a day of refills is 400.
        self.assertAlmostEqual(state['nextAt'] - (self.start + 12), 86400 / 388 - 12, delta=1)
        self.assertEqual(company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + 100), ['paced'])
        self.assertEqual(company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=state['nextAt']), ['done'])
        self.assertEqual(len(self.sent), 13)

    def test_queued_headlines_are_sent_when_the_next_token_arrives_without_a_new_intake(self):
        for k in range(12):
            self.arrive(self.start + k)
            company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + k)
        self.arrive(self.start + 20, 5)
        self.arrive(self.start + 40, 3, source='yahoo')
        self.assertEqual(company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + 41), ['paced'])
        wake = company_wire.next_wake(self.path, env=ENV, now_ts=self.start + 41)
        self.assertAlmostEqual(wake, self.pace(self.start + 41)['nextAt'], delta=0.01)
        self.assertLess(wake - self.start, 300)
        # The scheduler fires at token time with no new intake: all eight go in one call, Stock News first, newest first.
        self.assertEqual(company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=wake), ['done'])
        last = self.sent[-1]
        self.assertEqual(len(last), 8)
        self.assertEqual(last[:5], [f'Apple story {" ".join(f"w{n}x{k}" for k in range(6))}' for n in (13, 14, 15, 16, 17)])
        self.assertEqual(company_wire.next_wake(self.path, env=ENV, now_ts=wake + 1), wake + 1 + company_wire.RETRY_WAKE_SECONDS)

    def test_the_bucket_survives_a_restart(self):
        for k in range(12):
            self.arrive(self.start + k)
            company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + k)
        # A new process keeps nothing in memory: the pacing is replayed from the call times stored in the database.
        self.arrive(self.start + 30)
        self.assertEqual(company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + 30), ['paced'])
        state = self.pace(self.start + 30)
        self.assertLess(state['tokens'], 1)
        self.assertEqual(state['calls24h'], 12)

    def test_a_busy_day_never_exceeds_the_ceiling_in_any_24_hours(self):
        # Arrivals every 5 seconds for 50 hours; each arrival makes a call whenever the pacing allows one.
        limit, step = 400, 5
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE company_wire_calls(at REAL NOT NULL)')
        calls, first_burst = [], None
        t = self.start
        while t < self.start + 50 * 3600:
            while company_wire.pacer(db, t, limit)['allowed']:
                db.execute('INSERT INTO company_wire_calls VALUES(?)', (t,))
                calls.append(t)
            if first_burst is None:
                first_burst = len(calls)
            t += step
        self.assertEqual(first_burst, company_wire.BUCKET_CAPACITY)
        peak = max(sum(1 for c in calls if s <= c < s + 86400) for s in calls)
        self.assertLessEqual(peak, limit)
        # Steady pace after the burst: one call per token (222.7 s, rounded up to the next arrival), with no pause at the ceiling.
        gaps = [b - a for a, b in zip(calls[company_wire.BUCKET_CAPACITY:], calls[company_wire.BUCKET_CAPACITY + 1:])]
        self.assertLessEqual(max(gaps), 86400 / 388 + step)
        self.assertGreaterEqual(peak, limit - 2)
        self.assertEqual(company_wire.bucket_size(400), (12, 388 / 86400))

    def test_a_restart_never_grants_a_burst_that_breaks_the_ceiling(self):
        # 400 calls already made in the last 24 hours (e.g. before a deploy): the next call waits for the oldest to leave the window.
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE company_wire_calls(at REAL NOT NULL)')
        db.executemany('INSERT INTO company_wire_calls VALUES(?)', [(self.start + k * 200,) for k in range(400)])
        now = self.start + 400 * 200 - 100
        state = company_wire.pacer(db, now, 400)
        self.assertTrue(state['ceilingReached'])
        self.assertFalse(state['allowed'])
        self.assertGreater(state['nextAt'], self.start + 86400)

    def test_calls_made_by_the_old_release_before_a_deploy_are_not_carried_as_debt(self):
        db = sqlite3.connect(':memory:')
        db.execute('CREATE TABLE company_wire_calls(at REAL NOT NULL)')
        db.executemany('INSERT INTO company_wire_calls VALUES(?)', [(self.start + k * 20,) for k in range(30)])
        state = company_wire.pacer(db, self.start + 600, 400)
        self.assertFalse(state['allowed'])
        self.assertLessEqual(state['nextAt'] - (self.start + 600), 86400 / 388)

    def test_health_shows_tokens_next_token_queue_wait_and_daily_waits(self):
        for k in range(12):
            self.arrive(self.start + k * 10)
            company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + k * 10 + 30)
        self.arrive(self.start + 200)
        company_wire.run_round(self.path, transport=self.send, env=ENV, now_ts=self.start + 200)
        with monitor.connect(self.path) as db:
            state = company_wire.translation_health(db, self.start + 230, ENV)
        self.assertEqual(state['pacing']['tokensAvailable'], 0)
        self.assertEqual(state['pacing']['capacity'], 12)
        self.assertEqual(state['pacing']['secondsPerToken'], 222.7)
        self.assertGreater(datetime.fromisoformat(state['pacing']['nextTokenAt']).timestamp(), self.start + 230)
        self.assertEqual(state['queue'], {'count': 1, 'new': 1, 'oldestWaitMinutes': 0.5})
        today = state['daily']['today']
        self.assertEqual(today['maxWaitMinutes'], 0.5)
        self.assertEqual(today['averageWaitMinutes'], 0.5)
        self.assertEqual(today['calls'], 12)
        with monitor.connect(self.path) as db:
            self.assertEqual(company_wire.sync_incident(db, self.start + 230, ENV, self.start), [])  # an empty bucket is no alert


if __name__ == '__main__':
    unittest.main()
