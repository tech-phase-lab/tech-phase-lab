import sqlite3
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402

RSS = b'''<?xml version="1.0"?><rss><channel>
<item><title>Credo Expands Portfolio - Credo Technology Group</title><link>https://news.example/a</link>
<source>Credo Technology Group</source><pubDate>Tue, 13 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Why Credo stock slid - Investing.com</title><link>https://news.example/b</link>
<source>Investing.com</source><pubDate>Tue, 13 Oct 2026 13:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://news.example/c</link></item>
<item><title>Plain http</title><link>http://news.example/d</link><pubDate>Tue, 13 Oct 2026 13:00:00 GMT</pubDate></item>
</channel></rss>'''


class CompanyWireTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        company_wire.schema(self.db)

    def test_parse_skips_undated_and_insecure_and_strips_publisher(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual([r['title'] for r in rows], ['Credo Expands Portfolio', 'Why Credo stock slid'])

    def test_origin_separates_company_and_wire_from_third_party(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual([company_wire.origin(r, 'Credo') for r in rows], ['wire', 'third-party'])
        self.assertEqual(company_wire.origin({'publisher': 'Business Wire'}, 'Credo'), 'wire')
        self.assertEqual(company_wire.origin({'publisher': ''}, 'Credo'), 'unknown')

    def test_store_dedupes_across_sources(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual(company_wire.store(self.db, rows, 'Credo'), 2)
        again = company_wire.parse(RSS, 'yahoo', 'CRDO')
        self.assertEqual(company_wire.store(self.db, again, 'Credo'), 0)

    def test_only_known_hosts_are_fetched(self):
        with self.assertRaises(ValueError):
            company_wire.fetch_feed('https://example.com/rss')

    def test_roster_is_the_non_earnings_providers(self):
        tickers = company_wire.roster()
        self.assertEqual(len(tickers), 22)
        self.assertIn('CRDO', tickers)
        self.assertNotIn('DELL', tickers)

    def test_status_reports_counts_without_titles(self):
        company_wire.store(self.db, company_wire.parse(RSS, 'gnews', 'CRDO'), 'Credo',
                           seen_at=datetime(2026, 10, 13, 14, 0, tzinfo=timezone.utc))
        status = company_wire.status(self.db, {('CRDO', 'yahoo'): 'URLError'})
        self.assertNotIn('Credo Expands', repr(status))
        self.assertEqual(status['CRDO']['feedErrors'], ['yahoo:URLError'])



class HomeScopeTests(unittest.TestCase):
    """Owner, Nov 10: US high-tech beyond the watched companies plus market news; anything else is off-topic."""
    def setUp(self):
        import tempfile, os, json
        self.json = json
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 11, 10, 4, 0, tzinfo=timezone.utc)
        published = datetime(2026, 11, 10, 3, 0, tzinfo=timezone.utc)
        def row(ticker, title, source='stocknews'):
            return {'ticker': ticker, 'source': source, 'title': title, 'publisher': 'Reuters', 'url': 'https://news.example/' + title.replace(' ', '-'), 'published': published}
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [row('AAPL', 'Apple unveils new chip'), row('MKT', 'Oil jumps on Hormuz tension'), row('KO', 'Coca-Cola launches a new flavour'),
                                    row('NVDA', 'Nvidia wins order')], 'Name', seen_at=self.now)
            company_wire.store(db, [row('XYZ', 'Yahoo only headline about XYZ', source='yahoo')], 'Name', seen_at=self.now)
        self.env = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}

    def tearDown(self):
        self.dir.cleanup()

    def translate(self, kinds):
        seen = {}
        def send(payload, key):
            seen['policy'] = payload['instructions']; seen['enum'] = payload['text']['format']['schema']['properties']['items']['items']['properties']['kind']['enum']
            items = self.json.loads(payload['input'])
            seen['order'] = [i['title'] for i in items]
            out = [{'id': i['id'], 'titleJa': '日本語の見出し', 'shortJa': '短い見出し', 'kind': kinds.get(i['title'], 'news')} for i in items]
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': self.json.dumps({'items': out}, ensure_ascii=False)}]}]}
        company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp())
        return seen

    def test_the_model_may_call_a_headline_off_topic_and_it_is_never_shown_or_retried(self):
        seen = self.translate({'Coca-Cola launches a new flavour': 'off-topic'})
        self.assertIn('off-topic', seen['enum'])
        self.assertIn('Strait of Hormuz', seen['policy'])
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
            self.assertEqual(db.execute("SELECT reason FROM company_wire_article_attempts").fetchall()[0][0], 'off-topic')
            self.assertEqual([r['title'] for r in company_wire.pending_rows(db, self.now.timestamp() + 99999)], [])
        self.assertNotIn('KO', feed['items'])

    def test_a_law_firm_solicitation_is_not_shown_even_when_only_its_japanese_title_gives_it_away(self):
        """Owner, Nov 15: 「GIL T投資家にSBS法律事務所と…詐欺調査参加の機会」 was on 注目トピック."""
        with company_wire.connect(self.path) as db:
            db.execute("UPDATE company_wire SET ticker='GILT', title='Gilat Satellite Networks news for holders' WHERE title='Apple unveils new chip'")
        self.translate({})
        with company_wire.connect(self.path) as db:
            db.execute("UPDATE company_wire_article_ja SET title_ja='GIL T投資家にSBS法律事務所とジラット衛星ネットワーク詐欺調査参加の機会' "
                       "WHERE article=(SELECT article FROM company_wire WHERE ticker='GILT')")
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        self.assertNotIn('GILT', feed['items'])
        self.assertIn('MKT', feed['items'])

    def test_watched_companies_are_translated_first(self):
        seen = self.translate({})
        self.assertEqual(seen['order'][0], 'Nvidia wins order')

    def test_unwatched_companies_and_market_news_are_shown_only_once_translated_and_only_from_the_stock_news_api(self):
        with company_wire.connect(self.path) as db:
            before = company_wire.public_feed(db, now_ts=self.now.timestamp())
        self.assertEqual(sorted(before['items']), ['NVDA'])   # untranslated extras and Yahoo/Google rows are not shown
        self.translate({})
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        self.assertEqual(sorted(feed['items']), ['AAPL', 'KO', 'MKT', 'NVDA'])
        self.assertNotIn('XYZ', feed['items'])

    def test_each_public_row_says_where_it_came_from_so_the_home_can_show_the_stock_news_api_stories(self):
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [{'ticker': 'NVDA', 'source': 'yahoo', 'title': 'Nvidia ships a new rack', 'publisher': 'Yahoo',
                                     'url': 'https://news.example/yahoo-nvda', 'published': datetime(2026, 11, 10, 2, 0, tzinfo=timezone.utc)}], 'Name', seen_at=self.now)
        self.translate({})
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        sources = {row['titleEn']: row['source'] for rows in feed['items'].values() for row in rows}
        self.assertEqual(sources['Nvidia wins order'], 'stocknews')
        self.assertEqual(sources['Nvidia ships a new rack'], 'yahoo')
        self.assertEqual(sources['Oil jumps on Hormuz tension'], 'stocknews')
        self.assertEqual(sources['Apple unveils new chip'], 'stocknews')

    def test_the_stock_news_sentiment_is_kept_and_sent_only_when_known(self):
        """Owner, Nov 15: the topics page shows プラス / マイナス / 中立 from the provider's sentiment."""
        published = datetime(2026, 11, 10, 3, 30, tzinfo=timezone.utc)
        def row(title, url, sentiment):
            return {'ticker': 'NVDA', 'source': 'stocknews', 'title': title, 'publisher': 'Reuters', 'url': url, 'published': published, 'sentiment': sentiment}
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [row('Nvidia raises its outlook', 'https://news.example/up', 'positive'),
                                    row('Nvidia faces a new export rule', 'https://news.example/rule', 'bullish')], 'Name', seen_at=self.now)
            # A story saved before its sentiment was kept gets it when the provider sends it again; a known one is not overwritten.
            company_wire.store(db, [row('Nvidia wins order', 'https://news.example/x', 'negative'),
                                    row('Nvidia raises its outlook', 'https://news.example/up', 'negative')], 'Name', seen_at=self.now)
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        found = {r['titleEn']: r.get('sentiment') for r in feed['items']['NVDA']}
        self.assertEqual(found, {'Nvidia raises its outlook': 'positive', 'Nvidia faces a new export rule': None, 'Nvidia wins order': 'negative'})
        self.assertNotIn('sentiment', next(r for r in feed['items']['NVDA'] if r['titleEn'] == 'Nvidia faces a new export rule'))

    def test_an_older_table_gains_the_sentiment_column(self):
        old = self.path + '.old'
        with sqlite3.connect(old) as db:
            db.execute('''CREATE TABLE company_wire(key TEXT PRIMARY KEY, ticker TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
              publisher TEXT NOT NULL, url TEXT NOT NULL, origin TEXT NOT NULL, published_at TEXT NOT NULL, first_seen_at TEXT NOT NULL)''')
            db.execute("INSERT INTO company_wire VALUES('k','NVDA','yahoo','Old','','https://x.example','unknown','2026-11-10T03:00:00+00:00','2026-11-10T03:00:00+00:00')")
        with company_wire.connect(old) as db:
            self.assertEqual(db.execute('SELECT sentiment FROM company_wire').fetchone()[0], '')


if __name__ == '__main__':
    unittest.main()


class TranslationTests(unittest.TestCase):
    def setUp(self):
        import tempfile, os, json
        self.json = json
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)
        rows = company_wire.parse(RSS, 'gnews', 'CRDO') + [{
            'ticker': 'CRDO', 'source': 'yahoo', 'title': 'Credo shares rise 5% on cut...', 'publisher': '',
            'url': 'https://news.example/e', 'published': datetime(2026, 10, 14, 3, 0, tzinfo=timezone.utc)}]
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'Credo', seen_at=self.now)
        self.env = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30,
                    'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}

    def tearDown(self):
        self.dir.cleanup()

    def transport(self, answers):
        def send(payload, key):
            items = self.json.loads(payload['input'])
            out = [{'id': i['id'], 'titleJa': answers.get(i['title'], 'x')} for i in items]
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': self.json.dumps({'items': out}, ensure_ascii=False)}]}]}
        return send

    def test_truncated_headline_is_never_translated_or_shown(self):
        with company_wire.connect(self.path) as db:
            company_wire.schema_translation(db)
            titles = [r['title'] for r in company_wire.pending_rows(db, self.now.timestamp())]
        self.assertNotIn('Credo shares rise 5% on cut...', titles)

    def test_valid_translation_is_stored_and_wrong_numbers_are_rejected(self):
        answers = {'Credo Expands Portfolio': 'Credoがポートフォリオを拡大',
                   'Why Credo stock slid': 'Credo株が7%下落した理由'}
        send = self.transport(answers)
        result = company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp())
        self.assertEqual(result, 'done')
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        by_title = {i['titleEn']: i['titleJa'] for i in feed['items']['CRDO']}
        self.assertEqual(by_title['Credo Expands Portfolio'], 'Credoがポートフォリオを拡大')
        # Owner, Nov 16: a "Why ..." headline is hidden by the site anyway, so it is no longer sent or shown (prefilter).
        self.assertNotIn('Why Credo stock slid', by_title)

    def test_a_one_line_band_headline_is_kept_only_when_it_is_short_and_its_numbers_are_checked(self):
        self.assertEqual(company_wire.validated_short('マイクロン、台湾工場の作業停止', 'マイクロン、労使紛争で45億ドルの台湾工場の作業を停止'), 'マイクロン、台湾工場の作業停止')
        self.assertEqual(company_wire.validated_short('マイクロン、45億ドルの工場停止。', 'マイクロン、労使紛争で45億ドルの台湾工場の作業を停止'), 'マイクロン、45億ドルの工場停止')
        # too long, a number the checked headline does not have, not Japanese, or more than one line: left empty
        self.assertEqual(company_wire.validated_short('マイクロンが労使紛争を理由に台湾の新工場の作業を一時的に停止した', 'x'), '')
        self.assertEqual(company_wire.validated_short('マイクロン、50億ドルの工場停止', 'マイクロン、45億ドルの工場停止'), '')
        self.assertEqual(company_wire.validated_short('Micron halts fab', 'マイクロン'), '')
        self.assertEqual(company_wire.validated_short('マイクロン\n工場停止', 'マイクロン工場停止'), '')

    def test_the_band_headline_is_stored_and_published_beside_the_full_one(self):
        def send(payload, key):
            self.assertIn('shortJa', payload['text']['format']['schema']['properties']['items']['items']['required'])
            items = self.json.loads(payload['input'])
            out = [{'id': i['id'], 'titleJa': 'Credoがポートフォリオを拡大', 'shortJa': 'Credo、品ぞろえ拡大', 'kind': 'news'} for i in items]
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': self.json.dumps({'items': out}, ensure_ascii=False)}]}]}
        company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp())
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        self.assertIn('Credo、品ぞろえ拡大', {i['shortJa'] for i in feed['items']['CRDO']})

    def test_headline_the_model_calls_not_news_is_never_published_or_retried(self):
        seen = {}

        def send(payload, key):
            seen['schema'] = payload['text']['format']['schema']['properties']['items']['items']
            seen['policy'] = payload['instructions']
            items = self.json.loads(payload['input'])
            out = [{'id': i['id'], 'titleJa': 'Credoがポートフォリオを拡大', 'kind': 'not-news' if i['title'] == 'Credo Expands Portfolio' else 'news'}
                   for i in items]
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': self.json.dumps({'items': out}, ensure_ascii=False)}]}]}
        self.assertEqual(company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp()), 'done')
        self.assertIn('kind', seen['schema']['required'])
        self.assertIn('not-news', seen['policy'])
        self.assertIn('human-interest', seen['policy'])
        self.assertIn('Why', seen['policy'])
        with company_wire.connect(self.path) as db:
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
            titles = {i['titleEn']: i['titleJa'] for i in feed['items'].get('CRDO', [])}
            self.assertNotIn('Credo Expands Portfolio', titles)
            self.assertNotIn('Why Credo stock slid', titles)
            self.assertEqual([r['title'] for r in company_wire.pending_rows(db, self.now.timestamp() + 99999)], [])
            reasons = db.execute("SELECT reason FROM company_wire_article_attempts").fetchall()
        # The "Why ..." and the cut-off headline never reached the model (prefilter); the model judged the other one.
        self.assertEqual(sorted(r[0] for r in reasons), ['not-news', 'prefilter', 'prefilter'])

    def test_rejected_headline_is_retried_later_and_given_up_after_three(self):
        send = self.transport({})
        for n in range(4):
            company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp() + n * 700)
        with company_wire.connect(self.path) as db:
            attempts = {r['article']: r['attempts'] for r in db.execute('SELECT * FROM company_wire_article_attempts')}
        self.assertTrue(attempts and max(attempts.values()) == 3)

    def test_the_reason_a_headline_was_not_translated_is_reported_without_titles(self):
        send = self.transport({'Why Credo stock slid': 'Credo株が7%下落した理由'})
        for n in range(3):
            company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp() + n * 700)
        def broken(payload, key):
            raise TimeoutError('slow')
        company_wire.translate_once(self.path, transport=broken, env=self.env, now_ts=self.now.timestamp() + 5000)
        with company_wire.connect(self.path) as db:
            from unittest.mock import patch
            with patch.object(company_wire, 'now', lambda: self.now + timedelta(hours=2)):
                status = company_wire.status(db, {})
            reasons = {r['reason'] for r in db.execute('SELECT * FROM company_wire_article_attempts')}
        self.assertIn('invalid-translation', reasons)
        self.assertTrue(status['_translation']['gaveUpByReason24h'])
        self.assertNotIn('Why Credo', repr(status))

    def test_a_retry_tells_the_model_why_the_last_answer_was_rejected(self):
        seen = []
        def spy(payload, key):
            seen.append(self.json.loads(payload['input']))
            return self.transport({})(payload, key)
        company_wire.translate_once(self.path, transport=spy, env=self.env, now_ts=self.now.timestamp())
        company_wire.translate_once(self.path, transport=spy, env=self.env, now_ts=self.now.timestamp() + 700)
        self.assertFalse(any('previousRejection' in item for item in seen[0]))
        self.assertTrue(all(item.get('previousRejection') == 'invalid-translation' for item in seen[1]))

    def test_a_company_keeps_its_newest_translated_headlines_even_when_newer_ones_are_untranslated(self):
        rows = [{'ticker': 'CRDO', 'source': 'gnews', 'title': f'Credo headline number {n}', 'publisher': '',
                 'url': f'https://news.example/h{n}', 'published': self.now - timedelta(minutes=n)} for n in range(1, 31)]
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'Credo', seen_at=self.now)
            company_wire.schema_translation(db)
            for row in db.execute("SELECT article,title FROM company_wire WHERE title LIKE 'Credo headline number %'").fetchall():
                number = int(row['title'].rsplit(' ', 1)[1])
                if number > 20:  # only the oldest ten are translated
                    db.execute('INSERT INTO company_wire_article_ja(article,title_ja,model,created_at) VALUES(?,?,?,?)', (row['article'], '日本語の見出し', 'm', self.now.isoformat()))
            db.commit()
            feed = company_wire.public_feed(db, now_ts=self.now.timestamp())
        shown = feed['items']['CRDO']
        self.assertEqual(sum(1 for item in shown if item['titleJa']), 10)
        self.assertLessEqual(sum(1 for item in shown if not item['titleJa']), 5)
        self.assertEqual([item['publishedAt'] for item in shown], sorted((item['publishedAt'] for item in shown), reverse=True))

    def test_disabled_without_configuration_and_budget_is_respected(self):
        self.assertEqual(company_wire.translate_once(self.path, transport=self.transport({}), env={}, now_ts=self.now.timestamp()), 'disabled')
        env = {**self.env, 'COMPANY_WIRE_TRANSLATION_DAILY_LIMIT': '1'}
        company_wire.translate_once(self.path, transport=self.transport({}), env=env, now_ts=self.now.timestamp())
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [{'ticker': 'CRDO', 'source': 'yahoo', 'title': 'Credo wins a new order', 'publisher': '',
                                     'url': 'https://news.example/n', 'published': self.now}], 'Credo', seen_at=self.now)
        self.assertEqual(company_wire.translate_once(self.path, transport=self.transport({}), env=env, now_ts=self.now.timestamp() + 1), 'budget')


class JapaneseNameTests(unittest.TestCase):
    def test_translators_are_told_one_japanese_spelling_for_each_watched_company(self):
        import headline_translation
        for text in (company_wire.POLICY, headline_translation.POLICY):
            self.assertIn('GE Vernova = GEベルノバ', text)
            self.assertIn('Bloom Energy = ブルーム・エナジー', text)


class TriageTests(unittest.TestCase):
    def test_community_posts_and_promos_are_noise(self):
        for title in ('$NVIDIA (NVDA.US)$$SK hynix (SKHY.US)$ where is my favorite dinosaur?',
                      '3 Stocks to Buy Before Year End', "Don't miss this memory stock",
                      'Better AI Stock: Nvidia or Micron?',
                      'If you only have $1,000, buy this one ETF and hold for 20 years',
                      'If the stock market crashes, history shows these 3 ETFs are the smartest buys',
                      'Disney to pay 66 Character.AI employees $60M a year - Alphabet (NASDAQ:GOOGL)',
                      "35 analysts cover SpaceX. Here's why their targets have little to do with rockets",
                      "SanDisk: This Isn't Over (Upgrade)", 'Core Scientific: 3 Key Points For Long-Term Investors',
                      'IT admins should check out new features recently added to Entra',
                      'CoreWeave (CRWV) Faces Market Challenges Amid AI Sector Sell-Off'):
            self.assertTrue(company_wire.NOISE.search(title), title)
        self.assertFalse(company_wire.NOISE.search('Micron raises fiscal Q1 guidance on HBM demand'))
        self.assertFalse(company_wire.NOISE.search('SanDisk upgraded by Morgan Stanley, target raised to $900'))

    def setUp(self):
        import tempfile, os
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.dir.cleanup()

    def headlines(self, *items):
        rows = [{'ticker': 'NVDA', 'source': 'gnews', 'title': title, 'publisher': publisher,
                 'url': f'https://news.example/{n}', 'published': self.now - timedelta(minutes=n)}
                for n, (title, publisher) in enumerate(items, 1)]
        with company_wire.connect(self.path) as db:
            company_wire.store(db, rows, 'NVIDIA', seen_at=self.now)
            company_wire.schema_translation(db)
            return [r['title'] for r in company_wire.pending_rows(db, self.now.timestamp())]

    def test_noise_is_never_sent_for_translation(self):
        picked = self.headlines(('Invesco QQQ Trust (QQQ) Sells NVIDIA and Apple on Oct. 14', 'Yahoo Finance'),
                                ('Lobbying Update: $110,000 of NVIDIA CORPORATION lobbying was just disclosed', 'Quiver'),
                                ('NVIDIA (NVDA) Sees $224.6 Million in Net ETF Buying on Oct. 14', 'Yahoo Finance'),
                                ('Germany to unveil Nvidia AI agreement next week, government sources say', 'Reuters'))
        self.assertEqual(picked, ['Germany to unveil Nvidia AI agreement next week, government sources say'])

    def test_one_headline_is_taken_per_story_from_the_best_publisher(self):
        picked = self.headlines(('Volvo Cars expands automated driving partnership with Nvidia', 'Just Auto'),
                                ('Volvo Cars Expands Nvidia Partnership for Hands-Free Automated Driving', 'Technology Org'),
                                ('Volvo Cars expands automated driving partnership with Nvidia', 'Reuters'),
                                ('Nvidia launches three open Nemotron models', 'TechRepublic'))
        self.assertEqual(len(picked), 2)
        self.assertIn('Volvo Cars expands automated driving partnership with Nvidia', picked)
        self.assertEqual(picked[0], 'Volvo Cars expands automated driving partnership with Nvidia')

    def test_a_story_already_translated_is_not_sent_again(self):
        with company_wire.connect(self.path) as db:
            rows = [{'ticker': 'NVDA', 'source': 'gnews', 'title': 'Nvidia expands Nemotron family with two new models', 'publisher': 'Reuters',
                     'url': 'https://news.example/a', 'published': self.now - timedelta(minutes=30)}]
            company_wire.store(db, rows, 'NVIDIA', seen_at=self.now)
            company_wire.schema_translation(db)
            key = db.execute('SELECT article FROM company_wire').fetchone()[0]
            db.execute('INSERT INTO company_wire_article_ja(article,title_ja,model,created_at) VALUES(?,?,?,?)', (key, 'エヌビディアがNemotronを拡充', 'm', self.now.isoformat()))
            db.commit()
        picked = self.headlines(('Nvidia expands Nemotron family with two new open models', 'Techzine'),
                                ('Germany plans AI cooperation deal with Nvidia, Handelsblatt says', 'Reuters'))
        self.assertEqual(picked, ['Germany plans AI cooperation deal with Nvidia, Handelsblatt says'])

    def translated_twin(self, published, seen):
        """A translated copy of the Nemotron story, and a later copy of it (Techzine) that was skipped as the same story."""
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [{'ticker': 'NVDA', 'source': 'gnews', 'title': 'Nvidia expands Nemotron family with two new models',
                                     'publisher': 'Reuters', 'url': 'https://news.example/a', 'published': published}], 'NVIDIA', seen_at=published)
            company_wire.store(db, [{'ticker': 'NVDA', 'source': 'gnews', 'title': 'Nvidia expands Nemotron family with two new open models',
                                     'publisher': 'Techzine', 'url': 'https://news.example/b', 'published': seen}], 'NVIDIA', seen_at=seen)
            company_wire.schema_translation(db)
            key = db.execute("SELECT article FROM company_wire WHERE publisher='Reuters'").fetchone()[0]
            db.execute('INSERT INTO company_wire_article_ja(article,title_ja,model,created_at) VALUES(?,?,?,?)', (key, 'エヌビディアがNemotronを拡充', 'm', published.isoformat()))
            db.commit()

    def test_a_skipped_copy_is_not_sent_when_its_translated_twin_leaves_the_24_hours(self):
        # Nov 19 (翻訳の待ち時間): the later copy used to be sent the moment the translated one turned 24 hours old, nearly a day
        # after it arrived (the 1437-minute waits). It stays covered for its own 24 hours, so it is never sent.
        published = self.now - timedelta(hours=24, minutes=5)
        self.translated_twin(published, published + timedelta(minutes=10))
        with company_wire.connect(self.path) as db:
            self.assertEqual(company_wire.pending_rows(db, self.now.timestamp()), [])

    def test_the_same_kind_of_headline_on_another_day_is_still_translated(self):
        published = self.now - timedelta(hours=30)
        self.translated_twin(published, self.now - timedelta(minutes=5))
        with company_wire.connect(self.path) as db:
            picked = [r['title'] for r in company_wire.pending_rows(db, self.now.timestamp())]
        self.assertEqual(picked, ['Nvidia expands Nemotron family with two new open models'])


class LawFirmSolicitationTests(unittest.TestCase):
    """Nov 15: law firms soliciting shareholders for class actions flooded the home band once the Stock News API was on."""

    def test_solicitations_are_noise_and_real_lawsuit_news_is_not(self):
        ads = ["Rosen Law Firm Urges D-Wave Quantum Inc. Shareholders to Secure Counsel Before Important Deadline in Securities Class Action - QBTS",
               "QBTS DEADLINE ALERT: Faruqi & Faruqi, LLP Investigates Claims on Behalf of Investors of D-Wave Quantum",
               "INTC INVESTORS: Opportunity to Lead Intel Corporation Securities Fraud Lawsuit with the Schall Law Firm"]
        news = ["Apple settles class action over iPhone batteries for $500 million",
                "Nvidia faces lawsuit from patent holder over GPU design",
                "Micron raises guidance on HBM demand"]
        self.assertTrue(all(company_wire.NOISE.search(t) for t in ads))
        self.assertFalse(any(company_wire.NOISE.search(t) for t in news))

    # Owner, Nov 15 (注目トピック): a Business Wire ad from a firm the old list did not name, 「GILT投資家にSBS法律事務所と…詐欺調査参加の機会」.
    ADS = ("GILT Investors Have Opportunity to Join Gilat Satellite Networks Ltd. Fraud Investigation with SBS Law Firm",
           "Gilat Satellite Networks (GILT) Investors Encouraged to Contact SBS About Securities Fraud Investigation",
           "GILT INVESTORS: Opportunity to Join Gilat Satellite Networks Fraud Investigation",
           "Kirby McInerney LLP Reminds Investors of Class Action Against Super Micro",
           "Levi & Korsinsky Announces Investigation on Behalf of Intel Shareholders",
           "Lost money on Nvidia? Investors who lost money should contact Frank R. Cruz",
           "Halper Sadeh LLC Encourages ARM Shareholders to Contact the Firm",
           "Securities Class Action Deadline Approaching for QBTS investors",
           "The Gross Law Firm Notifies Shareholders of Arista Networks",
           "Robbins Geller Rudman & Dowd LLP Announces that Super Micro Investors with Substantial Losses Have Opportunity to Lead Class Action",
           "Monteverde & Associates Is Investigating the Merger", "Bragar Eagel & Squire Is Investigating Claims", "Ademi Firm investigates Marvell board")
    ADS_JA = ("GIL T投資家にSBS法律事務所とジラット衛星ネットワーク詐欺調査参加の機会", "スーパー・マイクロの株主に集団訴訟への参加を呼びかけ",
              "クオンタム投資家、集団訴訟の締め切り迫る", "損失を被った投資家は連絡を")
    # News about a lawsuit itself, filed by a regulator or a named party, stays.
    NEWS = ("SEC sues Nikola founder Trevor Milton for securities fraud", "Intel shareholders sue after 29% drop",
            "Intel shareholders file class action lawsuit after 29% drop", "SEC opens securities fraud investigation into Super Micro",
            "Musk urges Tesla shareholders to vote for pay package", "Apple faces class action over Siri recordings",
            "Nvidia sees opportunity to lead AI market", "Nvidia invites investors to join Q3 earnings webcast", "SoftBank lost money on WeWork bet",
            "Germany joins EU antitrust investigation into Microsoft", "Gilat Satellite Networks wins $50 million defense contract",
            "SBS and Samsung sign broadcasting deal")
    NEWS_JA = ("米SEC、ニコラ創業者を証券詐欺で提訴", "インテル株主が集団訴訟を提起、株価29%下落後", "司法省がスーパー・マイクロの調査を開始")

    def test_any_firm_or_solicitation_wording_is_hidden_before_translation_and_lawsuit_news_is_kept(self):
        self.assertEqual([t for t in self.ADS if not company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.ADS + self.ADS_JA if not company_wire.LAW_FIRM_SOLICITATION.search(t)], [])
        self.assertEqual([t for t in self.NEWS if company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.NEWS + self.NEWS_JA if company_wire.LAW_FIRM_SOLICITATION.search(t)], [])
        self.assertTrue(company_wire.locally_rejected({'title': self.ADS[0], 'publisher': 'Business Wire', 'source': 'stocknews'}))

    def test_the_patterns_match_lib_research_wire_stories(self):
        import os, re
        ts = open(os.path.join(os.path.dirname(__file__), '..', 'lib', 'research', 'wire-stories.ts'), encoding='utf-8').read()
        block = re.search(r'export const LAW_FIRM_SOLICITATION = new RegExp\(\[(.*?)\]\.join', ts, re.S).group(1)
        self.assertEqual(''.join(re.findall(r'String\.raw`([^`]*)`', block)),
                         company_wire.LAW_FIRM_SOLICITATION_EN + '|' + company_wire.LAW_FIRM_SOLICITATION_JA)


class LowValueTests(unittest.TestCase):
    """Owner, Nov 20 (「いらないニュース全排除で。MRVLは同じの2つある」): market live blogs, stock lists, explainers and opinion are not
    translated or shown, and one broker action reported by two outlets is translated once."""

    LOW_VALUE = ('Stock Market Today: Anthropic’s Mega-IPO Sends Stocks Lower for a Second Day',
                 'Stock market today: Tech futures slide as Anthropic sinks 10% after IPO (live)',
                 'Anthropic shares fall in pre-market trade as AI rout hits global markets - business live',
                 'Dow Jones Futures: Techs Tumble, Anthropic Dives After Ugly Market Reversal To New Lows',
                 'Beyond TSMC: 3 Taiwanese Small-Cap Tech Stocks to Watch',
                 'Sandisk Stock Splits 8-for-1 — What It Means for Investors',
                 "Sandisk’s stock split is almost here. This is what investors need to know.",
                 'Intel 18A vs. TSMC N2: How to Read the Chip Claims',
                 "Anthropic IPO: Here's What Its Spending Commitments Mean to Microsoft, SpaceX, Amazon, and Alphabet",
                 'Prediction: Micron Stock Is Going to Soar After Its December Earnings Report',
                 'Dear Sandisk Stock Fans, Mark Your Calendars for November 20',
                 # HQ, Nov 20: "here's what it means / how" teasers, a broker-note teaser and "Analysis:" stay dropped.
                 "Anthropic files for IPO. Here's what it means for Alphabet", "Nvidia stock fell. Here's how to play it",
                 "72% Upside for GE Vernova? Bernstein Thinks So, and Here's How It Gets to $1,298", 'Analysis: Anthropic IPO tests AI valuations',
                 # HQ, Nov 20: MarketBeat price-move templates with no event.
                 "Vertiv (NYSE:VRT) Stock Falls 5.1% - Here's What Happened",
                 "Arista Networks (NYSE:ANET) Stock Price Down 5.5% - Here's Why",
                 "Arista Networks (NYSE:ANET) Stock Price Breaks Below 50 Day Moving Average - Here's What Happened",
                 'Bloom Energy (NYSE:BE) Shares Gap Up - Time to Buy?',
                 'Lumentum (NASDAQ:LITE) Shares Gap Down',
                 "NVIDIA (NASDAQ:NVDA) Trading 3.2% Higher - Here's Why",
                 'Micron Technology (NASDAQ:MU) Stock Price Up 4.1% - Should You Buy?',
                 "Lumentum (NASDAQ:LITE) Stock Falls 2.9% - What's Next?")
    NEWS = ('Microsoft announces general availability of Azure Cobalt 200',
            'The U.S. Approved 879,000 Nvidia and AMD Chips for China in 6 Months',
            'Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370',
            'Stifel cuts Marvell stock price target on deal concerns to $280',
            'BMO Capital Markets Upgrades Bloom Energy (NYSE:BE) to Outperform',
            'Nvidia reports record third-quarter revenue of $115.8 billion', 'Sandisk completes 8-for-1 stock split and increases authorized shares',
            'TSMC halts advanced chip orders from Chinese designers in Taiwan', 'Nvidia sells 10 million shares to SoftBank',
            'Arista names new chief financial officer', 'Live Nation shares jump after earnings',
            # HQ, Nov 20: "here's what" followed by what happened reports an event; the plain broker target change is kept.
            "Microsoft CEO Satya Nadella calls Outlook outage a 'perfect storm.' Here's what went wrong",
            "Sandisk Stock Looked Like It Fell 87%. Here's What Really Happened.", "Nvidia board picks new CEO: here's what we know",
            'Bernstein raises GE Vernova price target to $1,298')

    def setUp(self):
        import tempfile, os
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 11, 20, 14, 40, tzinfo=timezone.utc)

    def tearDown(self):
        self.dir.cleanup()

    def test_low_value_headlines_are_hidden_and_news_is_kept(self):
        self.assertEqual([t for t in self.LOW_VALUE if not company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.NEWS if company_wire.hidden_title(t)], [])

    def test_opinion_outlets_on_google_news_are_dropped_and_others_kept(self):
        row = lambda publisher, source='gnews': {'title': 'Nvidia stock: a closer look', 'publisher': publisher, 'source': source}
        self.assertTrue(company_wire.locally_rejected(row('The Motley Fool')))
        self.assertTrue(company_wire.locally_rejected(row('Simply Wall St')))
        for publisher in ('Reuters', 'Seeking Alpha', 'MarketBeat', 'Investing.com UK', 'TradingView', 'Yahoo Finance'):
            self.assertFalse(company_wire.locally_rejected(row(publisher)), publisher)
        # Yahoo's feed names no outlet; its rows are judged by their titles only.
        self.assertFalse(company_wire.locally_rejected(row('', 'yahoo')))

    def test_the_patterns_match_lib_research_wire_stories(self):
        import os, re
        ts = open(os.path.join(os.path.dirname(__file__), '..', 'lib', 'research', 'wire-stories.ts'), encoding='utf-8').read()
        for name, python in (('LOW_VALUE', company_wire.LOW_VALUE_EN), ('LOW_VALUE_SOFT', company_wire.LOW_VALUE_SOFT_EN),
                             ('CONCRETE_EVENT', company_wire.CONCRETE_EVENT_EN)):
            block = re.search(r'export const ' + name + r' = new RegExp\(\[(.*?)\]\.join', ts, re.S).group(1)
            self.assertEqual(''.join(re.findall(r'String\.raw`([^`]*)`', block)), python, name)
        python_target = re.search(r"ANY_TARGET = re\.compile\(r'(.*?)', re\.I\)", open(company_wire.__file__, encoding='utf-8').read()).group(1)
        self.assertEqual(re.search(r'const ANY_TARGET = /(.*?)/i;', ts).group(1), python_target)

    # Nov 20 review: an explainer, "- live", "here's the" or bull-case phrase does not drop a headline that reports a concrete event.
    EVENT_NEWS = ('AMD launches MI400: what it means for Nvidia', 'Microsoft to invest $10 billion in Japan, what to know',
                  'Intel names new CEO - live', 'Oracle surges 30% on cloud backlog - live', "Here's the full statement from Apple on the EU fine",
                  "Nvidia to buy stake in Intel; here's the deal terms", "Palantir wins $10 billion Army contract — what's next",
                  'Morgan Stanley bull case for Tesla raised to $800')
    # The owner's examples and the drops approved on Nov 20 stay dropped.
    STILL_LOW_VALUE = ('Stock Market Today live: Nasdaq slides as Anthropic sinks', 'Beyond TSMC: 3 Taiwan small-cap tech stocks',
                       'Sandisk 8-for-1: what it means for investors', 'Intel 18A vs. TSMC N2: How to Read the Chip Claims',
                       "Anthropic IPO: Here's What Its Spending Commitments Mean to Microsoft, SpaceX, Amazon, and Alphabet",
                       "Nvidia beats estimates - Here's why", 'Analysis: Nvidia names a new chief executive',
                       "Lumentum (NASDAQ:LITE) Stock Surges 2.9% - What's Next?", 'Lumentum unveils AI rack optics demo: what it means for LITE stock')
    # Owner, Nov 21: GuruFocus templates.
    GURUFOCUS = ('Marvell Technology (MRVL) Stock Down 11.7% — What the 84 GF Score Means for Investors',
                 'Arm Holdings (ARM) after 14.1% drop — GF Value $207.57 vs price $152.18',
                 'Arista Networks (ANET) a bargain after 11.6% drop? GF rating')

    def test_an_explainer_phrase_does_not_drop_an_event_headline(self):
        self.assertEqual([t for t in self.EVENT_NEWS if company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.STILL_LOW_VALUE if not company_wire.hidden_title(t)], [])

    # Owner, Nov 26: a consumer brand's stunt naming a CEO, "another connection" teasers and celebrity trivia are never translated;
    # earnings, guidance, export controls, deals and broker actions are.
    STUNTS_AND_TEASERS = ("‘Your booth is waiting': Denny's welcomes Jensen Huang back as Nvidia CEO",
                          "Chinese-Linked Executive's Other Connection to Nvidia", 'Another Nvidia connection for China-linked executive',
                          'The hidden link between Nvidia and a Chinese chip broker', "Wendy's trolls Elon Musk after Tesla CEO's tweet",
                          "McDonald's offers free fries to celebrate Nvidia founder Jensen Huang",
                          'Jensen Huang signs autographs and poses for selfies in Taipei', "Jensen Huang's leather jacket steals the show at Computex")
    KEPT_NEAR_MISSES = ('Nvidia reports record third-quarter revenue of $57 billion', 'Nvidia raises fourth-quarter revenue guidance above estimates',
                        'US tightens export controls on Nvidia H20 chips to China', 'Nvidia agrees to buy Run:ai for $700 million',
                        'Bernstein raises Nvidia price target to $300', 'Morgan Stanley upgrades Micron to Overweight',
                        "McDonald's to deploy Nvidia AI across 40,000 restaurants", 'Starbucks partners with Nvidia on drive-thru AI',
                        'Intel cuts ties with Chinese distributor after export probe', 'Meta launches AI selfie feature for Instagram',
                        'Nvidia names Jensen Huang chief executive again after board vote')

    def test_brand_stunts_and_connection_teasers_are_dropped_and_material_news_kept(self):
        self.assertEqual([t for t in self.STUNTS_AND_TEASERS if not company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.KEPT_NEAR_MISSES if company_wire.hidden_title(t)], [])

    # Owner, Nov 26: company-blog marketing and customer showcases are never translated; launches, partnerships and expansions are.
    SHOWCASES = ('See what 5 builders are making with Gemini 4 Neon', '5 ways to use Gemini in Google Docs', 'Tips for holiday shopping with AI Mode',
                 'How small businesses are using Gemini to grow', 'Meet the students building the future of AI',
                 'Behind the scenes of the Pixel camera', 'Customer spotlight: Wayfair scales search with Vertex AI',
                 'Indie filmmakers in India bring big-screen stories to life with Google Flow', 'Retailers build shopping agents with Gemini',
                 # Owner, Nov 26 (audit of the served feed).
                 'Dropbox to Present at the 2026 UBS Global Technology and AI Conference', 'CrowdStrike to Participate in Upcoming Investor Conferences',
                 'Cango Inc. to Report Third Quarter 2026 Financial Results on November 30, 2026, Eastern Time',
                 'Hydreight Technologies Announces Timing of Q3 2026 Financial Results and Earnings Call', 'Uniserve Announces Grant of Incentive Stock Options',
                 'Options Now Available on ANUU, ANDD & ANSS: Leverage Shares by Themes 2X Long, 2X Short and 1X Short Anthropic (ANT) ETFs',
                 'CDW Canada Named 2026 Cisco Partner of the Year for Cloud & AI and SMB', 'Anthropic Rebounds From 10% Drop as Markets Stage Dramatic Recovery | Closing Bell',
                 'Freedom Gold Corp. Announces Extension and Amendment of FT Offering and Extension of Unit Offering',
                 'A Man in Denver Has Been Throwing Eggs at Waymo Vehicles', "Former Tesla engineer says AI will create more 'fake jobs' — not mass unemployment",
                 'Remedy says Microsoft decides whether Quantum Break gets a sequel', "Mulvaney: Trump ‘Reading the Room Wrong' on Huang",
                 'Nvidia, Micron and Oracle Shares Fall as AI Sell-Off Continues; Key Reasons Behind the Decline')
    SHOWCASE_NEAR_MISSES = ('Introducing Gemini 4 Neon', 'Meet the new Pixel 11', 'Google launches Gemini 4 Neon: 5 ways to try it',
                            'Golden State Warriors and Google expand partnership, naming Gemini the official AI assistant partner',
                            "Nvidia to expand King's Cross hub in London", 'Nvidia builds Taiwan AI supercomputer with Foxconn',
                            'Palantir wins $480 million Army contract award', "Exclusive: Nvidia in talks to supply ‘Rubin' chips to Saudi venture",
                            'Nvidia unveils Rubin Ultra at GTC conference', 'iQIYI Announces Receipt of Minimum Bid Price Notice from Nasdaq',
                            'Amazon to launch Amazon Autos in UK in early 2027 in first expansion beyond US')

    def test_marketing_showcases_are_dropped_and_launches_kept(self):
        self.assertEqual([t for t in self.SHOWCASES if not company_wire.hidden_title(t)], [])
        self.assertEqual([t for t in self.SHOWCASE_NEAR_MISSES if company_wire.hidden_title(t)], [])

    def test_a_headline_filed_under_a_company_it_does_not_name_is_rejected_for_that_company(self):
        row = lambda ticker, title: {'ticker': ticker, 'title': title, 'publisher': 'Reuters', 'source': 'gnews', 'url': 'https://news.example/x'}
        kings = "Nvidia to expand King's Cross hub in London"
        self.assertTrue(company_wire.locally_rejected(row('GOOGL', kings)))
        self.assertFalse(company_wire.locally_rejected(row('NVDA', kings)))
        self.assertFalse(company_wire.locally_rejected(row('GOOGL', 'Golden State Warriors expand Gemini partnership')))
        self.assertFalse(company_wire.locally_rejected(row('GOOGL', 'Fed holds rates steady')))
        self.assertFalse(company_wire.locally_rejected(row('KXHCF', 'Kioxia and NVIDIA Collaborate')))
        # Without a ticker (the prefilter reads articles, not copies) the copy is not judged.
        self.assertFalse(company_wire.locally_rejected({'title': kings, 'publisher': 'Reuters', 'source': 'gnews', 'url': 'https://news.example/x'}))
        self.assertTrue(company_wire.locally_rejected({'title': kings, 'publisher': 'Reuters', 'source': 'gnews', 'url': 'https://news.example/x'}, 'GOOGL'))
        # The Stock News API files a story under the companies it is about: its copies are not judged.
        self.assertFalse(company_wire.locally_rejected({**row('GOOGL', kings), 'source': 'stocknews'}))

    def test_gurufocus_templates_links_and_outlet_are_dropped(self):
        self.assertEqual([t for t in self.GURUFOCUS if not company_wire.hidden_title(t)], [])
        # GF Securities is a broker, not a GuruFocus template.
        self.assertFalse(company_wire.hidden_title('Micron, Sandisk, SK Hynix in focus as GF Securities cuts NAND price forecast, sees glut'))
        row = lambda publisher, source='gnews', url='https://news.google.com/rss/articles/x': {
            'title': 'Credo Technology Group Holding (CRDO) Announces Patent Agreement', 'publisher': publisher, 'source': source, 'url': url}
        self.assertTrue(company_wire.locally_rejected(row('GuruFocus')))
        self.assertTrue(company_wire.locally_rejected(row('GuruFocus.com', 'stocknews')))
        self.assertTrue(company_wire.locally_rejected(row('', 'yahoo', 'https://www.gurufocus.com/news/123/credo')))
        self.assertFalse(company_wire.locally_rejected(row('', 'yahoo', 'https://finance.yahoo.com/news/credo-123.html')))
        self.assertFalse(company_wire.locally_rejected(row('', 'yahoo', 'https://notgurufocus.com.example/news')))

    def test_a_billion_or_trillion_amount_is_not_read_as_the_target(self):
        self.assertEqual(company_wire.analyst_actions('Goldman Sachs keeps Nvidia price target, sees $500 billion AI opportunity'), frozenset())
        self.assertEqual(company_wire.analyst_actions('UBS lifts Apple PT ahead of $1.5 trillion buyback'), frozenset())
        self.assertEqual(company_wire.analyst_actions('Goldman Sachs keeps Nvidia price target at $250, sees $500 billion AI opportunity'),
                         {('goldman', 'pt', 250.0)})
        self.assertEqual(company_wire.analyst_actions('UBS lifts Apple PT, sees $1.5 trillion buyback and $300 shares'), {('ubs', 'pt', 300.0)})
        self.assertEqual(company_wire.analyst_actions('Bernstein raises GE Vernova price target, sees $1,298.'), {('bernstein', 'pt', 1298.0)})

    def test_a_broker_action_is_keyed_by_broker_and_new_target_or_rating(self):
        self.assertEqual(company_wire.analyst_actions('Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370'),
                         {('stifel', 'pt', 280.0)})
        self.assertEqual(company_wire.analyst_actions('Stifel cuts Marvell stock price target on deal concerns to $280'), {('stifel', 'pt', 280.0)})
        self.assertEqual(company_wire.analyst_actions('BMO Upgrades Bloom Energy to Outperform With $230 Price Target'),
                         {('bmo', 'pt', 230.0), ('bmo', 'rating', 'outperform')})
        self.assertEqual(company_wire.analyst_actions('Marvell agrees to buy Lumentum for $115 billion'), frozenset())

    def store(self, *items):
        with company_wire.connect(self.path) as db:
            for title, publisher, minutes in items:
                published = self.now - timedelta(minutes=minutes)
                company_wire.store(db, [{'ticker': 'MRVL', 'source': 'gnews', 'title': title, 'publisher': publisher,
                                         'url': f'https://news.example/{minutes}', 'published': published}], 'Marvell Technology', seen_at=published)
            company_wire.schema_translation(db)

    def pending(self):
        with company_wire.connect(self.path) as db:
            return [r['title'] for r in company_wire.pending_rows(db, self.now.timestamp())]

    def test_one_broker_action_from_two_outlets_is_translated_once_the_first_report(self):
        self.store(('Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370', 'TradingView', 69),
                   ('Stifel cuts Marvell stock price target on deal concerns to $280', 'Investing.com UK', 16),
                   ('Needham cuts Marvell price target to $280', 'Reuters', 10))
        self.assertEqual(sorted(self.pending()), ['Needham cuts Marvell price target to $280',
                                                  'Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370'])

    def test_a_later_copy_of_a_translated_broker_action_is_not_sent(self):
        self.store(('Stifel maintains Marvell Technology at Buy, lowers price target to $280 from $370', 'TradingView', 69))
        with company_wire.connect(self.path) as db:
            article = db.execute('SELECT article FROM company_wire').fetchone()[0]
            db.execute('INSERT INTO company_wire_article_ja(article,title_ja,model,created_at) VALUES(?,?,?,?)',
                       (article, 'マーベル、スティーフェルが維持も目標株価を280ドルに引き下げ', 'm', self.now.isoformat()))
            db.commit()
        self.store(('Stifel cuts Marvell stock price target on deal concerns to $280', 'Investing.com UK', 16))
        self.assertEqual(self.pending(), [])


class TechAlertsNoiseTests(unittest.TestCase):
    """Owner, Nov 24 (ハイテク速報「こういうニュースはいらない」): chart-of-the-day recaps, options-chain and quote pages, social posts and
    interviews, opinion and predictions, and consumer how-to tips are never translated or published; real company news is."""

    @classmethod
    def setUpClass(cls):
        import json
        cls.cases = json.loads((Path(__file__).resolve().parent / 'fixtures' / 'tech-alerts-noise-1124.json').read_text(encoding='utf-8'))

    def test_each_kind_is_dropped_by_its_english_title(self):
        for kind, titles in self.cases['dropped'].items():
            with self.subTest(kind=kind):
                self.assertEqual([t for t in titles if not company_wire.hidden_title(t)], [])
        self.assertEqual([en for _ja, en in self.cases['droppedJa'] if not company_wire.hidden_title(en)], [])

    def test_real_news_is_kept(self):
        self.assertEqual([t for t in self.cases['kept'] if company_wire.hidden_title(t)], [])

    def test_outlets_and_links_are_dropped_and_others_kept(self):
        title = 'Nvidia reinstates Jensen Huang after Trump speaks directly to board'
        for row in self.cases['sources']['dropped']:
            self.assertTrue(company_wire.locally_rejected({**row, 'title': title}), row)
        for row in self.cases['sources']['kept']:
            self.assertFalse(company_wire.locally_rejected({**row, 'title': title}), row)

    def test_rows_already_stored_leave_the_public_feed(self):
        """Rows stored (and translated) before these rules are filtered when the feed is built, so they leave the page on redeploy."""
        import tempfile, os
        now = datetime(2026, 11, 24, 3, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'db.sqlite')
            rows = [('Chip stocks led a $3 trillion comeback on Monday — now comes Turnaround Tuesday: Chart of the Day', '', 'yahoo',
                     'https://finance.yahoo.com/markets/article/chip-stocks-1'),
                    ('Nebius signs $17.4 billion GPU capacity deal with Microsoft', 'Reuters', 'gnews', 'https://news.example/deal'),
                    ('Nebius startup programme update', 'LinkedIn', 'gnews', 'https://news.example/post'),
                    ('Astera Labs (ALAB) quote', '', 'yahoo', 'https://finance.yahoo.com/quote/ALAB/options/')]
            with company_wire.connect(path) as db:
                for minutes, (title, publisher, source, url) in enumerate(rows):
                    published = now - timedelta(minutes=minutes + 1)
                    company_wire.store(db, [{'ticker': 'NBIS', 'source': source, 'title': title, 'publisher': publisher, 'url': url,
                                             'published': published}], 'Nebius Group', seen_at=published)
                feed = company_wire.public_feed(db, now.timestamp())
        self.assertEqual([r['titleEn'] for r in feed['items'].get('NBIS', [])], ['Nebius signs $17.4 billion GPU capacity deal with Microsoft'])
