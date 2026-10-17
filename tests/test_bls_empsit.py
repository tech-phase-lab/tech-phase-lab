"""BLS jobs report projection. Text mirrors the structure of the live release page."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import bls_empsit
import monitor
import release_watch
import signals

TEXT = """Employment Situation Summary
Transmission of material in this news release is embargoed until USDL-26-1549
8:30 a.m. (ET) Friday, October 2, 2026
Technical information:
THE EMPLOYMENT SITUATION - SEPTEMBER 2026
Both nonfarm payroll employment (+29,000) and the unemployment rate (4.2 percent) changed little in September, the U.S. Bureau of Labor Statistics reported today. Employment in all major industries changed little over the month.
Both the unemployment rate, at 4.2 percent, and the number of unemployed people, at 7.1 million, changed little in September.
"""


class BlsJobsTests(unittest.TestCase):
    def test_projects_payroll_change_and_unemployment_rate_with_the_scheduled_release_time(self):
        result = bls_empsit.parse_release(TEXT)
        self.assertEqual(result["publishedAt"], "2026-10-02T08:30:00-04:00")
        self.assertEqual(result["period"], "2026-09")
        self.assertEqual(result["title"], "U.S. September jobs report: nonfarm payrolls +29K / unemployment rate 4.2%")
        self.assertEqual(result["translationJa"], "米国9月雇用統計：非農業部門雇用者数 +29,000人／失業率 4.2%")
        self.assertEqual(result["url"], "https://www.bls.gov/news.release/archives/empsit_10022026.htm")
        self.assertTrue(bls_empsit.is_release_url(result["url"]))

    def test_other_wordings_and_a_decrease_are_read_and_signed(self):
        text = TEXT.replace("Both nonfarm payroll employment (+29,000) and the unemployment rate (4.2 percent) changed little in September",
                            "Total nonfarm payroll employment fell by 33,000 in September, and the unemployment rate changed little at 4.2 percent")
        result = bls_empsit.parse_release(text)
        self.assertIn("nonfarm payrolls -33K", result["title"])
        self.assertIn("-33,000人", result["translationJa"])

    def test_fails_closed_when_anything_is_missing_ambiguous_or_inconsistent(self):
        broken = {
            "no heading": TEXT.replace("THE EMPLOYMENT SITUATION - SEPTEMBER 2026", ""),
            "no release clock": TEXT.replace("embargoed until", "until"),
            "wrong weekday": TEXT.replace("Friday, October 2", "Thursday, October 2"),
            "release before the reference month ends": TEXT.replace("October 2, 2026", "September 2, 2026").replace("Friday", "Wednesday"),
            "payroll missing": TEXT.replace("nonfarm payroll employment (+29,000)", "employment"),
            "payroll ambiguous": TEXT + "Total nonfarm payroll employment rose by 31,000 in September.",
            "rate ambiguous": TEXT + "The unemployment rate, at 4.3 percent, was higher.",
            "absurd value": TEXT.replace("(+29,000)", "(+29,000,000)"),
        }
        for name, text in broken.items():
            with self.subTest(name), self.assertRaises(ValueError):
                bls_empsit.parse_release(text)

    def test_only_the_dated_archive_and_the_live_page_are_recognised(self):
        self.assertTrue(bls_empsit.is_page_url("https://www.bls.gov/news.release/empsit.nr0.htm"))
        for url in ("https://www.bls.gov/news.release/empsit.nr0.htm?x=1", "http://www.bls.gov/news.release/archives/empsit_10022026.htm",
                    "https://evil.example/news.release/archives/empsit_10022026.htm", "https://www.bls.gov/news.release/archives/empsit_1002202.htm"):
            self.assertFalse(bls_empsit.is_release_url(url), url)

    def source(self):
        return next(s for s in signals.SOURCES if s["id"] == "bls-jobs")

    def page(self, text=TEXT):
        return "<main>" + "".join(f"<p>{line}</p>" for line in text.splitlines()) + "</main>"

    def test_source_is_the_live_release_page_on_bls_only(self):
        source = self.source()
        self.assertEqual(source["url"], bls_empsit.PAGE)
        self.assertEqual(source["allowedHosts"], ["www.bls.gov"])
        self.assertEqual(source["format"], "document")
        self.assertIs(source["officialUpdates"], True)
        self.assertIn(source, signals.enabled_sources())

    def test_bls_is_fetched_with_the_declared_contact_agent_and_a_failed_route_retries_within_minutes(self):
        source = self.source()
        self.assertIs(source["contactUserAgent"], True)
        seen = {}

        class Response:
            headers = type("H", (), {"get_content_type": lambda self: "text/html"})()
            status = 200
            def read(self, _size=-1):
                return b"" if seen.get("done") else (seen.update(done=True) or b"<main>page</main>")
            def __enter__(self): return self
            def __exit__(self, *exc): return False
            def getheader(self, *_a): return None

        class Opener:
            def open(self, request, timeout=None):
                seen["agent"] = request.get_header("User-agent")
                return Response()

        with patch.dict("os.environ", {"RESEARCH_USER_AGENT": "TechPhaseResearch ops@example.com"}), \
                patch.object(signals, "build_opener", return_value=Opener()):
            try:
                signals.fetch(source, {})
            except Exception:
                pass
        self.assertEqual(seen["agent"], "TechPhaseResearch ops@example.com")
        # Without a contact address nothing is sent at all.
        with patch.dict("os.environ", {"RESEARCH_USER_AGENT": "no-contact"}), self.assertRaises(ValueError):
            signals.fetch(source, {})
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            signals.schema(db)
            db.execute("INSERT INTO signal_routes(id,checked_at,next_check_at,failures,error) VALUES('bls-jobs',?,?,1,'http-403')",
                       ("2026-10-02T13:12:12+00:00", "2026-10-02T19:12:12+00:00"))
            db.commit()
            for moment, due in (("2026-10-02T13:14:00+00:00", False), ("2026-10-02T13:17:13+00:00", True)):
                with patch.object(signals, "stamp", return_value=moment):
                    self.assertEqual("bls-jobs" in [s["id"] for s in signals.due(db, [source])], due, moment)

    def test_intake_publishes_the_exact_release_once_and_only_while_current(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            with patch.object(signals, "stamp", return_value="2026-10-02T12:30:07+00:00"):
                result = signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(result["status"], "ok")
            reference = datetime(2026, 10, 2, 12, 31, tzinfo=timezone.utc)
            [item] = signals.public_official_updates(db, reference=reference)
            self.assertEqual(item["publisher"], "BLS")
            self.assertEqual(item["tickers"], [])
            self.assertNotIn("newsCategory", item)
            self.assertEqual(item["url"], "https://www.bls.gov/news.release/archives/empsit_10022026.htm")
            self.assertEqual(item["publishedAt"], "2026-10-02T08:30:00-04:00")
            self.assertEqual(item["observedAt"], "2026-10-02T12:30:07+00:00")
            self.assertIn("nonfarm payrolls +29K / unemployment rate 4.2%", item["title"])
            self.assertIn("非農業部門雇用者数 +29,000人／失業率 4.2%", item["translationJa"])
            # The site and the release watch read the same item, so the watch
            # records it as published seven seconds after the scheduled time.
            event = {"id": "jobs-2026-10-02", "kind": "economic", "indicator": "jobs", "phase": "release",
                     "at": datetime(2026, 10, 2, 12, 30, tzinfo=timezone.utc)}
            found = release_watch.match(event, {"officialUpdates": [item]})
            self.assertEqual((found - event["at"]).total_seconds(), 7)
            # Health shows which route is healthy (Oct 14: the summary hid the failing one).
            [route] = release_watch.diagnostics(db, reference)["officialRoutes"]
            self.assertEqual((route["id"], route["succeededAt"], route["error"]), ("bls-jobs", "2026-10-02T12:30:07+00:00", None))
            # An unchanged page adds nothing; the item leaves the feed after a week.
            with patch.object(signals, "stamp", return_value="2026-10-02T12:30:30+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(db.execute("SELECT count(*) FROM signal_events WHERE source_id='bls-jobs'").fetchone()[0], 1)
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 10, tzinfo=timezone.utc)), [])
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 2, 12, tzinfo=timezone.utc)), [])

    def test_a_page_that_is_not_a_complete_release_publishes_nothing_and_is_retried(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            pending = self.page(TEXT.replace("THE EMPLOYMENT SITUATION - SEPTEMBER 2026", "THE EMPLOYMENT SITUATION - AUGUST 2026"))
            with patch.object(signals, "stamp", return_value="2026-10-02T12:29:50+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": pending.encode()})
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 2, 12, 30, tzinfo=timezone.utc)), [])

    def test_the_release_burst_polls_the_page_every_few_seconds_around_the_release(self):
        events = [{"id": "jobs-2026-10-02", "kind": "economic", "indicator": "jobs", "phase": "release",
                   "at": datetime(2026, 10, 2, 12, 30, tzinfo=timezone.utc)}]
        inside = datetime(2026, 10, 2, 12, 30, 5, tzinfo=timezone.utc)
        outside = datetime(2026, 10, 2, 12, 50, tzinfo=timezone.utc)
        self.assertIn("bls-jobs", release_watch.burst_routes(inside, events))
        self.assertIn("x-wallstengine", release_watch.burst_routes(inside, events))
        self.assertNotIn("bls-jobs", release_watch.burst_routes(outside, events))
        # Only a jobs report release polls the jobs page.
        events[0]["indicator"] = "cpi"
        self.assertNotIn("bls-jobs", release_watch.burst_routes(inside, events))
        events[0]["indicator"] = "ppi"
        self.assertEqual(signals.source_interval_seconds(self.source(), inside), release_watch.BURST_INTERVAL_SECONDS)


if __name__ == "__main__":
    unittest.main()
