"""Synthetic PCE cases; real release figures are verified separately."""
from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import bea_pce
import monitor
import signals
import html_signals

URL = "https://www.bea.gov/news/2026/personal-income-and-outlays-august-2026"
TITLE = "Personal Income and Outlays, August 2026"
TEXT = """EMBARGOED UNTIL RELEASE AT 8:30 a.m. EDT, Wednesday, September 30, 2026
Personal income increased 0.9 percent. PCE spending increased 1.2 percent.
From the preceding month, the PCE price index for August increased 0.4 percent.
Excluding food and energy, the PCE price index increased 0.3 percent.
From the same month one year ago, the PCE price index for August increased 2.9 percent.
Excluding food and energy, the PCE price index increased 2.7 percent from one year ago.
PRIVATE EVIDENCE SENTINEL
"""


class PceTests(unittest.TestCase):
    def test_projection_distinguishes_spending_and_prices(self):
        result = bea_pce.parse_release(TITLE, TEXT, URL)
        self.assertEqual(result["publishedAt"], "2026-09-30T08:30:00-04:00")
        self.assertIn("+0.4% MoM / +2.9% YoY", result["title"])
        self.assertIn("コア 前月比+0.3%・前年比+2.7%", result["translationJa"])
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("1.2%", result["title"])

    def test_negative_values_and_standard_time(self):
        text = TEXT.replace("August", "October").replace(
            "EDT, Wednesday, September 30", "EST, Wednesday, November 25").replace(
            "increased 0.4 percent", "decreased 0.4 percent")
        result = bea_pce.parse_release(TITLE.replace("August", "October"), text,
                                       URL.replace("august", "october"))
        self.assertEqual(result["publishedAt"], "2026-11-25T08:30:00-05:00")
        self.assertIn("-0.4%", result["translationJa"])

    def test_bea_generic_first_heading_uses_release_identifier(self):
        text = "News Release\n" + TEXT.replace("Personal income", "BEA 26–43\n" + TITLE + "\nPersonal income", 1)
        self.assertEqual(bea_pce.release_title(text), TITLE)
        with self.assertRaises(ValueError):
            bea_pce.release_title(text + "\nBEA 26–44\n" + TITLE)

    def test_missing_ambiguous_mismatched_or_invalid_evidence_is_rejected(self):
        for title, text, url in [
            (TITLE, TEXT.replace("0.4 percent", "unknown"), URL),
            (TITLE, TEXT + TEXT, URL),
            (TITLE, TEXT.replace("Wednesday", "Thursday"), URL),
            (TITLE, TEXT.replace("EDT", "EST"), URL),
            (TITLE, TEXT.replace("0.4 percent", "99.0 percent"), URL),
            (TITLE.replace("August", "July"), TEXT, URL),
            (TITLE, TEXT, URL.replace("www.bea.gov", "evil.example")),
            (TITLE, TEXT, URL + "?redirect=private"),
            (TITLE, TEXT, URL.replace("/news/", "/private/")),
        ]:
            with self.subTest(text=text[:80], url=url), self.assertRaises(ValueError):
                bea_pce.parse_release(title, text, url)

    def test_intake_public_projection_dedup_304_and_revision_binding(self):
        source = next(s for s in signals.SOURCES if s["id"] == "bea-pce")
        article = f"<main><h1>News Release</h1><p>BEA 26–43</p><h1>{TITLE}</h1><p>{TEXT}</p></main>".encode()
        requests = []

        def request(config, validators):
            requests.append((config["url"], validators))
            if config["url"] == source["url"]:
                return {"body": f'<a href="{URL}">PCE</a><a href="{URL}">PCE again</a>'.encode()}
            return {"body": article, "etag": '"pce-1"'}

        def acquire(config, validators):
            return html_signals.collect(config, validators, list(monitor.PROVIDERS), request, signals.stamp)

        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            with patch.object(signals, "stamp", return_value="2026-09-30T13:00:00+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), acquire)
            self.assertEqual(len(requests), 2)
            reference = datetime(2026, 9, 30, 14, tzinfo=timezone.utc)
            result = signals.public_official_updates(db, reference=reference)
            self.assertEqual(len(result), 1)
            self.assertEqual(result[0]["tickers"], [])
            self.assertEqual(result[0]["publishedAt"], "2026-09-30T08:30:00-04:00")
            self.assertNotIn("PRIVATE", json.dumps(result))
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 9, 30, 12, tzinfo=timezone.utc)), [])
            self.assertEqual(signals.public_official_updates(db, reference=datetime(2026, 10, 8, tzinfo=timezone.utc)), [])

            def unchanged(config, validators):
                if config["url"] == source["url"]:
                    return request(config, validators)
                self.assertEqual(validators["etag"], '"pce-1"')
                return {"not_modified": True}

            with patch.object(signals, "stamp", return_value="2026-09-30T14:05:00+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), lambda config, validators:
                              html_signals.collect(config, validators, list(monitor.PROVIDERS), unchanged, signals.stamp))
            self.assertEqual(db.execute("SELECT count(*) FROM signal_events WHERE source_id='bea-pce'").fetchone()[0], 1)
            article = article.replace(b"0.4 percent", b"0.5 percent")
            with patch.object(signals, "stamp", return_value="2026-09-30T15:10:00+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), acquire)
            revised = signals.public_official_updates(db, reference=datetime(2026, 9, 30, 16, tzinfo=timezone.utc))
            self.assertEqual(len(revised), 1)
            self.assertIn("+0.5%", revised[0]["title"])
            self.assertNotIn("+0.4%", revised[0]["title"])

    def test_parser_failure_stays_pending_and_retries_without_publication(self):
        source = next(s for s in signals.SOURCES if s["id"] == "bea-pce")
        calls = []

        def request(config, validators):
            calls.append(config["url"])
            if config["url"] == source["url"]:
                return {"body": f'<a href="{URL}">PCE</a>'.encode()}
            return {"body": f"<main><h1>{TITLE}</h1>{'pending ' * 30}</main>".encode()}

        def acquire(config, validators):
            return html_signals.collect(config, validators, list(monitor.PROVIDERS), request, signals.stamp)

        with tempfile.TemporaryDirectory() as directory, monitor.connect(Path(directory) / "test.sqlite") as db:
            with patch.object(signals, "stamp", return_value="2026-09-30T13:00:00+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), acquire)
            state = json.loads(db.execute("SELECT body FROM signal_index_state WHERE source_id='bea-pce'").fetchone()[0])
            self.assertTrue(state["children"][URL]["error"])
            self.assertEqual(state["children"][URL]["next_check"], "2026-09-30T13:04:00+00:00")
            self.assertEqual(signals.public_official_updates(db), [])
            calls.clear()
            with patch.object(signals, "stamp", return_value="2026-09-30T13:02:00+00:00"):
                signals.check(db, source, list(monitor.PROVIDERS), acquire)
            self.assertEqual(calls, [source["url"]])


if __name__ == "__main__":
    unittest.main()
