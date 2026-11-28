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

# The filings each company's hand-made file also used besides the results release, as fixtures: its 10-Q (filed days after the
# release) and the quarter's other 8-Ks (a deal, a preliminary result). With them the automatic dive reaches full parity; before
# the 10-Q is filed it uses the substitutes the writers document (tests below check both stages).
FILINGS = {
    'CRDO': {'report': ('https://www.sec.gov/Archives/edgar/data/1807794/000162828026060111/crdo-20260801.htm', 'CRDO-10q-2026-08-01')},
    'MRVL': {'events': [('https://www.sec.gov/Archives/edgar/data/1835632/000119312526442714/d81187dex991.htm', 'MRVL-8k-2026-11-02',
                         datetime(2026, 11, 2, 13, 6, tzinfo=timezone.utc))]},
    'AVGO': {'report': ('https://www.sec.gov/Archives/edgar/data/1730168/000173016826000080/avgo-20260802.htm', 'AVGO-10q-2026-08-02')},
    'TSM': {'exhibits': [('https://www.sec.gov/Archives/edgar/data/1046179/000104617926000726/a3q26presentatione.htm', 'TSM-992')]},
    'ASML': {'exhibits': [('https://www.sec.gov/Archives/edgar/data/937966/000162828026065813/a2026_10x14xpresentation.htm', 'ASML-992'),
                          ('https://www.sec.gov/Archives/edgar/data/937966/000162828026065813/financial_statementsxusx.htm', 'ASML-993')]},
    'AMD': {},   # the release alone carries every figure of the hand-made file
    'ANET': {'report': ('https://www.sec.gov/Archives/edgar/data/1596532/000159653226000254/anet-20260930.htm', 'ANET-10q-2026-09-30')},
    'PLTR': {'prior': ('https://www.sec.gov/Archives/edgar/data/1321655/000132165526000039/a2026q2ex991pressrelease.htm', 'PLTR-release-q2-2026')},
    'ALAB': {'report': ('https://www.sec.gov/Archives/edgar/data/1736297/000173629726000045/alab-20260930.htm', 'ALAB-10q-2026-09-30')},
    # Marvell's agreement to buy Lumentum: Lumentum's own 8-K (Item 1.01) of its results day, the same joint press release as MRVL's
    'LITE': {'events': [('https://www.sec.gov/Archives/edgar/data/1633978/000119312526442758/d163169dex991.htm', 'LITE-8k-2026-11-02',
                         datetime(2026, 11, 2, 13, 39, 16, tzinfo=timezone.utc))]},
    'SNDK': {},
    # the deal 8-K's press exhibit (EX-99.1, what the patrol reads) instead of its cover page; the Q2 release for the previous quarter
    'VRT': {'events': [('https://www.sec.gov/Archives/edgar/data/1674101/000162828026067393/exhibit991vrt-q42026102720.htm', 'VRT-8k-2026-10-27-ex991',
                        datetime(2026, 10, 27, 20, 15, tzinfo=timezone.utc))],
            'prior': ('https://www.sec.gov/Archives/edgar/data/1674101/000162828026050323/q22026exhibit991vrt07292026.htm', 'VRT-release-q2-2026')},
    'GEV': {'prior': ('https://www.sec.gov/Archives/edgar/data/1996810/000199681026000147/gevpressrelease2q26.htm', 'GEV-release-q2-2026')},
    'BE': {},
    # the results-day 6-Ks: the year's shareholder-return plan and the quarter's dividend (Korean fair disclosures filed with the SEC)
    'SKHY': {'exhibits': [('https://news.skhynix.com/en/q3-2026-business-results/', 'SKHY-newsroom-3q26')],
             'events': [('https://www.sec.gov/Archives/edgar/data/2120882/000119312526435008/d236990d6k.htm', 'SKHY-6k-returns',
                         datetime(2026, 10, 28, 10, 6, 14, tzinfo=timezone.utc)),
                        ('https://www.sec.gov/Archives/edgar/data/2120882/000119312526435015/d236994d6k.htm', 'SKHY-6k-dividend',
                         datetime(2026, 10, 28, 10, 9, 24, tzinfo=timezone.utc))]},
    'ARM': {'prior': ('https://www.sec.gov/Archives/edgar/data/1973239/000197323926000113/exhibit992fye27q130-junx26.htm', 'ARM-letter-q1-fye27')},
    'CRWV': {'report': ('https://www.sec.gov/Archives/edgar/data/1769628/000176962826000465/crwv-20260930.htm', 'CRWV-10q-2026-09-30'),
             'prior': ('https://www.sec.gov/Archives/edgar/data/1769628/000176962826000362/coreweave2q26earningspress.htm', 'CRWV-release-q2-2026')},
    # the shareholder letter is EX-99.2 of the results 6-K (the hand-made file quoted the same letter as a PDF from nebius.com)
    'NBIS': {'exhibits': [('https://www.sec.gov/Archives/edgar/data/1513845/000110465926126008/tm2629571d1_ex99-2.htm', 'NBIS-992')]},
    'MSFT': {},
    'GOOGL': {},
    # the CFO commentary and the supplemental information (EX-99.2, EX-99.3), and the quarter's two leadership 8-Ks (Item 5.02)
    'NVDA': {'exhibits': [('https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/q3fy27cfocommentary.htm', 'NVDA-992'),
                          ('https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/supplementalfinancialinfor.htm', 'NVDA-993')],
             'events': [('https://www.sec.gov/Archives/edgar/data/1045810/000104581026000082/nvda-20261111.htm', 'NVDA-8k-2026-11-11',
                         datetime(2026, 11, 11, 21, 30, tzinfo=timezone.utc)),
                        ('https://www.sec.gov/Archives/edgar/data/1045810/000104581026000090/nvda-20261122.htm', 'NVDA-8k-2026-11-22',
                         datetime(2026, 11, 23, 1, 0, tzinfo=timezone.utc))]},
}
GAPS = {  # what is still different from the hand-made file with every filing in hand (none)
    'CRDO': {}, 'MRVL': {}, 'AVGO': {}, 'TSM': {},
    'ASML': {'caution.chips[1]': 'the hand-made file showed free cash flow (−€2.61B in Q1 to €11.35B); the statements exhibit gives no quarterly '
                                 'free cash flow line, so the chip shows the contract liabilities the same section explains'},
    'AMD': {}, 'ANET': {},
    'PLTR': {},
    'ALAB': {}, 'LITE': {}, 'SNDK': {},
    'VRT': {}, 'GEV': {}, 'BE': {},
    'SKHY': {},
    'ARM': {}, 'CRWV': {},
    'NBIS': {'sources': 'interest expense and the funding sources come from the release\'s own statements (the hand-made file quoted them from the '
                        'separate Operating and Financial Review 6-K); the shareholder letter is its SEC copy (EX-99.2) instead of the nebius.com PDF'},
    'MSFT': {}, 'GOOGL': {}, 'NVDA': {},
}
CHIP_GAPS = {}
EVENT_FORMS = {'SKHY': '6-K'}
RELEASE_URLS = {'SKHY': 'https://www.sec.gov/Archives/edgar/data/2120882/000119312526434994/d162547d6k.htm'}   # a foreign issuer's other filings of the quarter are 6-Ks
FILINGS_DIR = ROOT / 'tests/fixtures/dive-filings'


def filing_text(name):
    return gzip.open(FILINGS_DIR / f'{name}.txt.gz', 'rt').read()


def previous_file(dive):
    """The previous quarter's file as the current hand-made file records it (its last history bar and the quotes behind it)."""
    h, ev = dive['history'], {e['field']: e for e in dive['evidence']}
    prev = copy.deepcopy(dive)
    q = dive['periodQuarter'] - 1 or 4
    prev.update(period=f'Q{q} PREVIOUS', periodQuarter=q, periodEnd=h[-1]['end'],
                history=[{'label': 'Q1', 'end': '2024-01-01', 'value': 1}] + h[:-1])
    segments = dive['numbers'].get('segments')
    prev['numbers'] = {**dive['numbers'], 'revenue': {'current': h[-1]['value']},
                       'segments': [{**x, 'revenue': x['previous'], 'operatingMargin': x['previousOperatingMargin']} for x in segments] if segments else None}
    prev['evidence'] = [{**ev[f'history[{len(h) - 1}].value'], 'field': 'numbers.revenue.current'}] + \
        [{**ev[f'history[{i}].value'], 'field': f'history[{i + 1}].value'} for i in range(len(h) - 1)]
    gm = dive['numbers'].get('grossMargin') or {}
    if gm.get('previous') is not None:  # the previous file's own gross margin, quoted where the hand-made file quoted it
        prev['numbers']['grossMargin'] = {'current': gm['previous'], 'previous': None}
        prev['evidence'] += [{**e, 'field': 'numbers.grossMargin.current'} for e in dive['evidence'] if e['field'] == 'numbers.grossMargin.previous']
    for i, _ in enumerate(segments or []):
        for old, new in (('previous', 'revenue'), ('previousOperatingMargin', 'operatingMargin')):
            prev['evidence'] += [{**e, 'field': f'numbers.segments[{i}].{new}'} for e in dive['evidence'] if e['field'] == f'numbers.segments[{i}].{old}']
    return prev


def generated(ticker, filings=True):
    dive = json.loads((ROOT / f'lib/research/dives/{ticker}.json').read_text(encoding='utf-8'))
    text = gzip.open(ROOT / f'tests/fixtures/latest-releases/{ticker}.txt.gz', 'rt').read()
    # the release the patrol reads (an SEC filing); SK hynix's hand-made file listed its newsroom release first
    url = RELEASE_URLS.get(ticker, dive['sources'][0]['url'])
    release = patrol.latest_release(ticker, {'filings': {'recent': {'form': ['8-K'], 'acceptanceDateTime': [dive['releasedOn'] + 'T21:00:00.000Z'],
                                    'items': ['2.02'], 'accessionNumber': ['a-1'], 'primaryDocument': ['x']}}},
                                    datetime(2026, 11, 26, tzinfo=timezone.utc), exhibit=lambda *a: (url, text), primary=lambda *a: None)
    release['releasedOn'] = dive['releasedOn']
    extra = FILINGS.get(ticker, {}) if filings else {'exhibits': FILINGS.get(ticker, {}).get('exhibits', [])}  # exhibits are part of the release
    if 'report' in extra:
        release['report'] = {'url': extra['report'][0], 'text': filing_text(extra['report'][1]), 'form': '10-Q'}
    release['events'] = [{'url': u, 'text': filing_text(n), 'accepted': at, 'form': EVENT_FORMS.get(ticker, '8-K')}
                         for u, n, at in extra.get('events', [])]
    release['exhibits'] = [{'url': u, 'text': filing_text(n)} for u, n in extra.get('exhibits', [])]
    if 'prior' in FILINGS.get(ticker, {}):  # the previous quarter's release (public before this release, so in both stages)
        release['prior'] = {'url': FILINGS[ticker]['prior'][0], 'text': filing_text(FILINGS[ticker]['prior'][1])}
    previous = previous_file(dive)
    fixture = check_dives.read_fixture(ROOT / f'tests/fixtures/dives/{ticker}-source.txt')
    texts = {url: check_dives.normalize(text)}
    for other in [release.get('report'), release.get('prior')] + release['events'] + release['exhibits']:
        if other:
            texts[other['url']] = check_dives.normalize(other['text'])
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
                    if hand['numbers'][a] is None:   # no gross margin or guidance at all (Vertiv reports none)
                        self.assertIsNone(auto['numbers'][a], f'{ticker} {a}')
                        continue
                    if hand['numbers'][a][b] is None:
                        self.assertIsNone(auto['numbers'][a][b], f'{ticker} {path}')
                        continue
                    self.assertAlmostEqual(auto['numbers'][a][b], hand['numbers'][a][b], delta=abs(hand['numbers'][a][b]) * 0.001 + 0.05, msg=f'{ticker} {path}')
                self.assertAlmostEqual(auto['numbers']['adjustedEPS'], hand['numbers']['adjustedEPS'], places=2)
                for i, seg in enumerate(hand['numbers'].get('segments') or []):
                    for k in ('revenue', 'previous', 'operatingMargin', 'previousOperatingMargin'):
                        self.assertAlmostEqual(auto['numbers']['segments'][i][k], seg[k], delta=0.051, msg=f'{ticker} segments[{i}].{k}')
                same = [i for i in range(len(hand['tiles'])) if f'tiles[{i}].label' not in GAPS[ticker]]   # a gap: another figure in its place
                self.assertEqual([auto['tiles'][i]['label']['en'] for i in same], [hand['tiles'][i]['label']['en'] for i in same], f'{ticker} tiles')

    def test_the_gaps_are_only_what_the_release_does_not_carry(self):
        self.assertEqual(sorted(GAPS), sorted(dive_writers.WRITERS))
        self.assertEqual(sorted(FILINGS), sorted(dive_writers.WRITERS))

    def test_before_the_10q_and_the_other_8ks_the_dive_still_passes_with_its_substitutes(self):
        for ticker in sorted(dive_writers.WRITERS):
            with self.subTest(ticker=ticker):
                hand, auto, problems = generated(ticker, filings=False)
                self.assertEqual(problems, [])
                for key, card in hand['summary']['cards'].items():
                    self.assertGreaterEqual(len(auto['summary']['cards'][key]['sections']), 3)

    def test_the_year_end_release_of_marvell_reads_every_figure(self):
        import dive_figures
        read = dive_figures.read('MRVL', filing_text('MRVL-release-q4fy26'))
        self.assertEqual(sorted(read), sorted(['revenue', 'gm', 'gmGaap', 'eps', 'epsGaap', 'opMargin', 'netIncome', 'netIncomeNonGaap', 'dataCenter',
                                               'communications', 'dataCenterShare', 'guidanceRevenue', 'guidanceGm', 'guidanceEps']))
        self.assertEqual(read['netIncome'].raws, ['396.1', '1901.3', '200.2'])
        self.assertEqual(read['epsGaap'].raws, ['0.46', '2.20', '0.23'])

    def test_the_10q_and_the_deal_8k_are_read_exactly(self):
        import dive_figures
        crdo = dive_figures.read_report('CRDO', filing_text('CRDO-10q-2026-08-01'))
        self.assertEqual((crdo['customerA'].raws, crdo['customerB'].raws), (['43', '50'], ['28', '35']))
        self.assertEqual(crdo['acquisition'].values[1:], ['DustPhotonics', '1.3', 'billion'])
        avgo = dive_figures.read_report('AVGO', filing_text('AVGO-10q-2026-08-02'))
        self.assertEqual(avgo['semisOpIncome'].raws, ['12770', '5217'])
        self.assertEqual(avgo['topFive'].raws, ['55', '50', '40'])
        deal = dive_figures.deal(filing_text('MRVL-8k-2026-11-02'))
        self.assertEqual(deal['exchangeRatio'].values, ['4.500', 'Marvell', 'Lumentum'])
        self.assertEqual(deal['preliminary'].values, ['third', '2027', '2'])
        self.assertEqual(dive_figures.deal('Marvell reports record revenue.'), {})

    def test_without_its_other_exhibits_a_multi_exhibit_company_is_held(self):
        import dive_figures
        for ticker in ('TSM', 'ASML', 'NBIS', 'NVDA', 'SKHY'):
            dive = json.loads((ROOT / f'lib/research/dives/{ticker}.json').read_text(encoding='utf-8'))
            text = gzip.open(ROOT / f'tests/fixtures/latest-releases/{ticker}.txt.gz', 'rt').read()
            figures = dive_figures.read_docs(ticker, [(dive['sources'][0]['url'], text)])
            with self.subTest(ticker=ticker), self.assertRaisesRegex(ValueError, 'missing:'):
                dive_writers.WRITERS[ticker](figures, dive['sources'][0]['url'], None)

    def test_a_missing_figure_holds_the_dive(self):
        dive = json.loads((ROOT / 'lib/research/dives/CRDO.json').read_text(encoding='utf-8'))
        text = gzip.open(ROOT / 'tests/fixtures/latest-releases/CRDO.txt.gz', 'rt').read().replace('Goodwill', 'Goodwil1')
        with self.assertRaisesRegex(ValueError, 'missing:goodwill'):
            dive_writers.crdo(__import__('dive_figures').read('CRDO', text), dive['sources'][0]['url'], None)


class StrictReading(unittest.TestCase):
    """A value is read only when its row is in the table once, with exactly the table's number of cells (owner, Nov 26)."""
    def test_a_row_is_read_only_once_and_only_at_its_width(self):
        import dive_figures as d
        table = 'Revenue $ 100 $ 90 $ 80 Cost of revenue 50 45 40'
        self.assertEqual(d.row(table, 'Revenue', 3, None, 'Cost').values, [100, 90, 80])
        self.assertIsNone(d.row(table, 'Revenue', 2, None, 'Cost'))            # a cell more than the table's columns
        self.assertIsNone(d.row(table, 'Revenue', 4, None, 'Cost'))            # a cell missing
        self.assertIsNone(d.row(table + ' Revenue $ 7 $ 6 $ 5', 'Revenue', 3, None, None))   # the label twice
        self.assertEqual(d.row(table, 'Revenue', 2, None, 'Cost', width=3).values, [100, 90])
        self.assertEqual(d.row('Net loss (5.2 ) 465.8', 'Net loss', 2).raws, ['5.2', '465.8'])
        self.assertLess(d.row('Net loss (5.2 ) 465.8', 'Net loss', 2).values[0], 0)   # a negative printed "(5.2 )"

    def test_differing_restatements_of_a_sentence_are_not_read(self):
        import dive_figures as d
        p = r'revenue of \$([\d.]+) billion'
        self.assertEqual(d.sentence('Q3 revenue of $1.2 billion. Again, revenue of $1.2 billion.', p, (1,), unit='text').values, ['1.2'])
        self.assertIsNone(d.sentence('Q3 revenue of $1.2 billion. Q2 revenue of $1.1 billion.', p, (1,), unit='text'))


if __name__ == '__main__':
    unittest.main()
