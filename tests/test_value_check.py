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


class Score(unittest.TestCase):
    def test_position_is_the_share_of_days_higher_than_today(self):
        self.assertEqual(vc.position([10, 20, 30, 40], 15), 75.0)
        self.assertIsNone(vc.position([], 1))

    def test_score_averages_pe_and_ps_and_uses_ps_alone_on_a_loss(self):
        ratios = [(i, 30.0 - i * 0.01, 10.0 - i * 0.001) for i in range(800)]
        score, pe_pos, ps_pos, _, _ = vc.score_at(ratios, 799)
        self.assertEqual((pe_pos, ps_pos, score), (100.0, 100.0, 100))
        ratios[-1] = (799, None, 10.0)  # loss today: P/S only, P/S now the highest -> 0
        self.assertEqual(vc.score_at(ratios, 799)[0], 0)
        self.assertIsNone(vc.score_at(ratios[:200], 199))  # under three years of history

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
        self.assertEqual([r['ticker'] for r in tech['items']], ['LOSS', 'UP', 'DOWN'])  # ties by ticker
        self.assertEqual(tech['excluded'], {'revenue-decline': ['SHRINK']})
        self.assertEqual(snap['universes']['all']['excluded']['share-class'], ['BRK.B'])
        loss = tech['items'][0]
        self.assertIsNone(loss['pe'])
        self.assertEqual(loss['score'], 100)
        self.assertEqual(snap['basis'], 'trailing')
        self.assertEqual(loss['ja'], 'LOSSジャ')

    def test_in_and_out(self):
        rows = [{'ticker': 'A', 'score': 96, 'previous': 61}, {'ticker': 'B', 'score': 61, 'previous': 74},
                {'ticker': 'C', 'score': 80, 'previous': 75}, {'ticker': 'D', 'score': 72, 'previous': 69}]
        moved = vc.changes(rows)
        self.assertEqual(moved['in'], [{'ticker': 'A', 'from': 61, 'to': 96}, {'ticker': 'D', 'from': 69, 'to': 72}])
        self.assertEqual(moved['out'], [{'ticker': 'B', 'from': 74, 'to': 61}])


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

        pacer = vc.Pacer(transport, sleep=sleep, clock=lambda: clock[0])
        self.assertTrue(pacer.wait_for(8))
        self.assertEqual(clock[0], 20)  # two busy minutes (445 + 8 and 448 + 8 pass 450), then room

    def test_own_budget_per_minute(self):
        clock = [0.0]
        pacer = vc.Pacer(lambda p, q: {'current_usage': 0}, sleep=lambda s: clock.__setitem__(0, clock[0] + s), clock=lambda: clock[0], own=16)
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


if __name__ == '__main__':
    unittest.main()
