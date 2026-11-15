"""Owner, Nov 15 (注目トピックの要約): the Stock News API article's short English text is stored, translated into Japanese in the same
model call as the headline, checked like the headline, and shown in the public feed. A failed summary never rejects the headline."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402
import stock_news  # noqa: E402

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}
TITLE = 'Meta fined $887 million by Italian antitrust regulator'
TITLE_JA = 'メタ、イタリア競争当局から8億8700万ドルの制裁金'
TEXT = "Italy's antitrust authority fined Meta $887 million, saying it shut rival AI chatbots out of WhatsApp. Meta said it would appeal."
SUMMARY_JA = 'イタリアの競争当局は、メタがWhatsAppから競合のAIチャットボットを締め出したとして8億8700万ドルの制裁金を科した。メタは不服を申し立てるとした。'


def answering(seen, summary=SUMMARY_JA, usage=None, omit_summary=False):
    def send(payload, key):
        seen.append(payload)
        items = json.loads(payload['input'])
        out = []
        for item in items:
            answer = {'id': item['id'], 'titleJa': TITLE_JA, 'shortJa': 'メタに制裁金', 'kind': 'news'}
            if not omit_summary:
                answer['summaryJa'] = summary if 'text' in item else ''
            out.append(answer)
        response = {'status': 'completed', 'output': [{'type': 'message', 'content': [
            {'type': 'output_text', 'text': json.dumps({'items': out}, ensure_ascii=False)}]}]}
        if usage is not None:
            response['usage'] = usage
        return response
    return send


class SummaryTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 11, 15, 3, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.dir.cleanup()

    def store(self, ticker='META', source='stocknews', summary=TEXT, title=TITLE, publisher='Reuters'):
        row = {'ticker': ticker, 'source': source, 'title': title, 'publisher': publisher, 'url': f'https://news.example/{ticker}{source}',
               'published': self.now - timedelta(minutes=10), 'summary': summary}
        with company_wire.connect(self.path) as db:
            company_wire.store(db, [row], 'Name', seen_at=self.now)

    def run_round(self, transport):
        return company_wire.run_round(self.path, transport=transport, env=ENV, now_ts=self.now.timestamp())

    def feed(self):
        with company_wire.connect(self.path) as db:
            return company_wire.public_feed(db, now_ts=self.now.timestamp())['items']

    def today(self):
        with company_wire.connect(self.path) as db:
            return company_wire.daily_counts(db, self.now.timestamp())['today']

    def test_the_summary_rides_in_the_same_call_with_its_own_schema_field_and_output_allowance(self):
        self.store()
        self.store('NVDA', title='Nvidia signs a supply deal with Foxconn', summary='')
        seen = []
        self.assertEqual(self.run_round(answering(seen)), ['done'])
        self.assertEqual(len(seen), 1, 'one call for headline and summary together')
        payload = seen[0]
        props = payload['text']['format']['schema']['properties']['items']['items']
        self.assertIn('summaryJa', props['required'])
        self.assertEqual(props['properties']['summaryJa'], {'type': 'string'})
        self.assertIn('summaryJa', payload['instructions'])
        self.assertEqual(payload['max_output_tokens'], 4000 + company_wire.SUMMARY_OUTPUT_TOKENS, 'room for the one article with text')
        sent = {item['title']: item for item in json.loads(payload['input'])}
        self.assertEqual(sent[TITLE]['text'], TEXT)
        self.assertNotIn('text', sent['Nvidia signs a supply deal with Foxconn'])

    def test_a_checked_summary_is_stored_per_article_and_shown_in_both_languages(self):
        self.store()
        self.store('GOOGL')  # the same article under another ticker shares the translation and summary
        self.run_round(answering([], usage={'input_tokens': 1200, 'output_tokens': 340}))
        with company_wire.connect(self.path) as db:
            rows = db.execute('SELECT title_ja, summary_ja FROM company_wire_article_ja').fetchall()
        self.assertEqual([tuple(r) for r in rows], [(TITLE_JA, SUMMARY_JA)])
        feed = self.feed()
        for ticker in ('META', 'GOOGL'):
            item = feed[ticker][0]
            self.assertEqual((item['summaryEn'], item['summaryJa']), (TEXT, SUMMARY_JA), ticker)
        today = self.today()
        self.assertEqual((today['summariesTranslated'], today['summariesNotAccepted']), (1, 0))
        self.assertEqual((today['inputTokens'], today['outputTokens']), (1200, 340))

    def test_a_summary_failing_the_checks_keeps_the_headline_and_shows_no_japanese_summary(self):
        for bad in ('メタは12億ドルの制裁金を科された。',        # a number not in the English text
                    'Meta was fined.',                          # not Japanese
                    'あ' * (company_wire.SUMMARY_JA_MAX + 1),   # too long
                    'メタ\x00に制裁金'):                          # NUL
            with self.subTest(bad=bad[:12]):
                self.tearDown(); self.setUp()
                self.store()
                self.assertEqual(self.run_round(answering([], summary=bad)), ['done'])
                item = self.feed()['META'][0]
                self.assertEqual(item['titleJa'], TITLE_JA, 'the headline is kept')
                self.assertEqual(item['summaryEn'], TEXT, 'the English page still has its summary')
                self.assertNotIn('summaryJa', item)
                self.assertEqual((self.today()['summariesTranslated'], self.today()['summariesNotAccepted']), (0, 1))

    def test_a_missing_summary_field_keeps_the_headline(self):
        self.store()
        self.assertEqual(self.run_round(answering([], omit_summary=True)), ['done'])
        item = self.feed()['META'][0]
        self.assertEqual(item['titleJa'], TITLE_JA)
        self.assertNotIn('summaryJa', item)

    def test_only_stock_news_rows_carry_a_summary(self):
        self.store('NVDA', source='yahoo', title='Nvidia ships a new rack system', summary='Ignored text.', publisher='')
        with company_wire.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT summary_en FROM company_wire').fetchone()[0], '')
        self.run_round(answering([]))
        item = self.feed()['NVDA'][0]
        self.assertNotIn('summaryEn', item)
        self.assertNotIn('summaryJa', item)

    def test_a_story_stored_before_the_change_gets_its_english_summary_when_seen_again(self):
        self.store(summary='')
        self.run_round(answering([]))
        self.assertNotIn('summaryEn', self.feed()['META'][0])
        self.store()
        self.assertEqual(self.feed()['META'][0]['summaryEn'], TEXT)

    def test_validated_summary_mirrors_the_headline_checks(self):
        self.assertEqual(company_wire.validated_summary(SUMMARY_JA, TEXT, TITLE), SUMMARY_JA)
        self.assertEqual(company_wire.validated_summary(' ' + SUMMARY_JA + '\n', TEXT, TITLE), SUMMARY_JA)
        self.assertEqual(company_wire.validated_summary(SUMMARY_JA, '', TITLE), '', 'no English text: no summary')
        self.assertEqual(company_wire.validated_summary(None, TEXT, TITLE), '')
        self.assertEqual(company_wire.validated_summary('メタは2027年に控訴する。', TEXT, TITLE), '', 'an invented year')
        self.assertEqual(company_wire.validated_summary('メタとGoogleに制裁金。', TEXT, TITLE), '', 'an invented name')

    def test_summary_text_is_one_bounded_paragraph(self):
        self.assertEqual(company_wire.summary_text('  Line one.\n\n Line  two. '), 'Line one. Line two.')
        self.assertEqual(company_wire.summary_text(None), '')
        self.assertEqual(company_wire.summary_text('a\x00b'), 'ab')
        long = ('Meta was fined by the regulator in Italy. ' * 40).strip()
        cut = company_wire.summary_text(long)
        self.assertLessEqual(len(cut), company_wire.SUMMARY_EN_MAX)
        self.assertTrue(cut.endswith('Italy.'))
        words = company_wire.summary_text('word ' * 400)
        self.assertLessEqual(len(words), company_wire.SUMMARY_EN_MAX)
        self.assertTrue(words.endswith('word…'))


class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = stock_news.connect(Path(self.tmp.name) / 'news.sqlite')
        self.env = patch.dict(os.environ, {'STOCK_NEWS_ENABLED': 'true', 'STOCK_NEWS_API_KEY': 'synthetic-key', 'STOCK_NEWS_TO_HOME': 'true',
                                           'STOCK_NEWS_STREAMS': 'tech', 'STOCK_NEWS_ITEMS': '10'})
        self.env.start()

    def tearDown(self):
        self.env.stop(); self.db.close(); self.tmp.cleanup()

    def test_the_article_text_reaches_the_company_headline_table(self):
        rows = [{'news_url': 'https://reuters.example/meta', 'title': TITLE, 'text': TEXT, 'source_name': 'Reuters',
                 'date': 'Sun, 15 Nov 2026 01:00:00 +0000', 'tickers': ['META']}]
        self.assertEqual(stock_news.poll_stream(self.db, 'tech', transport=lambda *_: rows)['mirrored'], 1)
        self.assertEqual(self.db.execute('SELECT summary_en FROM company_wire').fetchone()[0], TEXT)


if __name__ == '__main__':
    unittest.main()
