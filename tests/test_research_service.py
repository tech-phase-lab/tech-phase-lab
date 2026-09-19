from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import json
import os
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


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

    def test_editorial_methods_require_current_evidence_and_do_not_deliver(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "a" * 64, "contentType": "text/html", "contentBytes": 80,
                "extractedText": "Capacity will increase in 2027.\nExecution remains subject to demand.", "extractedChars": 70,
            })
        payload = {
            "url": "https://nebius.com/newsroom/new-release", "sha256": "a" * 64,
            "summaryJa": "公式発表によると、AI向け容量は2027年に増加する計画です。",
            "impactLabel": "mixed", "impactJa": "供給能力の拡大余地がありますが、実行と需要の確認が引き続き必要です。",
            "confidence": "medium", "evidence": {
                "summary": ["Capacity will increase in 2027."], "impact": ["Execution remains subject to demand."],
            },
        }
        self.assertFalse(app.save_brief(payload)["published"])
        queue = app.editorial_queue(5)
        self.assertEqual(queue["items"][0]["brief_status"], "draft")
        decision = app.decide_brief({
            "url": payload["url"], "sha256": payload["sha256"], "decision": "approved",
            "reviewer": "editor", "reason": "原文と数値を確認",
        })
        self.assertFalse(decision["published"])

    def test_editorial_http_api_is_fail_closed_and_bearer_protected(self):
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        with monitor.connect(self.db_path) as db:
            row = db.execute("SELECT * FROM sources WHERE url LIKE '%new-release'").fetchone()
            monitor.save_source_check(db, row, {
                "sha256": "b" * 64, "contentType": "text/html", "contentBytes": 20,
                "extractedText": "Official evidence body.", "extractedChars": 23,
            })
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{server.server_port}/admin/briefs"
        try:
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("RESEARCH_EDITOR_TOKEN", None)
                with self.assertRaises(HTTPError) as missing:
                    urlopen(Request(url), timeout=2)
                self.assertEqual(missing.exception.code, 401)
            with patch.dict(os.environ, {"RESEARCH_EDITOR_TOKEN": "editor-token-at-least-24-characters"}):
                with self.assertRaises(HTTPError) as wrong:
                    urlopen(Request(url, headers={"Authorization": "Bearer wrong-token-at-least-24-chars"}), timeout=2)
                self.assertEqual(wrong.exception.code, 401)
                response = urlopen(Request(url, headers={"Authorization": "Bearer editor-token-at-least-24-characters"}), timeout=2)
                payload = json.loads(response.read())
                self.assertTrue(payload["ok"])
                self.assertIn("Official evidence body.", str(payload["items"]))
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
