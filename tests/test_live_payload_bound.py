"""The monitor's /live payload stays under the site's response cap on a production-sized database (Nov 20).

Production had about 3,100 sources with up to 20 history rows each and hundreds of thousands of discovery
runs; /live grew past the site's 3 MB cap and the intake page fell back to a September snapshot."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
import monitor  # noqa: E402

service_spec = importlib.util.spec_from_file_location("live_bound_service", ROOT / "scripts/research/service.py")
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)

SITE_CAP_BYTES = 3_000_000  # app/api/research/live/route.ts MAX_MONITOR_BYTES
BASE = datetime(2026, 9, 1, tzinfo=timezone.utc)


def fill(path, sources, heavy_history=1000, runs=50_000, events=3000):
    """Sources spread over every ticker, the first `heavy_history` with 40 history rows and the rest with 4."""
    with monitor.connect(path) as db:
        tickers = list(monitor.PROVIDERS)
        rows = []
        for index in range(sources):
            ticker = tickers[index % len(tickers)]
            host = (sorted(h for h in monitor.HOSTS[ticker] if "sec.gov" not in h) or ["www.sec.gov"])[0]
            url = (f"https://{host}/news-releases/news-release-details/2026/"
                   f"{ticker.lower()}-announces-results-for-the-quarter-and-updates-its-outlook-{index:05d}")
            at = (BASE + timedelta(minutes=index * 20)).isoformat(timespec="milliseconds")
            rows.append((url, ticker, at))
            db.execute("""INSERT INTO sources(url,ticker,published_on,discovered_at,checked_at,sha256,status,error,title,
                          content_type,content_bytes,extracted_chars,fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                       (url, ticker, at[:10], at, at, hashlib.sha256(url.encode()).hexdigest(), "pending", None,
                        f"{ticker} announces results for the quarter and updates its outlook ({index})",
                        "text/html", 120000, 8000, at))
        db.executemany("INSERT INTO history(url,at,kind,sha256) VALUES (?,?,?,?)", [
            (url, at, "first-fetch" if k == 0 else "changed", hashlib.sha256(f"{url}{k}".encode()).hexdigest())
            for n, (url, _, at) in enumerate(rows) for k in range(40 if n < heavy_history else 4)])
        db.executemany("""INSERT INTO discovery_runs(ticker,at,status,candidates,error,index_url,source_format,
                          sources_checked,sources_configured) VALUES (?,?,?,?,?,?,?,?,?)""", [
            (tickers[k % len(tickers)], (BASE + timedelta(seconds=k * 12)).isoformat(timespec="milliseconds"), "ok", 25,
             None, monitor.PROVIDERS[tickers[k % len(tickers)]]["indexUrl"], "html", 1, 1) for k in range(runs)])
        db.executemany("INSERT INTO release_events(url,ticker,detected_at) VALUES (?,?,?)",
                       [(url, ticker, at) for url, ticker, at in rows[-events:]])
        db.commit()
    return rows


class LivePayloadBoundTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp.name) / "automatic.sqlite"
        self.snapshot_path = Path(self.temp.name) / "snapshot.json"

    def tearDown(self):
        self.temp.cleanup()

    def assert_consistent(self, snapshot):
        urls = {row["url"] for row in snapshot["sources"]}
        self.assertEqual(len(urls), len(snapshot["sources"]))
        self.assertTrue(all(row["url"] in urls for row in snapshot["history"]))
        self.assertTrue(all(row["url"] in urls for row in snapshot["events"]))
        self.assertTrue(all(row["url"] in urls for row in snapshot["briefs"]))

    def test_production_sized_database_fits_under_the_site_cap_over_http(self):
        rows = fill(self.db_path, sources=3200)
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        # The previous /live snapshot of this database: what production served before the fix.
        self.assertGreater(monitor.encoded_size(app.public_snapshot()), SITE_CAP_BYTES)
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            # The stream gateway asks for identity encoding on /live, so the site sees uncompressed bytes.
            request = Request(f"http://127.0.0.1:{server.server_port}/live", headers={"Accept-Encoding": "identity"})
            with urlopen(request, timeout=30) as response:
                body = response.read()
                self.assertEqual(int(response.headers["Content-Length"]), len(body))
        finally:
            server.shutdown()
            server.server_close()
        self.assertLess(len(body), SITE_CAP_BYTES)
        payload = json.loads(body)
        self.assertEqual((payload["ok"], payload["mode"]), (True, "automatic"))
        snapshot = payload["snapshot"]
        self.assertLessEqual(monitor.encoded_size(snapshot), monitor.LIVE_SNAPSHOT_BUDGET_BYTES)
        # Every source stays (the dashboard counts them); history is what gives way first.
        self.assertEqual(len(snapshot["sources"]), len(rows))
        self.assertEqual(snapshot["omitted"]["sources"], 0)
        self.assertGreater(snapshot["omitted"]["history"], 0)
        self.assertLessEqual(len(snapshot["events"]), 20)
        self.assertLessEqual(len(snapshot["discoveryRuns"]), 10 * len(monitor.PROVIDERS) + 2 * len(monitor.PROVIDERS))
        self.assert_consistent(snapshot)
        build = payload["monitor"]["liveBuild"]
        self.assertEqual(build["sources"], len(rows))
        self.assertEqual(build["snapshotBytes"], monitor.encoded_size(snapshot))

    def test_a_much_larger_database_keeps_the_newest_sources_within_budget(self):
        rows = fill(self.db_path, sources=9000, heavy_history=500, runs=5000, events=200)
        with monitor.connect(self.db_path) as db:
            snapshot = monitor.bounded_live_snapshot(db)
        self.assertLessEqual(monitor.encoded_size(snapshot), monitor.LIVE_SNAPSHOT_BUDGET_BYTES)
        self.assertGreater(snapshot["omitted"]["sources"], 0)
        self.assertEqual(len(snapshot["sources"]) + snapshot["omitted"]["sources"], len(rows))
        kept = {row["url"] for row in snapshot["sources"]}
        self.assertIn(rows[-1][0], kept)
        self.assertNotIn(rows[0][0], kept)
        self.assert_consistent(snapshot)

    def test_budget_holds_even_when_single_rows_are_large(self):
        data = {"schemaVersion": 1, "generatedAt": "2026-11-20T00:00:00.000+00:00", "discoveryRuns": [], "events": [],
                "briefs": [], "history": [],
                "sources": [{"url": f"https://example.com/{n}", "ticker": "NVDA", "discovered_at": f"{n:06d}",
                             "title": "x" * 5000} for n in range(2000)]}
        fitted = monitor.fit_snapshot(data, budget=100_000)
        self.assertLessEqual(monitor.encoded_size(fitted), 100_000)
        self.assertGreater(len(fitted["sources"]), 0)

    def test_compact_rows_leave_out_fields_the_dashboard_does_not_read(self):
        fill(self.db_path, sources=60, heavy_history=0, runs=100, events=10)
        with monitor.connect(self.db_path) as db:
            snapshot = monitor.bounded_live_snapshot(db)
            full = monitor.snapshot(db, recent_per_item=20)
        source = snapshot["sources"][0]
        self.assertNotIn("content_bytes", source)
        self.assertNotIn("fetched_at", source)
        self.assertIsNone(source["evidence_url"])
        self.assertEqual(len(snapshot["history"][0]["sha256"]), 16)
        # /snapshot is unchanged.
        self.assertIn("content_bytes", full["sources"][0])
        self.assertEqual(full["sources"][0]["evidence_url"], full["sources"][0]["url"])
        self.assertNotIn("omitted", full)

    def test_live_is_served_from_the_background_build_with_a_current_cycle_age(self):
        fill(self.db_path, sources=20, heavy_history=0, runs=50, events=5)
        app = service.AutomaticMonitor(self.db_path, self.snapshot_path)
        # The pinned test clock is a U.S. night (off-hours pacing): this test measures the usual intervals.
        app.pacing = service.off_hours.Pacing(env={"RESEARCH_OFF_HOURS_ENABLED": "false"})
        with patch.object(app, "build_live", wraps=app.build_live) as build:
            first = app.live_payload()
            second = app.live_payload()
            self.assertEqual(build.call_count, 1)
            self.assertIs(first["snapshot"], second["snapshot"])
            # A cycle that finished long ago is reported as stale at the moment of the answer, not at build time.
            with app.state_lock:
                app.state["ready"] = True
            stale_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="milliseconds")
            app.live_cache[1]["monitor"].update(ready=True, lastCycleAt=stale_at)
            stale = app.live_payload()
            self.assertGreater(stale["monitor"]["lastCycleAgeSeconds"], 3000)
            self.assertIn("monitor-stale", stale["monitor"]["health"]["issues"])
            # An old build is replaced before it is served.
            app.live_cache = (time.monotonic() - service.LIVE_MAX_AGE - 1, app.live_cache[1])
            app.live_payload()
            self.assertEqual(build.call_count, 2)
            # The refresher rebuilds only while someone has asked recently.
            app.live_cache = (time.monotonic() - service.LIVE_REFRESH_INTERVAL - 1, app.live_cache[1])
            self.assertTrue(app.refresh_live())
            app.live_requested_at = time.monotonic() - service.LIVE_IDLE_SECONDS - 1
            app.live_cache = (time.monotonic() - service.LIVE_REFRESH_INTERVAL - 1, app.live_cache[1])
            self.assertFalse(app.refresh_live())


if __name__ == "__main__":
    unittest.main()
