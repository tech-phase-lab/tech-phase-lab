"""Nov 28, follow-up: the Jul/Aug release layouts, the next quarter's outlook, and the one-time refill of stored rows' blanks.

Every expected figure was checked against the company's SEC exhibit 99.1 (tests/fixtures/prior-releases: the release before each
company's latest, written by scripts/research/earnings_release_sweep.py --previous; tests/fixtures/latest-releases).
"""
import gzip
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts/research'))
import earnings_history_backfill as backfill  # noqa: E402
import earnings_refill as refill  # noqa: E402
import issuer_result_flash as flash  # noqa: E402
import monitor  # noqa: E402
import release_extras  # noqa: E402

FX = ROOT / 'tests/fixtures'


def read(folder, ticker):
    manifest = json.loads((FX / folder / 'manifest.json').read_text())[ticker]
    text = gzip.decompress((FX / folder / f'{ticker}.txt.gz').read_bytes()).decode()
    parsed, code = backfill.read_figures(ticker, manifest['url'], text)
    return manifest, text, parsed, code


# (period, [(key, value, year-ago)]) of each previous release: revenue, EPS, net income, operating income as the release prints them
PRIOR = {
    'AMD': ('Q2 2026', [('revenue', '$11.536B', '$7.685B'), ('eps', '$1.38', '$0.54'), ('net-income', '$2.297B', '$872M'), ('operating-income', '$1.99B', '$-134M')]),
    'ANET': ('Q2 2026', [('revenue', '$3.0357B', '$2.2048B'), ('eps', '$0.95', '$0.70'), ('net-income', '$1.2129B', '$888.8M'), ('operating-income', '$1.378B', '$986.2M')]),
    'GOOGL': ('Q2 2026', [('revenue', '$119.796B', '$96.428B'), ('eps', '$9.11', '$2.31'), ('net-income', '$112.107B', '$28.196B'), ('operating-income', '$40.77B', '$31.271B')]),
    'MSFT': ('Q4 FY2026', [('revenue', '$90.007B', '$76.441B'), ('eps', '$4.81', '$3.65'), ('net-income', '$35.766B', '$27.233B'), ('operating-income', '$40.603B', '$34.323B')]),
    'KLAC': ('Q4 FY2026', [('revenue', '$3.657556B', '$3.174741B'), ('eps', '$1.04', '$0.91'), ('net-income', '$1.363059B', '$1.202849B')]),
    'LITE': ('Q4 FY2026', [('revenue', '$1.0063B', '$480.7M'), ('eps', '$-84.65', '$2.96'), ('net-income', '$-7.1617B', '$213.3M'), ('operating-income', '$279.3M', '$-8.4M')]),
    'META': ('Q2 2026', [('revenue', '$60.801B', '$47.516B'), ('eps', '$6.18', '$7.14'), ('net-income', '$15.848B', '$18.337B'), ('operating-income', '$18.775B', '$20.441B')]),
    'VRT': ('Q2 2026', [('revenue', '$3.2743B', '$2.6381B'), ('eps', '$1.27', '$0.83'), ('net-income', '$497.8M', '$324.2M')]),
    'STX': ('Q4 FY2026', [('revenue', '$3.629B', '$2.444B'), ('eps', '$5.58', '$2.24'), ('net-income', '$1.294B', '$488M'), ('operating-income', '$1.559B', '$568M')]),
    'GEV': ('Q2 2026', [('revenue', '$11.104B', '$9.111B'), ('eps', '$2.47', '$1.86'), ('net-income', '$649M', '$492M')]),
    'ORCL': ('Q4 FY2026', [('revenue', '$19.184B', '$15.903B'), ('eps', '$1.45', '$1.19'), ('net-income', '$4.304B', '$3.427B'), ('operating-income', '$6.133B', '$5.109B')]),
    'ALAB': ('Q2 2026', [('revenue', '$392.4M', '$191.925M'), ('eps', '$0.83', '$0.29'), ('net-income', '$153.088M', '$51.219M'), ('operating-income', '$89.248M', '$39.774M')]),
    'AAOI': ('Q2 2026', [('revenue', '$191.922M', '$102.952M'), ('eps', '$-0.28', '$-0.16'), ('net-income', '$-22.781M', '$-9.098M'), ('operating-income', '$-24.727M', '$-15.976M')]),
    'MRVL': ('Q1 FY2027', [('revenue', '$2.4178B', '$1.8953B'), ('eps', '$0.04', '$0.20'), ('net-income', '$34.5M', '$177.9M'), ('operating-income', '$339.4M', '$270.6M')]),
    'CRDO': ('Q4 FY2026', [('revenue', '$437.003M', '$170.025M'), ('eps', '$0.88', '$0.20'), ('net-income', '$169.102M', '$36.588M'), ('operating-income', '$155.845M', '$33.788M')]),
    'IONQ': ('Q2 2026', [('revenue', '$80.05M', '$20.694M'), ('eps', '$-5.08', '$-0.70'), ('net-income', '$-1.867742B', '$-176.838M'), ('operating-income', '$-337.243M', '$-160.592M')]),
    'AMAT': ('Q3 FY2026', [('revenue', '$9.115B', '$7.302B'), ('eps', '$3.17', '$2.22'), ('net-income', '$2.538B', '$1.779B'), ('operating-income', '$3.075B', '$2.233B')]),
}
# the next quarter's outlook (revenue[, non-GAAP EPS]) of the previous and of the latest release
OUTLOOK = {
    'AMD': (['$13B ± $300M'], ['$17B ± 3%']), 'ANET': (['$3.3B', '$1.06-$1.08'], ['$3.9B-$4B', '$1.26-$1.30']),
    'KLAC': (['$4B ± $200M', '$1.16 ± $0.10'], ['$4.7B ± $200M', '$1.44 ± $0.11']),
    'LITE': (['$1.225B-$1.275B', '$4.05-$4.35'], ['$1.575B-$1.625B', '$5.90-$6.20']), 'META': (['$61B-$64B'], ['$73B-$76B']),
    'STX': (['$4.1B ± $100M', '$7.30 ± $0.20'], ['$4.8B ± $100M', '$9.20 ± $0.20']), 'ALAB': (['$540M-$560M'], ['$730M-$750M']),
    'AAOI': (['$255M-$290M'], ['$385M-$420M']), 'MRVL': (['$2.7B ± 5%'], ['$3.15B ± 5%']), 'CRDO': (['$465M-$475M'], ['$525M-$535M']),
    'AMAT': (['$10.25B ± $500M', '$4.02 ± $0.20'], ['$11.1B ± $500M', '$4.35 ± $0.20']),
    'GOOGL': ([], []), 'MSFT': ([], []), 'GEV': ([], []), 'ORCL': ([], []), 'VRT': ([], []), 'IONQ': ([], []),
}


class JulyAugustLayouts(unittest.TestCase):
    def test_each_previous_release_is_read_from_its_own_statement(self):
        for ticker, (period, expected) in PRIOR.items():
            with self.subTest(ticker=ticker):
                _manifest, _text, parsed, code = read('prior-releases', ticker)
                self.assertIsNone(code)
                self.assertEqual(parsed['period'], period)
                self.assertEqual([(f[0], f[1], f[2]) for f in parsed['facts'] if f[0] in ('revenue', 'eps', 'net-income', 'operating-income')], expected)

    def test_the_latest_releases_still_read_the_same(self):
        manifest = json.loads((FX / 'latest-releases/manifest.json').read_text())
        for ticker in PRIOR:
            with self.subTest(ticker=ticker):
                _m, _t, parsed, code = read('latest-releases', ticker)
                self.assertEqual(parsed['period'], manifest[ticker]['period'])
                self.assertEqual(sorted(set(manifest[ticker]['facts']) - {f[0] for f in parsed['facts']}), [])

    def test_the_next_quarters_outlook(self):
        for ticker, (before, latest) in OUTLOOK.items():
            for folder, want in (('prior-releases', before), ('latest-releases', latest)):
                with self.subTest(ticker=ticker, folder=folder):
                    _m, text, parsed, _code = read(folder, ticker)
                    facts = release_extras.supplement(text, parsed)['facts']
                    self.assertEqual([f[1] for f in facts if f[0] in ('guidance-revenue', 'guidance-adjusted-eps')], want)

    def test_an_outlook_for_another_quarter_or_an_outlook_range_is_never_taken(self):
        _m, text, parsed, _code = read('latest-releases', 'LITE')
        flat = ' '.join(text.split())
        self.assertEqual(release_extras.next_quarter_guidance(flat.replace('second quarter of fiscal year 2027', 'third quarter of fiscal year 2027'),
                                                              parsed['period']), [])
        facts = release_extras.supplement(text, parsed)['facts']
        self.assertNotIn('adjusted-eps', [f[0] for f in facts], '"non-GAAP diluted net income per share of $5.90 to $6.20" is the outlook')
        self.assertEqual(release_extras.following_quarter('Q4 FY2026'), (1, 2027))
        self.assertIsNone(release_extras.following_quarter('Sep 2026 quarter'))


class Refill(unittest.TestCase):
    def test_only_blanks_are_filled_at_the_stored_precision(self):
        stored = [{'key': 'revenue', 'ja': '売上高', 'en': 'Revenue', 'value': '$1.58B'},
                  {'key': 'net-income', 'ja': '純損益', 'en': 'Net income', 'value': '$24.9M'},
                  {'key': 'guidance-revenue', 'ja': '通期見通し 売上高', 'en': 'Full-year guidance Revenue', 'value': '$202.0B'}]
        new = [{'key': 'revenue', 'ja': '売上高', 'en': 'Revenue', 'value': '$1.583419B', 'comparisons': {'yearAgo': '$1.234244B'}},
               {'key': 'eps', 'ja': 'EPS', 'en': 'EPS', 'value': '$0.02', 'comparisons': {'yearAgo': '$-0.03'}},
               {'key': 'net-income', 'ja': '純損益', 'en': 'Net income', 'value': '$24.856M', 'comparisons': {'yearAgo': '$-26.776M'}},
               {'key': 'guidance-revenue', 'ja': '次四半期見通し 売上高', 'en': 'Next-quarter guidance Revenue', 'value': '$56.3B'},
               {'key': 'guidance-fy-revenue', 'ja': '通期見通し 売上高', 'en': 'Full-year guidance Revenue', 'value': '$202.0B', 'comparisons': {'priorGuidance': '$192.0B'}}]
        facts, filled = refill.fill(stored, new)
        self.assertEqual([(f['key'], f['value'], f.get('comparisons')) for f in facts], [
            ('revenue', '$1.58B', {'yearAgo': '$1.23B'}), ('net-income', '$24.9M', {'yearAgo': '$-26.8M'}), ('eps', '$0.02', {'yearAgo': '$-0.03'}),
            ('guidance-fy-revenue', '$202.0B', {'priorGuidance': '$192.0B'}), ('guidance-revenue', '$56.3B', None)])
        self.assertEqual(facts[3]['ja'], '通期見通し 売上高', 'the stored outlook keeps its value and label')
        self.assertIn('revenue.yearAgo', filled)
        with self.assertRaises(ValueError):
            refill.fill(stored, [{**new[0], 'value': '$1.60B'}])  # a reading that disagrees is never written
        self.assertEqual(refill.at_precision('$1.234244B', '$1.58B'), '$1.23B')
        self.assertTrue(refill.confirms('$9.45', '$9.45'))
        self.assertFalse(refill.confirms('$9.45', '$9.46'))

    def test_a_stored_row_is_refilled_once_and_its_times_never_move(self):
        manifest = json.loads((FX / 'latest-releases/manifest.json').read_text())['STX']
        text = gzip.decompress((FX / 'latest-releases/STX.txt.gz').read_bytes()).decode()
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, 'monitor.db')
            db = monitor.connect(path)
            flash.schema(db)
            # STX as production stored it on Oct 27 (no year-ago net income / operating income, no adjusted EPS, no outlook)
            payload = {'id': '1', 'researchId': 'ir-flash-1', 'kind': 'earnings', 'ticker': 'STX', 'period': 'Q1 FY2027', 'url': manifest['url'],
                       'facts': [{'key': 'revenue', 'ja': '売上高', 'en': 'Revenue', 'value': '$4.233B', 'comparisons': {'yearAgo': '$2.629B'}},
                                 {'key': 'eps', 'ja': 'EPS', 'en': 'EPS', 'value': '$7.59', 'comparisons': {'yearAgo': '$2.43'}},
                                 {'key': 'net-income', 'ja': '純損益', 'en': 'Net income', 'value': '$1.761B'},
                                 {'key': 'operating-income', 'ja': '営業損益', 'en': 'Operating income', 'value': '$2.064B'}]}
            db.execute('INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)',
                       ('k', 'STX', manifest['url'], 'Q1 FY2027', json.dumps(payload), '2026-10-27T20:12:00+00:00', '2026-10-27T20:13:00+00:00', 0, 'v'))
            db.execute("INSERT INTO sources(url,ticker,discovered_at,sha256,status) VALUES(?,?,?,?,?)", (manifest['url'], 'STX', '2026-10-27', 'abc', 'published'))
            db.execute('INSERT INTO source_revisions VALUES(?,?,?,?,?,?,?)', (manifest['url'], 'abc', '2026-10-27', 'text/html', 1, text, len(text)))
            db.commit()
            db.close()

            class NoSec:
                def get(self, _url):
                    raise AssertionError('the stored revision is read, not SEC')
            now = datetime(2026, 11, 28, tzinfo=timezone.utc)
            self.assertEqual(refill.run_once(path, now, NoSec(), log=lambda _l: None)['filled'], 1)
            self.assertEqual(refill.run_once(path, now, NoSec(), log=lambda _l: None)['filled'], 0, 'once per version')
            db = sqlite3.connect(path)
            stored, observed, published = db.execute('SELECT payload,observed_at,published_at FROM issuer_result_publications').fetchone()
            db.close()
            self.assertEqual((observed, published), ('2026-10-27T20:12:00+00:00', '2026-10-27T20:13:00+00:00'), 'never fresh again (push, patrol)')
            facts = {f['key']: f for f in json.loads(stored)['facts']}
            self.assertEqual(facts['net-income']['comparisons'], {'yearAgo': '$549M'})
            self.assertEqual(facts['operating-income']['comparisons'], {'yearAgo': '$694M'})
            self.assertEqual(facts['adjusted-eps']['value'], '$7.68')
            self.assertEqual(facts['guidance-revenue']['value'], '$4.8B ± $100M')
            self.assertEqual([facts[k]['value'] for k in ('revenue', 'eps', 'net-income', 'operating-income')], ['$4.233B', '$7.59', '$1.761B', '$2.064B'])

    def test_the_service_runs_it_after_the_backfill(self):
        service = (ROOT / 'scripts/research/service.py').read_text()
        self.assertIn('earnings_refill.run_once(self.db_path, lock=self.db_lock', service)


if __name__ == '__main__':
    unittest.main()
