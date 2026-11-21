"""週刊 Tech Phase PRO, owner review of Nov 21: only this week's events, and the week's market read from real prices.

1. The Nov 21 draft carried SK hynix's results, released on Oct 28 (its SEC 6-K copies were first stored on Nov 13 and Nov 16, and every
   source was picked by the time this service handled it). Each item is now dated by the event itself and kept only inside the issue's week.
2. The draft said nothing about a week in which the Nasdaq 100 fell more than in any week since March 2020. The week's moves are computed
   from closing prices, given to the model, and a headline or lead that leaves out a notable move is rejected or replaced."""
import json
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest import mock
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import market_results
import weekly_generator as gen
import weekly_issues as weekly
import weekly_market as wm
from test_weekly_generator import ENV, FakeModel, fake_prices, model_output, part, publish_flash

JST = ZoneInfo("Asia/Tokyo")
NOV21 = datetime(2026, 11, 21, 8, 30, tzinfo=JST).timestamp()  # the Saturday of the rejected draft

NVDA = {"kind": "earnings", "ticker": "NVDA", "period": "Q3 FY2027", "url": "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000088/nvda-20261117.htm",
        "facts": [{"key": "revenue", "ja": "売上高", "en": "Revenue", "value": "$115.8B", "comparisons": {"yearAgo": "$57B"}},
                  {"key": "guidance-revenue", "ja": "次四半期見通し 売上高", "en": "Next-quarter guidance Revenue", "value": "$130.0B ± 3%"}],
        "titleJa": "NVDA Q3 FY2027決算：売上高$115.8B", "titleEn": "NVDA Q3 FY2027 earnings: Revenue $115.8B"}
SKHY_FLASH = {"kind": "earnings", "ticker": "SKHY", "period": "3Q26", "url": "https://www.sec.gov/Archives/edgar/data/2120882/000119312526461909/d166755d6k.htm",
              "facts": [{"key": "revenue", "ja": "売上高", "en": "Revenue", "value": "$17.1B"}],
              "titleJa": "SKHY 3Q26決算：売上高$17.1B", "titleEn": "SKHY 3Q26 earnings: Revenue $17.1B"}
SKHY_ANALYSIS = {"headline": {"ja": "SKハイニックスはHBMで最高益", "en": "SK hynix posts record profit on HBM"},
                 "points": [{"ja": "HBMの売上が伸びました。", "en": "HBM revenue grew."}]}
PCE = {"kind": "economic", "ticker": "ECON", "period": "SEPTEMBER U.S. PCE", "url": "https://x.com/tipranks/status/30",
       "facts": [{"key": "pce-yoy", "ja": "PCE（前年比）", "en": "PCE (YoY)", "value": "1.1%", "comparisons": {"forecast": "1.2%"}}],
       "titleJa": "米国PCE物価指数（9月）：PCE（前年比） 1.1%", "titleEn": "U.S. PCE (YoY) 1.1%"}
RETAIL = {"kind": "economic", "ticker": "ECON", "period": "OCTOBER RETAIL SALES", "url": "https://x.com/tipranks/status/31",
          "facts": [{"key": "actual", "ja": "結果", "en": "Actual", "value": "0.2%", "comparisons": {"forecast": "0.4%", "previous": "0.8%"}}],
          "titleJa": "小売売上高（10月）：結果 0.2%", "titleEn": "Retail sales: actual 0.2%"}


def make_db(path):
    db = weekly.connect(path)
    market_results.schema(db)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS signal_events(id INTEGER PRIMARY KEY, url TEXT, tickers_json TEXT, published_at TEXT, published_on TEXT);
      CREATE TABLE IF NOT EXISTS official_research_publications(event_id INTEGER PRIMARY KEY, sha TEXT, body_sha TEXT, payload TEXT, evidence TEXT, started_at TEXT, public_at TEXT, generation_ms INTEGER);
      CREATE TABLE IF NOT EXISTS deep_analyses(source_ref TEXT PRIMARY KEY, kind TEXT, subject TEXT, source_sha TEXT, state TEXT, payload TEXT,
        created_at TEXT, published_at TEXT, source_url TEXT, source_title TEXT);
      CREATE TABLE IF NOT EXISTS company_wire(key TEXT PRIMARY KEY, ticker TEXT, source TEXT, title TEXT, publisher TEXT, url TEXT, published_at TEXT, article TEXT);
    """)
    return db


def crash_market(pct=-10.5):
    monday, _ = wm.week_of(date(2026, 11, 21))
    return wm.compute(date(2026, 11, 21), transport=fake_prices(monday.isoformat(), pct))


class Base(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = make_db(Path(self.temp.name) / "w.sqlite")
        # This week's NVIDIA results (released Nov 17, stored the same day): kept.
        publish_flash(self.db, 1, NVDA, "2026-11-17T21:22:03+00:00")
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.temp.cleanup()

    def labels(self, evidence):
        return " ".join(item["label"] for item in evidence)


class IssueWeekTests(Base):
    def test_the_issue_week_is_the_trading_week_before_the_saturday(self):
        self.assertEqual(gen.issue_window(NOV21), (date(2026, 11, 14), date(2026, 11, 20)))
        self.assertEqual(wm.week_of(date(2026, 11, 21)), (date(2026, 11, 16), date(2026, 11, 20)))

    def test_sk_hynix_results_of_oct_28_stored_this_week_are_never_this_weeks_news(self):
        """Every way the Oct 28 release can reach the week: a flash stored late, a late deep analysis (its release date read from the title,
        or only from the schedule), an official note published on Oct 28 but processed this week, and a 6-K copy whose dateline says Oct 28."""
        publish_flash(self.db, 2, SKHY_FLASH, "2026-11-16T11:30:00+00:00", released="2026-10-28T07:00:00+00:00")
        self.db.execute("INSERT INTO deep_analyses VALUES('source:a:1','earnings','SKHY','s','done',?,?,?,?,?)",
                        (json.dumps(SKHY_ANALYSIS, ensure_ascii=False), "2026-11-16T12:00:00+00:00", "2026-11-16T12:30:00+00:00",
                         "https://news.skhynix.com/en/q3-2026-business-results/", "SK hynix Announces 3Q26 Financial Results October 28, 2026"))
        self.db.execute("INSERT INTO deep_analyses VALUES('source:b:2','earnings','SKHY','s','done',?,?,?,?,?)",
                        (json.dumps(SKHY_ANALYSIS, ensure_ascii=False), "2026-11-16T12:00:00+00:00", "2026-11-16T12:30:00+00:00",
                         "https://www.sec.gov/Archives/edgar/data/2120882/000119312526461909/d166755d6k.htm", "6-K · FORM 6-K"))
        for event_id, published_on, summary in ((7, "2026-10-28", "SK hynix reported record third-quarter results."),
                                                (8, "2026-11-16", "SEOUL, October 28, 2026 /PRNewswire/ -- SK hynix announced its third-quarter results.")):
            self.db.execute("INSERT INTO signal_events(id,url,tickers_json,published_on) VALUES(?,?,?,?)",
                            (event_id, f"https://www.sec.gov/skhy/{event_id}", '["SKHY"]', published_on))
            payload = {"title": {"ja": "SKハイニックスの決算", "en": "SK hynix results"}, "summary": {"ja": "SKハイニックスは決算を発表しました。", "en": summary}, "facts": []}
            self.db.execute("INSERT INTO official_research_publications VALUES(?,'s','b',?,'[]',?,?,0)",
                            (event_id, json.dumps(payload, ensure_ascii=False), "2026-11-18T00:00:00+00:00", "2026-11-18T00:00:00+00:00"))
        self.db.commit()
        notes = []
        evidence = gen.collect(self.db, NOV21, notes=notes)
        self.assertEqual([item["ticker"] for item in evidence], ["NVDA"], "only this week's NVIDIA results are left")
        self.assertEqual(evidence[0]["date"], "2026-11-17")
        self.assertNotIn("SKHY", json.dumps(evidence, ensure_ascii=False))
        self.assertNotIn("ハイニックス", json.dumps(evidence, ensure_ascii=False))
        memo = "\n".join(notes)
        self.assertEqual(len(notes), 5, memo)
        self.assertEqual(memo.count("米国時間2026-10-27"), 5, "Oct 28 in Seoul is the evening of Oct 27 in New York")
        self.assertIn("〔outside-week-schedule〕", memo)
        # Without the schedule, the release's own date (the flash's source time, the note's publication date) and the date it states in its
        # title or dateline still exclude it; only the 6-K analysis, which carries no date of its own, would be left.
        notes = []
        with mock.patch.object(gen, "scheduled_results", return_value=None):
            again = gen.collect(self.db, NOV21, notes=notes)
        self.assertEqual([item["ticker"] for item in again], ["NVDA", "SKHY"])
        memo = "\n".join(notes)
        for how in ("source", "stated"):
            self.assertIn("〔outside-week-" + how + "〕", memo)
        self.assertEqual(memo.count("outside-week"), 4)

    def test_the_results_date_in_the_release_schedule_wins_over_the_date_a_copy_was_found(self):
        item = {"kind": "analysis", "ticker": "SKHY", "label": "SKHY: HBM", "quote": "", "eventDate": date(2026, 11, 16), "eventDateSource": "release"}
        self.assertEqual(gen.event_date(item), (date(2026, 10, 27), "schedule"))  # 2026-10-28 00:00 UTC: Oct 28 in Seoul, Oct 27 in New York
        # A company the schedule does not know keeps its own date; a schedule entry more than a quarter back is a different release.
        self.assertEqual(gen.event_date({**item, "ticker": "ZZZZ"}), (date(2026, 11, 16), "release"))
        self.assertIsNone(gen.scheduled_results("SKHY", date(2027, 2, 1)))

    def test_an_item_without_any_date_is_left_out_and_noted(self):
        notes = []
        kept = gen.keep_in_window([{"id": "E1", "kind": "note", "label": "undated", "quote": "", "ticker": ""}], gen.issue_window(NOV21), notes)
        self.assertEqual(kept, [])
        self.assertTrue(notes and "no-event-date" in notes[0])

    def test_the_draft_of_nov_21_never_carries_sk_hynix_and_the_model_never_sees_it(self):
        publish_flash(self.db, 2, SKHY_FLASH, "2026-11-16T11:30:00+00:00", released="2026-10-28T07:00:00+00:00")
        self.db.commit()
        model = FakeModel(model_output(headline="ナスダック100が週間10.5%安", lead="ナスダック100は週間で10.5%下落し、2020年3月以来の大きさでした。",
                                       parts=[part("text", heading="NVDAは増収でした", body="NVDAの売上高は$115.8Bでした。", evidenceIds=["E1"])]))
        saved = gen.generate(self.db, NOV21, transport=model, env=ENV, market=crash_market())
        sent = model.calls[0]["input"]
        self.assertNotIn("SKHY", sent)
        self.assertNotIn("SKHY", json.dumps(saved["parts"], ensure_ascii=False))
        request = json.loads(sent)
        self.assertEqual((request["weekStart"], request["weekEnd"]), ("2026-11-14", "2026-11-20"))
        self.assertTrue(any("SKHY" in line and "outside-week" in line for line in saved["notes"]))

    def test_an_indicator_released_before_the_week_is_left_out_and_one_released_in_it_says_what_it_is(self):
        publish_flash(self.db, 3, PCE, "2026-11-17T13:00:00+00:00", released="2026-10-31T12:30:00+00:00")
        publish_flash(self.db, 4, RETAIL, "2026-11-17T13:31:00+00:00", released="2026-11-17T13:30:00+00:00")
        self.db.commit()
        evidence = gen.collect(self.db, NOV21)
        indicators = [item for item in evidence if item["kind"] == "indicator"]
        self.assertEqual([item["label"] for item in indicators], ["小売売上高"], "the reference month is not in the title; last month's PCE is gone")
        card = gen.build_card(evidence, {"evidenceId": indicators[0]["id"], "factKey": "actual"})
        self.assertEqual(card["label"], "小売売上高")
        self.assertNotIn("結果", card["label"])
        self.assertEqual(card["range"], "予想 0.4%・前回 0.8%・10月分")

    def test_titles_lose_the_reference_month_in_parentheses(self):
        self.assertEqual(gen.plain_title("米国PCE物価指数（10月）"), "米国PCE物価指数")
        self.assertEqual(gen.plain_title("米国小売売上高（10月・速報）"), "米国小売売上高")
        self.assertEqual(gen.plain_title("NVIDIA 決算（米国市場終了後）"), "NVIDIA 決算（米国市場終了後）")
        rows = gen.upcoming(NOV21)
        self.assertIn("米国PCE物価指数", [row["name"] for row in rows])
        self.assertFalse(any("10月" in row["name"] for row in rows))


class MarketComputationTests(unittest.TestCase):
    def test_the_weekly_change_and_its_historical_context_come_from_closing_prices(self):
        market = crash_market()
        qqq = next(item for item in market["indices"] if item["symbol"] == "QQQ")
        self.assertEqual(str(qqq["pct"]), "-10.5")
        self.assertEqual((qqq["lastDate"], qqq["previousDate"]), ("2026-11-20", "2026-11-13"))
        self.assertEqual(qqq["since"]["monday"], "2020-03-16")
        self.assertEqual(str(qqq["since"]["pct"]), "-11.3")
        self.assertEqual(qqq["record"], "2020年3月以来")
        self.assertTrue(qqq["notable"])
        lines = "\n".join(wm.lines(market))
        self.assertIn("ナスダック100連動ETF（QQQ）は週間で10.5%下落。騰落率-10.5%", lines)
        self.assertIn("2020年3月以来の大きさ", lines)
        self.assertIn("2020-03-16の週で-11.3%", lines)
        self.assertNotRegex(lines, r"[)）][。、]", "no punctuation right after a closing parenthesis")
        memo = "\n".join(wm.verification(market))
        self.assertIn("QQQ 週間-10.5% = 2026-11-20終値", memo)
        self.assertIn("Twelve Data", memo)

    def test_a_larger_move_than_any_earlier_week_says_so_and_a_small_move_claims_nothing(self):
        worst = crash_market(-15.0)
        qqq = next(item for item in worst["indices"] if item["symbol"] == "QQQ")
        self.assertTrue(qqq["since"]["beyondData"])
        self.assertEqual(qqq["record"], "2020年1月以降で最大")
        calm = crash_market(-0.4)
        self.assertFalse(any(item["record"] or item["notable"] for item in calm["indices"]))
        self.assertEqual(wm.lead_sentence(calm), "")

    def test_weekend_prints_are_not_closes_and_batches_stay_under_the_providers_limit(self):
        rows = wm._series({"status": "ok", "values": [{"datetime": "2026-11-21", "close": "1"}, {"datetime": "2026-11-20", "close": "2"}]})
        self.assertEqual(rows, [(date(2026, 11, 20), wm.Decimal("2"))])
        calls = []

        def transport(path, params):
            calls.append(params)
            symbols = params["symbol"].split(",")
            body = {s: {"status": "ok", "values": [{"datetime": "2026-11-20", "close": "1"}]} for s in symbols}
            return body[symbols[0]] if len(symbols) == 1 else body
        wm.fetch_closes([f"S{i}" for i in range(30)], "2008-01-01", "2026-11-21", transport)
        self.assertTrue(all(len(c["symbol"].split(",")) * int(c["outputsize"]) <= wm.BATCH_ROWS for c in calls))

    def test_the_key_never_appears_in_an_error(self):
        with mock.patch.object(wm.urllib.request, "urlopen", side_effect=OSError("https://api.twelvedata.com/x?apikey=secret-value")):
            with self.assertRaises(wm.MarketUnavailable) as caught:
                wm._get("time_series", {"symbol": "QQQ"}, env={"TWELVE_DATA_API_KEY": "secret-value"})
        self.assertNotIn("secret", str(caught.exception))


class LeadTests(Base):
    def compose(self, output, market, lenient=True):
        evidence = gen.collect(self.db, NOV21)
        quote = "\n".join(wm.lines(market))
        evidence.append({"id": f"E{len(evidence) + 1}", "kind": "market", "label": "market", "url": "", "quote": quote, "facts": [], "text": quote, "ticker": ""})
        return gen.compose(output, evidence, [], lenient=lenient, date="2026-11-21", market=market)

    def test_a_lead_about_earnings_only_in_a_crash_week_is_rejected_or_replaced(self):
        market = crash_market()
        output = model_output(headline="NVDAは増収でした", lead="NVDAの決算は強く、AI需要は続いています。", parts=[])
        with self.assertRaises(ValueError) as caught:
            self.compose(output, market, lenient=False)
        self.assertEqual(str(caught.exception), "omits-market-move")
        headline, lead, parts, notes, _ = self.compose(output, market)
        self.assertTrue(lead.startswith("今週はナスダック100が週間で10.5%下落し、2020年3月以来の大きな下げになりました。"), lead)
        self.assertIn("10.5%安", headline)
        self.assertTrue(any("omits-market-move" in line and line.startswith("【定型文】導入文") for line in notes))
        self.assertEqual([p["heading"] for p in parts if p["section"] == "market"][:2], ["今週の指数と金・銀・ビットコイン", "今週大きく動いた銘柄"])

    def test_a_lead_that_leads_with_the_move_and_its_computed_comparison_is_kept(self):
        market = crash_market()
        lead = "ナスダック100は週間で10.5%下落し、2020年3月以来の大きさになりました。NVDAの決算発表のあとも、売りが続きました。"
        output = model_output(headline="ナスダック100が週間10.5%安、2020年3月以来の下げ", lead=lead, parts=[])
        headline, kept, _, notes, _ = self.compose(output, market, lenient=False)
        self.assertEqual(kept, lead)
        self.assertFalse(any("omits-market-move" in line for line in notes))

    def test_a_comparison_the_data_does_not_prove_is_never_published(self):
        market = crash_market()
        output = model_output(headline="ナスダック100が週間10.5%安、2008年以来の下げ", lead="ナスダック100は週間で10.5%下落し、2008年以来の下げでした。", parts=[])
        headline, lead, _, notes, _ = self.compose(output, market)
        self.assertNotIn("2008", headline + lead)
        self.assertIn("2020年3月以来", lead)

    def test_a_calm_week_asks_nothing_of_the_lead(self):
        market = crash_market(-0.4)
        output = model_output(headline="NVDAは増収でした", lead="NVDAの決算は強めでした。", parts=[])
        _, lead, _, notes, _ = self.compose(output, market, lenient=False)
        self.assertEqual(lead, "NVDAの決算は強めでした。")

    def test_the_model_is_told_the_week_is_notable_and_given_the_computed_lines(self):
        model = FakeModel(model_output(parts=[]))
        gen.generate(self.db, NOV21, transport=model, env=ENV, market=crash_market())
        request = json.loads(model.calls[0]["input"])
        self.assertTrue(request["marketNotable"])
        market = next(e for e in request["evidence"] if e["type"] == "market")
        self.assertIn("2020年3月以来", market["text"])
        self.assertIn("今週の相場", model.calls[0]["instructions"])

    def test_no_draft_and_no_model_call_without_the_weeks_prices(self):
        model = FakeModel(model_output())
        with mock.patch.object(wm, "_get", side_effect=wm.MarketUnavailable("twelve-data-time_series-HTTPError")):
            with self.assertRaises(RuntimeError) as caught:
                gen.generate(self.db, NOV21, transport=model, env=ENV)
        self.assertIn("weekly-no-market-data", str(caught.exception))
        self.assertEqual(model.calls, [])


class HeadlineRankingTests(Base):
    def add(self, key, ticker, title, publisher, at):
        self.db.execute("INSERT INTO company_wire(key,ticker,source,title,publisher,url,published_at,article) VALUES(?,?,?,?,?,?,?,?)",
                        (key, ticker, "stocknews", title, publisher, f"https://example.com/{key}", at, key))

    def test_the_weeks_market_moving_headlines_come_first_with_their_dates_and_links(self):
        self.add("a", "MKT", "Trump says US to penalize firms building data centers abroad", "Reuters", "2026-11-20T18:08:18+00:00")
        self.add("b", "MKT", "U.S. Stocks Extend Plunge as AI Boom Turns to Bust", "WSJ", "2026-11-20T21:27:00+00:00")
        self.add("c", "PANW", "Palo Alto Networks to Present at Upcoming Investor Event", "PRNewsWire", "2026-11-20T13:30:00+00:00")
        self.add("d", "MKT", "Nasdaq plunges after the jobs report", "Reuters", "2026-11-06T21:00:00+00:00")
        self.db.commit()
        rows = gen.wire_headlines(self.db, NOV21)
        self.assertEqual([row["titleEn"] for row in rows], ["U.S. Stocks Extend Plunge as AI Boom Turns to Bust", "Trump says US to penalize firms building data centers abroad"])
        self.assertTrue(all(row["url"].startswith("https://") and row["publishedAt"].startswith("2026-11-20") for row in rows))
        evidence = gen.collect(self.db, NOV21, rows)
        news = [item for item in evidence if item["kind"] == "news"]
        self.assertEqual([item["date"] for item in news], ["2026-11-20", "2026-11-20"])
        self.assertTrue(news[1]["label"].startswith("Reuters: Trump"))


if __name__ == "__main__":
    unittest.main()
