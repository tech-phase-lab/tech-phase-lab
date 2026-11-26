"""Depth parity of the automatic 決算の深掘り with each company's hand-made file (owner, Nov 26: as deep as the hand-made dives).

For every company with a writer (dive_writers.WRITERS), the dive built from its last release (tests/fixtures/latest-releases) must
have the hand-made file's cards, each card's sections (same keys), at least as many chips, the same number of conclusion paragraphs
and tiles, and the same kinds of figures in `numbers`; it must pass check_dives. Where the hand-made file used something the release
does not carry (the 10-Q, another filing), the gap is listed in GAPS and checked to stay exactly that.
"""
import copy
import gzip
import json
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import check_dives  # noqa: E402
import dive_writers  # noqa: E402
import earnings_dive_generate as gen  # noqa: E402
import earnings_patrol as patrol  # noqa: E402

# What the hand-made file shows that a results release does not contain (read at release time it cannot be).
GAPS = {
    'CRDO': {'tiles[2]': 'largest-customer share is in the 10-Q (filed a day after the release); the tile shows non-GAAP net income',
             'growth.watch': 'customer concentration (10-Q); the section compares GAAP and non-GAAP net margins'},
    'MRVL': {'caution.chips': 'the Lumentum deal (a later 8-K) is not in the results release: one chip fewer',
             'next.chips': 'the Nov 2 preliminary revenue (a later 8-K): one chip fewer'},
}
CHIP_GAPS = {('MRVL', 'caution'): 1, ('MRVL', 'next'): 1}


def previous_file(dive):
    """The previous quarter's file as the current hand-made file records it (its last history bar and the quotes behind it)."""
    h, ev = dive['history'], {e['field']: e for e in dive['evidence']}
    prev = copy.deepcopy(dive)
    q = dive['periodQuarter'] - 1 or 4
    prev.update(period=f'Q{q} PREVIOUS', periodQuarter=q, periodEnd=h[-1]['end'],
                history=[{'label': 'Q1', 'end': '2024-01-01', 'value': 1}] + h[:-1])
    prev['numbers'] = {**dive['numbers'], 'revenue': {'current': h[-1]['value']}}
    prev['evidence'] = [{**ev[f'history[{len(h) - 1}].value'], 'field': 'numbers.revenue.current'}] + \
        [{**ev[f'history[{i}].value'], 'field': f'history[{i + 1}].value'} for i in range(len(h) - 1)]
    return prev


def generated(ticker):
    dive = json.loads((ROOT / f'lib/research/dives/{ticker}.json').read_text(encoding='utf-8'))
    text = gzip.open(ROOT / f'tests/fixtures/latest-releases/{ticker}.txt.gz', 'rt').read()
    url = dive['sources'][0]['url']
    release = patrol.latest_release(ticker, {'filings': {'recent': {'form': ['8-K'], 'acceptanceDateTime': [dive['releasedOn'] + 'T21:00:00.000Z'],
                                    'items': ['2.02'], 'accessionNumber': ['a-1'], 'primaryDocument': ['x']}}},
                                    datetime(2026, 11, 26, tzinfo=timezone.utc), exhibit=lambda *a: (url, text), primary=lambda *a: None)
    release['releasedOn'] = dive['releasedOn']
    previous = previous_file(dive)
    fixture = check_dives.read_fixture(ROOT / f'tests/fixtures/dives/{ticker}-source.txt')
    texts = {url: check_dives.normalize(text)}
    for e in previous['evidence']:
        texts[e['url']] = (texts.get(e['url'], '') + ' ' + ' '.join(fixture.get(e['url'], [])) + ' ' + check_dives.normalize(e['quote'])).strip()
    draft = gen.build(ticker, release, previous, None, '2026-11-26')
    return dive, draft, gen.checks(ticker, draft, release, previous, texts)


class DepthParity(unittest.TestCase):
    def test_every_writer_matches_its_hand_made_file(self):
        for ticker in sorted(dive_writers.WRITERS):
            with self.subTest(ticker=ticker):
                hand, auto, problems = generated(ticker)
                self.assertEqual(problems, [])
                self.assertEqual(auto['period'], hand['period'])
                self.assertEqual(auto['periodEnd'], hand['periodEnd'])
                self.assertEqual(len(auto['summary']['conclusion']), len(hand['summary']['conclusion']))
                self.assertEqual(len(auto['tiles']), len(hand['tiles']))
                for key, card in hand['summary']['cards'].items():
                    mine = auto['summary']['cards'][key]
                    self.assertEqual([s['key'] for s in mine['sections']], [s['key'] for s in card['sections']], f'{ticker} {key}')
                    self.assertGreaterEqual(len(mine['chips']), len(card['chips']) - CHIP_GAPS.get((ticker, key), 0), f'{ticker} {key}')
                kinds = lambda n: {k for k, v in n.items() if v is not None} | {f'{k}.{x}' for k, v in n.items() if isinstance(v, dict) for x, y in v.items() if y is not None}
                self.assertEqual(kinds(auto['numbers']), kinds(hand['numbers']), ticker)
                # the same figures as the hand-made file, where the hand-made file read them from the same release
                for path in ('revenue.current', 'revenue.previous', 'revenue.yearAgo', 'grossMargin.current', 'grossMargin.previous',
                             'guidance.low', 'guidance.high', 'guidance.grossMarginPercent'):
                    a, b = path.split('.')
                    self.assertAlmostEqual(auto['numbers'][a][b], hand['numbers'][a][b], delta=abs(hand['numbers'][a][b]) * 0.001 + 0.05, msg=f'{ticker} {path}')
                self.assertAlmostEqual(auto['numbers']['adjustedEPS'], hand['numbers']['adjustedEPS'], places=2)

    def test_the_gaps_are_only_what_the_release_does_not_carry(self):
        self.assertEqual(sorted(GAPS), sorted(dive_writers.WRITERS))

    def test_a_missing_figure_holds_the_dive(self):
        dive = json.loads((ROOT / 'lib/research/dives/CRDO.json').read_text(encoding='utf-8'))
        text = gzip.open(ROOT / 'tests/fixtures/latest-releases/CRDO.txt.gz', 'rt').read().replace('Goodwill', 'Goodwil1')
        with self.assertRaisesRegex(ValueError, 'missing:goodwill'):
            dive_writers.crdo(__import__('dive_figures').read('CRDO', text), dive['sources'][0]['url'], None)


if __name__ == '__main__':
    unittest.main()
