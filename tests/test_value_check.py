import json
import sqlite3
import sys
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import value_check as vc  # noqa: E402


def fact(val, start, end, filed, form='10-Q', accn='a'):
    return {'val': val, 'start': start, 'end': end, 'filed': filed, 'form': form, 'accn': accn}


def facts(revenue_rows, income_rows=None, shares=None):
    return {'facts': {'us-gaap': {'Revenues': {'units': {'USD': revenue_rows}}, 'NetIncomeLoss': {'units': {'USD': income_rows or []}}},
                      'dei': {'EntityCommonStockSharesOutstanding': {'units': {'shares': shares or []}}}}}


def trading_days(first, count):
    out, day = [], date.fromisoformat(first)
    while len(out) < count:
        if day.weekday() < 5:
            out.append(day.isoformat())
        day += timedelta(days=1)
    return out


class TwelveMonths(unittest.TestCase):
    def test_trailing_year_from_year_to_date(self):
        rows = [fact(100, '2024-01-01', '2024-12-31', '2025-02-10', '10-K'),
                fact(30, '2024-01-01', '2024-06-30', '2024-08-01'),
                fact(40, '2025-01-01', '2025-06-30', '2025-08-01')]
        record = vc.fundamentals(facts(rows, shares=[{'val': 10, 'end': '2025-07-20', 'filed': '2025-08-01', 'form': '10-Q', 'accn': 'b'}]))
        last = record['revenue'][-1]
        self.assertEqual(last['value'], 110)  # 100 + 40 - 30
        self.assertEqual(date.fromordinal(last['filed']).isoformat(), '2025-08-01')

    def test_share_classes_of_one_filing_are_added(self):
        rows = [{'val': 5, 'end': '2025-07-20', 'filed': '2025-08-01', 'form': '10-Q', 'accn': 'x'},
                {'val': 7, 'end': '2025-07-20', 'filed': '2025-08-01', 'form': '10-Q', 'accn': 'x'}]
        self.assertEqual(vc.share_points(facts([], shares=rows))[0]['value'], 12)

    def test_before_the_first_cover_count_the_weighted_count_as_first_reported(self):
        data = facts([], shares=[{'val': 100, 'end': '2025-07-20', 'filed': '2025-08-01', 'form': '10-Q', 'accn': 'x'}])
        data['facts']['us-gaap']['WeightedAverageNumberOfDilutedSharesOutstanding'] = {'units': {'shares': [
            fact(10, '2024-04-01', '2024-06-30', '2024-08-01'), fact(80, '2024-04-01', '2024-06-30', '2025-08-01'),  # restated after a split
            fact(90, '2025-04-01', '2025-06-30', '2025-08-01')]}}
        points = vc.share_points(data)
        self.assertEqual([p['value'] for p in points], [10, 90, 100])

    def test_a_share_count_off_by_a_thousand_in_one_filing_is_left_out(self):
        points = [{'end': 1, 'value': 90e6}, {'end': 2, 'value': 89e9}, {'end': 3, 'value': 89e6}, {'end': 4, 'value': 180e6}]
        self.assertEqual([p['end'] for p in vc.clean_shares(points)], [1, 3, 4])  # a real doubling (a split) stays

    def test_revenue_takes_the_widest_name(self):
        rows = {'facts': {'us-gaap': {
            'RevenueFromContractWithCustomerExcludingAssessedTax': {'units': {'USD': [fact(5, '2024-01-01', '2024-12-31', '2025-02-10', '10-K')]}},
            'Revenues': {'units': {'USD': [fact(100, '2024-01-01', '2024-12-31', '2025-02-10', '10-K')]}}}}}
        self.assertEqual(vc.fundamentals(rows)['revenue'][-1]['value'], 100)


class Score(unittest.TestCase):
    def test_trimmed_mean_leaves_out_the_top_and_bottom_five_percent(self):
        self.assertEqual(vc.trimmed_mean(list(range(1, 101))), 50.5)

    def test_score_is_the_distance_below_the_five_year_mean(self):
        history = [(i, 15.0, 5.0) for i in range(300)]
        today = vc.score_at(history + [(300, 3.8, 5.0)], 300)
        self.assertAlmostEqual(today['exact'], (100 * (1 - 3.8 / 15) + 0) / 2)  # P/E 3.8 against 15: 75%; P/S at its mean: 0%
        self.assertFalse(today['low'])  # P/S is not below every day
        both = vc.score_at(history + [(300, 3.8, 2.5)], 300)
        self.assertAlmostEqual(both['exact'], (100 * (1 - 3.8 / 15) + 50) / 2)
        self.assertTrue(both['low'])
        self.assertIsNone(vc.score_at(history + [(300, None, 2.5)], 300))  # a loss today: never scored (owner, Nov 24)
        self.assertIsNone(vc.score_at(history[:200] + [(200, 3.8, 2.5)], 200))  # under a year of history
        # loss days have no P/E and stay out of its mean
        mixed = [(i, None if i % 2 else 10.0, 5.0) for i in range(600)]
        self.assertAlmostEqual(vc.score_at(mixed + [(600, 5.0, 5.0)], 600)['exact'], (50 + 0) / 2)
        # under a year of profitable days: not scored (a company just out of losses has no P/E history to compare with)
        self.assertIsNone(vc.score_at(mixed[:400] + [(400, 5.0, 5.0)], 400))

    def test_years_of_near_zero_revenue_or_earnings_count_at_the_cap(self):
        # AST SpaceMobile, Nov 2026: P/S in the thousands while revenue was near zero, about 170 now. Uncapped, today looked 80% cheap.
        history = [(i, 20.0, 2000.0 if i < 400 else 300.0) for i in range(600)]
        today = vc.score_at(history + [(600, 20.0, 40.0)], 600)
        self.assertAlmostEqual(today['exact'], (0 + 100 * (1 - 40 / vc.PS_CAP)) / 2)
        # a P/E of 900 on earnings near zero counts as 100 in the mean: a P/E of 60 today is 40% below it, not 93%
        thin = [(i, 900.0, 5.0) for i in range(600)]
        self.assertAlmostEqual(vc.score_at(thin + [(600, 60.0, 5.0)], 600)['exact'], (40 + 0) / 2)

    def test_split_rebases_the_stored_closes_and_keeps_market_value(self):
        db = sqlite3.connect(':memory:')
        vc.schema(db)
        days = trading_days('2026-11-02', 10)
        vc.store_history(db, 'X', [(d, 800.0) for d in days[:5]], [(d, 800.0) for d in days[:5]])
        # 8-for-1 on days[5]: the provider's adjusted history is now one eighth.
        vc.store_update(db, 'X', [(d, 100.0) for d in days[:10]])
        rows = db.execute('SELECT day, raw, adj FROM value_check_closes ORDER BY day').fetchall()
        db.close()
        self.assertAlmostEqual(rows[0][2], 100.0)
        self.assertEqual(rows[0][1], 800.0)
        record = {'shares': [{'end': date.fromisoformat(days[0]).toordinal(), 'value': 1.0}],
                  'revenue': [{'end': date.fromisoformat(days[0]).toordinal() - 1, 'filed': date.fromisoformat(days[0]).toordinal(), 'value': 100.0}],
                  'income': []}
        ratios = vc.daily_ratios(rows, record)
        self.assertAlmostEqual(ratios[0][2], 8.0)   # 800 x 1 share / 100
        self.assertAlmostEqual(ratios[-1][2], 8.0)  # 100 x 8 shares / 100: unchanged by the split


class Snapshot(unittest.TestCase):
    def universe(self):
        companies = {t: {'ticker': t, 'cik': 1, 'en': t, 'ja': t + 'ジャ'} for t in ('UP', 'DOWN', 'LOSS', 'SHRINK')}
        return {'tech': ['UP', 'DOWN', 'LOSS', 'SHRINK'], 'all': ['UP', 'DOWN', 'LOSS', 'SHRINK', 'BRK.B'], 'companies': companies}

    def build(self):
        days = trading_days('2021-01-04', 1300)
        first = date.fromisoformat(days[0]).toordinal()

        def record(revenue_now=200.0, income=10.0):
            # revenue reported each quarter, growing; known from the start of the price history
            revenue = [{'end': first - 400 + q * 91, 'filed': first - 380 + q * 91, 'value': 100.0 + q * (revenue_now - 100.0) / 25} for q in range(26)]
            return {'revenue': revenue, 'income': [{**p, 'value': income} for p in revenue], 'shares': [{'end': first - 10, 'value': 1.0}]}

        # UP falls steadily, so today is its cheapest day (100); DOWN rises, so today is its dearest (0).
        up = [(d, 100.0 - i * 0.05, 100.0 - i * 0.05) for i, d in enumerate(days)]
        down = [(d, 10.0 + i * 0.05, 10.0 + i * 0.05) for i, d in enumerate(days)]
        loss_record = record(income=-5.0)
        shrink = record()
        shrink['revenue'][-1] = {**shrink['revenue'][-1], 'value': 50.0}
        closes = {'UP': up, 'DOWN': down, 'LOSS': up, 'SHRINK': up}
        records = {'UP': record(), 'DOWN': record(), 'LOSS': loss_record, 'SHRINK': shrink}
        return vc.build_snapshot(self.universe(), closes, records, datetime(2026, 11, 20, 22, tzinfo=timezone.utc))

    def test_ranking_exclusions_and_order(self):
        snap = self.build()
        tech = snap['universes']['tech']
        self.assertEqual([r['ticker'] for r in tech['items']], ['UP'])  # a loss-maker is never ranked (owner, Nov 24)
        self.assertEqual(tech['excluded'], {'above-average': ['DOWN'], 'not-profitable': ['LOSS'], 'revenue-decline': ['SHRINK']})
        self.assertEqual(snap['universes']['all']['excluded']['share-class'], ['BRK.B'])
        up = tech['items'][0]
        self.assertGreater(up['score'], 30)
        self.assertTrue(up['low'])
        self.assertIsNotNone(up['pe'])
        self.assertEqual(snap['basis'], 'trailing')
        self.assertEqual(up['ja'], 'UPジャ')

    def test_in_and_out(self):
        rows = [{'ticker': 'A', 'score': 50, 'previous': 20}, {'ticker': 'B', 'score': 20, 'previous': 40},
                {'ticker': 'C', 'score': 60, 'previous': 40}, {'ticker': 'D', 'score': 31, 'previous': 29}]
        moved = vc.changes(rows)  # the line is 30% (owner, Nov 22)
        self.assertEqual(moved['in'], [{'ticker': 'A', 'from': 20, 'to': 50}, {'ticker': 'D', 'from': 29, 'to': 31}])
        self.assertEqual(moved['out'], [{'ticker': 'B', 'from': 40, 'to': 20}])


class ForeignAndShort(unittest.TestCase):
    def test_ifrs_facts_in_their_own_currency(self):
        data = {'facts': {'ifrs-full': {'Revenue': {'units': {
            'TWD': [fact(1000, '2024-01-01', '2024-12-31', '2025-04-10', '20-F'), fact(800, '2023-01-01', '2023-12-31', '2024-04-10', '20-F')],
            'USD': [fact(31, '2024-01-01', '2024-12-31', '2025-04-10', '20-F')]}}}}}
        record = vc.fundamentals(data)
        self.assertEqual(record['currency'], 'TWD')
        self.assertEqual(record['revenue'][-1]['value'], 1000)

    def test_provider_quarters_extend_the_sec_series_on_the_depositary_share_basis(self):
        end = lambda text: date.fromisoformat(text).toordinal()  # noqa: E731
        record = {'revenue': [{'end': end('2024-12-31'), 'filed': end('2025-04-10'), 'value': 1000.0}], 'income': [],
                  'shares': [{'end': end('2025-12-31'), 'value': 25.0}], 'currency': 'TWD', 'source': 'sec'}
        quarters = [('2025-03-31', 100), ('2025-06-30', 110), ('2025-09-30', 120), ('2025-12-31', 130), ('2026-03-31', 140), ('2026-06-30', 150)]
        body = {'meta': {'currency': 'TWD'}, 'income_statement': [
            {'fiscal_date': d, 'sales': v, 'net_income': v / 2, 'diluted_shares_outstanding': 5.0} for d, v in reversed(quarters)]}
        merged = vc.supplement(record, body)
        self.assertEqual(merged['source'], 'sec+twelvedata')
        self.assertEqual([p['value'] for p in merged['revenue']], [1000.0, 460.0, 500.0, 540.0])
        self.assertEqual(merged['shares'][0]['value'], 5.0)  # 25 ordinary shares = 5 depositary shares
        self.assertAlmostEqual(vc.revenue_growth(merged), 150 / 110 * 100 - 100)  # no twelve months a year back: the quarter
        # never two currencies in one series
        self.assertEqual(vc.supplement(record, {**body, 'meta': {'currency': 'USD'}})['revenue'], record['revenue'])

    def test_market_value_is_turned_into_the_filing_currency(self):
        days = trading_days('2026-01-05', 3)
        record = {'shares': [{'end': date.fromisoformat(days[0]).toordinal() - 5, 'value': 2.0}], 'income': [], 'currency': 'TWD',
                  'revenue': [{'end': date.fromisoformat(days[0]).toordinal() - 30, 'filed': date.fromisoformat(days[0]).toordinal() - 1, 'value': 640.0}]}
        closes = [(d, 10.0, 10.0) for d in days]
        ratios = vc.daily_ratios(closes, record, [(days[0], 32.0)])
        self.assertAlmostEqual(ratios[-1][2], 1.0)  # 10 x 2 = 20 dollars = 640 Taiwan dollars, over 640 of revenue
        self.assertEqual(vc.daily_ratios(closes, record, None), [])

    def test_a_recent_listing_is_calculated_over_its_own_history_and_says_so(self):
        days = trading_days('2025-06-02', 300)
        first = date.fromisoformat(days[0]).toordinal()
        revenue = [{'end': first - 400 + q * 91, 'filed': first - 380 + q * 91, 'value': 100.0 + q} for q in range(12)]
        record = {'shares': [{'end': first - 5, 'value': 1.0}], 'income': [{**p, 'value': 5.0} for p in revenue], 'revenue': revenue}
        closes = [(d, 100.0 - i * 0.1, 100.0 - i * 0.1) for i, d in enumerate(days)]
        row = vc.evaluate('NEW', closes, record, days[-1])
        self.assertEqual(row['period'], 'listed')
        self.assertGreater(row['score'], 0)
        self.assertTrue(row['low'])

    def test_loss_makers_thin_earnings_and_new_profits_are_not_ranked(self):
        # The AST SpaceMobile case (owner, Nov 24): revenue from near zero to 143 million, a net loss of 628 million, P/S down from
        # the thousands. It came first in ハイテク on its P/S alone; now it is left out.
        days = trading_days('2021-11-01', 1300)
        first = date.fromisoformat(days[0]).toordinal()
        revenue = [{'end': first - 400 + q * 91, 'filed': first - 380 + q * 91, 'value': 0.5 if q < 18 else 143.0} for q in range(26)]
        closes = [(d, 50.0, 50.0) for d in days]

        def row(income_of):
            record = {'shares': [{'end': first - 10, 'value': 100.0}], 'revenue': revenue,
                      'income': [{**p, 'value': income_of(q)} for q, p in enumerate(revenue)]}
            return vc.evaluate('X', closes, record, days[-1])

        self.assertEqual(row(lambda q: -628.0), {'excluded': 'not-profitable'})
        self.assertEqual(row(lambda q: -628.0 if q < 22 else 10.0), {'excluded': 'short-profit-history'})
        self.assertEqual(row(lambda q: 40.0), {'excluded': 'thin-earnings'})  # P/E 125
        ranked = row(lambda q: 500.0)  # P/E 10 all along: P/S compared with its capped mean, not 99% below the raw one
        self.assertEqual(ranked['pe'], 10.0)
        self.assertLess(ranked['score'], 50)

    def test_the_same_percent_is_ordered_by_the_unrounded_value(self):
        rows = [{'ticker': 'A', 'score': 40, 'exact': 40.2}, {'ticker': 'B', 'score': 40, 'exact': 40.4}, {'ticker': 'C', 'score': 41, 'exact': 40.6}]
        self.assertEqual([r['ticker'] for r in vc.rank(rows)], ['C', 'B', 'A'])


class Credits(unittest.TestCase):
    def test_waits_while_the_minute_is_busy_and_never_passes_the_ceiling(self):
        clock = [0.0]
        usage = [445, 448, 300]
        calls = []

        def transport(path, params):
            calls.append(path)
            return {'current_usage': usage.pop(0) if usage else 0}

        def sleep(seconds):
            clock[0] += seconds

        pacer = vc.Pacer(transport, sleep=sleep, clock=lambda: clock[0], wall=lambda: clock[0])
        self.assertTrue(pacer.wait_for(8))
        self.assertEqual(clock[0], 122)  # two busy minutes, each waited out to 2 s into the next minute

    def test_own_budget_per_minute(self):
        clock = [0.0]
        pacer = vc.Pacer(lambda p, q: {'current_usage': 0}, sleep=lambda s: clock.__setitem__(0, clock[0] + s), clock=lambda: clock[0], own=16, wall=lambda: clock[0])
        self.assertTrue(pacer.wait_for(8))
        self.assertTrue(pacer.wait_for(8))
        self.assertTrue(pacer.wait_for(8))
        self.assertGreaterEqual(clock[0], 60)
        self.assertEqual(pacer.total, 24)

    def test_off_by_default_and_due_once_after_the_close(self):
        self.assertFalse(vc.enabled({}))
        self.assertTrue(vc.enabled({'VALUE_CHECK_ENABLED': 'true'}))
        friday = datetime(2026, 11, 20, 22, 40, tzinfo=timezone.utc)  # 17:40 Eastern
        self.assertEqual(vc.due(friday, None), '2026-11-20')
        self.assertIsNone(vc.due(friday, '2026-11-20'))
        self.assertIsNone(vc.due(datetime(2026, 11, 20, 21, 0, tzinfo=timezone.utc), None))  # 16:00 Eastern
        self.assertIsNone(vc.due(datetime(2026, 11, 21, 22, 40, tzinfo=timezone.utc), None))  # Saturday

    def test_universe_file(self):
        universe = vc.load_universe()
        self.assertGreaterEqual(len(universe['tech']), 140)
        self.assertGreaterEqual(len(universe['all']), 500)
        self.assertTrue(set(universe['tech']) <= set(universe['all']))
        self.assertTrue(all(universe['companies'][t]['cik'] for t in universe['all']))
        json.dumps(universe)


class ValueCheckStorageTest(unittest.TestCase):
    def test_connect_creates_its_folder_and_waits_on_a_busy_file(self):
        """value-check-failed (Nov 22): the file and its folder are created on first use; busy_timeout and WAL like the monitor."""
        import tempfile
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'missing' / 'value-check.sqlite'
            db = vc.connect(str(path))
            try:
                self.assertTrue(path.exists())
                self.assertEqual(db.execute('PRAGMA busy_timeout').fetchone()[0], 30000)
                self.assertEqual(db.execute('PRAGMA journal_mode').fetchone()[0], 'wal')
            finally:
                db.close()

if __name__ == '__main__':
    unittest.main()
