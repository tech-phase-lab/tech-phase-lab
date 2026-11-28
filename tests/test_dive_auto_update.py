"""The next quarter's 決算の深掘り end to end (audit, Nov 28): the patrol finds a new results 8-K in the SEC submissions, reads it, and the
dive for that quarter is built, checked and stored as passed for GET /company-dives, from the committed file of the quarter before.
No network and no model: SEC is a fixture (the real AMD Q3 2026 release), the committed file is the previous quarter's."""
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
sys.path.insert(0, str(ROOT / 'tests'))
import check_dives  # noqa: E402
import earnings_dive_generate as gen  # noqa: E402
import earnings_patrol as patrol  # noqa: E402
import monitor  # noqa: E402
from test_dive_parity import previous_file  # noqa: E402

TICKER = 'AMD'
HAND = json.loads((ROOT / f'lib/research/dives/{TICKER}.json').read_text(encoding='utf-8'))
TEXT = gzip.open(ROOT / f'tests/fixtures/latest-releases/{TICKER}.txt.gz', 'rt').read()
URL = HAND['sources'][0]['url']
ACCESSION = '0000002488-26-000188'
ACCEPTED = '2026-11-03T20:15:00.000Z'
NOW = datetime(2026, 11, 3, 23, 0, tzinfo=timezone.utc)


def submissions(*rows):
    """SEC submissions 'recent' from (form, accepted, items, accession) rows, newest first."""
    return {'filings': {'recent': {'form': [r[0] for r in rows], 'acceptanceDateTime': [r[1] for r in rows], 'items': [r[2] for r in rows],
                                   'accessionNumber': [r[3] for r in rows], 'reportDate': ['' for _ in rows],
                                   'primaryDocument': ['doc.htm' for _ in rows]}}}


SEC = submissions(('8-K', ACCEPTED, '2.02,7.01,9.01', ACCESSION),
                  ('10-Q', '2026-08-05T20:30:00.000Z', '', '0000002488-26-000123'),
                  ('8-K', '2026-08-04T20:15:00.000Z', '2.02,7.01,9.01', '0000002488-26-000121'))
# the company page still shows the previous quarter's release
SECTION = {'from': 'dive', 'period': 'Q2 2026', 'releasedOn': '2026-08-04', 'hold': None, 'tiles': [], 'checks': {}}


class NextQuarterDive(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dives = Path(tmp.name) / 'dives'
        self.dives.mkdir()
        self.previous = previous_file(HAND)
        self.previous['period'] = 'Q2 2026'
        (self.dives / f'{TICKER}.json').write_text(json.dumps(self.previous, ensure_ascii=False), encoding='utf-8')
        self.db_path = Path(tmp.name) / 'db.sqlite'
        patcher = mock.patch.object(gen, 'DIVES', self.dives)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.fetched = []

    def fetch_json(self, url):
        self.fetched.append(url)
        if url.startswith('https://data.sec.gov/submissions/'):
            return SEC
        raise AssertionError(f'unexpected fetch {url}')

    def read_release(self, ticker, filings, now):
        def exhibit(cik, accession, numbers):
            self.assertEqual(accession, ACCESSION, 'only the newest results 8-K is read')
            return URL, TEXT
        return patrol.latest_release(ticker, filings, now, exhibit=exhibit, primary=lambda *a: None)

    def patrol(self):
        return patrol.patrol(NOW, tickers=[TICKER], fetch_json=self.fetch_json, read_release=self.read_release, sections={TICKER: SECTION})

    def test_a_new_release_is_found_and_its_dive_is_built_checked_and_published(self):
        results, _ = self.patrol()
        release = results[TICKER + ':release']
        self.assertEqual(gen.normalize_period(release['period']), 'Q3 2026')
        self.assertEqual(release['accession'], ACCESSION)
        with monitor.connect(self.db_path) as db:
            self.assertEqual(gen.due(results, db), [TICKER])
            done = patrol.draft_dives(db, results, NOW, env={}, extras={TICKER: (None, [])})
            self.assertEqual(done, [(TICKER, 'passed')])
            served = gen.published(db)[TICKER]
            row = db.execute('SELECT state, errors FROM generated_dives WHERE ticker=?', (TICKER,)).fetchone()
        self.assertEqual(tuple(row), ('passed', '[]'))
        # the release's quarter, its figures, and the history continued from the previous file
        self.assertEqual((served['period'], served['releasedOn'], served['periodEnd']), ('Q3 2026', '2026-11-03', HAND['periodEnd']))
        self.assertEqual(served['numbers']['revenue'], {'current': 13377.0, 'previous': 11536.0, 'yearAgo': 9246.0})
        self.assertEqual(served['numbers']['guidance']['low'], HAND['numbers']['guidance']['low'])
        self.assertEqual([h['value'] for h in served['history']], [h['value'] for h in HAND['history']])
        self.assertEqual(sorted(served['summary']['cards']), ['caution', 'change', 'growth', 'next'])
        # every quoted passage is in the release (or carried from the previous file's own quotes)
        quoted = {URL: check_dives.normalize(TEXT)}
        for e in self.previous['evidence']:
            quoted[e['url']] = quoted.get(e['url'], '') + ' ' + check_dives.normalize(e['quote'])
        for e in served['evidence']:
            self.assertIn(check_dives.normalize(e['quote']), quoted[e['url']], e['field'])

    def test_a_later_patrol_keeps_the_one_passed_dive_and_the_same_quarter_is_not_due(self):
        results, _ = self.patrol()
        with monitor.connect(self.db_path) as db:
            patrol.draft_dives(db, results, NOW, env={}, extras={TICKER: (None, [])})
            again = patrol.draft_dives(db, results, NOW, env={}, extras={TICKER: (None, [])})
            self.assertEqual(again, [(TICKER, 'passed')])
            self.assertEqual(db.execute('SELECT count(*) FROM generated_dives').fetchone()[0], 1)
        # once the committed file is this quarter's, nothing is due for the same release
        (self.dives / f'{TICKER}.json').write_text(json.dumps(HAND, ensure_ascii=False), encoding='utf-8')
        with monitor.connect(self.db_path) as db:
            self.assertEqual(gen.due(results, db), [])

    def test_the_off_switch_builds_nothing(self):
        results, _ = self.patrol()
        with monitor.connect(self.db_path) as db:
            self.assertEqual(patrol.draft_dives(db, results, NOW, env={'EARNINGS_DIVE_AUTO': 'false'}), [])
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE name='generated_dives'").fetchone()[0], 0)


class DealWindow(unittest.TestCase):
    """A deal 8-K filed on the previous release's own day (Marvell agreeing to buy Lumentum, Nov 2, 2026, the day of Lumentum's results)
    is read for the next dive; that day's results 8-K is not."""
    def test_a_deal_on_the_previous_release_day_is_read_and_its_results_8k_is_not(self):
        sec = submissions(('8-K', '2027-02-03T21:05:00.000Z', '2.02,9.01', 'results-q2'),
                          ('8-K', '2026-11-23T21:00:00.000Z', '5.07', 'vote'),
                          ('8-K', '2026-11-02T13:39:16.000Z', '1.01,5.02,7.01,9.01', 'deal'),
                          ('8-K', '2026-11-02T12:12:55.000Z', '2.02,9.01', 'results-q1'),
                          ('8-K', '2026-11-01T12:00:00.000Z', '1.01', 'older-deal'))
        release = {'accession': 'results-q2', 'accepted': datetime(2027, 2, 3, 21, 5, tzinfo=timezone.utc)}
        with mock.patch('earnings_reconcile.report_after', return_value=None):
            _, events = patrol.quarter_filings('LITE', sec, release, {'releasedOn': '2026-11-02'},
                                               exhibit=lambda cik, acc, numbers: (f'https://www.sec.gov/{acc}.htm', 'text'))
        self.assertEqual([e['accession'] for e in events], ['deal'])


if __name__ == '__main__':
    unittest.main()
