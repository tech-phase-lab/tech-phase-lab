"""BLS PPI projection. Text mirrors the structure of the live release page."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import bls_ppi
import monitor
import release_watch
import signals

TEXT = """Producer Price Index News Release summary
Transmission of material in this release is embargoed until USDL 26-1576
8:30 a.m. (ET) Thursday, October 15, 2026
Technical information: (202) 691-7705 * ppi-info@bls.gov * www.bls.gov/ppi
PRODUCER PRICE INDEXES - SEPTEMBER 2026
The Producer Price Index for final demand increased 1.3 percent in September, seasonally adjusted, the U.S. Bureau of Labor Statistics reported today. Final demand prices moved up 0.5 percent in August and 0.2 percent in July. On an unadjusted basis, the index for final demand climbed 6.3 percent for the 12 months ended in September, the largest 12-month increase since moving up 6.4 percent in December 2022.
Prices for final demand less foods, energy, and trade services moved up 0.5 percent in September after increasing 0.3 percent in August. For the 12 months ended in September, the index for final demand less foods, energy, and trade services rose 5.0 percent.
"""


class BlsPpiTests(unittest.TestCase):
    def test_projects_the_four_headline_and_core_measures_with_the_scheduled_release_time(self):
        result = bls_ppi.parse_release(TEXT)
        self.assertEqual(result["publishedAt"], "2026-10-15T08:30:00-04:00")
        self.assertEqual(result["period"], "2026-09")
        self.assertEqual(result["title"], "U.S. September PPI: final demand +1.3% MoM / +6.3% YoY; core +0.5% MoM / +5.0% YoY")
        self.assertEqual(result["translationJa"], "米国9月PPI：総合 前月比+1.3%・前年比+6.3%／コア 前月比+0.5%・前年比+5.0%")
        self.assertEqual(result["url"], "https://www.bls.gov/news.release/archives/ppi_10152026.htm")
        self.assertTrue(bls_ppi.is_release_url(result["url"]))

    def test_a_decrease_is_signed_negative(self):
        result = bls_ppi.parse_release(TEXT.replace("final demand increased 1.3", "final demand decreased 1.3"))
        self.assertIn("final demand -1.3% MoM", result["title"])

    def test_fails_closed_when_anything_is_missing_ambiguous_or_inconsistent(self):
        broken = {
            "no heading": TEXT.replace("PRODUCER PRICE INDEXES - SEPTEMBER 2026", ""),
            "no release clock": TEXT.replace("embargoed until", "until"),
            "wrong weekday": TEXT.replace("Thursday, October 15", "Wednesday, October 15"),
            "release before the reference month ends": TEXT.replace("October 15, 2026", "September 15, 2026").replace("Thursday", "Tuesday"),
            "core monthly missing": TEXT.replace("Prices for final demand less foods, energy, and trade services moved up 0.5 percent in September", "Prices for core moved up 0.5 percent in September"),
            "core yearly ambiguous": TEXT + "For the 12 months ended in September, the index for final demand less foods, energy, and trade services rose 5.1 percent.",
            "other month named": TEXT.replace("percent in September, seasonally", "percent in August, seasonally"),
            "absurd value": TEXT.replace("rose 5.0 percent", "rose 65.0 percent"),
        }
        for name, text in broken.items():
            with self.subTest(name), self.assertRaises(ValueError):
                bls_ppi.parse_release(text)

    def test_only_the_dated_archive_and_the_live_page_are_recognised(self):
        self.assertTrue(bls_ppi.is_page_url("https://www.bls.gov/news.release/ppi.nr0.htm"))
        for url in ("https://www.bls.gov/news.release/ppi.nr0.htm?x=1", "http://www.bls.gov/news.release/archives/ppi_10152026.htm",
                    "https://evil.example/news.release/archives/ppi_10152026.htm", "https://www.bls.gov/news.release/archives/ppi_1015202.htm"):
            self.assertFalse(bls_ppi.is_release_url(url), url)

    def source(self):
        return next(s for s in signals.SOURCES if s["id"] == "bls-ppi")

    def page(self, text=TEXT):
        return "<main>" + "".join(f"<p>{line}</p>" for line in text.splitlines()) + "</main>"

    def test_source_is_the_live_release_page_on_bls_only(self):
        source = self.source()
        self.assertEqual(source["url"], bls_ppi.PAGE)
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
            db.execute("INSERT INTO signal_routes(id,checked_at,next_check_at,failures,error) VALUES('bls-ppi',?,?,1,'http-403')",
                       ("2026-10-15T13:12:12+00:00", "2026-10-15T19:12:12+00:00"))
            db.commit()
            for moment, due in (("2026-10-15T13:14:00+00:00", False), ("2026-10-15T13:17:13+00:00", True)):
                with patch.object(signals, "stamp", return_value=moment):
                    self.assertEqual("bls-ppi" in [s["id"] for s in signals.due(db, [source])], due, moment)

    def test_intake_publishes_the_exact_release_once_and_only_while_current(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            with patch.object(signals, "stamp", return_value="2026-10-15T12:30:07+00:00"):
                result = signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(result["status"], "ok")
            reference = datetime(2026, 10, 15, 12, 31, tzinfo=timezone.utc)
            [item] = signals.public_official_updates(db, reference=reference)
            self.assertEqual(item["publisher"], "BLS")
            self.assertEqual(item["tickers"], [])
            self.assertNotIn("newsCategory", item)
            self.assertEqual(item["url"], "https://www.bls.gov/news.release/archives/ppi_10152026.htm")
            self.assertEqual(item["publishedAt"], "2026-10-15T08:30:00-04:00")
            self.assertEqual(item["observedAt"], "2026-10-15T12:30:07+00:00")
            self.assertIn("+1.3% MoM / +6.3% YoY", item["title"])
            self.assertIn("総合 前月比+1.3%・前年比+6.3%", item["translationJa"])
            # The site and the release watch read the same item, so the watch
            # records it as published seven seconds after the scheduled time.
            event = {"id": "ppi-2026-10-15", "kind": "economic", "indicator": "ppi", "phase": "release",
                     "at": datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)}
            found = release_watch.match(event, {"officialUpdates": [item]})
            self.assertEqual((found - event["at"]).total_seconds(), 7)
            # Health shows which route is healthy (Oct 14: the summary hid the failing one).
            [route] = release_watch.diagnostics(db, reference)["officialRoutes"]
            self.assertEqual((route["id"], route["succeededAt"], route["error"]), ("bls-ppi", "2026-10-15T12:30:07+00:00", None))
            # An unchanged page adds nothing; the item leaves the feed after a week.
            with patch.object(signals, "stamp", return_value="2026-10-15T12:30:30+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(db.execute("SELECT count(*) FROM signal_events WHERE source_id='bls-ppi'").fetchone()[0], 1)
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 23, tzinfo=timezone.utc)), [])
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 15, 12, tzinfo=timezone.utc)), [])

    def test_a_page_that_is_not_a_complete_release_publishes_nothing_and_is_retried(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            pending = self.page(TEXT.replace("PRODUCER PRICE INDEXES - SEPTEMBER 2026", "PRODUCER PRICE INDEXES - AUGUST 2026"))
            with patch.object(signals, "stamp", return_value="2026-10-15T12:29:50+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": pending.encode()})
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)), [])

    def test_the_release_burst_polls_the_page_every_few_seconds_around_the_release(self):
        events = [{"id": "ppi-2026-10-15", "kind": "economic", "indicator": "ppi", "phase": "release",
                   "at": datetime(2026, 10, 15, 12, 30, tzinfo=timezone.utc)}]
        inside = datetime(2026, 10, 15, 12, 30, 5, tzinfo=timezone.utc)
        outside = datetime(2026, 10, 15, 12, 50, tzinfo=timezone.utc)
        self.assertIn("bls-ppi", release_watch.burst_routes(inside, events))
        self.assertIn("x-wallstengine", release_watch.burst_routes(inside, events))
        self.assertNotIn("bls-ppi", release_watch.burst_routes(outside, events))
        # Only a PPI release polls the PPI page.
        events[0]["indicator"] = "jobs"
        self.assertNotIn("bls-ppi", release_watch.burst_routes(inside, events))
        events[0]["indicator"] = "ppi"
        self.assertEqual(signals.source_interval_seconds(self.source(), inside), release_watch.BURST_INTERVAL_SECONDS)


if __name__ == "__main__":
    unittest.main()
