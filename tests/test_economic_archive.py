"""Official BLS/BEA indicator results are kept in event_results for good (Nov 28: calendar rows vanished after the feed's seven days)."""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import economic_archive as archive  # noqa: E402
import event_results as events  # noqa: E402
import web_push  # noqa: E402

NOW = datetime(2026, 11, 28, 12, 0, tzinfo=timezone.utc)
PCE = {"id": "5795", "title": "U.S. October PCE: headline +0.3% MoM / +3.8% YoY; core +0.3% MoM / +3.3% YoY", "publisher": "BEA",
       "url": "https://www.bea.gov/news/2026/personal-income-and-outlays-october-2026", "observedAt": "2026-11-25T13:32:23.742000+00:00",
       "publishedAt": "2026-11-25T13:30:00.000Z", "translationJa": "米国10月PCE：総合 前月比+0.3%・前年比+3.8%／コア 前月比+0.3%・前年比+3.3%"}
CPI = {"id": "9101", "title": "U.S. December CPI: headline +0.3% MoM / +3.9% YoY; core +0.3% MoM / +3.0% YoY", "publisher": "BLS",
       "url": "https://www.bls.gov/news.release/archives/cpi_01132027.htm", "observedAt": "2027-01-13T13:30:07Z",
       "publishedAt": "2027-01-13T08:30:00-05:00", "translationJa": "米国12月CPI：総合 前月比+0.3%・前年比+3.9%／コア 前月比+0.3%・前年比+3.0%"}
JOBS = {"id": "9200", "title": "U.S. November jobs report: nonfarm payrolls +90K / unemployment rate 4.1%", "publisher": "BLS",
        "url": "https://www.bls.gov/news.release/archives/empsit_12042026.htm", "observedAt": "2026-12-04T13:30:05Z",
        "publishedAt": "2026-12-04T08:30:00-05:00", "translationJa": "米国11月雇用統計：非農業部門雇用者数 +90,000人／失業率 4.1%"}


class OfficialResult(unittest.TestCase):
    def test_bls_and_bea_results_get_the_calendars_ids_and_official_wording(self):
        pce = archive.official_result(PCE)
        self.assertEqual((pce["id"], pce["titleJa"], pce["resultJa"], pce["sourceUrl"], pce["releasedAt"], pce["verifiedOn"]),
                         ("pce-2026-10", "米国PCE物価指数（10月）", PCE["translationJa"], PCE["url"], "2026-11-25T13:30:00+00:00", "2026-11-25"))
        self.assertEqual(pce["sources"], [{"publisher": "BEA", "title": "Personal Income and Outlays", "url": PCE["url"]}])
        self.assertEqual(archive.official_result(CPI)["id"], "cpi-2026-12", "a December CPI released in January is last year's")
        self.assertEqual(archive.official_result(JOBS)["titleJa"], "米国雇用統計（11月）")

    def test_anything_else_is_not_copied(self):
        for bad in ({**PCE, "url": PCE["url"] + "?x=1"}, {**PCE, "publisher": "Other"}, {**PCE, "translationJa": ""}, {**PCE, "publishedAt": None},
                    {**PCE, "url": "https://www.bea.gov/news/2026/gdp-advance-estimate-3rd-quarter-2026"},
                    {**CPI, "url": "https://www.bls.gov/news.release/cpi.nr0.htm"}, {**CPI, "title": "CPI rises"},
                    {**CPI, "url": CPI["url"].replace("www.bls.gov", "bls.gov.example")}, "x", None):
            self.assertIsNone(archive.official_result(bad), bad)


class Archive(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "events.sqlite3")

    def tearDown(self):
        self.tmp.cleanup()

    def test_kept_once_for_good_and_answered_for_the_calendar_not_the_news_feed(self):
        with events.connect(self.path) as db:
            self.assertEqual(archive.archive(db, [PCE, CPI, JOBS, PCE, {"url": "x"}], NOW), 3)
            self.assertEqual(archive.archive(db, [PCE, CPI, JOBS], NOW), 0, "stored once")
            events._store(db, "claims-2026-11-21", "published", {"id": "claims-2026-11-21", "releasedAt": "2026-11-25T13:31:00+00:00", "resultJa": "189,000件"}, NOW)
            events._store(db, "us-midterm-2026-11-03", "published", {"id": "us-midterm-2026-11-03", "releasedAt": "2026-11-04T10:34:05+00:00", "resultJa": "x"}, NOW)
            answered = [row["id"] for row in archive.answer(db)["eventResults"]]
            self.assertEqual(answered, ["cpi-2026-12", "jobs-2026-11", "claims-2026-11-21", "pce-2026-10"], "indicators only, newest release first")
            self.assertEqual(sorted(row["id"] for row in events.public_view(db)), ["claims-2026-11-21", "us-midterm-2026-11-03"],
                             "the news feed's event results are unchanged")
            # the push notices see no second copy: BLS/BEA results are announced from their headlines only
            self.assertEqual(web_push.economic_items([], events.public_view(db) + archive.answer(db)["eventResults"])[0]["kind"], "claims")
            self.assertFalse(any(item["kind"] in ("pce", "cpi", "jobs") for item in web_push.economic_items([], archive.answer(db)["eventResults"])))

    def test_a_withdrawn_row_and_another_readers_row_are_left_alone_a_better_translation_is_taken(self):
        with events.connect(self.path) as db:
            archive.archive(db, [PCE, CPI], NOW)
            events.withdraw(db, {"id": "pce-2026-10"})
            self.assertEqual(archive.archive(db, [{**PCE, "translationJa": PCE["translationJa"] + "。"}], NOW), 0)
            self.assertEqual(db.execute("SELECT state FROM event_results WHERE id='pce-2026-10'").fetchone()["state"], "withdrawn")
            events._store(db, "jobs-2026-11", "published", {"id": "jobs-2026-11", "releasedAt": "2026-12-04T13:30:00+00:00", "resultJa": "hand"}, NOW)
            self.assertEqual(archive.archive(db, [JOBS], NOW), 0)
            self.assertEqual(json.loads(db.execute("SELECT payload FROM event_results WHERE id='jobs-2026-11'").fetchone()["payload"])["resultJa"], "hand")
            first = db.execute("SELECT published_at FROM event_results WHERE id='cpi-2026-12'").fetchone()["published_at"]
            self.assertEqual(archive.archive(db, [{**CPI, "translationJa": "米国12月CPI：総合 前月比+0.3%"}], datetime(2027, 1, 14, tzinfo=timezone.utc)), 1)
            row = db.execute("SELECT payload,published_at FROM event_results WHERE id='cpi-2026-12'").fetchone()
            self.assertEqual((json.loads(row["payload"])["resultJa"], row["published_at"]), ("米国12月CPI：総合 前月比+0.3%", first))

    def test_endpoint_uses_the_news_token(self):
        import service
        with events.connect(self.path) as db:
            archive.archive(db, [PCE], NOW)
        handler = object.__new__(service.Handler)
        handler.server = SimpleNamespace(app=SimpleNamespace(db_path=self.path))
        results = []
        handler.send_json = lambda status, payload: results.append((status, payload))
        for supplied, expected in [("", 401), ("Bearer wrong", 401), ("Bearer test", 200)]:
            handler.path = "/economic-results"
            handler.headers = {"Authorization": supplied}
            with patch.dict(os.environ, {"RESEARCH_API_TOKEN": "test", "RESOLUTE_NEWS_READ_TOKEN": ""}):
                handler.do_GET()
            self.assertEqual(results[-1][0], expected)
        self.assertEqual([row["id"] for row in results[-1][1]["eventResults"]], ["pce-2026-10"])

    def test_the_monitor_copies_them_from_its_event_loop(self):
        source = (Path(__file__).resolve().parents[1] / "scripts/research/service.py").read_text(encoding="utf-8")
        self.assertIn("self.archive_economic_results()", source)
        self.assertIn("economic_archive.archive(events_db, updates)", source)
        self.assertIn('read_only=True)\n        with self.db_lock, event_results.connect(self.db_path) as events_db:', source)


if __name__ == "__main__":
    unittest.main()
