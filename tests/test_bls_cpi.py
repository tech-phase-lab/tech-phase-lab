"""BLS CPI projection. Text mirrors the structure of the live release page."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import bls_cpi
import monitor
import release_watch
import signals

TEXT = """Consumer Price Index Summary
Transmission of material in this release is embargoed until
8:30 a.m. (ET) Wednesday, October 14, 2026 USDL-26-1574
CONSUMER PRICE INDEX - SEPTEMBER 2026
The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.6 percent on a seasonally adjusted basis in September after rising 0.4 percent in August, the U.S. Bureau of Labor Statistics reported today. Over the last 12 months, the all items index increased 3.7 percent before seasonal adjustment.
The index for all items less food and energy rose 0.3 percent in September, as it did in August.
The all items index rose 3.7 percent for the 12 months ending September, a larger increase than the 3.4-percent increase reported for the 12 months ending in August. The all items less food and energy index rose 2.6 percent over the year, following a 2.4-percent increase over the 12 months ending August.
"""


class BlsCpiTests(unittest.TestCase):
    def test_projects_the_four_headline_and_core_measures_with_the_scheduled_release_time(self):
        result = bls_cpi.parse_release(TEXT)
        self.assertEqual(result["publishedAt"], "2026-10-14T08:30:00-04:00")
        self.assertEqual(result["period"], "2026-09")
        self.assertEqual(result["title"], "U.S. September CPI: headline +0.6% MoM / +3.7% YoY; core +0.3% MoM / +2.6% YoY")
        self.assertEqual(result["translationJa"], "米国9月CPI：総合 前月比+0.6%・前年比+3.7%／コア 前月比+0.3%・前年比+2.6%")
        self.assertEqual(result["url"], "https://www.bls.gov/news.release/archives/cpi_10142026.htm")
        self.assertTrue(bls_cpi.is_release_url(result["url"]))

    def test_a_decrease_is_signed_negative(self):
        result = bls_cpi.parse_release(TEXT.replace("(CPI-U) increased 0.6", "(CPI-U) decreased 0.6"))
        self.assertIn("headline -0.6% MoM", result["title"])

    def test_fails_closed_when_anything_is_missing_ambiguous_or_inconsistent(self):
        broken = {
            "no heading": TEXT.replace("CONSUMER PRICE INDEX - SEPTEMBER 2026", ""),
            "no release clock": TEXT.replace("embargoed until", "until"),
            "wrong weekday": TEXT.replace("Wednesday, October 14", "Thursday, October 14"),
            "release before the reference month ends": TEXT.replace("October 14, 2026", "September 14, 2026").replace("Wednesday", "Monday"),
            "core monthly missing": TEXT.replace("The index for all items less food and energy rose 0.3 percent in September", "The index for core rose 0.3 percent in September"),
            "core yearly ambiguous": TEXT + "The all items less food and energy index rose 2.7 percent over the year.",
            "other month named": TEXT.replace("percent in September, as it did", "percent in August, as it did"),
            "absurd value": TEXT.replace("rose 2.6 percent over the year", "rose 62.6 percent over the year"),
        }
        for name, text in broken.items():
            with self.subTest(name), self.assertRaises(ValueError):
                bls_cpi.parse_release(text)

    def test_only_the_dated_archive_and_the_live_page_are_recognised(self):
        self.assertTrue(bls_cpi.is_page_url("https://www.bls.gov/news.release/cpi.nr0.htm"))
        for url in ("https://www.bls.gov/news.release/cpi.nr0.htm?x=1", "http://www.bls.gov/news.release/archives/cpi_10142026.htm",
                    "https://evil.example/news.release/archives/cpi_10142026.htm", "https://www.bls.gov/news.release/archives/cpi_1014202.htm"):
            self.assertFalse(bls_cpi.is_release_url(url), url)

    def source(self):
        return next(s for s in signals.SOURCES if s["id"] == "bls-cpi")

    def page(self, text=TEXT):
        return "<main>" + "".join(f"<p>{line}</p>" for line in text.splitlines()) + "</main>"

    def test_source_is_the_live_release_page_on_bls_only(self):
        source = self.source()
        self.assertEqual(source["url"], bls_cpi.PAGE)
        self.assertEqual(source["allowedHosts"], ["www.bls.gov"])
        self.assertEqual(source["format"], "document")
        self.assertIs(source["officialUpdates"], True)
        self.assertIn(source, signals.enabled_sources())

    def test_intake_publishes_the_exact_release_once_and_only_while_current(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            with patch.object(signals, "stamp", return_value="2026-10-14T12:30:07+00:00"):
                result = signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(result["status"], "ok")
            reference = datetime(2026, 10, 14, 12, 31, tzinfo=timezone.utc)
            [item] = signals.public_official_updates(db, reference=reference)
            self.assertEqual(item["publisher"], "BLS")
            self.assertEqual(item["tickers"], [])
            self.assertNotIn("newsCategory", item)
            self.assertEqual(item["url"], "https://www.bls.gov/news.release/archives/cpi_10142026.htm")
            self.assertEqual(item["publishedAt"], "2026-10-14T08:30:00-04:00")
            self.assertEqual(item["observedAt"], "2026-10-14T12:30:07+00:00")
            self.assertIn("+0.6% MoM / +3.7% YoY", item["title"])
            self.assertIn("総合 前月比+0.6%・前年比+3.7%", item["translationJa"])
            # The site and the release watch read the same item, so the watch
            # records it as published seven seconds after the scheduled time.
            event = {"id": "cpi-2026-10-14", "kind": "economic", "indicator": "cpi", "phase": "release",
                     "at": datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)}
            found = release_watch.match(event, {"officialUpdates": [item]})
            self.assertEqual((found - event["at"]).total_seconds(), 7)
            # Health shows which route is healthy (Oct 14: the summary hid the failing one).
            [route] = release_watch.diagnostics(db, reference)["officialRoutes"]
            self.assertEqual((route["id"], route["succeededAt"], route["error"]), ("bls-cpi", "2026-10-14T12:30:07+00:00", None))
            # An unchanged page adds nothing; the item leaves the feed after a week.
            with patch.object(signals, "stamp", return_value="2026-10-14T12:30:30+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": self.page().encode()})
            self.assertEqual(db.execute("SELECT count(*) FROM signal_events WHERE source_id='bls-cpi'").fetchone()[0], 1)
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 22, tzinfo=timezone.utc)), [])
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 14, 12, tzinfo=timezone.utc)), [])

    def test_a_page_that_is_not_a_complete_release_publishes_nothing_and_is_retried(self):
        source = self.source()
        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            pending = self.page(TEXT.replace("CONSUMER PRICE INDEX - SEPTEMBER 2026", "CONSUMER PRICE INDEX - AUGUST 2026"))
            with patch.object(signals, "stamp", return_value="2026-10-14T12:29:50+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda *_: {"body": pending.encode()})
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)), [])

    def test_the_release_burst_polls_the_page_every_few_seconds_around_the_release(self):
        events = [{"id": "cpi-2026-10-14", "kind": "economic", "indicator": "cpi", "phase": "release",
                   "at": datetime(2026, 10, 14, 12, 30, tzinfo=timezone.utc)}]
        inside = datetime(2026, 10, 14, 12, 30, 5, tzinfo=timezone.utc)
        outside = datetime(2026, 10, 14, 12, 50, tzinfo=timezone.utc)
        self.assertIn("bls-cpi", release_watch.burst_routes(inside, events))
        self.assertIn("x-wallstengine", release_watch.burst_routes(inside, events))
        self.assertNotIn("bls-cpi", release_watch.burst_routes(outside, events))
        # Only a CPI release polls the CPI page.
        events[0]["indicator"] = "jobs"
        self.assertNotIn("bls-cpi", release_watch.burst_routes(inside, events))
        events[0]["indicator"] = "cpi"
        self.assertEqual(signals.source_interval_seconds(self.source(), inside), release_watch.BURST_INTERVAL_SECONDS)


if __name__ == "__main__":
    unittest.main()
