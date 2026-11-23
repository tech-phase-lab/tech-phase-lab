import io
import json
import os
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import production_watch as watch  # noqa: E402

NOW = datetime(2026, 11, 20, 6, 0, tzinfo=timezone.utc)
SECRET = "https://private.example/secret-title-and-figures"


def healthy(now=NOW):
    def at(**delta):
        return (now - timedelta(**delta)).isoformat()

    return {
        "/api/research/company-wire": {"ok": True, "items": {"NVDA": [
            {"titleJa": "見出し", "publishedAt": at(minutes=30 + n), "url": SECRET} for n in range(12)]}},
        "/api/research/news": {"ok": True, "items": [], "officialUpdates": [{"observedAt": at(hours=5), "title": SECRET}]},
        "/api/research/live": {"ok": True, "mode": "automatic", "monitor": {"lastCycleAgeSeconds": 12},
                               "snapshot": {"generatedAt": at(seconds=20), "sources": [{"url": SECRET}] * 150}},
        "/api/research/freshness": {"ok": True, "status": "ok", "lastCycleAt": at(seconds=30)},
        "/api/research/earnings-results": {"ok": True, "complete": True, "resultBriefs": [
            {"publicAt": at(days=2), "facts": [{"value": SECRET}]}]},
        "/api/research/stocks": {"ok": True, "results": [{"ticker": "NVDA", "name": SECRET}]},
        "/health": {"ready": True, "lastCycleAt": at(seconds=15), "health": {"status": "ready", "issues": []}},
    }


def fetcher(payloads, ms=300, status=200, overrides=None):
    def fetch(url, timeout):
        path = "/" + url.split("://", 1)[1].split("/", 1)[1].split("?", 1)[0]
        if overrides and path in overrides:
            return overrides[path]
        return status, payloads[path], ms, None
    return fetch


class ProductionWatchTests(unittest.TestCase):
    def test_all_healthy(self):
        summary = watch.run(fetch=fetcher(healthy()), now=NOW)
        self.assertTrue(summary["ok"], summary)
        self.assertEqual(summary["failed"], [])
        self.assertEqual(set(summary["checks"]), {"homeBand", "news", "live", "freshness", "earningsResults",
                                                  "compareSearch", "monitorHealth"})

    def test_output_holds_only_flags_counts_and_codes(self):
        out = io.StringIO()
        with mock.patch.dict(os.environ, {"PRODUCTION_WATCH": "true"}, clear=True), \
                mock.patch.object(watch, "request", fetcher(healthy(datetime.now(timezone.utc)))), redirect_stdout(out):
            self.assertEqual(watch.main(), 0)
        self.assertNotIn("secret", out.getvalue())
        self.assertNotIn("http", out.getvalue())
        line = json.loads(out.getvalue())
        for result in line["checks"].values():
            for value in result.values():
                self.assertTrue(value is None or isinstance(value, (bool, int, str)))

    def test_snapshot_fallback_on_live_fails_the_run(self):
        payloads = healthy()
        payloads["/api/research/live"] = {"ok": False, "mode": "snapshot", "error": "monitor-unavailable",
                                          "diagnosticReason": "oversized-response",
                                          "snapshot": {"generatedAt": "2026-09-19T12:33:15.714Z", "sources": [{}] * 332}}
        summary = watch.run(fetch=fetcher(payloads), now=NOW)
        self.assertEqual(summary["failed"], ["live"])
        self.assertTrue(summary["checks"]["live"]["fallback"])

    def test_stale_empty_slow_and_unreachable_answers_fail(self):
        payloads = healthy()
        payloads["/api/research/company-wire"]["items"]["NVDA"] = [
            {"titleJa": "x", "publishedAt": (NOW - timedelta(days=2)).isoformat()}] * 12
        payloads["/api/research/stocks"] = {"ok": True, "results": []}
        payloads["/api/research/earnings-results"]["complete"] = False
        payloads["/health"]["health"] = {"status": "degraded", "issues": ["monitor-stale"]}
        overrides = {"/api/research/news": (None, None, 25000, "timeout"),
                     "/api/research/freshness": (200, payloads["/api/research/freshness"], 9000, None)}
        summary = watch.run(fetch=fetcher(payloads, overrides=overrides), now=NOW)
        self.assertEqual(set(summary["failed"]), {"homeBand", "compareSearch", "earningsResults", "monitorHealth",
                                                  "news", "freshness"})
        self.assertEqual(summary["checks"]["news"]["error"], "timeout")
        self.assertFalse(summary["checks"]["freshness"]["fast"])

    def test_http_error_and_unexpected_shape_fail(self):
        payloads = healthy()
        payloads["/api/research/company-wire"] = {"ok": True, "items": "not-a-dict"}
        overrides = {"/health": (503, None, 100, "http-error")}
        summary = watch.run(fetch=fetcher(payloads, overrides=overrides), now=NOW)
        self.assertIn("monitorHealth", summary["failed"])
        self.assertIn("homeBand", summary["failed"])

    def test_enabled_by_its_own_flag_or_the_selfcheck_flag(self):
        self.assertFalse(watch.enabled({}))
        self.assertTrue(watch.enabled({"PRODUCTION_WATCH": "true"}))
        self.assertTrue(watch.enabled({"EARNINGS_SELFCHECK": "true"}))
        self.assertFalse(watch.enabled({"EARNINGS_SELFCHECK": "true", "PRODUCTION_WATCH": "false"}))
        out = io.StringIO()
        with mock.patch.dict(os.environ, {}, clear=True), \
                mock.patch.object(watch, "request", side_effect=AssertionError("must not run")), redirect_stdout(out):
            self.assertEqual(watch.main(), 0)
        self.assertTrue(out.getvalue().startswith("DISABLED"))


# daily_checks.py (report instead of crash, Nov 23) is tested in test_cron_report.py.


if __name__ == "__main__":
    unittest.main()
