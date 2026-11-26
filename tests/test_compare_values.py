import json
import sys
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import compare_values as cv  # noqa: E402
import value_check as vc  # noqa: E402
from test_value_check import quarterly_shares, trading_days  # noqa: E402

LISTS = {'spac': {'7': 'Blank Check Acquisition Corp'}, 'fund': {'8': 'Example Muni Fund'}, 'etn': {'9': {'name': 'Bank AG', 'shares': ['BNK']}},
         'instrument': {'BIGN': 'preferred'}}


def directory(rows):
    return {'fields': ['cik', 'name', 'ticker', 'exchange'], 'data': rows}


def record(first, revenue=200.0, income=10.0, equity=None, shares=1.0, quarters=26):
    revenue_points = [{'end': first - 400 + q * 91, 'filed': first - 380 + q * 91, 'value': 100.0 + q * ((revenue or 100.0) - 100.0) / 25} for q in range(quarters)]
    out = {'revenue': revenue_points if revenue else [], 'income': [{**p, 'value': income} for p in revenue_points] if revenue else [],
           'shares': quarterly_shares(first, shares), 'currency': 'USD', 'source': 'sec'}
    if equity is not None:
        out['equity'] = [{'end': p['end'], 'filed': p['filed'], 'value': equity} for p in revenue_points]
    return out


class Universe(unittest.TestCase):
    def test_the_comparison_exclusions_in_the_same_order(self):
        rows = [[1, 'Big Co', 'BIG', 'Nasdaq'], [1, 'Big Co', 'BIGW', 'Nasdaq'], [2, 'Alphabet', 'GOOGL', 'Nasdaq'], [2, 'Alphabet', 'GOOG', 'Nasdaq'],
                [3, 'Pref Co', 'PRF-PA', 'NYSE'], [4, 'Otc Co', 'OTCX', 'OTC'], [7, 'Blank Check Acquisition Corp', 'BCAC', 'Nasdaq'],
                [8, 'Example Muni Fund', 'MUNI', 'NYSE'], [9, 'Bank AG', 'BNK', 'NYSE'], [9, 'Bank AG', 'VXXN', 'NYSE'], [10, 'Brk', 'BRK-B', 'NYSE'],
                [1, 'Big Co', 'BIGN', 'NYSE']]  # a note on the provider's list (comparison-exclusions.json "instrument")
        self.assertEqual(cv.comparable(directory(rows), LISTS),
                         [('BIG', 1), ('GOOGL', 2), ('GOOG', 2), ('BNK', 9), ('BRK-B', 10)])

    def test_companies_a_member_asked_for_go_first(self):
        cv.WANTED.clear()
        try:
            cv.want(['ZZZ', 'bad ticker', 'YYY'])
            self.assertEqual(cv.ordered(['AAA', 'YYY', 'ZZZ']), ['YYY', 'ZZZ', 'AAA'])
        finally:
            cv.WANTED.clear()


class Figures(unittest.TestCase):
    def test_a_bank_reads_its_interest_income_and_equity_is_kept_for_pb(self):
        usd = lambda rows: {'units': {'USD': rows}}  # noqa: E731
        row = lambda val, start, end, filed, form='10-K': {'val': val, 'start': start, 'end': end, 'filed': filed, 'form': form, 'accn': 'x'}  # noqa: E731
        facts = {'facts': {'us-gaap': {
            'InterestAndDividendIncomeOperating': usd([row(500, '2025-01-01', '2025-12-31', '2026-02-20'), row(450, '2024-01-01', '2024-12-31', '2025-02-20')]),
            'NetIncomeLoss': usd([row(90, '2025-01-01', '2025-12-31', '2026-02-20')]),
            'StockholdersEquity': usd([{'val': 900, 'end': '2025-12-31', 'filed': '2026-02-20', 'form': '10-K', 'accn': 'x'}]),
        }, 'dei': {'EntityCommonStockSharesOutstanding': {'units': {'shares': [{'val': 10, 'end': '2026-02-01', 'filed': '2026-02-20', 'form': '10-K', 'accn': 'x'}]}}}}}
        self.assertEqual(vc.fundamentals(facts)['revenue'], [])  # Treasure Hunt's own reading is unchanged
        record_ = cv.compare_fundamentals(facts)
        self.assertEqual(record_['revenueBasis'], 'bank')
        self.assertEqual([p['value'] for p in record_['revenue']], [450.0, 500.0])
        self.assertEqual(record_['equity'], [{'end': date(2025, 12, 31).toordinal(), 'filed': date(2026, 2, 20).toordinal(), 'value': 900.0}])


class Calculation(unittest.TestCase):
    def setUp(self):
        self.days = trading_days('2021-01-04', 1300)
        self.first = date.fromisoformat(self.days[0]).toordinal()
        self.falling = [(d, 100.0 - i * 0.05, 100.0 - i * 0.05) for i, d in enumerate(self.days)]

    def test_the_same_number_as_treasure_hunt_when_it_can_calculate(self):
        rec = record(self.first)
        value, reason = cv.compare_value(self.falling, rec, self.days[-1])
        self.assertIsNone(reason)
        treasure = vc.comparison_value(self.falling, rec, self.days[-1])
        self.assertEqual((value['score'], value['exact'], value['basis'], value['period']), (treasure['score'], treasure['exact'], treasure['basis'], treasure['period']))

    def test_a_loss_is_judged_on_ps_and_no_revenue_on_pb(self):
        loss, _ = cv.compare_value(self.falling, record(self.first, income=-5.0), self.days[-1])
        self.assertEqual(loss['basis'], 'ps')
        book, reason = cv.compare_value(self.falling, record(self.first, revenue=None, equity=50.0), self.days[-1])
        self.assertIsNone(reason)
        self.assertEqual(book['basis'], 'pb')
        self.assertGreater(book['score'], 0)  # the price fell while the book stayed: below its average
        negative, reason = cv.compare_value(self.falling, record(self.first, revenue=None, equity=-50.0), self.days[-1])
        self.assertIsNone(negative)
        self.assertEqual(reason, 'negative-equity')
        self.assertEqual(cv.compare_value(self.falling, record(self.first, revenue=None), self.days[-1]), (None, 'no-revenue-or-equity'))

    def test_a_recent_listing_uses_its_own_history_from_sixty_trading_days(self):
        days = trading_days('2026-03-02', 120)
        first = date.fromisoformat(days[0]).toordinal()
        closes = [(d, 50.0 - i * 0.1, 50.0 - i * 0.1) for i, d in enumerate(days)]
        rec = record(first, quarters=10)
        self.assertIsNone(vc.comparison_value(closes, rec, days[-1]))  # Treasure Hunt: under a year, not calculated
        value, _ = cv.compare_value(closes, rec, days[-1])
        self.assertEqual(value['period'], 'listed')
        self.assertLess(value['days'], vc.MIN_PS_DAYS)
        short = closes[:45]
        self.assertEqual(cv.compare_value(short, rec, short[-1][0]), (None, 'short-history'))

    def test_no_figure_for_an_old_price_or_missing_shares(self):
        self.assertEqual(cv.compare_value(self.falling[:-1], record(self.first), self.days[-1]), (None, 'stale-price'))
        self.assertEqual(cv.compare_value(self.falling, {**record(self.first), 'shares': []}, self.days[-1]), (None, 'no-shares'))


def series_body(symbols, days, start=100.0):
    rows = [{'datetime': d, 'close': str(start - i * 0.05)} for i, d in enumerate(days)]
    return {s: {'meta': {'symbol': s}, 'status': 'ok', 'values': rows} for s in symbols} if len(symbols) > 1 else {'meta': {'symbol': symbols[0]}, 'status': 'ok', 'values': rows}


class Worker(unittest.TestCase):
    def setUp(self):
        self.days = trading_days('2021-01-04', 1300)
        self.first = date.fromisoformat(self.days[0]).toordinal()
        self.db = vc.connect(':memory:')
        snapshot = {'ok': True, 'asOf': self.days[-1], 'computedAt': '2026-01-01T00:00:00Z', 'universes': {}, 'values': {'TRES': {'score': 40, 'exact': 40.2, 'basis': 'pe-ps', 'period': None}}}
        self.db.execute('INSERT INTO value_check_state(key,value) VALUES(?,?)', ('snapshot', json.dumps(snapshot)))
        self.db.commit()
        self.calls = []

    def tearDown(self):
        self.db.close()

    def transport(self, path, params):
        if path == 'api_usage':
            return {'current_usage': 0}
        symbols = params['symbol'].split(',')
        self.calls.append((path, tuple(symbols)))
        if path == 'income_statement':
            return {'meta': {'currency': 'USD'}, 'income_statement': []}
        return series_body(symbols, self.days if params['outputsize'] != str(vc.UPDATE_BARS) else self.days[-5:])

    def sec(self, cik):
        return {'facts': {'us-gaap': {'x': {}}}, 'cik': cik}

    def test_one_step_reads_figures_prices_and_calculates_every_company_with_treasure_hunt_first(self):
        rows = [[1, 'Alpha', 'ALPH', 'Nasdaq'], [2, 'Bio', 'BIO', 'Nasdaq'], [3, 'Treasure', 'TRES', 'NYSE'], [4, 'Nofacts Trust', 'NOFX', 'NYSE']]
        records = {'ALPH': record(self.first), 'BIO': record(self.first, revenue=None, equity=40.0), 'TRES': record(self.first)}
        original = cv.compare_fundamentals
        cv.compare_fundamentals = lambda facts: records.get({1: 'ALPH', 2: 'BIO', 3: 'TRES'}.get(facts['cik']), {'error': 'no-sec-data'})
        try:
            report = cv.step(self.db, transport=self.transport, sec=self.sec, directory=lambda: directory(rows), now=datetime(2026, 1, 5, tzinfo=timezone.utc),
                             sleep=lambda s: None, treasure=['TRES'], last_statement={'at': 0})
        finally:
            cv.compare_fundamentals = original
        self.assertEqual(report['universe'], 4)
        self.assertEqual(report['facts'], 4)
        # A company without facts gets one statements read (nothing came back), the others their history; TRES's prices are Treasure Hunt's.
        self.assertEqual([c for c in self.calls if c[0] == 'income_statement'], [('income_statement', ('NOFX',))])
        histories = sorted({s for path, symbols in self.calls if path == 'time_series' for s in symbols})
        self.assertEqual(histories, ['ALPH', 'BIO'])
        values = vc.compare_list(self.db, vc.snapshot(self.db))
        self.assertEqual(values['ALPH'][2], 'pe-ps')
        self.assertEqual(values['BIO'][2], 'pb')
        self.assertEqual(values['TRES'], [40, 40.2, 'pe-ps', None])  # Treasure Hunt's own figure wins
        self.assertNotIn('NOFX', values)
        coverage = cv.coverage(self.db)
        self.assertEqual(coverage['withValue'], 3)
        # Nothing new: a second step spends nothing on the provider.
        self.calls.clear()
        cv.step(self.db, transport=self.transport, sec=self.sec, directory=lambda: directory(rows), now=datetime(2026, 1, 5, tzinfo=timezone.utc),
                sleep=lambda s: None, treasure=['TRES'], last_statement={'at': datetime(2026, 1, 5, tzinfo=timezone.utc).timestamp()})
        self.assertEqual(self.calls, [])


class Payload(unittest.TestCase):
    def test_the_list_is_compact_and_an_old_snapshot_converges(self):
        db = vc.connect(':memory:')
        try:
            stored = {'ok': True, 'asOf': '2026-11-25', 'computedAt': 'c1', 'universes': {}}
            db.execute('INSERT INTO value_check_state(key,value) VALUES(?,?)', ('snapshot', json.dumps(stored)))
            db.execute('INSERT INTO compare_values(ticker,as_of,payload) VALUES(?,?,?)', ('XBIO', '2026-11-25', json.dumps({'score': 32, 'exact': 31.6, 'basis': 'pb', 'period': None, 'days': 1200})))
            db.execute('INSERT INTO compare_values(ticker,as_of,payload) VALUES(?,?,?)', ('OLD', '2026-11-20', json.dumps({'score': 1, 'exact': 1, 'basis': 'ps', 'period': None})))
            db.commit()
            original, runs = vc.compute, []
            vc.compute = lambda _db, _u: runs.append(1) or {'asOf': '2026-11-24', 'values': {}}  # a different close: not used
            vc.DERIVED.clear()
            try:
                self.assertFalse(vc.ensure_values(db, {'all': []}))
                self.assertFalse(vc.ensure_values(db, {'all': []}))
                self.assertEqual(len(runs), 1, 'tried once per stored snapshot, not every five minutes')
            finally:
                vc.compute = original
                vc.DERIVED.clear()
            self.assertEqual(vc.public_payload(db)['values'], {'XBIO': [32, 31.6, 'pb', None]})
        finally:
            db.close()


if __name__ == '__main__':
    unittest.main()
