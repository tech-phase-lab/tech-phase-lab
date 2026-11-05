"""FOMC, GDP and retail-sales readers (official pages) and the ISM level reader (headlines). Fixtures are short excerpts of the real pages; no network."""
import json
import sys
import tempfile
import unittest
import urllib.error
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import event_results as events
import indicator_results as ind

FOMC_TEXT = ("October 28, 2026 Federal Reserve issues FOMC statement For release at 2:00 p.m. EDT Share The Federal Open Market Committee approved the "
             "following statement for release by a 10 – 2 vote: The Committee decided to maintain the target range for the federal funds rate at 3-3/4 to 4 percent, "
             "in support of the Federal Reserve's dual mandate. Voting against the monetary policy action were Lisa D. Cook and Beth M. Hammack, who preferred to raise "
             "the target range for the federal funds rate by 1/4 percentage point at this meeting. Implementation Note issued October 28, 2026")
CUT_TEXT = FOMC_TEXT.replace("maintain the target range for the federal funds rate at 3-3/4 to 4 percent", "lower the target range for the federal funds rate by 1/4 percentage point to 3-1/2 to 3-3/4 percent")
GDP_TEXT = ("Home News GDP (Advance Estimate), 3rd Quarter 2026 News Release EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Thursday, October 29, 2026 BEA 26—45 "
            "GDP (Advance Estimate), 3rd Quarter 2026 Real gross domestic product (GDP) increased at an annual rate of 3.4 percent in the third quarter of 2026 "
            "(July, August, and September), according to the advance estimate released today by the U.S. Bureau of Economic Analysis (BEA). In the second quarter, real GDP increased 2.2 percent.")
RETAIL_TEXT = ("FOR IMMEDIATE RELEASE: Thursday, October 15, 2026 Advance Monthly Sales for Retail and Food Services October 15, 2026 CB26-165 Advance Estimates of U.S. Retail and "
               "Food Services Advance estimates of U.S. retail and food services sales for September 2026, adjusted for seasonal variation and holiday and trading-day differences, "
               "but not for price changes, were $745.0 billion, up 0.8 percent (±0.4 percent) from the previous month, and up 6.3 percent (±0.5 percent) from September 2025.")
MEETING = date(2026, 10, 28)
NOW = datetime(2026, 10, 28, 18, 5, tzinfo=timezone.utc)


class Fomc(unittest.TestCase):
    def test_a_hold_is_read_from_the_statement(self):
        d = ind.parse_fomc(FOMC_TEXT, MEETING)
        self.assertEqual((d["action"], d["low"], d["high"], d["step"], d["yes"], d["no"]), ("maintain", 3.75, 4.0, None, 10, 2))
        self.assertEqual(d["at"], datetime(2026, 10, 28, 18, 0, tzinfo=timezone.utc), "2:00 p.m. EDT")
        payload = ind.fomc_payload(d, MEETING, "https://www.federalreserve.gov/x", NOW)
        self.assertEqual(payload["id"], "fomc-2026-10-28")
        self.assertEqual(payload["resultJa"], "政策金利を据え置き（3.75〜4.00%）")
        self.assertIn("賛成10・反対2", payload["detailJa"])
        self.assertNotIn("引き", payload["resultJa"], "the dissenters' wish to raise is not the decision")

    def test_a_cut_and_the_winter_clock(self):
        d = ind.parse_fomc(CUT_TEXT.replace("October 28, 2026", "December 9, 2026").replace("EDT", "EST").replace("issued October 28, 2026", "issued December 9, 2026"), date(2026, 12, 9))
        self.assertEqual((d["action"], d["low"], d["high"], d["step"]), ("lower", 3.5, 3.75, 0.25))
        self.assertEqual(d["at"], datetime(2026, 12, 9, 19, 0, tzinfo=timezone.utc), "2:00 p.m. EST")
        self.assertEqual(ind.fomc_payload(d, date(2026, 12, 9), "u", NOW)["resultJa"], "政策金利を0.25ポイント引き下げ（3.50〜3.75%）")

    def test_wording_that_does_not_match_is_not_read(self):
        for bad in (FOMC_TEXT.replace("3-3/4 to 4 percent", "3-3/4 to 4-1/2 percent"),   # not a quarter-point range
                    FOMC_TEXT.replace("3-3/4 to 4 percent", "3-3/4 to four percent"),
                    FOMC_TEXT.replace("maintain the target range for the federal funds rate at", "maintain the target range for the federal funds rate by 1/4 percentage point at"),
                    FOMC_TEXT.replace("For release at 2:00 p.m. EDT", "For release at 2 o'clock"),
                    FOMC_TEXT.replace("3-3/4 to 4 percent", "13-3/4 to 14 percent"),
                    "The Committee will announce its decision later."):
            self.assertIsNone(ind.parse_fomc(bad, MEETING))
        self.assertIsNone(ind.parse_fomc(FOMC_TEXT, date(2026, 12, 9)), "the page must be the statement of that meeting")

    def test_fractions(self):
        self.assertEqual([ind.fraction(x) for x in ("3-3/4", "4", "1/4", "4-1/4", "0")], [3.75, 4.0, 0.25, 4.25, 0.0])
        self.assertIsNone(ind.fraction("four"))
        self.assertIsNone(ind.fraction("3/0"))


class Gdp(unittest.TestCase):
    def test_the_advance_estimate_is_read(self):
        r = ind.parse_gdp(GDP_TEXT)
        self.assertEqual((r["value"], r["quarter"], r["year"], r["estimate"]), (3.4, 3, 2026, "advance"))
        self.assertEqual(r["at"], datetime(2026, 10, 29, 12, 30, tzinfo=timezone.utc))
        payload = ind.gdp_payload(r, "u", NOW)
        self.assertEqual((payload["id"], payload["resultJa"], payload["titleJa"]), ("gdp-2026-q3-advance", "実質GDP 前期比年率+3.4%", "米国GDP（7〜9月期・速報）"))

    def test_a_decrease_is_negative_and_odd_wording_is_not_read(self):
        down = GDP_TEXT.replace("increased at an annual rate of 3.4", "decreased at an annual rate of 0.5").replace("advance estimate", "second estimate")
        r = ind.parse_gdp(down)
        self.assertEqual((r["value"], r["estimate"]), (-0.5, "second"))
        self.assertEqual(ind.gdp_payload(r, "u", NOW)["resultJa"], "実質GDP 前期比年率-0.5%")
        self.assertIsNone(ind.parse_gdp(GDP_TEXT.replace("3.4 percent", "34.0 percent")))
        self.assertIsNone(ind.parse_gdp(GDP_TEXT.replace("EMBARGOED UNTIL RELEASE AT", "RELEASED")))


class Retail(unittest.TestCase):
    def test_the_monthly_change_is_read(self):
        r = ind.parse_retail(RETAIL_TEXT)
        self.assertEqual((r["value"], r["amount"], r["month"], r["year"]), (0.8, 745.0, 9, 2026))
        self.assertEqual(r["at"], datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc), "8:30 a.m. EDT")
        payload = ind.retail_payload(r, "u", NOW)
        self.assertEqual((payload["id"], payload["resultJa"]), ("retail-2026-09", "前月比+0.8%（売上高 745.0十億ドル）"))

    def test_down_winter_clock_and_odd_values(self):
        down = ind.parse_retail(RETAIL_TEXT.replace("up 0.8 percent", "down 0.3 percent").replace("October 15, 2026", "December 16, 2026"))
        self.assertEqual(down["value"], -0.3)
        self.assertEqual(down["at"], datetime(2026, 12, 16, 13, 30, tzinfo=timezone.utc), "8:30 a.m. EST")
        self.assertIsNone(ind.parse_retail(RETAIL_TEXT.replace("up 0.8 percent", "up 18.0 percent")))
        self.assertIsNone(ind.parse_retail(RETAIL_TEXT.replace("$745.0 billion", "$7.0 billion")))
        self.assertIsNone(ind.parse_retail(RETAIL_TEXT.replace("for September 2026,", "for Septembre 2026,")))


class Running(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "t.sqlite"
        self.config = {"version": 1, "fomcMeetings": ["2026-10-28"]}
        self.calls = []

    def tearDown(self):
        self.tmp.cleanup()

    def transport(self, pages):
        def fetch(url):
            self.calls.append(url)
            value = pages.get(url)
            if isinstance(value, Exception):
                raise value
            if value is None:
                raise urllib.error.HTTPError(url, 404, "not found", {}, None)
            return value
        return fetch

    def stored(self):
        with events.connect(self.path) as db:
            return {r["id"]: (r["state"], json.loads(r["payload"])) for r in db.execute("SELECT id,state,payload FROM event_results")}

    def status(self):
        with events.connect(self.path) as db:
            return {r["publisher"]: (r["ok"], r["error"]) for r in db.execute("SELECT publisher,ok,error FROM event_feed_status")}

    def test_all_three_official_pages_are_stored_once_with_their_official_link(self):
        pages = {
            "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm": f"<html><body><p>{FOMC_TEXT}</p></body></html>",
            "https://www.bea.gov/news/current-releases": '<a href="/news/2026/gdp-advance-estimate-3rd-quarter-2026">GDP</a> <a href="/news/2026/personal-income-and-outlays-september-2026">PCE</a>',
            "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026": f"<main>{GDP_TEXT}</main>",
            "https://www.census.gov/retail/sales.html": f"<div>{RETAIL_TEXT}</div>",
        }
        self.assertEqual(ind.run_once(self.path, now=NOW, config=self.config, transport=self.transport(pages)), 3)
        stored = self.stored()
        self.assertEqual(sorted(stored), ["fomc-2026-10-28", "gdp-2026-q3-advance", "retail-2026-09"])
        self.assertTrue(all(state == "published" for state, _ in stored.values()))
        self.assertEqual(stored["fomc-2026-10-28"][1]["sourceUrl"], "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm")
        self.assertEqual(stored["gdp-2026-q3-advance"][1]["sourceUrl"], "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026")
        self.calls.clear()
        self.assertEqual(ind.run_once(self.path, now=NOW + timedelta(minutes=5), config=self.config, transport=self.transport(pages)), 0, "never stored twice")
        self.assertNotIn("https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm", self.calls, "a stored statement is not fetched again")
        self.assertNotIn("https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026", self.calls)

    def test_before_the_release_the_statement_is_not_there_and_that_is_not_a_failure(self):
        self.assertEqual(ind.run_once(self.path, now=NOW, config=self.config, transport=self.transport({"https://www.bea.gov/news/current-releases": "", "https://www.census.gov/retail/sales.html": ""})), 0)
        self.assertEqual(self.status()["FRB（FOMC声明）"], (1, "not-published-yet"))
        self.assertEqual(self.stored(), {})

    def test_a_page_that_cannot_be_read_is_recorded_and_the_others_continue(self):
        pages = {"https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm": urllib.error.URLError("down"),
                 "https://www.bea.gov/news/current-releases": urllib.error.HTTPError("u", 403, "forbidden", {}, None),
                 "https://www.census.gov/retail/sales.html": f"<div>{RETAIL_TEXT}</div>"}
        self.assertEqual(ind.run_once(self.path, now=NOW, config=self.config, transport=self.transport(pages)), 1)
        status = self.status()
        self.assertEqual(status["FRB（FOMC声明）"][0], 0)
        self.assertEqual(status["BEA（発表一覧）"], (0, "HTTPError:403"))
        self.assertEqual(status["Census（小売売上高）"], (1, None))
        self.assertEqual(list(self.stored()), ["retail-2026-09"])

    def test_wording_we_do_not_recognise_is_recorded_not_guessed(self):
        pages = {"https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm": "<p>October 28, 2026 For release at 2:00 p.m. EDT The Committee made a decision.</p>",
                 "https://www.bea.gov/news/current-releases": '<a href="/news/2026/gdp-advance-estimate-3rd-quarter-2026">GDP</a>',
                 "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026": GDP_TEXT.replace("third quarter of 2026", "second quarter of 2026"),
                 "https://www.census.gov/retail/sales.html": "<p>Nothing here.</p>"}
        self.assertEqual(ind.run_once(self.path, now=NOW, config=self.config, transport=self.transport(pages)), 0)
        status = self.status()
        for name in ("FRB（FOMC声明）", "BEA（GDP）", "Census（小売売上高）"):
            self.assertEqual(status[name], (0, "wording-not-recognised"), name)
        self.assertEqual(self.stored(), {})

    def test_a_withdrawn_result_is_never_published_again(self):
        pages = {"https://www.census.gov/retail/sales.html": f"<div>{RETAIL_TEXT}</div>", "https://www.bea.gov/news/current-releases": ""}
        ind.run_once(self.path, now=NOW, config={"version": 1, "fomcMeetings": []}, transport=self.transport(pages))
        with events.connect(self.path) as db:
            events.withdraw(db, {"id": "retail-2026-09"})
        ind.run_once(self.path, now=NOW + timedelta(hours=1), config={"version": 1, "fomcMeetings": []}, transport=self.transport(pages))
        self.assertEqual(self.stored()["retail-2026-09"][0], "withdrawn")

    def test_the_fomc_page_is_only_asked_for_in_the_meeting_window(self):
        pages = {"https://www.bea.gov/news/current-releases": "", "https://www.census.gov/retail/sales.html": ""}
        for when in (datetime(2026, 10, 28, 12, 0, tzinfo=timezone.utc), datetime(2026, 11, 20, tzinfo=timezone.utc)):
            self.calls.clear()
            ind.run_once(self.path, now=when, config=self.config, transport=self.transport(pages))
            self.assertFalse(any("federalreserve.gov" in url for url in self.calls), when)

    def test_polling_is_every_30_seconds_around_8_30_and_2_pm_eastern_on_weekdays_otherwise_5_minutes(self):
        wait = lambda y, mo, d, h, mi: ind.next_wait(datetime(y, mo, d, h, mi, tzinfo=timezone.utc))
        self.assertEqual(wait(2026, 11, 5, 13, 30), 30, "Thursday Nov 5, 8:30 EST (winter time began Nov 1)")
        self.assertEqual(wait(2026, 11, 5, 12, 30), 300, "7:30 EST")
        self.assertEqual(wait(2026, 10, 29, 12, 30), 30, "Thursday Oct 29, 8:30 EDT")
        self.assertEqual(wait(2026, 10, 28, 18, 5), 30, "Wednesday 2:05 p.m. EDT")
        self.assertEqual(wait(2026, 10, 29, 16, 0), 300)
        self.assertEqual(wait(2026, 10, 31, 12, 30), 300, "Saturday")


class Ism(unittest.TestCase):
    SPEC = {"level": True, "range": [30, 75], "must": [r"\bISM\b|Manufacturing PMI", "manufactur"], "mustNot": ["non-?manufacturing", r"\bservices\b"]}

    def test_the_result_is_read_and_what_it_is_compared_with_is_not(self):
        for title, expected in (("October ISM manufacturing PMI comes in at 55.5, beating estimates", 55.5),
                                ("US ISM manufacturing PMI for October 55.5 versus 54.5 estimate", 55.5),
                                ("US ISM Manufacturing PMI reaches 55.5 in October, above the 54.6 forecast", 55.5),
                                ("October ISM Report: Manufacturing PMI Grows to 55.5%, Extending 10-Month Streak", 55.5),
                                ("October ISM manufacturing PMI rises to 55.5 from 54.5, consensus 54.6", 55.5),
                                ("ISM manufacturing PMI up from 54.5 to 55.5", 55.5),
                                ("US ISM manufacturing PMI expected at 54.6", None),
                                ("ISM manufacturing PMI seen at 54.6 ahead of release", None),
                                ("ISM non-manufacturing PMI comes in at 54.5 in October", None),
                                ("ISM services PMI at 54.5", None),
                                ("The Week Ahead: ISM PMI reports, US jobs report, Apple earnings", None),
                                ("ISM manufacturing PMI at 155.5", None),
                                ("ISM manufacturing PMI at 12.5", None)):
            self.assertEqual(events.read_level(title, self.SPEC), expected, title)

    def test_the_issuers_own_release_stands_alone_and_two_outlets_are_needed_otherwise(self):
        config = events.load_config()
        watch = next(w for w in config["watches"] if w["id"] == "ism-2026-11")
        now = datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc)
        moment = datetime(2026, 11, 2, 15, 0, tzinfo=timezone.utc)
        with tempfile.TemporaryDirectory() as tmp:
            db = events.connect(Path(tmp) / "t.sqlite")
            one = [("October ISM manufacturing PMI comes in at 55.5, beating estimates", "https://a.test/1", moment, "CNBC")]
            events.ingest(db, config, "Google News ISM 1", one, now, "markets"); events.evaluate(db, config, now)
            self.assertEqual(db.execute("SELECT count(*) FROM event_results").fetchone()[0], 0, "one outlet is not enough")
            two = [("US ISM manufacturing PMI for October 55.5 versus 54.5 estimate", "https://a.test/2", moment, "investingLive")]
            events.ingest(db, config, "Google News ISM 1", two, now, "markets"); events.evaluate(db, config, now)
            row = json.loads(db.execute("SELECT payload FROM event_results WHERE id=?", (watch["id"],)).fetchone()["payload"])
            self.assertIn("製造業景況指数 55.5", row["resultJa"])
            db.execute("DELETE FROM event_results"); db.execute("DELETE FROM event_observations"); db.commit()
            release = [("Manufacturing PMI® at 55.5%; October 2026 ISM® Manufacturing PMI® Report", "https://prn.test/1", moment, "PR Newswire")]
            events.ingest(db, config, "Google News ISM 1", release, now, "markets"); events.evaluate(db, config, now)
            self.assertEqual(db.execute("SELECT count(*) FROM event_results").fetchone()[0], 1, "ISM's own release is enough")
            db.close()

    def test_two_different_levels_are_held_as_a_conflict(self):
        config = events.load_config()
        now = datetime(2026, 11, 5, 3, 0, tzinfo=timezone.utc); moment = datetime(2026, 11, 2, 15, 0, tzinfo=timezone.utc)
        rows = [(f"ISM manufacturing PMI at {level}", f"https://a.test/{i}", moment, outlet) for i, (level, outlet) in enumerate((("55.5", "A"), ("55.5", "B"), ("54.9", "C"), ("54.9", "D")))]
        with tempfile.TemporaryDirectory() as tmp:
            db = events.connect(Path(tmp) / "t.sqlite")
            events.ingest(db, config, "Google News ISM 1", rows, now, "markets"); events.evaluate(db, config, now)
            self.assertEqual(db.execute("SELECT state FROM event_results WHERE id='ism-2026-11'").fetchone()["state"], "conflict")
            db.close()


if __name__ == "__main__":
    unittest.main()
