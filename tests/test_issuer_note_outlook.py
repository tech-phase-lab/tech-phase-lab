"""Note-specific "still unknown" / "next checkpoint" lines for issuer notes (owner, Nov 18)."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import official_research as research
import issuer_note_outlook as outlook
from test_headline_translation import ENV
from test_official_research import NOW, URL, TITLE, QUOTES, NOTE

PLAN = 'Nebius plans to make the Inferize technology available to Token Factory customers in the first quarter of 2027.'
BODY = ' '.join(QUOTES) + ' ' + PLAN + ' ' + ('Company announcement background. ' * 50)
QUESTION = {'ja': 'Inferizeの買収金額は明らかにしていない。',
            'en': 'The release does not disclose the price Nebius paid for Inferize.', 'topic': 'price'}
CHECKPOINT = {'ja': 'NebiusはInferizeの技術を2027年第1四半期にToken Factoryの顧客へ提供する計画だ。',
              'en': PLAN}


def excerpt_id(excerpts, text):
    return next(key for key, value in excerpts.items() if text in value)


class IssuerNoteOutlookTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'
        self.body(BODY)
        self.calls = []

    def body(self, body):
        with research.connect(self.path) as db:
            if not db.execute('SELECT 1 FROM sources').fetchone():
                db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)',
                           (URL, 'NBIS', TITLE, '2026-10-01', NOW.isoformat(), 'body-v1'))
                db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (URL, 'NBIS', NOW.isoformat()))
                db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                           (URL, 'body-v1', NOW.isoformat(), body, len(body)))
            else:
                db.execute('UPDATE source_revisions SET extracted_text=?,extracted_chars=?', (body, len(body)))

    def transport(self, question=QUESTION, checkpoint=CHECKPOINT, question_text=QUOTES[0], checkpoint_text=PLAN):
        def send(payload, key):
            self.calls.append(payload)
            excerpts = json.loads(payload['input'])['evidenceExcerpts']
            value = json.loads(json.dumps(NOTE))
            if question is not None:
                value['openQuestion'] = {**question, 'evidenceId': excerpt_id(excerpts, question_text)}
            if checkpoint is not None:
                value['nextCheckpoint'] = {**checkpoint, 'evidenceId': excerpt_id(excerpts, checkpoint_text)}
            return {'status': 'completed', 'output': [{'type': 'message', 'content': [
                {'type': 'output_text', 'text': json.dumps(value, ensure_ascii=False)}]}]}
        return send

    def publish(self, **changes):
        self.assertEqual(research.run_once(self.path, self.transport(**changes), ENV, NOW.timestamp()), 'done')
        with research.connect(self.path) as db:
            [item] = research.feed(db, NOW)
        return item

    def test_lines_are_written_in_the_same_call_and_published_after_checks(self):
        item = self.publish()
        self.assertEqual(len(self.calls), 1)
        payload = self.calls[0]
        schema = payload['text']['format']['schema']
        self.assertIn('openQuestion', schema['required'])
        self.assertIn('nextCheckpoint', schema['required'])
        self.assertIn('openQuestion', payload['instructions'])
        self.assertEqual(json.loads(payload['input'])['kind'], 'acquisition')
        self.assertEqual(item['unknown'], {'ja': QUESTION['ja'], 'en': QUESTION['en']})
        self.assertEqual(item['next'], {'ja': CHECKPOINT['ja'], 'en': CHECKPOINT['en']})
        self.assertNotIn('evidenceQuote', json.dumps(item))
        self.assertNotIn('topic', item)

    def test_a_rejected_line_is_dropped_without_holding_the_note(self):
        cases = {
            'number not in source': dict(question={**QUESTION, 'ja': 'Inferizeの買収金額2億ドルの内訳は明らかにしていない。',
                                                   'en': 'The release does not disclose the breakdown of the $200 million price.'}),
            'advice': dict(question={**QUESTION, 'ja': '株価への影響は明らかにしていない。',
                                     'en': 'The release does not disclose the effect on the share price.'}),
            'forecast': dict(question={**QUESTION, 'ja': '利益を押し上げる規模は明らかにしていない。',
                                       'en': 'The release does not disclose how much the deal will boost profit.'}),
            'not phrased as undisclosed': dict(question={**QUESTION, 'ja': '買収金額は大きい。', 'en': 'The price is large.'}),
            'unknown evidence id': dict(question={**QUESTION, 'evidenceId': 'missing'}),
        }
        for name, change in cases.items():
            with self.subTest(name):
                self.setUp()
                if name == 'unknown evidence id':
                    def send(payload, key, base=self.transport()):
                        result = base(payload, key)
                        value = json.loads(result['output'][0]['content'][0]['text'])
                        value['openQuestion']['evidenceId'] = 'missing'
                        result['output'][0]['content'][0]['text'] = json.dumps(value, ensure_ascii=False)
                        return result
                    self.assertEqual(research.run_once(self.path, send, ENV, NOW.timestamp()), 'done')
                    with research.connect(self.path) as db:
                        [item] = research.feed(db, NOW)
                else:
                    item = self.publish(**change)
                self.assertNotIn('unknown', item)
                self.assertEqual(item['next']['ja'], CHECKPOINT['ja'])
                self.assertEqual(len(item['facts']), 3)

    def test_a_disclosed_topic_cannot_be_called_unknown(self):
        self.body(BODY + ' Nebius acquired Inferize for approximately $120 million in cash.')
        item = self.publish()
        self.assertNotIn('unknown', item)
        self.assertIn('next', item)

    def test_checkpoint_must_be_a_source_supported_future_milestone(self):
        invented_date = {'ja': 'NebiusはInferizeの技術を2028年第1四半期にToken Factoryの顧客へ提供する計画だ。',
                         'en': PLAN.replace('2027', '2028')}
        item = self.publish(checkpoint=invented_date)
        self.assertNotIn('next', item)
        self.assertIn('unknown', item)
        self.setUp()
        past = {'ja': 'Inferizeの技術とチームはToken Factoryに加わった。',
                'en': "Inferize's technology and team have joined Nebius Token Factory."}
        item = self.publish(checkpoint=past, checkpoint_text=QUOTES[1])
        self.assertNotIn('next', item)

    def test_answers_without_the_lines_still_publish_the_note(self):
        item = self.publish(question=None, checkpoint=None)
        self.assertNotIn('unknown', item)
        self.assertNotIn('next', item)
        self.assertEqual(item['title']['en'], 'Nebius acquires Inferize')

    def test_stored_lines_are_checked_again_before_every_feed(self):
        self.publish()
        with research.connect(self.path) as db:
            payload = json.loads(db.execute('SELECT payload FROM official_research_publications').fetchone()[0])
            payload['outlook']['openQuestion']['ja'] = 'Inferizeの買収金額3億ドルは明らかにしていない。'
            db.execute('UPDATE official_research_publications SET payload=?', (json.dumps(payload, ensure_ascii=False),))
            [item] = research.feed(db, NOW)
        self.assertNotIn('unknown', item)
        self.assertIn('next', item)

    def test_only_company_releases_ask_for_the_lines(self):
        self.assertTrue(outlook.enabled({'source_id': 'primary-ir-NBIS'}))
        for row in ({'source_id': 'nebius-blog'}, {'source_id': 'primary-ir-NBIS', 'issuer_business': True},
                    {'source_id': 'primary-ir-NBIS', 'general_source': True}):
            self.assertFalse(outlook.enabled(row))
        self.assertEqual([outlook.release_kind(t) for t in (
            'Nebius acquires Inferize', 'Micron Reports Results for the Fourth Quarter',
            'Arm and Meta sign agreement', 'NVIDIA launches Rubin')],
            ['acquisition', 'earnings', 'partnership', 'product'])
        schema = outlook.extend_schema(research.response_schema())
        self.assertEqual(research.response_schema()['required'], ['title', 'summary', 'facts', 'purpose'])
        self.assertEqual(schema['properties']['openQuestion']['properties']['topic']['enum'], list(outlook.TOPICS))


if __name__ == '__main__':
    unittest.main()
