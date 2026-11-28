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
                                                  "compareSearch", "monitorHealth", "proCompare"})
        self.assertEqual(summary["checks"]["proCompare"], {"ok": True, "skipped": "no-token"})

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


TOKEN = "t" * 40


def pro_company(ticker, missing=(), invalid=(), status="ready"):
    present = [f for f in watch.PRO_FACTORS if f not in missing]
    return {"ticker": ticker, "status": status, "factors": {"present": present, "missing": list(missing), "kinds": {}},
            "strengths": [{"id": "revenue-growth", "ja": SECRET, "en": SECRET}], "weaknesses": [], "invalid": list(invalid)}


def pro_payload(**changes):
    pairs = [{"tickers": list(t), "ok": True, "comparable": True, "companies": [pro_company(x) for x in t]}
             for t in watch.PRO_COMPARE_PAIRS]
    for index, pair in changes.items():
        pairs[int(index[1:])] = pair
    return {"ok": True, "generatedAt": NOW.isoformat(), "pairs": pairs}


def authed_fetcher(payloads, pro, seen):
    public = fetcher(payloads)

    def fetch(url, timeout, token=None):
        seen.append((url, token))
        if url.endswith("/api/research/internal/pro-check"):
            return (200, pro, 4000, None) if token == TOKEN else (404, None, 50, "http-error")
        assert token is None, "the secret is sent to the pro check only"
        return public(url, timeout)
    return fetch


class ProCompareTests(unittest.TestCase):
    def test_all_pairs_complete_pass_and_the_token_goes_only_to_the_site_check(self):
        seen = []
        summary = watch.run(fetch=authed_fetcher(healthy(), pro_payload(), seen), now=NOW, token=TOKEN)
        self.assertTrue(summary["ok"], summary)
        result = summary["checks"]["proCompare"]
        self.assertEqual((result["pairs"], result["companies"], result["missingFactors"], result["invalidNumbers"]), (6, 12, 0, 0))
        self.assertEqual([url for url, token in seen if token], ["https://techphase.app/api/research/internal/pro-check"])
        self.assertEqual(summary["details"]["proCompare"]["NVDA"], {"missing": [], "invalid": [], "strengths": 1, "weaknesses": 0})

    def test_missing_factor_invalid_number_and_failed_pair_fail(self):
        broken = pro_payload(p1={"tickers": ["NVDA", "AMD"], "ok": True, "comparable": False,
                                 "companies": [pro_company("NVDA", missing=("valuation",)),
                                               pro_company("AMD", invalid=("absurd:quarterOperatingMargin",))]},
                             p2={"tickers": ["JPM", "GS"], "ok": False, "error": "unavailable"})
        summary = watch.run(fetch=authed_fetcher(healthy(), broken, []), now=NOW, token=TOKEN)
        self.assertEqual(summary["failed"], ["proCompare"])
        result = summary["checks"]["proCompare"]
        self.assertFalse(result["valid"])
        self.assertEqual((result["pairs"], result["missingFactors"], result["invalidNumbers"]), (5, 1, 1))
        self.assertIn("NVDA:missing=valuation", result["problems"])
        self.assertIn("AMD:invalid=absurd:quarterOperatingMargin", result["problems"])
        self.assertIn("JPM/GS=unavailable", result["problems"])

    def test_validator_rejects_wrong_shape_absent_companies_and_a_non_ready_company(self):
        check = watch.check_pro_compare
        self.assertFalse(check({"ok": True, "pairs": []}, NOW)["valid"])
        self.assertFalse(check({"ok": False, "pairs": pro_payload()["pairs"]}, NOW)["valid"])
        absent = pro_payload(p0={"tickers": ["BRK-B", "ORCL"], "ok": True, "companies": [pro_company("BRK-B")]})
        self.assertIn("ORCL=absent", check(absent, NOW)["problems"])
        unready = pro_payload(p5={"tickers": ["AAPL", "MSFT"], "ok": True, "companies": [pro_company("AAPL"), pro_company("MSFT", status="unavailable")]})
        verdict = check(unready, NOW)
        self.assertFalse(verdict["valid"])
        self.assertIn("MSFT:invalid=status:unavailable", verdict["problems"])
        self.assertTrue(check(pro_payload(), NOW)["valid"])

    def test_wrong_token_is_a_failure_and_no_token_or_plain_http_is_skipped(self):
        summary = watch.run(fetch=authed_fetcher(healthy(), pro_payload(), []), now=NOW, token="x" * 40)
        self.assertEqual(summary["failed"], ["proCompare"])
        self.assertEqual(summary["checks"]["proCompare"]["status"], 404)
        seen = []
        summary = watch.run(fetch=authed_fetcher(healthy(), pro_payload(), seen), now=NOW, token=TOKEN, site="http://example.test")
        self.assertEqual(summary["checks"]["proCompare"]["skipped"], "insecure-site")
        self.assertFalse(any(token for _, token in seen))
        self.assertTrue(watch.token_allowed("http://localhost:3000"))

    def test_log_lines_hold_no_secret_text_or_token(self):
        out = io.StringIO()
        env = {"PRODUCTION_WATCH": "true", "COMPARISON_WARM_SECRET": TOKEN}
        fetch = authed_fetcher(healthy(datetime.now(timezone.utc)), pro_payload(), [])
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(watch, "request", fetch), redirect_stdout(out):
            self.assertEqual(watch.main(), 0)
        text = out.getvalue()
        self.assertNotIn(TOKEN, text)
        self.assertNotIn("secret", text)
        main_line, pro_line = [json.loads(line) for line in text.strip().splitlines()]
        self.assertEqual(main_line["check"], "production-watch")
        self.assertNotIn("details", main_line)
        for value in main_line["checks"]["proCompare"].values():
            self.assertTrue(value is None or isinstance(value, (bool, int, str)))
        self.assertEqual(pro_line["check"], "pro-compare")
        self.assertEqual(set(pro_line["companies"]), {t for pair in watch.PRO_COMPARE_PAIRS for t in pair})


# daily_checks.py (report instead of crash, Nov 23) is tested in test_cron_report.py.


if __name__ == "__main__":
    unittest.main()
