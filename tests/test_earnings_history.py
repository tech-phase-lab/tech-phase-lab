"""The calendar's 「発表済みの結果」 reads every stored result of a month (owner, Nov 18), and the SEC backfill lists results
without inventing figures."""
import gzip
import hashlib
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import earnings_announce  # noqa: E402
import earnings_history  # noqa: E402
import earnings_history_backfill as backfill  # noqa: E402
import highlight_sentences  # noqa: E402
import market_results  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import monitor  # noqa: E402

FX = Path(__file__).parent / 'fixtures'
ROOT = Path(__file__).resolve().parents[1]


def store_flash(db, ticker, url, period, observed, facts):
    parsed = {'period': period, 'facts': facts}
    key, payload = flash.build(ticker, url, parsed, observed)
    db.execute('INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)',
               (key, ticker, url, period, json.dumps(payload, ensure_ascii=False), observed, observed, 120, flash.VERSION))


THREE = [('revenue', '$1.443B', '$1.135B'), ('net-income', '$130M', '$238M'), ('operating-income', '$201M', '$163M')]


class History(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'monitor.sqlite3'
        with monitor.connect(self.path) as db:
            flash.schema(db)
            earnings_announce.schema(db)
            store_flash(db, 'META', 'https://www.sec.gov/Archives/edgar/data/1326801/000132680126000101/meta-ex991.htm', 'Q3 2026',
                        '2026-10-21T20:03:00.000+00:00', THREE)
            store_flash(db, 'PANW', 'https://www.sec.gov/Archives/edgar/data/1327567/000132756726000040/panw-ex991.htm', 'Q1 FY2027',
                        '2026-11-18T21:37:00.000+00:00', THREE)
            # a flash with a single figure stays off the site (display floor), as in the live feed
            store_flash(db, 'AMD', 'https://www.sec.gov/Archives/edgar/data/2488/000000248826000050/amd-ex991.htm', 'Q3 2026',
                        '2026-10-28T20:16:00.000+00:00', THREE[:1])
            # the company's own "announced" line: kept in October (no figures for that release), dropped where figures exist
            for ticker, url, at in [('IBM', 'https://www.ibm.com/investor/q3-2026', '2026-10-21T20:19:00.000+00:00'),
                                    ('META', 'https://investor.atmeta.com/q3-2026', '2026-10-21T20:05:00.000+00:00')]:
                db.execute('INSERT INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                           (hashlib.sha256(url.encode()).hexdigest(), ticker, url, 'Q3 2026', at, at, 50))
        self.addCleanup(self.tmp.cleanup)

    def test_a_month_lists_every_stored_result_of_that_month_only(self):
        start, end = earnings_history.parse_range({'from': ['2026-10-01'], 'to': ['2026-10-31']})
        db = earnings_history.connect_read_only(self.path)
        try:
            october = earnings_history.results(db, start, end)
        finally:
            db.close()
        self.assertEqual([(i['ticker'], i['researchId'].split('-')[1]) for i in october], [('IBM', 'announce'), ('META', 'flash')])
        start, end = earnings_history.parse_range({'from': ['2026-11-01'], 'to': ['2026-11-30']})
        db = earnings_history.connect_read_only(self.path)
        try:
            november = earnings_history.results(db, start, end)
        finally:
            db.close()
        self.assertEqual([i['ticker'] for i in november], ['PANW'])
        self.assertEqual(november[0]['facts'][0]['value'], '$1.443B')

    def test_old_results_outside_the_live_window_are_still_served(self):
        # the news feed's window is seven days; the history reads by month whatever the current date
        answer = earnings_history.answer(self.path, {'from': ['2026-10-01'], 'to': ['2026-10-31']})
        self.assertTrue(answer['ok'])
        self.assertEqual((answer['from'], answer['to']), ('2026-10-01', '2026-10-31'))
        self.assertIn('META', [i['ticker'] for i in answer['resultBriefs']])

    def test_range_is_validated_and_bounded(self):
        for query in [{}, {'from': ['2026-10-01']}, {'from': ['2026-10-01'], 'to': ['2026-13-01']},
                      {'from': ['2026-10-01'], 'to': ['2026-09-30']}, {'from': ['2026-01-01'], 'to': ['2026-12-31']},
                      {'from': ['2026-10-01', '2026-10-02'], 'to': ['2026-10-31']}, {'from': ["2026-10-01'"], 'to': ['2026-10-31']},
                      {'from': ['2026-10-01'], 'to': ['2026-10-31'], 'limit': ['9']}]:
            with self.assertRaises(ValueError, msg=query):
                earnings_history.parse_range(query)

    def test_read_only(self):
        db = earnings_history.connect_read_only(self.path)
        try:
            with self.assertRaises(Exception):
                db.execute('DELETE FROM issuer_result_publications')
        finally:
            db.close()

    def test_endpoint_uses_the_news_token(self):
        import service
        handler = object.__new__(service.Handler)
        handler.server = SimpleNamespace(app=SimpleNamespace(db_path=self.path))
        results = []
        handler.send_json = lambda status, payload: results.append((status, payload))
        for configured, supplied, query, expected in [('test', '', 'from=2026-10-01&to=2026-10-31', 401),
                                                      ('test', 'Bearer wrong', 'from=2026-10-01&to=2026-10-31', 401),
                                                      ('test', 'Bearer test', 'from=2026-10-01&to=2027-10-31', 400),
                                                      ('test', 'Bearer test', 'from=2026-10-01&to=2026-10-31', 200)]:
            handler.path = '/earnings-results?' + query
            handler.headers = {'Authorization': supplied}
            with patch.dict(os.environ, {'RESEARCH_API_TOKEN': configured, 'RESOLUTE_NEWS_READ_TOKEN': ''}):
                handler.do_GET()
            self.assertEqual(results[-1][0], expected, query)
        self.assertEqual({i['ticker'] for i in results[-1][1]['resultBriefs']}, {'IBM', 'META'})


class Backfill(unittest.TestCase):
    def test_nebius_html_release_of_the_sec_6k_is_read(self):
        # Nov 12, 2026 6-K EX-99.1 prints "571 %" and "(119.6 )"; the PDF layout's parser now reads it, figures as printed
        parsed = flash.parse_nebius((FX / 'nebius-results-q326-sec-html.txt').read_text(), 'https://www.sec.gov/Archives/edgar/data/1513845/x/y.htm')
        self.assertEqual(parsed['period'], 'Q3 2026')
        self.assertEqual([(f[0], f[1], f[2]) for f in parsed['facts']],
                         [('revenue', '$980.8M', '$146.1M'), ('net-income', '$-37.5M', '$-119.6M'),
                          ('adjusted-ebitda', '$465.8M', '$-5.2M'), ('adjusted-net-income', '$90.9M', '$-100.4M')])

    def test_the_pdf_layout_is_unchanged(self):
        self.assertEqual(flash.parse_nebius((FX / 'nebius-results-q326.txt').read_text())['facts'][0][1], '$980.8M')

    def test_release_period_named_in_the_first_lines(self):
        release_period = highlight_sentences.release_period
        cases = {'IBM RELEASES THIRD-QUARTER RESULTS ... today announced third-quarter 2026 earnings results.': 'Q3 2026',
                 'IREN Reports Q1 FY27 Results Quarterly AI Cloud Revenue': 'Q1 FY2027',
                 'Qualcomm Announces Fourth Quarter and Fiscal 2026 Results': 'Q4 FY2026',
                 'COHERENT CORP. REPORTS FIRST QUARTER FISCAL 2027 RESULTS': 'Q1 FY2027',
                 'Q3 2026 Update Highlights Financial Summary': 'Q3 2026',
                 'announced via press release its results for the third quarter ended September 30, 2026.': 'Q3 2026',
                 'Board resolution on dividends': '決算'}
        for text, expected in cases.items():
            self.assertEqual(release_period(text), expected, text)

    def test_only_results_filings_without_figures_are_listed(self):
        eight_k = {'form': '8-K', 'primary': 'tsla-8k.htm'}
        exhibit = 'https://www.sec.gov/Archives/edgar/data/1/2/ex991.htm'
        self.assertTrue(backfill.is_results(eight_k, exhibit, 'EX-99.1 Q3 2026 Update Highlights'))
        self.assertFalse(backfill.is_results(eight_k, exhibit, 'Tesla Third Quarter 2026 Production, Deliveries & Deployments results'))
        self.assertFalse(backfill.is_results(eight_k, exhibit, 'MARVELL AND LUMENTUM TO COMBINE ... third quarter results'))
        cover = 'https://www.sec.gov/Archives/edgar/data/1/2/tsla-8k.htm'
        self.assertTrue(backfill.is_results(eight_k, cover, 'FORM 8-K Item 2.02. Results of Operations ... announced its results for the third quarter'))
        six_k = {'form': '6-K', 'primary': 'd1.htm'}
        self.assertFalse(backfill.is_results(six_k, exhibit, 'Board resolved to designate the record date for quarterly cash dividends'))

    def test_committed_history_is_well_formed_and_never_invents_figures(self):
        data = json.loads((ROOT / 'lib/research/earnings-results-history.json').read_text())
        coverage = [c['ticker'] for c in json.loads((ROOT / 'lib/research/calendar-coverage.json').read_text())]
        self.assertEqual([c['ticker'] for c in data['companies']], coverage)
        for brief in data['resultBriefs']:
            self.assertEqual(brief['kind'], 'earnings')
            self.assertTrue(brief['url'].startswith('https://www.sec.gov/Archives/edgar/data/'), brief['url'])
            if brief['researchId'].startswith('ir-flash-'):
                self.assertGreaterEqual(len(brief['facts']), 1 if brief['method'] == highlight_sentences.METHOD else 3)
                self.assertIn(brief['ticker'], flash.PROFILES)
            else:
                self.assertEqual((brief['researchId'], brief['facts']), ('ir-announce-' + brief['id'], []))
            at = datetime.fromisoformat(brief['publishedAt'])
            self.assertTrue(datetime(2026, 10, 1, tzinfo=timezone.utc) <= at < datetime(2026, 12, 1, tzinfo=timezone.utc))
        for company in data['companies']:
            self.assertEqual(company['figures'], any(b['ticker'] == company['ticker'] and b['facts'] for b in data['resultBriefs']))



class HighlightSentences(unittest.TestCase):
    """Companies outside the deep-analysis roster: figures from the release's own highlight sentences (owner, Nov 18)."""

    def read(self, name):
        parsed = highlight_sentences.parse((FX / name).read_text())
        return parsed['period'], [(f[0], f[1], f[3][0]) for f in parsed['facts']]

    def test_real_releases(self):
        self.assertEqual(self.read('coherent-results-q1fy27-head.txt'),
                         ('Q1 FY2027', [('revenue', '$2.37B', '売上高'), ('eps', '$1.90', 'EPS（GAAP）'), ('adjusted-eps', '$2.09', '調整後EPS（Non-GAAP）')]))
        self.assertEqual(self.read('ibm-results-q326-head.txt'), ('Q3 2026', [('revenue', '$17.1B', '売上高')]))
        # "Total quarterly revenue ... to $228 million"; the segment ("AI Cloud quarterly revenue ... $200 million") and the backlog are not read
        self.assertEqual(self.read('iren-results-q1fy27-head.txt'), ('Q1 FY2027', [('revenue', '$228M', '売上高')]))
        self.assertEqual(self.read('vistra-results-q326-head.txt'), ('Q3 2026', [('net-income', '$1.14B', '純損益')]))
        # "$0.8B GAAP net income $1.7B non-GAAP net income": the GAAP figure only
        self.assertEqual(self.read('tesla-update-q326-head.txt'),
                         ('Q3 2026', [('net-income', '$800M', '純損益'), ('operating-income', '$700M', '営業損益')]))

    def test_full_year_and_non_results_are_not_read(self):
        # Qualcomm's sentences give the fiscal year, not the quarter
        with self.assertRaises(ValueError):
            highlight_sentences.parse((FX / 'qualcomm-results-q4fy26-head.txt').read_text())
        with self.assertRaisesRegex(ValueError, 'not-a-results-release'):
            highlight_sentences.parse((FX / 'tesla-deliveries-q326-head.txt').read_text())

    def test_ambiguous_and_outlook_sentences_are_left_out(self):
        head = 'ACME Reports Third Quarter 2026 Results • Revenue of $2.0 billion • '
        self.assertEqual(highlight_sentences.parse(head + 'Revenue of $2.1 billion • GAAP EPS of $0.50')['facts'],
                         [('eps', '$0.50', None, ('EPS（GAAP）', 'GAAP EPS'))])
        with self.assertRaises(ValueError):
            highlight_sentences.parse('ACME Reports Third Quarter 2026 Results • For the full year, revenue of $9.0 billion. We expect revenue of $3.0 billion')
        parsed = highlight_sentences.parse('ACME Reports Third Quarter 2026 Results • Non-GAAP revenue of $2.2 billion • Diluted EPS of $0.57')
        self.assertEqual([(f[0], f[1]) for f in parsed['facts']], [('eps', '$0.57')])

    def test_table_parser_first_then_sentences_outside_the_roster_only(self):
        text = (FX / 'coherent-results-q1fy27-head.txt').read_text()
        self.assertEqual(flash.parse_with_sentences('COHR', text, None)['method'], highlight_sentences.METHOD)
        with self.assertRaises(ValueError):  # a roster company keeps its own verified fallback
            flash.parse_with_sentences('NVDA', text, None)

    def test_display_floor_keeps_a_sentence_result_with_one_figure(self):
        key, payload = flash.build('IBM', 'https://www.sec.gov/Archives/edgar/data/51143/1/ibm.htm',
                                   {**highlight_sentences.parse((FX / 'ibm-results-q326-head.txt').read_text()), 'method': highlight_sentences.METHOD},
                                   '2026-10-21T20:19:17.000+00:00')
        self.assertEqual(payload['method'], highlight_sentences.METHOD)
        self.assertEqual(len(market_results.display_floor([payload])), 1)
        table = {**payload, 'method': 'deterministic-issuer-table'}
        self.assertEqual(market_results.display_floor([table]), [])



def latest_release(ticker):
    """The extracted text of the company's latest results release (tests/fixtures/latest-releases, from SEC EDGAR)."""
    return gzip.decompress((FX / 'latest-releases' / f'{ticker}.txt.gz').read_bytes()).decode()


class Qualcomm(unittest.TestCase):
    """Qualcomm's quarterly results table (Q4 FY2026, 8-K of Nov 4, 2026): the quarter is only in tables, its highlight sentences are
    the fiscal year's."""

    def text(self):
        return ' '.join(latest_release('QCOM').split())

    def test_reads_the_gaap_and_non_gaap_columns_and_the_statement(self):
        parsed = flash.parse_qualcomm(self.text())
        self.assertEqual(parsed['period'], 'Q4 FY2026')
        self.assertEqual(parsed['facts'], [('revenue', '$10.322B', '$11.27B'), ('eps', '$1.17', '$-2.89'), ('adjusted-eps', '$2.17', '$3.00'),
                                           ('net-income', '$1.251B', '$-3.117B'), ('operating-income', '$1.356B', '$2.918B')])
        self.assertIs(flash.PROFILES['QCOM']['parse'], flash.parse_qualcomm)
        self.assertIn(flash.PROFILES['QCOM']['marker'], ' '.join(self.text().split()))
        self.assertNotIn('sentences-only', flash.PROFILES['QCOM'])

    def test_a_row_whose_change_disagrees_is_left_out(self):
        parsed = flash.parse_qualcomm(self.text().replace('Net income $1,251 ($3,117) +140%', 'Net income $1,251 ($3,117) +40%'))
        self.assertNotIn('net-income', [f[0] for f in parsed['facts']])
        self.assertIn('operating-income', [f[0] for f in parsed['facts']])  # still checked against the statement's own revenue and costs
        with self.assertRaisesRegex(ValueError, 'revenue-row-unrecognized'):
            flash.parse_qualcomm(self.text().replace('Revenues $10,322 $11,270 (8%)', 'Revenues $10,322 $11,270 (18%)', 1))

    def test_operating_income_only_when_the_statement_agrees(self):
        keys = lambda text: [f[0] for f in flash.parse_qualcomm(text)['facts']]  # noqa: E731
        self.assertNotIn('operating-income', keys(self.text().replace('Operating income 1,356 2,918', 'Operating income 1,366 2,918')))
        self.assertNotIn('operating-income', keys(self.text().replace('Total revenues 10,322 11,270', 'Total revenues 10,323 11,270')))

    def test_the_columns_must_be_the_quarter_and_a_year_earlier(self):
        with self.assertRaisesRegex(ValueError, 'columns-unrecognized'):
            flash.parse_qualcomm(self.text().replace('Q4 Fiscal 2026 Q4 Fiscal 2025 Change Q4', 'Q4 Fiscal 2026 Q3 Fiscal 2026 Change Q4', 1))
        with self.assertRaisesRegex(ValueError, 'table-heading-missing'):
            flash.parse_qualcomm(self.text().replace('Fourth Quarter Results', 'Fourth Quarter Summary'))


class Constellation(unittest.TestCase):
    """Constellation's Q3 2026 release (8-K EX-99.1 of Nov 9, 2026, filed under its co-registrant's CIK 1168165)."""

    def text(self):
        return ' '.join(latest_release('CEG').split())

    def test_reads_the_statements_and_the_reconciliation(self):
        parsed = flash.parse_with_sentences('CEG', self.text(), None)
        self.assertEqual(parsed['period'], 'Q3 2026')
        self.assertEqual(parsed['facts'], [('revenue', '$9.55B', '$6.57B'), ('eps', '$5.19', '$2.97'), ('adjusted-eps', '$5.06', '$3.04'),
                                           ('net-income', '$1.835B', '$930M'), ('operating-income', '$2.492B', '$1.086B')])
        self.assertIs(flash.PROFILES['CEG']['parse'], flash.parse_constellation)
        self.assertIn(flash.PROFILES['CEG']['marker'], ' '.join(self.text().split()))

    def test_a_statement_that_disagrees_with_itself_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'revenue-row-unrecognized'):
            flash.parse_constellation(self.text().replace('Operating income (loss) 2,492 5,404', 'Operating income (loss) 2,592 5,404'))
        with self.assertRaisesRegex(ValueError, 'revenue-row-unrecognized'):
            flash.parse_constellation(self.text().replace('Net income (loss) 929 1,891', 'Net income (loss) 939 1,891'))

    def test_per_share_figures_must_agree_with_the_highlights_and_the_statement(self):
        keys = lambda text: [f[0] for f in flash.parse_constellation(text)['facts']]  # noqa: E731
        self.assertNotIn('adjusted-eps', keys(self.text().replace('Operating Earnings of $5.06 per share', 'Operating Earnings of $5.16 per share')))
        changed = keys(self.text().replace('Diluted $ 5.19 $ 2.97', 'Diluted $ 5.18 $ 2.97'))
        self.assertNotIn('eps', changed)
        self.assertNotIn('adjusted-eps', changed)
        self.assertIn('net-income', changed)

    def test_the_year_ago_block_must_be_the_same_quarter(self):
        with self.assertRaisesRegex(ValueError, 'columns-unrecognized'):
            flash.parse_constellation(self.text().replace('Three Months Ended September 30, 2025 Nine', 'Three Months Ended June 30, 2025 Nine'))


INDEX = """<html><body>
<div class="companyInfo">
  <span class="companyName">CONSTELLATION ENERGY GENERATION LLC (Filer)
 <acronym title="Central Index Key">CIK</acronym>: <a href="/cgi-bin/browse-edgar?CIK=0001168165&amp;action=getcompany">0001168165 (see all company filings)</a></span>
</div>
<div class="companyInfo">
  <span class="companyName">Constellation Energy Corp (Filer)
 <acronym title="Central Index Key">CIK</acronym>: <a href="/cgi-bin/browse-edgar?CIK=0001868275&amp;action=getcompany">0001868275 (see all company filings)</a></span>
</div>
<p>See also <a href="/cgi-bin/browse-edgar?CIK=0009999999&amp;action=getcompany">another company</a></p>
<table class="tableFile">
<tr><td scope="row">1</td><td scope="row"></td><td scope="row"><a href="/ix?doc=/Archives/edgar/data/1168165/000186827526000116/ceg-20261109.htm">ceg-20261109.htm</a></td><td scope="row">8-K</td></tr>
<tr><td scope="row">2</td><td scope="row">EX-99.1</td><td scope="row"><a href="/Archives/edgar/data/1168165/000186827526000116/ceg-20261109991.htm">ceg-20261109991.htm</a></td><td scope="row">EX-99.1</td></tr>
<tr><td scope="row">3</td><td scope="row">EX-99.1</td><td scope="row"><a href="/Archives/edgar/data/9999999/000186827526000116/other.htm">other.htm</a></td><td scope="row">EX-99.1</td></tr>
<tr><td scope="row">4</td><td scope="row">EX-99.1</td><td scope="row"><a href="/Archives/edgar/data/1168165/000186827526000999/other-accession.htm">x</a></td><td scope="row">EX-99.1</td></tr>
</table></body></html>"""
PRIMARY = 'https://www.sec.gov/Archives/edgar/data/1868275/000186827526000116/ceg-20261109.htm'
# The 8-K's own exhibit list (as filed): the exhibit number and then its description, both linked to the same document.
COVER = (b'<html><body><p>FORM 8-K Item 2.02 Results of Operations and Financial Condition</p><table>'
         b'<tr><td><a href="ceg-20261109991.htm">99.1</a></td><td><a href="ceg-20261109991.htm">Press release and earnings release attachments</a></td></tr>'
         b'<tr><td><a href="ceg-20261109992.htm">99.2</a></td><td><a href="ceg-20261109992.htm">Earnings conference call presentation slides</a></td></tr>'
         b'</table></body></html>')


class CoRegistrant(unittest.TestCase):
    """Constellation's EX-99.1: the 8-K links it under CEG's own directory; the filing index lists it under its co-registrant's."""

    def release(self):
        return ('<html><body><p>CONSTELLATION REPORTS THIRD QUARTER 2026 RESULTS Earnings Release Highlights GAAP Net Income of $5.19 per share '
                + 'and more text ' * 40 + '</p></body></html>').encode()

    def test_the_exhibit_number_label_counts_although_a_description_follows(self):
        self.assertEqual(monitor.sec_exhibit_links(COVER, PRIMARY, 'CEG'),
                         ['https://www.sec.gov/Archives/edgar/data/1868275/000186827526000116/ceg-20261109991.htm'])
        self.assertEqual(monitor.sec_exhibit_links(COVER, PRIMARY, 'CEG', '2'),
                         ['https://www.sec.gov/Archives/edgar/data/1868275/000186827526000116/ceg-20261109992.htm'])

    def test_only_filers_the_index_names_and_the_same_accession(self):
        self.assertEqual(monitor.sec_filing_ciks(INDEX, '1868275'), ['1168165', '1868275'])
        self.assertEqual(monitor.sec_filing_ciks(INDEX, '0001868275'), ['1168165', '1868275'])
        self.assertEqual(monitor.sec_filing_ciks(INDEX, '320193'), [])  # an index that does not name the company itself: nobody
        directory = '/Archives/edgar/data/1868275/000186827526000116/'
        self.assertEqual(monitor.co_registrant_directory(directory, '1168165'), '/Archives/edgar/data/1168165/000186827526000116/')
        self.assertIsNone(monitor.co_registrant_directory(directory, '1868275'))
        allowed = {'/Archives/edgar/data/1168165/000186827526000116/'}
        good = 'https://www.sec.gov/Archives/edgar/data/1168165/000186827526000116/ceg-20261109991.htm'
        self.assertEqual(monitor.co_registrant_url(good, allowed), good)
        for bad in ['https://www.sec.gov/Archives/edgar/data/9999999/000186827526000116/x.htm', 'http://www.sec.gov' + good[19:],
                    'https://evil.example/Archives/edgar/data/1168165/000186827526000116/x.htm', good + '?x=1',
                    'https://www.sec.gov/Archives/edgar/data/1168165/000186827526000999/x.htm']:
            self.assertIsNone(monitor.co_registrant_url(bad, allowed), bad)

    def test_the_exhibit_under_the_co_registrant_is_fetched_from_the_index(self):
        fetched = []
        release = self.release()

        def transport(url, ticker, **_):
            fetched.append(url)
            if url.endswith('-index.html'):
                return INDEX.encode(), 'text/html'
            if url.endswith('/1168165/000186827526000116/ceg-20261109991.htm'):
                return release, 'text/html'
            raise AssertionError('unexpected fetch ' + url)
        cover = b'<html><body><p>FORM 8-K Item 2.02 Results of Operations</p></body></html>'
        evidence = monitor.sec_exhibit_evidence(cover, PRIMARY, 'CEG', transport)
        self.assertEqual(evidence['url'], 'https://www.sec.gov/Archives/edgar/data/1168165/000186827526000116/ceg-20261109991.htm')
        self.assertTrue(all('9999999' not in url and '000186827526000999' not in url for url in fetched))

    def test_a_co_registrant_the_index_does_not_name_is_never_fetched(self):
        index = INDEX.replace('CIK=0001168165', 'CIK=0001111111')

        def transport(url, ticker, **_):
            if url.endswith('-index.html'):
                return index.encode(), 'text/html'
            raise AssertionError('unexpected fetch ' + url)
        cover = b'<html><body><p>FORM 8-K Item 2.02 Results of Operations</p></body></html>'
        self.assertIn('error', monitor.sec_exhibit_evidence(cover, PRIMARY, 'CEG', transport))

    def test_constellation_highlight_sentences(self):
        parsed = highlight_sentences.parse((FX / 'constellation-results-q326-head.txt').read_text())
        self.assertEqual(parsed['period'], 'Q3 2026')
        # GAAP per share and the adjusted (non-GAAP) operating earnings per share; the full-year guidance range is not read
        self.assertEqual([(f[0], f[1]) for f in parsed['facts']], [('eps', '$5.19'), ('adjusted-eps', '$5.06')])


if __name__ == '__main__':
    unittest.main()
