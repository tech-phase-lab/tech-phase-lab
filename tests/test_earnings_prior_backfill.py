"""The calendar's 会社予想 / 上方修正 need each company's previous quarterly release (Nov 28).

Production stored results only from October 2026, so DELL's (Sep 1), NVDA's (Aug 26) and MU's (Jun 24) previous releases were missing,
and the DELL and MU parsers did not read the next quarter's outlook nor Dell's 'Previous' full-year column. Fixtures are the real SEC
releases (tests/fixtures/latest-releases, tests/fixtures/prior-releases: scripts/research/earnings_release_sweep.py).
"""
import gzip
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import urllib.error
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
sys.path.insert(0, str(ROOT / 'tests'))
import earnings_history  # noqa: E402
import earnings_history_backfill as backfill  # noqa: E402
import earnings_patrol  # noqa: E402
import earnings_prior_backfill as prior  # noqa: E402
import earnings_release_briefs  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import release_extras  # noqa: E402

FX = ROOT / 'tests/fixtures'
PRIOR = json.loads((FX / 'prior-releases/manifest.json').read_text())
LATEST = json.loads((FX / 'latest-releases/manifest.json').read_text())


def release(folder, ticker):
    return gzip.decompress((FX / folder / f'{ticker}.txt.gz').read_bytes()).decode()


def facts(parsed):
    return [(f[0], f[1], f[2]) for f in parsed['facts']]


class DellOutlook(unittest.TestCase):
    def test_q3_fy27_next_quarter_full_year_and_previous_column(self):
        parsed = flash.parse_dell(release('latest-releases', 'DELL'))
        self.assertEqual(parsed['period'], 'Q3 FY2027')
        # checked against the SEC exhibit 99.1 of Nov 24, 2026 (Guidance Summary and the Q3 FY27 results table)
        self.assertEqual(facts(parsed), [('revenue', '$54.937B', '$27.005B'), ('eps', '$8.82', '$2.28'), ('adjusted-eps', '$9.45', '$2.59'),
                                         ('net-income', '$5.673B', '$1.548B'), ('operating-income', '$7.442B', '$2.119B'),
                                         ('guidance-revenue', '$56.3B', None), ('guidance-adjusted-eps', '$8.40', None),
                                         ('guidance-fy-revenue', '$202.0B', None), ('guidance-fy-adjusted-eps', '$29.68', None)])
        self.assertEqual([f[5] if len(f) > 5 else None for f in parsed['facts']][-2:], ['$192.0B', '$25.50'])
        _key, payload = flash.build('DELL', LATEST['DELL']['url'], parsed, '2026-11-24T21:09:13.000+00:00')
        self.assertEqual(payload['facts'][-2]['comparisons'], {'priorGuidance': '$192.0B'})
        self.assertEqual(payload['facts'][-4]['ja'], '次四半期見通し 売上高')

    def test_an_outlook_that_does_not_fit_is_left_out(self):
        text = ' '.join(release('latest-releases', 'DELL').split())
        self.assertIn('FY27 Previous FY27 Updated', text)
        keys = lambda t: [f[0] for f in flash.parse_dell(t)['facts']]
        # a quarter that is not the next one, a full year that is not this fiscal year, a bullet that disagrees with the table
        self.assertNotIn('guidance-revenue', keys(text.replace('Q4FY27', 'Q1FY28', 1)))
        self.assertNotIn('guidance-fy-revenue', keys(text.replace('FY27 Previous FY27 Updated', 'FY26 Previous FY26 Updated', 1)))
        self.assertNotIn('guidance-fy-revenue', keys(text.replace('revenue guidance of $202.0 billion', 'revenue guidance of $203.0 billion', 1)))
        self.assertIn('revenue', keys(text.replace('Q4FY27', 'Q1FY28', 1)), 'the results stay')


class MicronOutlook(unittest.TestCase):
    def test_both_releases_read_their_business_outlook(self):
        q3 = flash.parse_micron(release('prior-releases', 'MU'))  # Jun 24, 2026 ('highlights' in lower case)
        self.assertEqual(q3['period'], 'Q3 FY2026')
        self.assertEqual(facts(q3), [('revenue', '$41.456B', '$9.301B'), ('eps', '$24.67', '$1.68'), ('adjusted-eps', '$25.11', '$1.91'),
                                     ('net-income', '$28.243B', '$1.885B'), ('operating-income', '$33.318B', '$2.169B'),
                                     ('guidance-revenue', '$50.0B ± $1.0B', None), ('guidance-adjusted-eps', '$31.00 ± $1.00', None)])
        q4 = flash.parse_micron(release('latest-releases', 'MU'))  # Sep 30, 2026
        self.assertEqual(facts(q4)[-2:], [('guidance-revenue', '$61.5B ± $1.5B', None), ('guidance-adjusted-eps', '$38.15 ± $1.00', None)])

    def test_another_quarters_table_is_not_taken(self):
        text = ' '.join(release('latest-releases', 'MU').split())
        self.assertIn('FQ1-27 GAAP', text)
        text = text.replace('FQ1-27 GAAP', 'FQ2-27 GAAP', 1)
        self.assertNotIn('guidance-revenue', [f[0] for f in flash.parse_micron(text)['facts']])


class OtherOutlooks(unittest.TestCase):
    def test_asml_q2_reads_the_third_quarter_outlook(self):
        parsed = flash.parse_asml(release('prior-releases', 'ASML'))
        self.assertEqual(parsed['period'], 'Q2 2026')
        self.assertEqual(facts(parsed)[-1], ('guidance-revenue', '€11.0B-€12.0B', None))

    def test_every_previous_release_with_an_outlook_gives_the_next_quarters_revenue(self):
        for ticker, value in {'DELL': '$49.0B', 'NVDA': '$108.0B ± 2%', 'MU': '$50.0B ± $1.0B', 'TSM': '$44.6B-$45.8B',
                              'ASML': '€11.0B-€12.0B', 'CRWD': '$1.5232B-$1.5292B'}.items():
            with self.subTest(ticker=ticker):
                text = release('prior-releases', ticker)
                parsed, code = backfill.read_figures(ticker, PRIOR[ticker]['url'], text)
                self.assertIsNone(code)
                parsed = release_extras.supplement(text, parsed)
                self.assertEqual([f[1] for f in parsed['facts'] if f[0] == 'guidance-revenue'], [value])

    def test_previous_release_fixtures_keep_their_figures(self):
        for ticker, entry in PRIOR.items():
            if entry['status'] != 'figures':
                continue
            with self.subTest(ticker=ticker):
                parsed, _code = backfill.read_figures(ticker, entry['url'], release('prior-releases', ticker))
                self.assertEqual(parsed['period'], entry['period'])
                self.assertEqual(sorted(set(entry['facts']) - {f[0] for f in parsed['facts']}), [])

    def test_non_gaap_diluted_eps_wording_and_never_an_outlook(self):
        read = lambda head: [f for f in release_extras.sentence_facts(head) if f[0] == 'adjusted-eps']
        self.assertEqual(read('record non-GAAP diluted EPS of $9.45, up 265%'), [('adjusted-eps', '$9.45', None, None)])
        self.assertEqual(read('KLA: non-GAAP diluted EPS was $1.22 and GAAP'), [('adjusted-eps', '$1.22', None, None)])
        self.assertEqual(read('FY27 diluted EPS guidance of $28.24 and non-GAAP diluted EPS guidance of $29.68'), [])
        self.assertEqual(read('non-GAAP diluted EPS of $9.45. Non-GAAP net income per diluted share was $9.40.'), [], 'two figures: ambiguous')

    def test_the_patrol_reads_a_dollar_band(self):
        self.assertEqual(earnings_patrol.guidance('$61.5B ± $1.5B')[1:], (60000, 63000))
        self.assertIsNone(earnings_patrol.guidance('$61.5B ± €1.5B'))


class Briefs(unittest.TestCase):
    def test_committed_briefs_are_what_the_parsers_read_from_the_real_releases(self):
        committed = json.loads((FX / 'earnings-release-briefs.json').read_text())
        self.assertEqual(committed, json.loads(json.dumps(earnings_release_briefs.briefs(), ensure_ascii=False)))


class Background(unittest.TestCase):
    NOW = datetime(2026, 11, 28, 6, 0, tzinfo=timezone.utc)
    FILINGS = {
        'DELL': [{'form': '8-K', 'filed': '2026-09-01', 'accepted': datetime(2026, 9, 1, 20, 10, 14, tzinfo=timezone.utc),
                  'accession': '0001571996-26-000039', 'primary': 'dell-20260901.htm'}],
        'MU': [{'form': '8-K', 'filed': '2026-06-24', 'accepted': datetime(2026, 6, 24, 20, 2, 1, tzinfo=timezone.utc),
                'accession': '0000723125-26-000013', 'primary': 'mu-20260624.htm'},
               {'form': '8-K', 'filed': '2026-09-30', 'accepted': datetime(2026, 9, 30, 20, 2, 22, tzinfo=timezone.utc),
                'accession': '0000723125-26-000018', 'primary': 'mu-20260930.htm'}],
    }

    class Client:
        def get(self, url, attempts=3):
            assert url == 'https://www.sec.gov/files/company_tickers.json', url
            return json.dumps({'0': {'ticker': 'DELL', 'cik_str': 1571996}, '1': {'ticker': 'MU', 'cik_str': 723125}}).encode(), 'application/json'

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.dir.name, 'monitor.db')
        self.reads = []
        self.fail = set()

    def tearDown(self):
        self.dir.cleanup()

    def filings(self, _client, cik, start, end):
        ticker = {1571996: 'DELL', 723125: 'MU'}[cik]
        self.assertEqual((start, end), ('2026-05-12', '2026-11-21'), 'two quarters back, up to a week ago (younger: the live flash)')
        return [f for f in self.FILINGS[ticker] if start <= f['filed'] <= end]

    def read_filing(self, _client, ticker, _cik, filing):
        self.reads.append(filing['accession'])
        if filing['accession'] in self.fail:
            raise urllib.error.URLError('down')
        folder = 'latest-releases' if filing['accession'].endswith('-000018') else 'prior-releases'
        return (PRIOR if folder == 'prior-releases' else LATEST)[ticker]['url'], release(folder, ticker)

    def run_once(self, tickers=('DELL', 'MU')):
        with patch.object(prior.backfill, 'filings', self.filings), patch.object(prior.backfill, 'read_filing', self.read_filing):
            return prior.run_once(self.db, self.NOW, self.Client(), list(tickers), log=lambda _line: None)

    def history(self, start, end):
        return earnings_history.answer(self.db, {'from': [start], 'to': [end]})['resultBriefs']

    def test_previous_releases_are_stored_once_and_reach_the_calendar_history_only(self):
        self.fail = {'0000723125-26-000018'}
        self.assertEqual(self.run_once()['stored'], 2)
        self.assertEqual(self.run_once()['failed'], 1, 'a network failure is tried again on the next run')
        self.fail = set()
        self.assertEqual(self.run_once()['stored'], 1)
        self.assertEqual(self.run_once()['stored'], 0, 'each filing is read once')
        self.assertEqual(self.reads.count('0001571996-26-000039'), 1)
        september = self.history('2026-09-01', '2026-09-30')
        dell = next(b for b in september if b['ticker'] == 'DELL')
        self.assertEqual(dell['period'], 'Q2 FY2027')
        self.assertEqual(dell['publishedAt'], '2026-09-01T20:10:14.000+00:00')
        self.assertEqual([(f['key'], f['value'], f.get('comparisons')) for f in dell['facts'] if f['key'].startswith('guidance-')],
                         [('guidance-revenue', '$49.0B', None), ('guidance-adjusted-eps', '$6.50', None),
                          ('guidance-fy-revenue', '$192.0B', {'priorGuidance': '$167.0B'}), ('guidance-fy-adjusted-eps', '$25.50', {'priorGuidance': '$17.90'})])
        self.assertIsNone(dell['detectionToPublicMs'])
        june = self.history('2026-06-01', '2026-06-30')
        self.assertEqual([(b['ticker'], b['period']) for b in june], [('MU', 'Q3 FY2026')])
        db = sqlite3.connect(self.db)
        tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        db.close()
        self.assertIn('earnings_prior_releases', tables)
        self.assertNotIn('issuer_result_publications', tables, 'never written to the live flash store (news, push, X)')

    def test_a_release_the_live_store_holds_is_left_to_it(self):
        db = sqlite3.connect(self.db)
        flash.schema(db)
        db.execute('INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)',
                   ('k', 'MU', 'https://www.sec.gov/x', 'Q4 FY2026', '{}', '2026-09-30T20:02:30+00:00', '2026-09-30T20:03:00+00:00', 0, 'v'))
        db.commit()
        db.close()
        counts = self.run_once(['MU'])
        self.assertEqual((counts['stored'], counts['held-live']), (1, 1))

    def test_off_switch_and_the_service_thread(self):
        self.assertFalse(prior.enabled({'EARNINGS_PRIOR_BACKFILL': 'false'}))
        self.assertTrue(prior.enabled({}))
        service = (ROOT / 'scripts/research/service.py').read_text()
        self.assertIn('target=self.run_earnings_prior_backfill, name="earnings-prior-backfill", daemon=True', service)
        self.assertIn('self.earnings_prior_thread.start()', service)
        self.assertEqual(prior.INTERVAL, timedelta(hours=6))


if __name__ == '__main__':
    unittest.main()
