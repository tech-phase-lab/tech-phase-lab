"""The 決算の深掘り data files (lib/research/dives/*.json) keep to their contract, and the check catches what it should."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import check_dives  # noqa: E402

DIVES = sorted((ROOT / 'lib/research/dives').glob('*.json'))


class DivesContractTests(unittest.TestCase):
    def test_every_dive_file_passes_the_check(self):
        self.assertTrue(DIVES, 'no lib/research/dives/*.json files')
        self.assertEqual(check_dives.check([str(p) for p in DIVES]), [])

    def test_every_dive_has_a_trimmed_cached_source(self):
        for path in DIVES:
            fixture = ROOT / 'tests/fixtures/dives' / f'{path.stem}-source.txt'
            self.assertTrue(fixture.exists(), fixture)
            self.assertLess(fixture.stat().st_size, 60_000, f'{fixture.name} should hold excerpts, not the whole filing')


class CheckCatchesProblems(unittest.TestCase):
    """Each broken copy of NVDA.json must be reported."""

    @classmethod
    def setUpClass(cls):
        cls.base = json.loads((ROOT / 'lib/research/dives/NVDA.json').read_text(encoding='utf-8'))

    def errors(self, change):
        dive = copy.deepcopy(self.base)
        change(dive)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'NVDA.json'
            path.write_text(json.dumps(dive, ensure_ascii=False), encoding='utf-8')
            return check_dives.Checker(path).run()

    def assertReported(self, change, text):
        errors = self.errors(change)
        self.assertTrue(any(text in e for e in errors), f'expected {text!r} in {errors}')

    def test_unchanged_copy_passes(self):
        self.assertEqual(self.errors(lambda d: None), [])

    def test_number_that_does_not_match_its_quote(self):
        self.assertReported(lambda d: d['numbers']['revenue'].update(current=115845), 'numbers.revenue.current: number does not match')

    def test_calc_result_that_does_not_match(self):
        self.assertReported(lambda d: d['numbers']['guidance'].update(low=126000), 'numbers.guidance.low: number does not match')

    def test_quote_not_in_the_source(self):
        def change(d):
            d['evidence'][0]['quote'] = 'Revenue $ 115,844 $ 57,007'
        self.assertReported(change, 'quote not found')

    def test_number_without_evidence(self):
        self.assertReported(lambda d: d.update(evidence=[e for e in d['evidence'] if e['field'] != 'numbers.adjustedEPS']), 'numbers.adjustedEPS has no evidence entry')

    def test_calc_with_a_figure_that_is_not_quoted(self):
        def change(d):
            for e in d['evidence']:
                if e['field'] == 'numbers.guidance.low':
                    e['calc'] = '126.1*1000'
        self.assertReported(change, 'figure 126.1 in calc is not in the quote')

    def test_section_and_chip_counts(self):
        self.assertReported(lambda d: d['summary']['cards']['next']['sections'].pop(), 'summary.cards.next.sections needs 3-4 items')
        self.assertReported(lambda d: d['summary']['cards']['growth'].update(chips=[]), 'summary.cards.growth.chips needs 1-3 items')
        self.assertReported(lambda d: d['summary']['cards'].pop('caution'), 'summary.cards.caution is missing')
        self.assertReported(lambda d: d['summary'].update(conclusion=[]), 'summary.conclusion needs 1-3 items')

    def test_tiles_and_history(self):
        self.assertReported(lambda d: d['tiles'].pop(), 'tiles needs exactly 3 items')
        self.assertReported(lambda d: d['history'].pop(0), 'history needs at least 4 earlier quarters')
        self.assertReported(lambda d: d['history'][3].update(label='Q1'), 'history labels must be consecutive')

    def test_missing_fields_and_copy_rules(self):
        self.assertReported(lambda d: d.pop('releasedOn'), 'releasedOn must be YYYY-MM-DD')
        self.assertReported(lambda d: d['numbers'].pop('guidance'), 'numbers.guidance is missing')
        self.assertReported(lambda d: d['summary']['conclusion'][0].update(ja='売上は$115.8 billionでした。'), 'Japanese money units')
        self.assertReported(lambda d: d['summary']['conclusion'][0].update(ja='今が買い時です。'), 'advice or rating wording')


if __name__ == '__main__':
    unittest.main()
