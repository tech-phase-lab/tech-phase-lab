"""大口の動き collection (ownership_data.py): offline parsers, 13F counting rules and the default-off switch."""
from pathlib import Path
import io
import json
import sqlite3
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import ownership_data as od

ROOT = Path(__file__).resolve().parents[1]

FORM4 = b"""<?xml version="1.0"?><ownershipDocument><documentType>4</documentType>
<issuer><issuerCik>0001045810</issuerCik><issuerTradingSymbol>NVDA</issuerTradingSymbol></issuer>
<reportingOwner><reportingOwnerId><rptOwnerName>Doe Jane</rptOwnerName></reportingOwnerId>
<reportingOwnerRelationship><isDirector>1</isDirector><isOfficer>1</isOfficer><officerTitle>EVP &amp; CFO</officerTitle></reportingOwnerRelationship></reportingOwner>
<aff10b5One>0</aff10b5One>
<nonDerivativeTable>
<nonDerivativeTransaction><transactionDate><value>2026-11-03</value></transactionDate><transactionCoding><transactionCode>S</transactionCode><footnoteId id="F1"/></transactionCoding>
<transactionAmounts><transactionShares><value>1000</value></transactionShares><transactionPricePerShare><value>150.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>D</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-11-03</value></transactionDate><transactionCoding><transactionCode>M</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>2000</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>2026-11-04</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding>
<transactionAmounts><transactionShares><value>300</value></transactionShares><transactionPricePerShare><value>140</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
</nonDerivativeTable>
<footnotes><footnote id="F1">Sold under a Rule 10b5-1 trading plan adopted on May 1, 2026.</footnote></footnotes></ownershipDocument>"""


def tsv(rows):
    return '\n'.join('\t'.join(r) for r in rows) + '\n'


def dataset():
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w') as zf:
        zf.writestr('SUBMISSION.tsv', tsv([
            ['ACCESSION_NUMBER', 'FILING_DATE', 'SUBMISSIONTYPE', 'CIK', 'PERIODOFREPORT'],
            ['A1', '01-AUG-2026', '13F-HR', '0000000001', '30-JUN-2026'],
            ['A2', '05-AUG-2026', '13F-HR/A', '0000000001', '30-JUN-2026'],   # restatement replaces A1
            ['B1', '02-AUG-2026', '13F-HR', '0000000002', '30-JUN-2026'],
            ['B2', '09-AUG-2026', '13F-HR/A', '0000000002', '30-JUN-2026'],   # new holdings: added to B1
            ['C1', '03-AUG-2026', '13F-NT', '0000000003', '30-JUN-2026'],
            ['D1', '04-JUN-2026', '13F-HR', '0000000004', '31-MAR-2026'],     # a late filing for the quarter before
        ]))
        zf.writestr('COVERPAGE.tsv', tsv([
            ['ACCESSION_NUMBER', 'ISAMENDMENT', 'AMENDMENTTYPE', 'REPORTTYPE'],
            ['A1', 'N', '', '13F HOLDINGS REPORT'], ['A2', 'Y', 'RESTATEMENT', '13F HOLDINGS REPORT'],
            ['B1', 'N', '', '13F HOLDINGS REPORT'], ['B2', 'Y', 'NEW HOLDINGS', '13F HOLDINGS REPORT'],
            ['C1', 'N', '', '13F NOTICE'], ['D1', 'N', '', '13F HOLDINGS REPORT'],
        ]))
        zf.writestr('INFOTABLE.tsv', tsv([
            ['ACCESSION_NUMBER', 'CUSIP', 'SSHPRNAMT', 'SSHPRNAMTTYPE', 'PUTCALL'],
            ['A1', '67066G104', '999', 'SH', ''],
            ['A2', '67066G104', '100', 'SH', ''],
            ['A2', '67066G104', '50', 'SH', 'Put'],
            ['B1', '67066G104', '200', 'SH', ''],
            ['B1', '67066G104', '70', 'PRN', ''],
            ['B2', '67066G104', '25', 'SH', ''],
            ['B2', '595112103', '40', 'SH', ''],
            ['D1', '67066G104', '5000', 'SH', ''],
        ]))
    out.seek(0)
    return zipfile.ZipFile(out)


class OwnershipDataTest(unittest.TestCase):
    def test_off_by_default(self):
        self.assertFalse(od.enabled({}))
        self.assertFalse(od.enabled({'OWNERSHIP_DATA_ENABLED': '1'}))
        self.assertTrue(od.enabled({'OWNERSHIP_DATA_ENABLED': 'true'}))

    def test_sec_user_agent_carries_the_owner_contact(self):
        self.assertIn('support@techphase.app', od.sec_user_agent({}))
        self.assertLessEqual(1 / od.SEC_MIN_INTERVAL, 10)

    def test_universe_is_value_check_tech_plus_watched(self):
        config = od.load_config()
        tickers = od.universe(config, value_check=ROOT / 'missing.json')
        watched = [p['ticker'] for p in json.loads((ROOT / 'lib/research/providers.json').read_text()) if p.get('scope') != 'earnings']
        self.assertEqual(len(watched), 22)
        self.assertTrue(set(watched) <= set(tickers))
        self.assertTrue(set(config['tech']) <= set(tickers))
        self.assertGreaterEqual(len(tickers), 150)

    def test_cusips_agree_with_capital_map(self):
        mapping = {}
        for name in ('capital-map-disclosures.json', 'capital-map-corporate.json'):
            for portfolio in json.loads((ROOT / 'lib/research' / name).read_text()):
                for holding in portfolio['current']['holdings']:
                    if holding.get('ticker') and len(holding['securityId']) == 9:
                        mapping.setdefault(holding['ticker'], set()).add(holding['securityId'])
        checked = 0
        for ticker, cusips in od.load_config()['cusips'].items():
            if ticker in mapping:
                checked += 1
                self.assertTrue(set(cusips) & mapping[ticker], ticker)
        self.assertGreater(checked, 50)

    def test_13f_counting_rules(self):
        zf = dataset()
        period, accessions = od.select_filings(zf)
        self.assertEqual(period, '2026-06-30')
        self.assertEqual(set(accessions), {'A2', 'B1', 'B2'})
        totals = od.aggregate_holdings(zf, accessions, {'NVDA': ['67066G104'], 'MU': ['595112103']})
        self.assertEqual(totals['NVDA'], (325, 2))  # 100 + 200 + 25; the put and the PRN row are not counted
        self.assertEqual(totals['MU'], (40, 1))

    def test_institutional_ratio_and_quarter_change(self):
        db = od.connect(':memory:')
        db.execute("INSERT INTO ownership_shares VALUES('NVDA','2026-05-01',1000,'cover','x')")
        db.execute("INSERT INTO ownership_shares VALUES('NVDA','2026-08-01',1000,'cover','y')")
        config = {'cusips': {'NVDA': ['67066G104'], 'TSM': ['874039100']}, 'adsShares': {'TSM': 5}}
        od.store_institutional(db, '2026-03-31', {'NVDA': (600, 10)}, ['NVDA', 'TSM'], config, 'q1')
        od.store_institutional(db, '2026-06-30', {'NVDA': (650, 12)}, ['NVDA', 'TSM'], config, 'q2')
        row = db.execute("SELECT pct, pct_change_pts, holders, holders_change FROM ownership_institutional WHERE period='2026-06-30'").fetchone()
        self.assertEqual(row, (65.0, 5.0, 12, 2))
        reasons = {r[0] for r in db.execute("SELECT reason FROM ownership_issues WHERE ticker='TSM'")}
        self.assertIn('no-13f-rows-2026-06-30', reasons)
        self.assertFalse(db.execute("SELECT 1 FROM sqlite_master WHERE sql LIKE '%filer_name%'").fetchone())  # totals only

    def test_form4_open_market_and_10b5_1(self):
        rows = od.parse_form4(FORM4)
        self.assertEqual([(r['code'], r['category'], r['side']) for r in rows],
                         [('S', 'open-market', 'sell'), ('M', 'other', 'buy'), ('P', 'open-market', 'buy')])
        self.assertEqual((rows[0]['plan_10b5_1'], rows[0]['plan_basis']), (1, 'footnote'))
        self.assertEqual((rows[2]['plan_10b5_1'], rows[2]['plan_basis']), (0, 'checkbox'))
        self.assertEqual(rows[0]['value'], 150500.0)
        self.assertEqual(rows[0]['owner_role'], 'EVP & CFO, Director')
        checked = od.parse_form4(FORM4.replace(b'<aff10b5One>0</aff10b5One>', b'<aff10b5One>1</aff10b5One>'))
        self.assertEqual(checked[2]['plan_10b5_1'], 1)

    def test_quarterly_from_year_to_date(self):
        facts = [{'start': '2026-01-26', 'end': '2026-04-26', 'val': 100, 'filed': '2026-05-20'},
                 {'start': '2026-01-26', 'end': '2026-07-26', 'val': 250, 'filed': '2026-08-26'},
                 {'start': '2026-01-26', 'end': '2026-10-25', 'val': 330, 'filed': '2026-11-20'}]
        out = od.quarterly(facts)
        self.assertEqual(out[('2026-01-26', '2026-04-26')][:2], (100, 0))
        self.assertEqual(out[('2026-04-27', '2026-07-26')][:2], (150, 1))
        self.assertEqual(out[('2026-07-27', '2026-10-25')][:2], (80, 1))

    def test_purchase_table(self):
        html = """<p>Issuer Purchases of Equity Securities</p><table>
        <tr><td>Period</td><td>Total Number of Shares Purchased (In millions)</td><td>Average Price Paid per Share</td>
        <td>Total Number of Shares Purchased as Part of Publicly Announced Program (In millions)</td>
        <td>Approximate Dollar Value of Shares that May Yet Be Purchased Under the Program (In billions)</td></tr>
        <tr><td>April 27, 2026 - May 24, 2026</td><td>28.7</td><td>$</td><td>214.32</td><td>28.7</td><td>$</td><td>112.7</td></tr>
        <tr><td>May 25, 2026 - June 21, 2026</td><td>&#8212;</td><td>$</td><td>&#8212;</td><td>&#8212;</td><td>$</td><td>112.7</td></tr>
        <tr><td>Total</td><td>28.7</td><td></td><td>28.7</td></tr></table>"""
        rows = od.parse_purchase_table(html)
        self.assertEqual(rows[0], ('April 27, 2026 - May 24, 2026', 28700000, 214.32, 28700000, 112.7e9, False))
        self.assertEqual(rows[1][1:3], (0, None))
        self.assertEqual(rows[2][0], 'Total')
        mu = """<p>Issuer Purchases of Equity Securities</p><table><tr><td>Period</td><td>Total number of shares purchased</td>
        <td>Average price paid per share</td><td>part of programs</td><td>Approximate dollar value that may yet be purchased (in millions)</td></tr>
        <tr><td>July 3, 2026 – July 30, 2026</td><td>912</td><td>983.12</td><td>—</td><td></td></tr>
        <tr><td>912</td><td>$</td><td>983.12</td><td>—</td><td>$</td><td>2,156</td></tr></table>"""
        rows = od.parse_purchase_table(mu)
        self.assertEqual(rows[-1], ('Total', 912, None, 0, 2156e6, True))

    def test_authorization_and_remaining_sentences(self):
        text = ('On August 26, 2025, our Board of Directors approved an additional $60.0 billion to our share repurchase authorization, '
                'without expiration. As of the quarter end, $14.7 billion remained available under the repurchase authorization approved by the Board.')
        self.assertEqual(od.authorization_sentences(text), [(60e9, text.split(' As of')[0])])
        self.assertEqual(od.remaining_from_text('We did not repurchase stock, and $2.16 billion of the 2018 authorization remained available '
                                                'for the repurchase of our common stock.'), 2.16e9)

    def test_cover_shares_sum_classes(self):
        html = ('<xbrli:context id="c1"><xbrli:entity/><xbrli:period><xbrli:instant>2026-10-20</xbrli:instant></xbrli:period></xbrli:context>'
                '<xbrli:context id="c2"><xbrli:entity/><xbrli:period><xbrli:instant>2026-10-20</xbrli:instant></xbrli:period></xbrli:context>'
                '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="c1" scale="0">5,800,000,000</ix:nonFraction>'
                '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="c2" scale="6">6,100</ix:nonFraction>')
        self.assertEqual(od.cover_shares(html), (5.8e9 + 6.1e9, '2026-10-20'))

    def test_run_due_skips_jobs_not_due(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'o.sqlite')
            db = od.connect(path)
            for job in od.INTERVALS:
                db.execute("INSERT INTO ownership_runs VALUES(?,?,?,?,?)", (job, od.iso(), od.iso(), 'ok', ''))
            db.commit()
            db.close()
            called = []
            original = od.run_job
            od.run_job = lambda *a, **k: called.append(a[1])
            try:
                od.run_due(path)
            finally:
                od.run_job = original
            self.assertEqual(called, [])
            self.assertTrue(sqlite3.connect(path).execute('SELECT count(*) FROM ownership_runs').fetchone()[0])


if __name__ == '__main__':
    unittest.main()
