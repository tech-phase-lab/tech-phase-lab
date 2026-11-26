"""The next quarter's 決算の深掘り without a second model call (owner, Nov 26): MU's own template over the parsed figures, then the
release's existing deep analysis (#693, the one approved call per release). check_dives and the cross-checks before publishing."""
import copy
import gzip
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import brief_generator  # noqa: E402
import check_dives  # noqa: E402
import deep_analysis  # noqa: E402
import earnings_dive_generate as gen  # noqa: E402
import earnings_patrol as patrol  # noqa: E402
import monitor  # noqa: E402

NOW = datetime(2026, 11, 18, 0, 0, tzinfo=timezone.utc)
ACCEPTED = datetime(2026, 11, 17, 21, 20, tzinfo=timezone.utc)
DIVE = json.loads((ROOT / 'lib/research/dives/NVDA.json').read_text(encoding='utf-8'))
TEXT = gzip.open(ROOT / 'tests/fixtures/latest-releases/NVDA.txt.gz', 'rt').read()
FIXTURE = check_dives.read_fixture(ROOT / 'tests/fixtures/dives/NVDA-source.txt')
URL = DIVE['sources'][0]['url']


def previous_file():
    """The Q2 FY2027 file as the committed Q3 file records it: its last history bar and the quotes behind it."""
    h, ev = DIVE['history'], {e['field']: e for e in DIVE['evidence']}
    prev = copy.deepcopy(DIVE)
    prev.update(period='Q2 FY2027', periodQuarter=2, periodEnd=h[-1]['end'],
                history=[{'label': 'Q1', 'end': '2025-04-27', 'value': 1}] + h[:-1])
    prev['numbers'] = {**DIVE['numbers'], 'revenue': {'current': h[-1]['value']}, 'grossMargin': None}
    prev['evidence'] = [{**ev[f'history[{len(h) - 1}].value'], 'field': 'numbers.revenue.current'}] + \
        [{**ev[f'history[{i}].value'], 'field': f'history[{i + 1}].value'} for i in range(len(h) - 1)]
    return prev


PREVIOUS = previous_file()


def release():
    read = patrol.latest_release('NVDA', {'filings': {'recent': {'form': ['8-K'], 'acceptanceDateTime': ['2026-11-17T21:20:00.000Z'],
                                 'items': ['2.02'], 'accessionNumber': ['0001045810-26-000088'], 'primaryDocument': ['x']}}},
                                 NOW, exhibit=lambda *a: (URL, TEXT), primary=lambda *a: None)
    read['releasedOn'] = '2026-11-17'
    return read


# A research note in deep_analysis.bind's stored shape (#693): what the one approved call per release leaves in deep_analyses.
NOTE = {'headline': {'ja': 'データセンター需要はどこまで続くか', 'en': 'How far does data center demand run?'},
        'summary': {'ja': 'データセンター向けが売上の大半を占め、前期から増えました。', 'en': 'Data Center made up most of revenue and grew from last quarter.'},
        'sections': [{'heading': {'ja': '需要の広がり', 'en': 'Broader demand'}, 'ja': '大手クラウド以外の顧客からの売上も増えたと会社は説明しています。',
                      'en': 'The company says revenue from customers beyond the largest clouds also grew.'},
                     {'heading': None, 'ja': '新しい製品の出荷が始まったと会社は述べています。', 'en': 'The company says shipments of its new platform have begun.'},
                     {'heading': None, 'ja': '粗利益率は前期とほぼ同じ水準でした。', 'en': 'Gross margin was at about the same level as last quarter.'},
                     {'heading': None, 'ja': '会社は自社株買いと配当を続けています。', 'en': 'The company continues its buybacks and dividends.'}],
        'scenarios': [{'case': 'base', 'ja': '出荷が予定どおり進むなら、見通しの幅に沿った売上になります。', 'en': 'If shipments proceed as planned, revenue would track the outlook range.'},
                      {'case': 'reassessment', 'ja': '中国向けの扱いが変わる場合は、見通しの前提を見直す必要があります。',
                       'en': 'If treatment of China changes, the outlook assumptions would need a second look.'}],
        'unknowns': [{'ja': '顧客ごとの売上内訳は開示されていません。', 'en': 'Revenue by customer is not disclosed.'},
                     {'ja': '新製品の採算は資料に記載がありません。', 'en': 'The release does not state the new platform\'s profitability.'}],
        'next': [{'ja': '次の決算で、見通しの幅に対する実績を確かめたい。', 'en': 'Check results against the outlook range in the next report.'},
                 {'ja': '新製品の出荷量の推移を確かめたい。', 'en': 'Check how new platform shipments develop.'}]}


class DiveWithoutModel(unittest.TestCase):
    def setUp(self):
        # The general path (MU's template plus the release's deep analysis), for a company without its own writer: NVIDIA has one now
        # (dive_writers, Nov 26), so it is taken out of the writers for these tests; tests/test_dive_parity.py covers its writer.
        import dive_writers
        from unittest import mock
        patcher = mock.patch.dict(dive_writers.WRITERS)
        patcher.start()
        self.addCleanup(patcher.stop)
        dive_writers.WRITERS.pop('NVDA')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'
        with monitor.connect(self.path) as db:
            deep_analysis.schema(db)
            db.execute("INSERT INTO deep_analyses(source_ref,kind,subject,source_sha,state,attempts,next_at,model,payload,created_at,published_at,source_url) "
                       "VALUES('event:1:x','earnings','NVDA','x','done',1,0,'approved-model',?,?,?,?)",
                       (json.dumps(NOTE, ensure_ascii=False), '2026-11-17T21:23:00+00:00', '2026-11-17T21:25:00+00:00', URL))

    def texts(self):
        texts = {URL: check_dives.normalize(TEXT)}
        for e in PREVIOUS['evidence']:
            texts[e['url']] = (texts.get(e['url'], '') + ' ' + ' '.join(FIXTURE.get(e['url'], [])) + ' ' + check_dives.normalize(e['quote'])).strip()
        return texts

    def test_on_unless_turned_off(self):
        self.assertTrue(gen.enabled({}))
        self.assertFalse(gen.enabled({'EARNINGS_DIVE_AUTO': 'false'}))

    def test_the_draft_reuses_the_releases_deep_analysis_and_makes_no_model_call(self):
        calls = []
        with mock.patch.object(brief_generator, 'request_response', side_effect=lambda *a, **k: calls.append(a) or {}), \
                mock.patch.object(deep_analysis, 'run_once', side_effect=lambda *a, **k: calls.append(a) or 'idle'):
            with monitor.connect(self.path) as db:
                note = gen.stored_analysis(db, 'NVDA', ACCEPTED)
                self.assertEqual(note['summary'], NOTE['summary'])
                draft = gen.build('NVDA', release(), PREVIOUS, note, '2026-11-18')
                problems = gen.checks('NVDA', draft, release(), PREVIOUS, self.texts())
                usage = db.execute("SELECT count(*) FROM sqlite_master WHERE name='llm_usage'").fetchone()[0]
                spent = db.execute('SELECT count(*) FROM llm_usage').fetchone()[0] if usage else 0
        self.assertEqual(problems, [])
        self.assertEqual(calls, [], 'no model call of any kind for the dive')
        self.assertEqual(spent, 0, 'nothing is added to llm_usage: the release keeps its one approved deep-analysis call')
        # the analysis text is used as written (only the site's copy rules apply); the figures come from the release
        texts = json.dumps(draft['summary'], ensure_ascii=False)
        self.assertIn(NOTE['sections'][0]['ja'], texts)
        self.assertIn(NOTE['unknowns'][0]['ja'], texts)
        self.assertEqual(draft['numbers']['revenue']['current'], 115800.0)
        self.assertEqual(draft['period'], 'Q3 FY2027')
        self.assertEqual(draft['periodEnd'], '2026-10-25')
        for card in draft['summary']['cards'].values():
            self.assertGreaterEqual(len(card['sections']), 3)

    def test_one_release_one_model_call_whatever_the_dive_does(self):
        """Counts every model call a release causes: the deep analysis (one, approved) and the dive (none)."""
        answered = {'status': 'completed', 'usage': {'input_tokens': 1, 'output_tokens': 1}, 'output': []}
        calls = []
        with mock.patch.object(brief_generator, 'request_response', side_effect=lambda *a, **k: calls.append('model') or answered):
            with monitor.connect(self.path) as db:
                results = {'NVDA:release': {**release(), 'accepted': ACCEPTED}}
                with mock.patch.object(gen, 'previous_dive', return_value=PREVIOUS), mock.patch.object(gen, 'DIVES', ROOT / 'lib/research/dives'):
                    patrol.draft_dives(db, results, NOW)
                    patrol.draft_dives(db, results, NOW)  # every later patrol: still no call
        self.assertEqual(calls, [])

    def test_a_wrong_number_or_another_quarter_is_never_published_and_the_owner_is_alerted(self):
        wrong = release()
        wrong['facts']['revenue'] = {'value': '$118.8B', 'label': 'Revenue'}
        with monitor.connect(self.path) as db:
            self.assertEqual(gen.generate(db, 'NVDA', wrong, NOW, previous=PREVIOUS), 'failed')
            self.assertEqual(gen.published(db), {})
            incident = db.execute("SELECT status,last_error_code FROM operational_incidents WHERE category='earnings-dive'").fetchone()
            self.assertEqual(tuple(incident), ('open', 'checks-failed'))
        draft = gen.build('NVDA', release(), PREVIOUS, NOTE, '2026-11-18')
        old = {**draft, 'period': 'Q2 FY2027'}
        self.assertIn("period is not the release's quarter", gen.checks('NVDA', old, release(), PREVIOUS, self.texts()))
        bad = copy.deepcopy(draft)
        bad['summary']['conclusion'][0]['en'] += ' Investors should buy.'
        bad['history'][-1]['value'] = 90000
        problems = gen.checks('NVDA', bad, release(), PREVIOUS, self.texts())
        self.assertIn('history does not continue the previous file', problems)
        self.assertTrue(any('advice or rating' in p for p in problems))

    def test_without_the_deep_analysis_the_dive_waits_and_nothing_is_stored(self):
        with monitor.connect(self.path) as db:
            db.execute('DELETE FROM deep_analyses')
            self.assertEqual(gen.generate(db, 'NVDA', {**release(), 'accepted': ACCEPTED}, NOW, previous=PREVIOUS), 'waiting')
            self.assertEqual(db.execute('SELECT count(*) FROM generated_dives').fetchone()[0], 0)

    def test_mu_template_is_the_first_source_and_its_unit_follows_the_currency(self):
        n = {'revenue': {'current': 11662.0, 'previous': 9330.0, 'yearAgo': None}, 'adjustedEPS': None, 'epsEstimate': None,
             'grossMargin': {'current': 57.5, 'previous': 54.0}, 'guidance': {'low': 14200.0, 'high': 15200.0, 'grossMarginPercent': None},
             'segments': None}
        out = gen.mu_template(n, 'EUR', gen.margin_label({'grossMargin': 'US GAAP (no adjusted measure)'}))
        text = json.dumps(out, ensure_ascii=False)
        self.assertIn('億ユーロ', text)
        self.assertNotIn('億ドル', text)
        self.assertNotIn('調整後粗利益率', text)
        self.assertIn('粗利益率(GAAP)', text)
        self.assertIsNone(gen.mu_template(n, 'KRW', gen.margin_label(None)))

    def test_the_monitor_image_carries_the_committed_dives_it_continues(self):
        self.assertIn('COPY lib/research/dives lib/research/dives', (ROOT / 'Dockerfile.research-monitor').read_text(encoding='utf-8'))
        self.assertEqual(gen.DIVES, ROOT / 'lib/research/dives')


if __name__ == '__main__':
    unittest.main()
