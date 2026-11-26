"""Earnings patrol of the 監視22銘柄 pages and the release-against-10-Q reconciliation (owner, Nov 26). No network: SEC and the site are faked."""
import gzip
import json
import re
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import earnings_patrol as patrol  # noqa: E402
import earnings_reconcile as reconcile  # noqa: E402
import monitor  # noqa: E402

FIXTURES = ROOT / 'tests/fixtures/latest-releases'
NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
NVDA_TEXT = gzip.open(FIXTURES / 'NVDA.txt.gz', 'rt').read()
ALAB_TEXT = gzip.open(FIXTURES / 'ALAB.txt.gz', 'rt').read()


def filings(*rows):
    """SEC submissions 'recent' from (form, accepted ISO, items, accession, reportDate) rows, newest first."""
    return {'filings': {'recent': {
        'form': [r[0] for r in rows], 'acceptanceDateTime': [r[1] for r in rows], 'items': [r[2] for r in rows],
        'accessionNumber': [r[3] for r in rows], 'reportDate': [r[4] if len(r) > 4 else '' for r in rows],
        'primaryDocument': ['doc.htm' for _ in rows]}}}


NVDA_8K = ('8-K', '2026-11-17T21:20:00.000Z', '2.02,9.01', '0001045810-26-000088')
NVDA_SECTION = {'from': 'dive', 'period': 'Q3 FY2027', 'releasedOn': '2026-11-17', 'hold': None,
                'tiles': [{'label': 'Revenue', 'value': '$115.8B'}, {'label': 'Data Center revenue', 'value': '$107.6B'},
                          {'label': 'Non-GAAP gross margin', 'value': '74.9%'}],
                'checks': {'diveCurrent': True, 'diveRevenue': True, 'flashRevenue': True, 'flashEps': True, 'flashGuidance': True}}


class Amounts(unittest.TestCase):
    def test_printed_figures_and_their_rounding(self):
        self.assertEqual(patrol.amount('$115.8B'), ('USD', Decimal('115800.0'), Decimal('50.0')))
        self.assertEqual(patrol.amount('NT$1,494.24B')[1], Decimal('1494240.00'))
        self.assertEqual(patrol.amount('−$190.4M')[1], Decimal('-190.4'))
        self.assertIsNone(patrol.amount('100%超'))
        self.assertEqual(patrol.per_share('$2.68'), ('USD', Decimal('2.68'), Decimal('0.005')))
        self.assertEqual(patrol.guidance('$60B–$63B'), ('USD', Decimal('60000'), Decimal('63000')))
        low, high = patrol.guidance('$130.0B ± 3%')[1:]
        self.assertEqual((low, high), (Decimal('126100.0000'), Decimal('133900.0000')))
        # $115.8B (rounded to $0.1B) agrees with the exact $115,844M; $116.0B does not.
        self.assertTrue(patrol.agree(patrol.amount('$115.8B'), ('USD', Decimal('115844'), Decimal('0.5'))))
        self.assertFalse(patrol.agree(patrol.amount('$116.0B'), ('USD', Decimal('115844'), Decimal('0.5'))))


class LatestRelease(unittest.TestCase):
    def read(self, rows, texts):
        return patrol.latest_release('NVDA', filings(*rows), NOW, exhibit=lambda cik, acc, numbers: texts.get(acc), primary=lambda *a: None)

    def test_the_newest_results_exhibit_is_read_with_the_monitors_own_parser(self):
        release = self.read([('4', '2026-11-20T00:00:00.000Z', '', 'x'), NVDA_8K], {NVDA_8K[3]: NVDA_TEXT})
        self.assertEqual(release['period'], 'Q3 FY2027')
        self.assertEqual(release['facts']['revenue']['value'], '$115.8B')
        self.assertEqual(release['facts']['guidance-revenue']['value'], '$130.0B ± 3%')

    def test_a_preliminary_notice_is_skipped_and_an_unreadable_release_is_reported(self):
        notice = ('Marvell and Lumentum to combine. Earnings per share accretive. Marvell Reports Preliminary Revenue for the Fiscal Third '
                  'Quarter 2027: consistent with previously provided guidance. Complete results will be reported in the 10-Q.')
        merger = ('8-K', '2026-11-20T13:06:00.000Z', '1.01,2.02,9.01', 'm-1')
        release = self.read([merger, NVDA_8K], {'m-1': notice, NVDA_8K[3]: NVDA_TEXT})
        self.assertEqual(release['accession'], NVDA_8K[3])
        changed = 'NVIDIA Announces Financial Results for Third Quarter Fiscal 2027. A new layout with no table.'
        release = self.read([('8-K', '2026-11-20T21:00:00.000Z', '2.02', 'n-1'), NVDA_8K], {'n-1': changed, NVDA_8K[3]: NVDA_TEXT})
        self.assertEqual(release['accession'], 'n-1')
        self.assertIn('unreadable', release)

    def test_nothing_in_the_lookback_is_none(self):
        self.assertIsNone(self.read([('8-K', '2026-01-02T21:00:00.000Z', '2.02', 'old')], {'old': NVDA_TEXT}))


def nvda_release(**changes):
    release = patrol.latest_release('NVDA', filings(NVDA_8K), NOW, exhibit=lambda *a: NVDA_TEXT, primary=lambda *a: None)
    release.update(changes)
    return release


class Judge(unittest.TestCase):
    def test_a_page_with_the_releases_quarter_and_figures_is_clean(self):
        self.assertEqual(patrol.judge('NVDA', nvda_release(), NVDA_SECTION, NOW), [])

    def test_a_newer_release_than_the_page_is_stale_after_the_grace_period_only(self):
        section = {**NVDA_SECTION, 'period': 'Q2 FY2027', 'releasedOn': '2026-08-26'}
        self.assertEqual(patrol.judge('NVDA', nvda_release(), section, NOW), ['section-stale'])
        just_filed = nvda_release(accepted=NOW - timedelta(minutes=5))
        self.assertEqual(patrol.judge('NVDA', just_filed, section, NOW), [])
        self.assertEqual(patrol.judge('NVDA', nvda_release(unreadable='parser-refused'), section, NOW), ['source-unreadable'])

    def test_a_figure_that_differs_from_the_release_is_a_mismatch(self):
        tiles = [{'label': 'Revenue', 'value': '$118.8B'}, {'label': 'Adjusted EPS', 'value': '$2.86'},
                 {'label': 'Next-quarter revenue guidance', 'value': '$120B–$124B'}]
        self.assertEqual(patrol.judge('NVDA', nvda_release(), {**NVDA_SECTION, 'tiles': tiles}, NOW),
                         ['revenue-mismatch', 'eps-mismatch', 'guidance-mismatch'])
        right = [{'label': 'Revenue', 'value': '$115.84B'}, {'label': 'Adjusted EPS', 'value': '$2.68'},
                 {'label': 'Next-quarter revenue guidance', 'value': '$126.1B–$133.9B'}]
        self.assertEqual(patrol.judge('NVDA', nvda_release(), {**NVDA_SECTION, 'tiles': right}, NOW), [])

    def test_the_dive_is_checked_through_the_sites_answers_and_a_held_release_is_reported(self):
        checks = {**NVDA_SECTION['checks'], 'diveCurrent': False, 'flashGuidance': False}
        self.assertEqual(patrol.judge('NVDA', nvda_release(), {**NVDA_SECTION, 'checks': checks, 'hold': 'figures-unreadable'}, NOW),
                         ['dive-stale', 'dive-mismatch', 'section-held'])
        self.assertEqual(patrol.judge('NVDA', None, NVDA_SECTION, NOW), ['source-missing'])
        self.assertEqual(patrol.judge('NVDA', nvda_release(), None, NOW), ['site-unreadable'])

    def test_the_roster_is_the_22_companies_of_the_site(self):
        dives = re.search(r'DIVE_TICKERS = \[([^\]]+)\]', (ROOT / 'lib/research/company-dive.ts').read_text())[1]
        self.assertEqual(sorted(patrol.ROSTER), sorted(['MU', *re.findall(r'"([A-Z]+)"', dives)]))
        self.assertEqual(len(patrol.ROSTER), 22)
        for ticker in patrol.ROSTER:
            self.assertIn(ticker, patrol.flash.PROFILES, ticker)  # every company has a release parser
            self.assertTrue(patrol.cik(ticker), ticker)           # and an SEC route


class Production(unittest.TestCase):
    def test_sections_come_from_the_public_route_and_mu_from_its_live_feed(self):
        answers = {
            'https://techphase.app/api/research/company-earnings': {'ok': True, 'companies': [
                {'ticker': 'NVDA', 'section': {k: v for k, v in NVDA_SECTION.items() if k not in ('checks', 'hold')},
                 'checks': NVDA_SECTION['checks'], 'hold': None}, {'ticker': 'AMD', 'missing': True}]},
            'https://techphase.app/api/research/watch-earnings': {'ok': True, 'snapshot': {'period': 'FQ4 2026', 'releasedOn': '2026-09-30',
                'tiles': [{'label': {'ja': '売上高', 'en': 'Revenue'}, 'value': {'ja': '542.29億ドル', 'en': '$54.229B'}}]}},
        }
        sections = patrol.production_sections(fetch_json=answers.__getitem__)
        self.assertEqual(sections['NVDA']['period'], 'Q3 FY2027')
        self.assertEqual(sections['MU']['tiles'], [{'label': 'Revenue', 'value': '$54.229B'}])
        self.assertNotIn('AMD', sections)
        self.assertNotIn(patrol.ROUTE_DOWN, sections)

    def test_a_missing_route_is_one_site_problem_not_one_per_company(self):
        def answers(url):
            if url.endswith('/api/research/company-earnings'):
                raise OSError('404')
            if url.endswith('/api/research/watch-earnings'):
                return {'snapshot': None}
            return filings()  # SEC submissions
        results, _ = patrol.patrol(NOW, tickers=['NVDA', 'AMD'], fetch_json=answers,
                                   read_release=lambda t, f, n: None, sections=patrol.production_sections(fetch_json=answers))
        self.assertEqual({k: v for k, v in results.items() if not k.endswith(':release')},
                         {'NVDA': [], 'AMD': [], 'SITE': ['site-route-unavailable']})


class QuarterFilings(unittest.TestCase):
    def test_the_10q_after_the_release_and_the_deal_8ks_since_the_previous_release_are_read(self):
        sub = filings(('10-Q', '2026-11-19T21:00:00.000Z', '', 'q-1', '2026-10-25'),
                      ('8-K', '2026-11-18T13:00:00.000Z', '1.01,2.02,9.01', 'deal-1'),
                      ('8-K', '2026-11-18T12:00:00.000Z', '5.02', 'officer-1'),
                      NVDA_8K,
                      ('8-K', '2026-08-20T13:00:00.000Z', '1.01', 'old-deal'),
                      ('10-Q', '2026-08-27T21:00:00.000Z', '', 'q-0', '2026-07-26'))
        release = nvda_release()
        fetched = []
        report, events = patrol.quarter_filings('NVDA', sub, release, {'releasedOn': '2026-08-15'},
                                                fetch=lambda url: fetched.append(url) or 'report text',
                                                exhibit=lambda cik, acc, numbers: (f'https://www.sec.gov/{acc}.htm', 'deal text'))
        self.assertEqual(report['accession'], 'q-1')
        self.assertEqual(report['text'], 'report text')
        self.assertEqual([e['accession'] for e in events], ['old-deal', 'deal-1'])  # since the previous release, oldest first; never the release itself

    def test_a_foreign_issuers_results_day_6ks_are_read_only_for_a_dive_that_uses_them(self):
        sub = filings(('6-K', '2026-11-20T11:00:00.000Z', '', 'later-6k'),
                      ('6-K', '2026-10-28T10:06:14.000Z', '', 'returns-6k'),
                      ('6-K', '2026-10-28T10:01:57.000Z', '', 'results-6k'),
                      ('6-K', '2026-10-14T10:02:00.000Z', '', 'earlier-6k'))
        release = {'accession': 'results-6k', 'accepted': datetime(2026, 10, 28, 10, 1, 57, tzinfo=timezone.utc)}
        read = []
        _, events = patrol.quarter_filings('SKHY', sub, release, {'releasedOn': '2026-07-29'}, fetch=lambda url: None,
                                           exhibit=lambda *a: (None, None), document=lambda url: read.append(url) or 'notice text')
        self.assertEqual([e['accession'] for e in events], ['returns-6k'])   # the results day only, never the results 6-K itself
        _, events = patrol.quarter_filings('NBIS', sub, release, {'releasedOn': '2026-07-29'}, fetch=lambda url: None,
                                           exhibit=lambda *a: (None, None), document=lambda url: 'notice text')
        self.assertEqual(events, [])   # a company whose dive reads no other 6-K

    def test_sk_hynix_newsroom_release_is_read_from_its_own_site(self):
        tried = []
        page = b'<html><body>SK hynix Newsroom 3Q26 Financial Results</body></html>'
        got = patrol.newsroom_release('SKHY', 'Q3 2026', get=lambda url: tried.append(url) or page)
        self.assertEqual(tried, ['https://news.skhynix.com/en/q3-2026-business-results/'])
        self.assertIn('3Q26 Financial Results', got[0]['text'])

        def blocked(url):
            tried.append(url)
            raise OSError('403')
        tried.clear()
        self.assertEqual(patrol.newsroom_release('SKHY', 'Q4 2026', get=blocked), [])   # held, read again at the next patrol
        self.assertEqual(tried, ['https://news.skhynix.com/en/q4-2026-business-results/', 'https://news.skhynix.com/en/sk-hynix-announces-fy26-financial-results/'])

    def test_a_leadership_8k_is_read_from_its_cover_document_for_a_dive_that_reports_it(self):
        sub = filings(('8-K', '2026-11-23T01:00:00.000Z', '5.02,9.01', 'ceo-back'), ('8-K', '2026-11-11T21:30:00.000Z', '5.02', 'ceo-out'), NVDA_8K)
        read = []
        _, events = patrol.quarter_filings('NVDA', sub, nvda_release(), {'releasedOn': '2026-08-26'}, fetch=lambda url: None,
                                           exhibit=lambda *a: (None, None), document=lambda url: read.append(url) or 'notice text')
        self.assertEqual([e['accession'] for e in events], ['ceo-out', 'ceo-back'])
        self.assertEqual(len(read), 2)
        _, events = patrol.quarter_filings('AMD', sub, nvda_release(), {'releasedOn': '2026-08-26'}, fetch=lambda url: None,
                                           exhibit=lambda *a: (None, None), document=lambda url: 'notice text')
        self.assertEqual(events, [])   # Item 5.02 alone is not read for a company whose dive does not report it


class Records(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'

    def incidents(self, db):
        return {r['subject']: (r['status'], r['severity'], r['last_error_code']) for r in db.execute(
            "SELECT subject,status,severity,last_error_code FROM operational_incidents WHERE category='earnings-patrol'")}

    def test_a_problem_opens_an_owner_incident_until_the_company_is_clean_and_the_day_has_one_summary_line(self):
        with monitor.connect(self.path) as db:
            line, daily = patrol.record(db, {'NVDA': ['section-stale'], 'AMD': ['dive-stale'], 'MU': []}, NOW, 'release')
            self.assertEqual(line['problems'], {'AMD': ['dive-stale'], 'NVDA': ['section-stale']})
            self.assertEqual(daily['stale'], ['AMD', 'NVDA'])
            self.assertEqual(daily['companies'], 3)
            self.assertEqual(self.incidents(db), {'NVDA': ('open', 'critical', 'section-stale'), 'AMD': ('open', 'warning', 'dive-stale')})
            # the next patrol the same day: no second daily line; NVDA is fixed and its incident is resolved
            _, daily = patrol.record(db, {'NVDA': [], 'AMD': ['dive-stale'], 'MU': []}, NOW + timedelta(hours=2), 'schedule')
            self.assertIsNone(daily)
            self.assertEqual(self.incidents(db)['NVDA'][0], 'resolved')
            self.assertEqual(patrol.diagnostics(db)['lastRun']['problems'], {'AMD': ['dive-stale']})
            # never a figure, URL or text in what is stored or printed
            stored = json.dumps([dict(r) for r in db.execute('SELECT * FROM earnings_patrol_runs')])
            self.assertNotRegex(stored, r'\$|https?:')

    def test_schedule_every_three_hours_and_minutes_after_a_new_release(self):
        s = patrol.Schedule()
        self.assertEqual(s.tick('t1', NOW), 'schedule')
        self.assertIsNone(s.tick('t1', NOW + timedelta(hours=1)))
        self.assertIsNone(s.tick('t2', NOW + timedelta(hours=1, minutes=1)))  # a new flash: wait for the site to pick it up
        self.assertEqual(s.tick('t2', NOW + timedelta(hours=1, minutes=5)), 'release')
        self.assertIsNone(s.tick('t2', NOW + timedelta(hours=2)))
        self.assertEqual(s.tick('t2', NOW + timedelta(hours=4, minutes=6)), 'schedule')


class Reconcile(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'

    def concept(self, values):
        def fetch(url):
            tag = url.rsplit('/', 1)[1][:-5]
            if tag not in values:
                raise OSError('404')
            unit = 'USD/shares' if tag == 'EarningsPerShareDiluted' else 'USD'
            return {'units': {unit: [
                {'start': '2026-04-27', 'end': '2026-07-26', 'val': 1, 'accn': 'older'},
                {'start': '2026-07-27', 'end': '2026-10-25', 'val': values[tag], 'accn': '0001045810-26-000099'},
                {'start': '2026-01-26', 'end': '2026-10-25', 'val': 999, 'accn': '0001045810-26-000099'}]}}
        return fetch

    def run_reconcile(self, values):
        release = nvda_release()
        sub = filings(('10-Q', '2026-11-19T21:00:00.000Z', '', '0001045810-26-000099', '2026-10-25'), NVDA_8K)
        with monitor.connect(self.path) as db:
            out = list(reconcile.run(db, {'NVDA:release': release}, {'NVDA': sub}, NOW, fetch_json=self.concept(values)))
            rows = {r['field']: r['status'] for r in db.execute('SELECT field,status FROM earnings_reconciliations')}
            again = list(reconcile.run(db, {'NVDA:release': release}, {'NVDA': sub}, NOW, fetch_json=self.concept(values)))
            incident = db.execute("SELECT status,last_error_code FROM operational_incidents WHERE category='earnings-reconcile'").fetchone()
        return out, rows, again, incident

    def test_the_10q_agrees_with_the_release_to_its_printed_rounding(self):
        out, rows, again, incident = self.run_reconcile({'Revenues': 115_844_000_000, 'EarningsPerShareDiluted': 2.70, 'NetIncomeLoss': 65_311_000_000})
        self.assertEqual(rows, {'revenue': 'match', 'eps': 'match', 'net-income': 'match'})
        self.assertEqual(out[0]['report'], '10-Q')
        self.assertEqual(again, [], 'each report is reconciled once')
        self.assertIsNone(incident)

    def test_a_difference_is_logged_and_alerted_and_a_missing_quarter_fact_is_only_logged(self):
        out, rows, _, incident = self.run_reconcile({'RevenueFromContractWithCustomerExcludingAssessedTax': 116_900_000_000,
                                                      'EarningsPerShareDiluted': 2.70})
        self.assertEqual(rows, {'revenue': 'differs', 'eps': 'match', 'net-income': 'not-found'})
        self.assertEqual(tuple(incident), ('open', 'differs:revenue'))

    def test_no_report_after_the_release_means_waiting(self):
        sub = filings(NVDA_8K, ('10-Q', '2026-08-27T21:00:00.000Z', '', 'previous-quarter', '2026-07-26'))
        with monitor.connect(self.path) as db:
            self.assertEqual(list(reconcile.run(db, {'NVDA:release': nvda_release()}, {'NVDA': sub}, NOW, fetch_json=self.concept({}))), [])


if __name__ == '__main__':
    unittest.main()
