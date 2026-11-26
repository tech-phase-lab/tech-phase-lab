"""The next quarter's 決算の深掘り, drafted by a model: off by default, published only when check_dives and the cross-checks pass (owner, Nov 26).
No network and no model: the 'model' answers with the committed NVDA file (a draft known to pass) or a broken copy of it."""
import copy
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import check_dives  # noqa: E402
import earnings_dive_generate as gen  # noqa: E402
import earnings_patrol as patrol  # noqa: E402
import monitor  # noqa: E402

NOW = datetime(2026, 11, 18, 0, 0, tzinfo=timezone.utc)
DRAFT = json.loads((ROOT / 'lib/research/dives/NVDA.json').read_text(encoding='utf-8'))
TEXTS = {url: ' '.join(lines) for url, lines in check_dives.read_fixture(ROOT / 'tests/fixtures/dives/NVDA-source.txt').items()}
# The file one quarter earlier, as far as the checks read it: its quarter, its period end and its revenue (the draft's last history bar).
PREVIOUS = {'ticker': 'NVDA', 'period': 'Q2 FY2027', 'periodEnd': '2026-07-26', 'numbers': {'revenue': {'current': 96221}}, 'evidence': []}
RELEASE = {'url': DRAFT['sources'][0]['url'], 'accession': '0001045810-26-000088', 'releasedOn': '2026-11-17', 'period': 'Q3 FY2027',
           'facts': {'revenue': {'value': '$115.8B', 'label': 'Revenue'}}, 'text': TEXTS[DRAFT['sources'][0]['url']]}


def answering(draft):
    calls = []

    def transport(payload):
        calls.append(payload)
        return {'status': 'completed', 'usage': {'input_tokens': 30000, 'output_tokens': 11000},
                'output': [{'type': 'message', 'content': [{'type': 'output_text', 'text': json.dumps(draft, ensure_ascii=False)}]}]}
    return transport, calls


class DiveGeneration(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'

    def generate(self, draft):
        transport, calls = answering(draft)
        with monitor.connect(self.path) as db:
            state = gen.generate(db, 'NVDA', dict(RELEASE), transport, 'model-x', NOW, previous=PREVIOUS, texts=dict(TEXTS))
        return state, calls

    def test_off_unless_the_owner_turns_it_on(self):
        self.assertFalse(gen.enabled({}))
        self.assertFalse(gen.enabled({'EARNINGS_DIVE_AI': 'yes please'}))
        self.assertTrue(gen.enabled({'EARNINGS_DIVE_AI': 'true'}))
        with monitor.connect(self.path) as db:
            self.assertEqual(patrol.draft_dives(db, {'NVDA:release': RELEASE}, NOW, transport=lambda p: 1 / 0, env={}), [])

    def test_a_draft_that_passes_every_check_is_published_and_the_call_is_counted(self):
        state, calls = self.generate(DRAFT)
        self.assertEqual(state, 'passed')
        self.assertEqual(len(calls), 1)
        payload = json.loads(calls[0]['input'])
        self.assertEqual(payload['releaseUrl'], RELEASE['url'])
        self.assertLessEqual(len(payload['releaseText']), gen.MAX_RELEASE_CHARS)
        with monitor.connect(self.path) as db:
            self.assertEqual(gen.published(db)['NVDA']['period'], 'Q3 FY2027')
            usage = db.execute("SELECT lane,input_tokens,output_tokens FROM llm_usage").fetchone()
            self.assertEqual(tuple(usage), ('earnings-dive', 30000, 11000))
            # a passed release is never drafted again
            self.assertEqual(gen.generate(db, 'NVDA', dict(RELEASE), lambda p: 1 / 0, 'model-x', NOW, previous=PREVIOUS), 'passed')

    def test_a_number_not_in_the_release_or_another_quarter_is_never_published_and_the_owner_is_alerted(self):
        wrong = copy.deepcopy(DRAFT)
        wrong['numbers']['revenue']['current'] = 118800
        state, _ = self.generate(wrong)
        self.assertEqual(state, 'failed')
        old = copy.deepcopy(DRAFT)
        old['period'] = 'Q2 FY2027'
        state, _ = self.generate(old)
        self.assertEqual(state, 'failed')
        with monitor.connect(self.path) as db:
            self.assertEqual(gen.published(db), {})
            errors = [json.loads(r[0]) for r in db.execute('SELECT errors FROM generated_dives ORDER BY attempt')]
            self.assertIn('revenue differs from the deterministic reading of the release', errors[0])
            self.assertTrue(any('number does not match its quote' in e for e in errors[0]))
            self.assertIn("period is not the release's quarter", errors[1])
            incident = db.execute("SELECT status,last_error_code FROM operational_incidents WHERE category='earnings-dive'").fetchone()
            self.assertEqual(tuple(incident), ('open', 'checks-failed'))
            # two calls per release at most
            self.assertEqual(gen.generate(db, 'NVDA', dict(RELEASE), lambda p: 1 / 0, 'model-x', NOW, previous=PREVIOUS), 'exhausted')

    def test_advice_wording_and_a_broken_history_are_rejected(self):
        bad = copy.deepcopy(DRAFT)
        bad['summary']['conclusion'][0]['en'] += ' Investors should buy.'
        bad['history'][-1]['value'] = 90000
        with monitor.connect(self.path) as db:
            problems = gen.checks('NVDA', bad, RELEASE, PREVIOUS, dict(TEXTS))
        self.assertIn('history does not continue the previous file', problems)
        self.assertTrue(any('advice or rating' in p for p in problems))

    def test_a_draft_is_due_only_for_a_release_newer_than_the_committed_file(self):
        folder = Path(self.tmp.name) / 'dives'
        folder.mkdir()
        (folder / 'NVDA.json').write_text(json.dumps(PREVIOUS), encoding='utf-8')
        with monitor.connect(self.path) as db:
            self.assertEqual(gen.due({'NVDA:release': RELEASE, 'AMD:release': None}, db, folder), ['NVDA'])
            (folder / 'NVDA.json').write_text(json.dumps({**PREVIOUS, 'period': 'Q3 FY2027'}), encoding='utf-8')
            self.assertEqual(gen.due({'NVDA:release': RELEASE}, db, folder), [])

    def test_the_monitor_image_carries_the_committed_dives_it_continues(self):
        self.assertIn('COPY lib/research/dives lib/research/dives', (ROOT / 'Dockerfile.research-monitor').read_text(encoding='utf-8'))
        self.assertEqual(gen.DIVES, ROOT / 'lib/research/dives')


if __name__ == '__main__':
    unittest.main()
