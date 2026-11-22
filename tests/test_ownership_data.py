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

    def test_shares_outstanding_side_of_a_split(self):
        db = od.connect(':memory:')
        db.execute("INSERT INTO ownership_shares VALUES('CRWD','2026-06-04',254564820,'cover','a')")
        db.execute("INSERT INTO ownership_shares VALUES('CRWD','2026-08-27',1023934842,'cover','b')")
        self.assertEqual(od.shares_for(db, 'CRWD', '2026-06-30'), (254564820, '2026-06-04'))  # 4-for-1 in July
        db.execute("INSERT INTO ownership_shares VALUES('MU','2026-06-25',1129393151,'cover','c')")
        db.execute("INSERT INTO ownership_shares VALUES('MU','2026-10-02',1131423212,'cover','d')")
        self.assertEqual(od.shares_for(db, 'MU', '2026-06-30'), (1131423212, '2026-10-02'))
        self.assertIsNone(od.shares_for(db, 'MU', '2025-06-30'))

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

    def test_public_payload_is_per_ticker_and_page_universe_only(self):
        db = od.connect(':memory:')
        db.execute("INSERT INTO ownership_institutional VALUES('NVDA','2026-06-30',700,10,1000,'2026-08-01',70.0,3.1,2,'q2','x')")
        db.execute("INSERT INTO ownership_institutional VALUES('XYZ','2026-06-30',700,10,1000,'2026-08-01',70.0,3.1,2,'q2','x')")
        db.execute("INSERT INTO ownership_short VALUES('NVDA','2026-10-30',280,300,-20,-6.7,100,2.8,200,1.4,24000,1.16,'x')")
        for line, (code, value) in enumerate((('S', 1000.0), ('S', 500.0), ('M', 9.0))):
            db.execute('INSERT INTO ownership_insider_trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       ('acc1', line, 'NVDA', '2026-11-03', '2026-11-02', 'Doe', 'Director', code, 'sell',
                        'open-market' if code == 'S' else 'other', 1, value, value, 1, 'checkbox'))
        db.execute("INSERT INTO ownership_buyback_authorizations(ticker,accession,filed,amount_usd,sentence,document) VALUES('NVDA','a1','2026-11-17',150e9,'s','u')")
        db.execute("INSERT INTO ownership_buyback_authorizations(ticker,accession,filed,amount_usd,sentence,document) VALUES('NVDA','a2','2026-11-20',150e9,'s','u')")
        payload = od.public_payload(db, companies={'NVDA': ('エヌビディア', 'NVIDIA')}, today=od.date(2026, 11, 22))
        self.assertEqual([r['ticker'] for r in payload['institutional']], ['NVDA'])
        self.assertEqual(payload['short'][0]['change'], round(1.16 - 300 * 1.16 / 280, 2))
        self.assertEqual(payload['short'][0]['days'], 1.4)
        self.assertEqual([(t['side'], t['value'], t['planned']) for t in payload['insiders']], [('sell', 1500.0, True)])
        self.assertEqual([(b['kind'], b['date']) for b in payload['buybacks']], [('authorization', '2026-11-17')])
        self.assertNotIn('filer', json.dumps(payload))

    def test_authorization_above_20_percent_of_market_value_is_kept_but_not_shown(self):
        db = od.connect(':memory:')
        today = od.date.today().isoformat()
        db.execute("INSERT INTO ownership_shares VALUES('NVDA',?,24100000000,'cover','a')", (today,))
        db.execute("INSERT INTO ownership_shares VALUES('SMOL',?,100000000,'cover','b')", (today,))
        db.execute("INSERT INTO ownership_buyback_authorizations(ticker,accession,filed,amount_usd,sentence,document) VALUES('NVDA','n1',?,150e9,'s','u')", (today,))
        db.execute("INSERT INTO ownership_buyback_authorizations(ticker,accession,filed,amount_usd,sentence,document) VALUES('SMOL','s1',?,6.7e9,'s','u')", (today,))
        db.execute("INSERT INTO ownership_buyback_authorizations(ticker,accession,filed,amount_usd,sentence,document) VALUES('NOCAP','x1',?,1e9,'s','u')", (today,))
        flagged = od.check_authorizations(db, {'adsShares': {}}, closes={'NVDA': (today, 125.53), 'SMOL': (today, 50.0)}, allow_quotes=False)
        self.assertEqual(flagged, 1)
        status = dict(db.execute('SELECT ticker, check_status FROM ownership_buyback_authorizations'))
        self.assertEqual(status, {'NVDA': 'ok', 'SMOL': 'suspect-amount', 'NOCAP': 'unchecked'})  # $150B < 20% of ~$3.0T; $6.7B > 20% of $5B
        payload = od.public_payload(db, companies={t: (t, t) for t in ('NVDA', 'SMOL', 'NOCAP')})
        self.assertEqual(sorted(b['ticker'] for b in payload['buybacks']), ['NOCAP', 'NVDA'])
        self.assertEqual(db.execute("SELECT count(*) FROM ownership_buyback_authorizations").fetchone()[0], 3)  # kept for audit

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


class OwnershipContentionTest(unittest.TestCase):
    """Nov 22 incident: the jobs kept the monitor database's write lock open across SEC downloads and every lane hit SQLITE_BUSY."""

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.main_path = str(Path(self.folder.name) / 'automatic.sqlite')
        self.saved = (od.sec_get, od.sec_json, od.BATCH_PAUSE)
        od.BATCH_PAUSE = 0
        self.addCleanup(self.restore)

    def restore(self):
        od.sec_get, od.sec_json, od.BATCH_PAUSE = self.saved

    def test_own_file_beside_the_monitor_database(self):
        path = od.ownership_path(self.main_path)
        self.assertNotEqual(Path(path).resolve(), Path(self.main_path).resolve())
        self.assertEqual(Path(path).parent, Path(self.main_path).parent)
        db = od.connect(path)
        self.assertEqual(db.execute('PRAGMA busy_timeout').fetchone()[0], 30000)
        self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
        self.assertIsNone(db.isolation_level)  # autocommit: no implicit transaction left open
        db.close()
        self.assertFalse(Path(self.main_path).exists())

    def test_no_write_lock_is_held_while_waiting_on_the_network(self):
        """Form 4 and the share counts: during every (slow) SEC call another connection can write at once (busy_timeout 0)."""
        path = od.ownership_path(self.main_path)
        db = od.connect(path)
        other = sqlite3.connect(path, timeout=0, isolation_level=None)
        other.execute('CREATE TABLE IF NOT EXISTS probe(n INTEGER)')
        probes = []

        def probe():
            self.assertFalse(db.in_transaction)
            other.execute('INSERT INTO probe VALUES(1)')  # raises "database is locked" if the job held a write
            probes.append(1)

        def fake_json(url):
            probe()
            if 'companyconcept' in url:
                return {'units': {'shares': [{'end': '2026-09-30', 'val': 1000, 'accn': 'a', 'filed': '2026-10-30'}]}}
            return {'filings': {'recent': {'form': ['4', '10-Q'], 'accessionNumber': ['0001-26-000001', '0001-26-000002'],
                                           'filingDate': [od.date.today().isoformat()] * 2, 'reportDate': ['', '2026-09-30'],
                                           'primaryDocument': ['xslF345X05/form4.xml', 'q3.htm']}}}

        def fake_get(url, limit=0, timeout=0):
            probe()
            return b'<ownershipDocument></ownershipDocument>'

        od.sec_json, od.sec_get = fake_json, fake_get
        od.issue(db, 'shares', 'X', 'earlier write')  # a write just before the network calls
        od.ensure_shares(db, ['AAA', 'BBB'], {'AAA': 1, 'BBB': 2})
        od.run_form4(db, ['AAA', 'BBB'], {}, {'AAA': 1, 'BBB': 2})
        self.assertGreaterEqual(len(probes), 4)
        self.assertEqual(db.execute('SELECT count(*) FROM ownership_form4_seen').fetchone()[0], 1)
        db.close()
        other.close()

    def contend(self, open_ingest):
        """A slow ownership ingest (network waits between writes) in a thread while three main-database lanes keep writing with
        a short busy timeout (0.2 s). Returns the lanes' SQLITE_BUSY errors and the tickers the ingest stored."""
        import threading
        import monitor
        with monitor.connect(self.main_path) as main:
            main.execute('CREATE TABLE IF NOT EXISTS lane_probe(n INTEGER)')

        def slow(url, *a, **k):
            threading.Event().wait(0.05)
            return {'units': {'shares': [{'end': '2026-09-30', 'val': 10, 'accn': 'a', 'filed': '2026-10-30'}]}}

        od.sec_json = slow
        tickers = [f'T{i}' for i in range(20)]
        stored = []

        def ingest():
            db = open_ingest()
            od.ensure_shares(db, tickers, {t: i for i, t in enumerate(tickers)})
            stored.append(db.execute('SELECT count(DISTINCT ticker) FROM ownership_shares').fetchone()[0])
            db.close()

        worker = threading.Thread(target=ingest)
        errors = []

        def lane():
            db = sqlite3.connect(self.main_path, timeout=0.2, isolation_level=None)
            while worker.is_alive():
                try:
                    db.execute('BEGIN IMMEDIATE')
                    db.execute('INSERT INTO lane_probe VALUES(1)')
                    db.execute('COMMIT')
                except sqlite3.OperationalError as error:
                    errors.append(str(error))
                threading.Event().wait(0.01)
            db.close()

        worker.start()
        lanes = [threading.Thread(target=lane) for _ in range(3)]
        for t in lanes:
            t.start()
        worker.join(60)
        for t in lanes:
            t.join(60)
        return errors, stored

    def test_reproduces_the_incident_when_the_ingest_writes_the_monitor_database(self):
        """The Nov 22 shape: the jobs in the monitor database with Python's implicit transaction left open across SEC calls."""
        def old_connect():
            db = sqlite3.connect(self.main_path, timeout=30)
            db.executescript(od.SCHEMA)
            return db
        errors, stored = self.contend(old_connect)
        self.assertTrue(errors)
        self.assertIn('database is locked', errors[0])
        self.assertEqual(stored, [20])

    def test_long_ingest_never_blocks_the_monitor_lanes(self):
        errors, stored = self.contend(lambda: od.connect(od.ownership_path(self.main_path)))
        self.assertEqual(errors, [])
        self.assertEqual(stored, [20])

    def test_runtime_files_are_in_the_monitor_image(self):
        """value-check-failed FileNotFoundError (Nov 22): the image lacked lib/research/value-check-universe.json."""
        root = Path(__file__).resolve().parents[1]
        dockerfile = (root / 'Dockerfile.research-monitor').read_text(encoding='utf-8')
        import re
        needed = set()
        for source in (root / 'scripts' / 'research').glob('*.py'):
            needed.update(re.findall(r"'lib' / 'research' / '([^']+)'", source.read_text(encoding='utf-8')))
        self.assertIn('value-check-universe.json', needed)
        for name in sorted(needed):
            self.assertIn(f'COPY lib/research/{name} lib/research/{name}', dockerfile)


if __name__ == '__main__':
    unittest.main()
