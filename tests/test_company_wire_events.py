"""Owner, Nov 21 (「まだまだいらない記事ありそう。精査は難しいですか？」): the translation call also names the headline's concrete event.
A headline judged news but with no concrete event (a GF Score template, an explainer, a prediction...) is never published; it is
stored with its reason and counted on /health. A missing or unknown event, or a failed call, changes nothing (fail-open)."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402
import monitor  # noqa: E402

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'k' * 30, 'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'test-model'}
GF = 'Credo Technology Group Holding Ltd (CRDO) Stock Down 8.2% -- Now Undervalued? GF Score: 77/100'
DEAL = 'Credo signs a multiyear supply contract with Microsoft'
SPLIT = 'Sandisk 8-for-1 stock split takes effect'
ETF = '14 ETFs Add to ASML Holding (ASML) on Nov. 18'
CRASH = 'VIEW Nasdaq plunges 5% a day after Anthropic debut, but investors still believe in AI'


def answering(seen, events, fail=False):
    """A model stand-in: every headline is news; ``events`` maps an English title to its event (absent: no event field at all)."""
    def send(payload, key):
        seen.append(payload)
        if fail:
            raise TimeoutError('slow')
        items = json.loads(payload['input'])
        out = []
        for i in items:
            item = {'id': i['id'], 'titleJa': 'クレドの見出し', 'shortJa': 'クレドの見出し', 'kind': 'news'}
            if i['title'] in events:
                item['event'] = events[i['title']]
            out.append(item)
        return {'status': 'completed', 'usage': {'input_tokens': 100, 'output_tokens': 20},
                'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'items': out}, ensure_ascii=False)}]}]}
    return send


class EventJudgmentTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'db.sqlite')
        self.now = datetime(2026, 11, 21, 3, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.dir.cleanup()

    def store(self, titles):
        with company_wire.connect(self.path) as db:
            for n, title in enumerate(titles):
                company_wire.store(db, [{'ticker': 'CRDO', 'source': 'stocknews', 'title': title, 'publisher': 'Reuters',
                                         'url': 'https://news.example/%d' % n, 'published': self.now - timedelta(minutes=10 + n)}],
                                   'Credo', seen_at=self.now)

    def translate(self, transport):
        return company_wire.translate_once(self.path, transport=transport, env=ENV, now_ts=self.now.timestamp())

    def shown(self):
        with company_wire.connect(self.path) as db:
            return [i['titleEn'] for i in company_wire.public_feed(db, now_ts=self.now.timestamp())['items'].get('CRDO', [])]

    def reasons(self):
        with company_wire.connect(self.path) as db:
            return {r[0]: (r[1], r[2]) for r in db.execute(
                'SELECT w.title, a.reason, a.attempts FROM company_wire w JOIN company_wire_article_attempts a ON a.article=w.article')}

    def health(self):
        with monitor.connect(self.path) as db:
            return company_wire.translation_health(db, self.now.timestamp(), ENV)['daily']['today']

    def test_the_prompt_and_schema_ask_for_the_event_in_the_same_call(self):
        seen = []
        self.store([DEAL])
        self.assertEqual(self.translate(answering(seen, {DEAL: 'contract'})), 'done')
        self.assertEqual(len(seen), 1, 'one call, as before')
        payload = seen[0]
        fields = payload['text']['format']['schema']['properties']['items']['items']
        self.assertIn('event', fields['required'])
        self.assertEqual(fields['properties']['event']['enum'], list(company_wire.EVENT_KEEP + company_wire.EVENT_DROP))
        for phrase in ('GF Score', 'price-target', 'split taking effect', 'index inclusion', 'live blog', 'personal-finance',
                       'what it means', 'listicle', 'prediction', 'For not-news or off-topic, write no-event.',
                       'index-level move', '5% or more', 'large options trade', 'pure forecast', 'under 5%',
                       'results-date notices'):
            self.assertIn(phrase, payload['instructions'])
        self.assertFalse(set(company_wire.EVENT_KEEP) & set(company_wire.EVENT_DROP))

    def test_news_with_no_concrete_event_is_not_published_but_kept_with_its_reason_and_counted(self):
        self.store([GF, DEAL, SPLIT, ETF, CRASH])
        self.translate(answering([], {GF: 'score-template', DEAL: 'contract', SPLIT: 'corporate-action', ETF: 'no-event',
                                      CRASH: 'market-move'}))
        self.assertEqual(sorted(self.shown()), sorted([DEAL, SPLIT, CRASH]), 'an index-level move (HQ, Nov 21) is kept')
        reasons = self.reasons()
        self.assertEqual(reasons[GF], ('not-event:score-template', company_wire.TRANSLATION_ATTEMPTS), 'stored for audit, never retried')
        self.assertEqual(reasons[ETF], ('not-event:no-event', company_wire.TRANSLATION_ATTEMPTS))
        with company_wire.connect(self.path) as db:
            self.assertEqual(company_wire.pending_rows(db, self.now.timestamp() + 3600), [], 'not sent again')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM company_wire_article_ja').fetchone()[0], 3, 'no Japanese is written for them')
        today = self.health()
        self.assertEqual(today['judgedNoEvent'], 2)
        self.assertEqual(today['noEventByReason'], {'no-event': 1, 'score-template': 1})
        self.assertEqual(today['judgedNotNews'], 0, 'not-news keeps its own count')
        self.assertEqual(today['translated'], 3)

    def test_fail_open_a_missing_or_unknown_event_publishes_as_before(self):
        self.store([GF, DEAL])
        self.translate(answering([], {DEAL: 'something-new'}))  # GF has no event field at all
        self.assertEqual(sorted(self.shown()), sorted([GF, DEAL]))
        self.assertEqual(self.health()['judgedNoEvent'], 0)
        self.assertIsNone(company_wire.no_event({'event': None}))
        self.assertIsNone(company_wire.no_event(None))
        self.assertEqual(company_wire.no_event({'event': 'opinion'}), 'opinion')

    def test_fail_open_a_failed_call_hides_nothing_and_is_retried(self):
        self.store([GF])
        self.assertTrue(self.translate(answering([], {}, fail=True)).startswith('model-'))
        self.assertEqual(self.reasons()[GF][0], 'model-TimeoutError')
        self.assertEqual(self.health()['judgedNoEvent'], 0)
        self.translate(answering([], {}))
        self.assertEqual(self.shown(), [GF])

    def test_not_news_and_off_topic_keep_their_own_reason(self):
        self.store([GF])

        def send(payload, key):
            items = json.loads(payload['input'])
            out = [{'id': i['id'], 'titleJa': 'x', 'shortJa': 'x', 'kind': 'not-news', 'event': 'score-template'} for i in items]
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps({'items': out})}]}]}
        self.translate(send)
        self.assertEqual(self.reasons()[GF][0], 'not-news')
        today = self.health()
        self.assertEqual((today['judgedNotNews'], today['judgedNoEvent']), (1, 0))


if __name__ == '__main__':
    unittest.main()
