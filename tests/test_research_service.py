from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
monitor_spec = importlib.util.spec_from_file_location("monitor", ROOT / "scripts/research/monitor.py")
monitor = importlib.util.module_from_spec(monitor_spec)
monitor_spec.loader.exec_module(monitor)
sys.modules["monitor"] = monitor
service_spec = importlib.util.spec_from_file_location("research_service", ROOT / "scripts/research/service.py")
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)


class ResearchServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "automatic.sqlite"
        self.snapshot_path = Path(self.temp.name) / "snapshot.json"
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/older", title="Older")
            monitor.add_source(db, "NBIS", "https://nebius.com/newsroom/new-release", title="New")
            monitor.add_release_events(db, "NBIS", ["https://nebius.com/newsroom/new-release"])

    def tearDown(self):
        self.temp.cleanup()

    def test_body_fetch_prioritizes_new_event_and_exports_only_metadata(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        app.body_batch = 1
        original_fetch = monitor.fetch
        monitor.fetch = lambda *_: (b"<main><h1>New release</h1><p>Evidence body.</p></main>", "text/html")
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                app.fetch_bodies(pool)
        finally:
            monitor.fetch = original_fetch

        with monitor.connect(self.db_path) as db:
            newest = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            older = db.execute("SELECT * FROM sources WHERE url LIKE '%older'").fetchone()
            self.assertIsNotNone(newest["sha256"])
            self.assertIn("Evidence body.", newest["extracted_text"])
            self.assertIsNone(older["sha256"])
        exported = self.snapshot_path.read_text()
        self.assertIn('"extracted_chars"', exported)
        self.assertNotIn("Evidence body.", exported)
        self.assertEqual(app.public_state()["sourceChecks"], 1)

    def test_inline_exchange_evidence_is_not_refetched_as_an_article(self):
        inline_url = "https://openapi.twse.com.tw/v1/opendata/t187ap04_L?company=2330&date=1150918&time=153643&id=abc"
        with monitor.connect(self.db_path) as db:
            monitor.add_source(db, "TSM", inline_url)
            db.execute("UPDATE sources SET source_mode='inline' WHERE url=?", (inline_url,))
            db.commit()
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        rows, _ = app.body_candidates()
        self.assertNotIn(inline_url, [row["url"] for row in rows])


if __name__ == "__main__":
    unittest.main()
