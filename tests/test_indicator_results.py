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

    def test_the_meetings_follow_the_feds_2027_calendar(self):
        # federalreserve.gov/monetarypolicy/fomccalendars.htm (updated Nov 18, 2026): seven 2027 meetings, none in December.
        meetings = ind.load_config()["fomcMeetings"]
        self.assertEqual([m for m in meetings if m.startswith("2027")], ["2027-01-27", "2027-03-17", "2027-04-28", "2027-06-09", "2027-07-28", "2027-09-15", "2027-10-27"])

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

    def test_the_second_and_third_estimates_are_found_and_read(self):
        # Nov 28: BEA's addresses for the later estimates carry more words, and the third estimate's is cut short with no year.
        links = {"/news/2026/gdp-second-estimate-and-corporate-profits-3rd-quarter-2026": ("2026", "second", "3", "2026"),
                 "/news/2026/gdp-third-estimate-industries-corporate-profits-state-gdp-and-state-personal-income-2nd": ("2026", "third", "2", None),
                 "/news/2026/gdp-advance-estimate-3rd-quarter-2026": ("2026", "advance", "3", "2026"),
                 "/news/2026/gdp-advance-estimate-4th-quarter-and-year-2025": ("2026", "advance", "4", "2025")}
        for link, groups in links.items():
            self.assertEqual(ind.GDP_LINK.fullmatch(link).groups(), groups, link)
        self.assertIsNone(ind.GDP_LINK.fullmatch("/news/2026/gross-domestic-product-county-and-personal-income-county-2024"))
        # The second estimate's page sets "GDP" in bold: its text reads "(GDP )".
        second = ("EMBARGOED UNTIL RELEASE AT 8:30 a.m. EST, Wednesday, November 25, 2026 Real gross domestic product  (GDP</strong>) increased  at an annual rate "
                  "of 4.3 percent</a> in the third quarter of 2026 (July,  August, and September), according to the second estimate released today")
        r = ind.parse_gdp(ind.page_text(second))
        self.assertEqual((r["value"], r["quarter"], r["year"], r["estimate"]), (4.3, 3, 2026, "second"))
        self.assertEqual(r["at"], datetime(2026, 11, 25, 13, 30, tzinfo=timezone.utc), "8:30 a.m. EST")
        self.assertEqual(ind.gdp_payload(r, "u", NOW)["id"], "gdp-2026-q3-second", "the id the calendar's verified row uses")


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

    def test_the_second_estimate_and_a_third_estimate_without_a_year_are_stored(self):
        second = "/news/2026/gdp-second-estimate-and-corporate-profits-3rd-quarter-2026"
        third = "/news/2027/gdp-third-estimate-industries-corporate-profits-state-gdp-and-state-personal-income-4th"
        pages = {
            "https://www.federalreserve.gov/newsevents/pressreleases/monetary20261028a.htm": "",
            "https://www.bea.gov/news/current-releases": f'<a href="{second}">GDP</a> <a href="{third}">GDP</a>',
            "https://www.bea.gov" + second: "<main>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EST, Wednesday, November 25, 2026 Real gross domestic product (<strong>GDP</strong>) "
                                             "increased at an annual rate of 4.3 percent in the third quarter of 2026 (July, August, and September), according to the second estimate</main>",
            "https://www.bea.gov" + third: "<main>EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Wednesday, March 31, 2027 Real gross domestic product (GDP) increased at an annual "
                                            "rate of 1.9 percent in the fourth quarter of 2026 (October, November, and December), according to the third estimate</main>",
            "https://www.census.gov/retail/sales.html": "",
        }
        # read after both releases: a result dated after "now" is not stored
        self.assertEqual(ind.run_once(self.path, now=datetime(2027, 3, 31, 13, 0, tzinfo=timezone.utc), config=self.config, transport=self.transport(pages)), 2)
        stored = self.stored()
        self.assertEqual(sorted(stored), ["gdp-2026-q3-second", "gdp-2026-q4-third"], "a fourth quarter's third estimate comes out the next year")
        self.assertEqual(stored["gdp-2026-q3-second"][1]["resultJa"], "実質GDP 前期比年率+4.3%")

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


CLAIMS_TEXT = ("1 News Release Connect with DOL at https://blog.dol.gov TRANSMISSION OF MATERIALS IN THIS RELEASE IS EMBARGOED UNTIL 8:30 A.M. (Eastern) "
               "Thursday, November 19, 2026 UNEMPLOYMENT INSURANCE WEEKLY CLAIMS SEASONALLY ADJUSTED DATA In the week ending November 14, the advance "
               "figure for seasonally adjusted initial claims was 203,000, an increase of 1,000 from the previous week's revised level. The previous week's "
               "level was revised up by 2,000 from 200,000 to 202,000. The 4-week moving average was 197,750, an increase of 2,000 from the previous week's revised average.")
CLAIMS_NOW = datetime(2026, 11, 19, 13, 31, tzinfo=timezone.utc)  # Thursday 8:31 a.m. EST


# The opening of the Nov 25, 2026 release (Wednesday, before Thanksgiving), as the PDF reader gives it.
CLAIMS_FULL = ("1 News Release Connect with DOL at https://blog.dol.gov TRANSMISSION OF MATERIALS IN THIS RELEASE IS EMBARGOED UNTIL 8:30 A.M. (Eastern) "
               "Wednesday, November 25, 2026 UNEMPLOYMENT INSURANCE WEEKLY CLAIMS SEASONALLY ADJUSTED DATA In the week ending November 21, the advance "
               "figure for seasonally adjusted initial claims was 189,000, a decrease of 13,000 from the previous week's revised level. The previous week's level "
               "was revised down by 1,000 from 203,000 to 202,000. The 4-week moving average was 196,000, a decrease of 1,500 from the previous week's revised "
               "average. The previous week's average was revised down by 250 from 197,750 to 197,500. The advance seasonally adjusted insured unemployment rate "
               "was 1.1 percent for the week ending November 14, a decrease of 0.1 percentage point from the previous week's revised rate. The previous week's "
               "rate was revised up by 0.1 from 1.1 to 1.2 percent. The advance number for seasonally adjusted insured unemployment during the week ending "
               "November 14 was 1,697,000, a decrease of 95,000 from the previous week's revised level. The previous week's level was revised up 29,000 from "
               "1,763,000 to 1,792,000. The 4-week moving average was 1,724,750, an increase of 500 from the previous week's revised average. The previous "
               "week's average was revised up by 7,250 from 1,717,000 to 1,724,250.")
CLAIMS_FULL_NOW = datetime(2026, 11, 25, 13, 31, tzinfo=timezone.utc)


class Claims(unittest.TestCase):
    """Weekly jobless claims from DOL's release PDF (Nov 21). The fixture is the opening of the Nov 19, 2026 release."""

    def test_the_advance_figure_is_read_from_the_release(self):
        r = ind.parse_claims(CLAIMS_TEXT)
        self.assertEqual((r["value"], r["change"], r["week"]), (203000, 1000, date(2026, 11, 14)))
        self.assertEqual(r["at"], datetime(2026, 11, 19, 13, 30, tzinfo=timezone.utc), "8:30 a.m. EST")
        p = ind.claims_payload(r, ind.CLAIMS_URL, CLAIMS_NOW)
        self.assertEqual(p["id"], "claims-2026-11-14")
        self.assertEqual(p["resultJa"], "203,000件（前週改定値から1,000件増）")
        self.assertEqual(p["titleJa"], "米国新規失業保険申請件数（11月14日終了週）")
        self.assertEqual(p["sources"][0]["publisher"], "U.S. Department of Labor", "a single official source the site accepts")
        self.assertNotIn("予想", p["resultJa"])

    def test_a_decrease_unchanged_curly_quotes_and_the_new_year(self):
        down = ind.parse_claims(CLAIMS_TEXT.replace("an increase of 1,000", "a decrease of 12,000"))
        self.assertEqual(down["change"], -12000)
        self.assertIn("12,000件減", ind.claims_payload(down, ind.CLAIMS_URL, CLAIMS_NOW)["resultJa"])
        same = ind.parse_claims(CLAIMS_TEXT.replace("an increase of 1,000", "unchanged").replace("previous week's revised level", "previous week’s unrevised level"))
        self.assertEqual(same["change"], 0)
        january = CLAIMS_TEXT.replace("Thursday, November 19, 2026", "Thursday, January 7, 2027").replace("week ending November 14", "week ending January 2")
        self.assertEqual(ind.parse_claims(january)["week"], date(2027, 1, 2))
        late_december = CLAIMS_TEXT.replace("Thursday, November 19, 2026", "Thursday, January 1, 2027").replace("week ending November 14", "week ending December 26")
        self.assertEqual(ind.parse_claims(late_december)["week"], date(2026, 12, 26))

    def test_odd_wording_dates_and_sizes_are_not_read(self):
        for text in (CLAIMS_TEXT.replace("seasonally adjusted initial claims", "unadjusted initial claims"),
                     CLAIMS_TEXT.replace("week ending November 14", "week ending November 13"),  # not a Saturday
                     CLAIMS_TEXT.replace("week ending November 14", "week ending October 31"),   # not the week before
                     CLAIMS_TEXT.replace("203,000", "20,300,000"), CLAIMS_TEXT.replace("an increase of 1,000", "an increase of 300,000"),
                     CLAIMS_TEXT.replace("EMBARGOED UNTIL", "RELEASED")):
            self.assertIsNone(ind.parse_claims(text), text[:60])

    def test_the_pdf_is_read_only_around_the_release_and_stored_once(self):
        calls = []
        def fetch_pdf(url):
            calls.append(url)
            return b"%PDF"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.sqlite"
            run = lambda when: ind.run_once(path, now=when, config={"version": 1, "fomcMeetings": []}, transport=lambda url: "",
                                            fetch_pdf=fetch_pdf, read_pdf=lambda content: CLAIMS_TEXT)
            self.assertEqual(run(CLAIMS_NOW - timedelta(days=1, hours=2)), 0, "Wednesday 6:31 a.m.: outside the window")
            self.assertEqual(run(datetime(2026, 11, 21, 13, 31, tzinfo=timezone.utc)), 0, "Saturday")
            self.assertEqual(calls, [])
            self.assertEqual(run(CLAIMS_NOW), 1)
            self.assertEqual(calls, [ind.CLAIMS_URL])
            self.assertEqual(run(CLAIMS_NOW + timedelta(minutes=5)), 0)
            self.assertEqual(len(calls), 1, "the week's result is stored: the PDF is not fetched again")
            with events.connect(path) as db:
                stored = json.loads(db.execute("SELECT payload FROM event_results WHERE id='claims-2026-11-14'").fetchone()["payload"])
                self.assertEqual(stored["sourceUrl"], "https://www.dol.gov/ui/data.pdf")
                self.assertIn(stored, events.public_view(db))

    def test_wednesday_is_read_only_before_a_thursday_holiday(self):
        self.assertFalse(ind.claims_window(datetime(2026, 11, 18, 13, 35, tzinfo=timezone.utc)), "an ordinary Wednesday")
        self.assertTrue(ind.claims_window(datetime(2026, 11, 25, 13, 35, tzinfo=timezone.utc)), "the day before Thanksgiving")
        self.assertEqual(ind.expected_week(datetime(2026, 11, 25, 13, 35, tzinfo=timezone.utc)), date(2026, 11, 21))
        self.assertTrue(ind.claims_window(datetime(2026, 12, 24, 13, 35, tzinfo=timezone.utc)), "Thursday Dec 24 2026 is a working day")
        self.assertFalse(ind.claims_window(datetime(2026, 11, 19, 17, 5, tzinfo=timezone.utc)), "after noon")

    def test_a_refusal_is_recorded_and_never_worked_around(self):
        def refused(url):
            raise urllib.error.HTTPError(url, 403, "Forbidden", {}, None)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.sqlite"
            self.assertEqual(ind.run_once(path, now=CLAIMS_NOW, config={"version": 1, "fomcMeetings": []}, transport=lambda url: "", fetch_pdf=refused), 0)
            with events.connect(path) as db:
                row = db.execute("SELECT ok,error FROM event_feed_status WHERE publisher=?", (ind.CLAIMS_SOURCE,)).fetchone()
            self.assertEqual((row["ok"], row["error"]), (0, "HTTPError:403"))
        self.assertIn("TechPhaseResearch", ind.USER_AGENT, "a plainly named reader, never a browser's name")

    def test_the_4_week_average_and_continuing_claims_are_read_with_the_advance_figure(self):
        r = ind.parse_claims(CLAIMS_FULL)
        self.assertEqual(r["average"], {"value": 196000, "change": -1500, "before": 197750})
        self.assertEqual(r["insured"], {"value": 1697000, "change": -95000, "week": date(2026, 11, 14), "before": 1763000})
        p = ind.claims_payload(r, ind.CLAIMS_URL, CLAIMS_FULL_NOW)
        self.assertEqual(p["resultJa"], "189,000件（前週改定値から13,000件減）", "the result line and its notification stay as they were")
        self.assertTrue(p["detailJa"].startswith("4週平均：196,000件（前週比1,500件減）。継続受給者数：1,697,000人（11月14日終了週・前週比95,000人減）。"))
        self.assertTrue(p["detailEn"].startswith("4-week average: 196,000 (down 1,500 from the previous week). Continuing claims: 1,697,000 (week ending November 14, down 95,000 from the previous week)."))
        self.assertTrue(p["detailsRead"])

    def test_a_figure_we_cannot_read_is_left_out(self):
        r = ind.parse_claims(CLAIMS_FULL.replace("The 4-week moving average was 196,000", "The four-week average was 196,000")
                             .replace("week ending November 14 was 1,697,000", "week ending November 7 was 1,697,000"))
        self.assertNotIn("average", r, "odd wording")
        self.assertNotIn("insured", r, "continuing claims are for the week before the initial claims")
        self.assertEqual(r["value"], 189000)
        p = ind.claims_payload(r, ind.CLAIMS_URL, CLAIMS_FULL_NOW)
        self.assertNotIn("4週平均", p["detailJa"])
        self.assertNotIn("継続受給者数", p["detailJa"])
        self.assertEqual(ind.parse_claims(CLAIMS_TEXT)["average"], {"value": 197750, "change": 2000}, "the average of the Nov 19 release, with no revision sentence")

    def test_results_stored_before_the_extra_figures_get_them_once_from_the_current_release(self):
        calls = []
        def fetch_pdf(url):
            calls.append(url)
            return b"%PDF"
        old = lambda week, at, ja: {"id": f"claims-{week}", "titleJa": "t", "titleEn": "t", "sourceName": "DOL", "releasedAt": at, "resultJa": ja, "resultEn": "r",
                                    "detailJa": ind.CLAIMS_NOTE_JA, "detailEn": ind.CLAIMS_NOTE_EN, "sourceUrl": ind.CLAIMS_URL, "sources": [], "verifiedOn": at[:10]}
        later = datetime(2026, 11, 26, 5, 0, tzinfo=timezone.utc)  # Thanksgiving, outside the release window
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.sqlite"
            with events.connect(path) as db:
                events._store(db, "claims-2026-11-14", "published", old("2026-11-14", "2026-11-19T13:30:00+00:00", "203,000件（前週改定値から1,000件増）"), CLAIMS_NOW)
                events._store(db, "claims-2026-11-21", "published", old("2026-11-21", "2026-11-25T13:30:00+00:00", "189,000件（前週改定値から13,000件減）"), CLAIMS_FULL_NOW)
            run = lambda when: ind.run_once(path, now=when, config={"version": 1, "fomcMeetings": []}, transport=lambda url: "",
                                            fetch_pdf=fetch_pdf, read_pdf=lambda content: CLAIMS_FULL)
            self.assertEqual(run(later), 0, "nothing new is stored")
            self.assertEqual(calls, [ind.CLAIMS_URL])
            self.assertEqual(run(later + timedelta(hours=2)), 0)
            self.assertEqual(len(calls), 1, "once the figures are added the PDF is not asked for again")
            with events.connect(path) as db:
                rows = {r["id"]: (r["published_at"], json.loads(r["payload"])) for r in db.execute("SELECT id,published_at,payload FROM event_results")}
            self.assertEqual(rows["claims-2026-11-21"][0], events.stamp(CLAIMS_FULL_NOW), "the time it was published stays")
            this, before = rows["claims-2026-11-21"][1], rows["claims-2026-11-14"][1]
            self.assertEqual(this["resultJa"], "189,000件（前週改定値から13,000件減）")
            self.assertIn("4週平均：196,000件（前週比1,500件減）。", this["detailJa"])
            # The figures this release says the week before was revised from are the ones that week's own release gave.
            self.assertTrue(before["detailJa"].startswith("4週平均：197,750件。継続受給者数：1,763,000人（11月7日終了週）。"))
            self.assertTrue(this["detailsRead"] and before["detailsRead"])

    def test_a_stored_result_without_figures_is_retried_at_most_hourly_and_only_for_a_week(self):
        calls = []
        def fetch_pdf(url):
            calls.append(url)
            return b"%PDF"
        stale = {"id": "claims-2026-11-21", "releasedAt": "2026-11-25T13:30:00+00:00", "resultJa": "189,000件（前週改定値から13,000件減）", "detailJa": "", "detailEn": ""}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "t.sqlite"
            with events.connect(path) as db:
                events._store(db, stale["id"], "published", stale, CLAIMS_FULL_NOW)
            run = lambda when: ind.run_once(path, now=when, config={"version": 1, "fomcMeetings": []}, transport=lambda url: "",
                                            fetch_pdf=fetch_pdf, read_pdf=lambda content: "an unrecognised page")
            start = datetime(2026, 11, 26, 5, 0, tzinfo=timezone.utc)
            run(start); run(start + timedelta(minutes=30))
            self.assertEqual(len(calls), 1, "not again within the hour")
            run(start + timedelta(minutes=61))
            self.assertEqual(len(calls), 2)
            run(datetime(2026, 12, 4, 5, 0, tzinfo=timezone.utc))
            self.assertEqual(len(calls), 2, "more than eight days after the release, the PDF holds another week")

    def test_claims_are_offered_to_the_notification_sender(self):
        import web_push
        payload = ind.claims_payload(ind.parse_claims(CLAIMS_TEXT), ind.CLAIMS_URL, CLAIMS_NOW)
        [item] = web_push.economic_items([], [payload])
        self.assertEqual((item["kind"], item["ja"]), ("claims", "203,000件（前週改定値から1,000件増）"))
        self.assertEqual(web_push.NAMES["claims"][0], "米国新規失業保険申請件数")
        self.assertNotIn("claims", web_push.ECON_DEFAULT_ON, "off until the member turns it on")


class Ism(unittest.TestCase):
    SPEC ={"level": True, "range": [30, 75], "must": [r"\bISM\b|Manufacturing PMI", "manufactur"], "mustNot": ["non-?manufacturing", r"\bservices\b"]}

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
