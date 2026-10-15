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
        self.assertIsNone(by_title['Why Credo stock slid'])

    def test_rejected_headline_is_retried_later_and_given_up_after_three(self):
        send = self.transport({})
        for n in range(4):
            company_wire.translate_once(self.path, transport=send, env=self.env, now_ts=self.now.timestamp() + n * 700)
        with company_wire.connect(self.path) as db:
            attempts = {r['key']: r['attempts'] for r in db.execute('SELECT * FROM company_wire_attempts')}
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
            reasons = {r['reason'] for r in db.execute('SELECT * FROM company_wire_attempts')}
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

    def test_disabled_without_configuration_and_budget_is_respected(self):
        self.assertEqual(company_wire.translate_once(self.path, transport=self.transport({}), env={}, now_ts=self.now.timestamp()), 'disabled')
        env = {**self.env, 'COMPANY_WIRE_TRANSLATION_DAILY_LIMIT': '1'}
        company_wire.translate_once(self.path, transport=self.transport({}), env=env, now_ts=self.now.timestamp())
        self.assertEqual(company_wire.translate_once(self.path, transport=self.transport({}), env=env, now_ts=self.now.timestamp() + 1), 'budget')
