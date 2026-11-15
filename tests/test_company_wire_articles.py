"""Owner, Nov 15: translate each article once, translate right after each intake round, count the day's work on /health, and take
only news organisations' Stock News API articles."""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402
import monitor  # noqa: E402
import stock_news  # noqa: E402

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}


def answering(seen, kind='news', title_ja='エヌビディアが大型受注を獲得'):
    def send(payload, key):
        items = json.loads(payload['input'])
        seen.append(items)
        out = [{'id': i['id'], 'titleJa': title_ja, 'shortJa': 'エヌビディア大型受注', 'kind': kind} for i in items]
        return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'items': out}, ensure_ascii=False)}]}]}
    return send


class ArticleOnceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 11, 15, 3, 0, tzinfo=timezone.utc)
        self.published = self.now - timedelta(minutes=10)

    def tearDown(self):
        self.dir.cleanup()

    def row(self, ticker, title='Nvidia wins a large order from Microsoft', source='stocknews', publisher='Reuters'):
        return {'ticker': ticker, 'source': source, 'title': title, 'publisher': publisher,
                'url': 'https://news.example/' + ticker + source, 'published': self.published}

    def store(self, rows, at=None):
        with company_wire.connect(self.path) as db:
            for row in rows:
                company_wire.store(db, [row], 'Name', seen_at=at or self.now)

    def feed(self):
        with company_wire.connect(self.path) as db:
            return company_wire.public_feed(db, now_ts=self.now.timestamp())

    def health(self, at=None):
        with monitor.connect(self.path) as db:
            return company_wire.translation_health(db, (at or self.now).timestamp(), ENV)

    def test_one_article_under_three_tickers_and_two_feeds_is_translated_once_and_shown_for_each_ticker(self):
        # The Stock News API files it under NVDA, MSFT and ORCL; Yahoo carries the same headline (different case and punctuation) for AVGO.
        self.store([self.row('NVDA'), self.row('MSFT'), self.row('ORCL'),
                    self.row('AVGO', title='NVIDIA wins a large order from Microsoft!', source='yahoo', publisher='')])
        seen = []
        self.assertEqual(company_wire.run_round(self.path, transport=answering(seen), env=ENV, now_ts=self.now.timestamp()), ['done'])
        self.assertEqual(len(seen), 1)
        self.assertEqual(len(seen[0]), 1, 'the article is sent once, not once per ticker or feed')
        feed = self.feed()['items']
        for ticker in ('NVDA', 'MSFT', 'ORCL', 'AVGO'):
            self.assertTrue(feed[ticker], ticker)
            self.assertTrue(all(item['titleJa'] == 'エヌビディアが大型受注を獲得' for item in feed[ticker]), ticker)
        self.assertEqual(feed['AVGO'][0]['source'], 'yahoo', 'a Yahoo copy of the same headline shares the translation')
        # The same article arriving later under another ticker uses the stored translation: no call.
        self.store([self.row('AMD')])
        self.assertEqual(company_wire.run_round(self.path, transport=answering(seen), env=ENV, now_ts=self.now.timestamp() + 60), ['idle'])
        self.assertEqual(len(seen), 1)
        self.assertEqual(self.feed()['items']['AMD'][0]['titleJa'], 'エヌビディアが大型受注を獲得')
        daily = self.health()['daily']
        self.assertEqual(daily['timezone'], 'Asia/Tokyo')
        today = daily['today']
        self.assertEqual(today['date'], '2026-11-15')
        self.assertEqual((today['articlesArrived'], today['translated'], today['calls'], today['retries'], today['headlinesSent']), (1, 1, 1, 0, 1))
        self.assertEqual(today['articlesBySource'], {'stocknews': 1})

    def test_not_news_is_judged_once_for_every_ticker(self):
        self.store([self.row('NVDA'), self.row('MSFT')])
        seen = []
        company_wire.run_round(self.path, transport=answering(seen, kind='not-news'), env=ENV, now_ts=self.now.timestamp())
        self.assertEqual(len(seen[0]), 1)
        self.assertNotIn('NVDA', self.feed()['items'])
        self.assertEqual(company_wire.run_round(self.path, transport=answering(seen), env=ENV, now_ts=self.now.timestamp() + 9999), ['idle'])
        self.assertEqual(self.health()['daily']['today']['judgedNotNews'], 1)

    def test_a_rejected_headline_is_retried_at_most_three_times_and_each_retry_is_counted(self):
        self.store([self.row('NVDA'), self.row('MSFT')])
        seen = []
        bad = answering(seen, title_ja='Nvidia order')  # no Japanese: rejected by the checks
        for n in range(5):
            company_wire.run_round(self.path, transport=bad, env=ENV, now_ts=self.now.timestamp() + n * 700)
        self.assertEqual([len(items) for items in seen], [1, 1, 1])
        self.assertEqual([('previousRejection' in items[0]) for items in seen], [False, True, True])
        today = self.health(self.now + timedelta(hours=1))['daily']['today']
        self.assertEqual((today['calls'], today['retries'], today['notAccepted'], today['translated']), (3, 2, 3, 0))

    def test_new_headlines_ride_with_due_retries_in_one_call(self):
        self.store([self.row('NVDA')])
        seen = []
        company_wire.run_round(self.path, transport=answering(seen, title_ja='Nvidia order'), env=ENV, now_ts=self.now.timestamp())
        self.store([self.row('AMD', title='AMD launches a new data center chip')], at=self.now + timedelta(minutes=11))
        company_wire.run_round(self.path, transport=answering(seen), env=ENV, now_ts=self.now.timestamp() + 11 * 60)
        self.assertEqual([len(items) for items in seen], [1, 2])

    def test_counts_are_kept_per_japan_day_and_survive_a_restart(self):
        late = datetime(2026, 11, 14, 14, 59, tzinfo=timezone.utc)  # 23:59 in Japan on Nov 14
        self.store([self.row('NVDA', title='Nvidia story one')], at=late)
        self.store([self.row('NVDA', title='Nvidia story two')], at=late + timedelta(minutes=2))  # 00:01 on Nov 15
        daily = self.health()['daily']
        self.assertEqual((daily['yesterday']['date'], daily['yesterday']['articlesArrived']), ('2026-11-14', 1))
        self.assertEqual((daily['today']['date'], daily['today']['articlesArrived']), ('2026-11-15', 1))
        text = json.dumps(daily)
        self.assertNotIn('Nvidia story', text)

    def test_translations_made_per_ticker_before_the_change_are_reused_and_never_sent_again(self):
        # A database written by the previous release: Japanese and attempts stored per ticker + headline, no article column.
        with sqlite3.connect(self.path) as db:
            db.execute('''CREATE TABLE company_wire(key TEXT PRIMARY KEY, ticker TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
              publisher TEXT NOT NULL, url TEXT NOT NULL, origin TEXT NOT NULL, published_at TEXT NOT NULL, first_seen_at TEXT NOT NULL,
              sentiment TEXT NOT NULL DEFAULT '')''')
            db.execute('CREATE TABLE company_wire_ja(key TEXT PRIMARY KEY, title_ja TEXT NOT NULL, model TEXT NOT NULL, created_at TEXT NOT NULL, short_ja TEXT NOT NULL DEFAULT \'\')')
            db.execute("CREATE TABLE company_wire_attempts(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, next_at REAL NOT NULL, reason TEXT NOT NULL DEFAULT '')")
            for ticker, title in (('NVDA', 'Nvidia wins a large order from Microsoft'), ('MSFT', 'Nvidia wins a large order from Microsoft'),
                                  ('AMD', 'Which chip stock is the better buy today'), ('ARM', 'Which chip stock is the better buy today')):
                key = f'{ticker}-{title[:5]}'
                db.execute('INSERT INTO company_wire VALUES(?,?,?,?,?,?,?,?,?,?)', (key, ticker, 'stocknews', title, 'Reuters', 'https://x.example/' + key,
                                                                                    'third-party', self.published.isoformat(), self.now.isoformat(), ''))
            db.execute("INSERT INTO company_wire_ja VALUES('NVDA-Nvidi', '既訳の見出し', 'm', ?, '既訳')", (self.now.isoformat(),))
            db.execute("INSERT INTO company_wire_attempts VALUES('AMD-Which', 3, 0, 'not-news')")
        seen = []
        self.assertEqual(company_wire.run_round(self.path, transport=answering(seen), env=ENV, now_ts=self.now.timestamp()), ['idle'])
        self.assertEqual(seen, [])
        feed = self.feed()['items']
        self.assertEqual(feed['MSFT'][0]['titleJa'], '既訳の見出し', 'the other ticker now shares the earlier translation')
        self.assertNotIn('ARM', feed)
        self.assertEqual(feed['MSFT'][0]['id'], 'MSFT-Nvidi', 'public ids stay the per-ticker keys')


class PublisherTests(unittest.TestCase):
    """Owner, Nov 15: only news organisations' Stock News API articles reach the topics; opinion and analysis outlets are dropped."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = stock_news.connect(Path(self.tmp.name) / 'news.sqlite')
        self.env = patch.dict(os.environ, {'STOCK_NEWS_ENABLED': 'true', 'STOCK_NEWS_API_KEY': 'synthetic-key', 'STOCK_NEWS_TO_HOME': 'true',
                                           'STOCK_NEWS_STREAMS': 'tech,market', 'STOCK_NEWS_ITEMS': '10'})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def item(self, index, publisher):
        return {'news_url': f'https://publisher.example/p/{index}', 'title': f'Nvidia headline number {index}', 'text': 'Body.',
                'source_name': publisher, 'date': 'Sun, 15 Nov 2026 01:00:00 +0000', 'tickers': ['NVDA']}

    def test_the_lists_classify_the_named_publishers(self):
        for name in ('Reuters', 'Bloomberg Markets and Finance (video)', 'CNBC Television', 'Wall Street Journal (articles)',
                     'Financial Times', 'Associated Press', 'Business Wire', 'PR Newswire'):
            self.assertTrue(company_wire.stock_news_publisher_kept(name), name)
        for name in ('Seeking Alpha', 'The Motley Fool', 'Zacks Investment Research', 'Investor Place', 'InvestorPlace', 'Benzinga',
                     'A Brand New Blog'):
            self.assertFalse(company_wire.stock_news_publisher_kept(name), name)
        self.assertFalse(company_wire.KEEP_KEYS & company_wire.DROP_KEYS)
        with patch.dict(os.environ, {'STOCK_NEWS_PUBLISHER_FILTER': 'false'}):
            self.assertTrue(company_wire.stock_news_publisher_kept('Seeking Alpha'))

    def test_dropped_publishers_never_reach_the_home_table_and_are_counted_per_publisher(self):
        rows = [self.item(1, 'Reuters'), self.item(2, 'Seeking Alpha'), self.item(3, 'The Motley Fool'), self.item(4, 'Unheard Of Daily')]
        result = stock_news.poll_stream(self.db, 'tech', transport=lambda *_: rows)
        self.assertEqual(result['mirrored'], 1, result)
        self.assertEqual([r[0] for r in self.db.execute('SELECT publisher FROM company_wire')], ['Reuters'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM news_articles').fetchone()[0], 4, 'the intake queue itself is unchanged')
        counts = company_wire.daily_counts(self.db, datetime.now(timezone.utc).timestamp())['today']['stockNewsPublishers']
        self.assertEqual(counts, {'kept': {'Reuters': 1}, 'dropped': {'Seeking Alpha': 1, 'The Motley Fool': 1, 'Unheard Of Daily': 1}})

    def test_rows_stored_before_the_change_from_a_dropped_publisher_are_not_translated_or_shown(self):
        now = datetime(2026, 11, 15, 3, 0, tzinfo=timezone.utc)
        row = {'ticker': 'NVDA', 'source': 'stocknews', 'title': 'Is Nvidia a buy before earnings', 'publisher': 'The Motley Fool',
               'url': 'https://fool.example/a', 'published': now - timedelta(minutes=5)}
        company_wire.schema(self.db)
        company_wire.store(self.db, [row], 'NVIDIA', seen_at=now)
        company_wire.schema_translation(self.db)
        self.assertEqual(company_wire.pending_rows(self.db, now.timestamp()), [])
        self.assertNotIn('NVDA', company_wire.public_feed(self.db, now_ts=now.timestamp())['items'])


if __name__ == '__main__':
    unittest.main()
