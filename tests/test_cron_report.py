"""Nov 23 (owner): daily cron checks alert through the monitor's incidents and exit 0, instead of crashing every morning."""
import io
import json
import os
import sys
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import cron_report  # noqa: E402
import daily_checks  # noqa: E402
import incident_delivery  # noqa: E402
import monitor  # noqa: E402
import production_watch as watch  # noqa: E402

TOKEN = "t" * 40
CLIENT = {cron_report.TOKEN_ENV: TOKEN, cron_report.URL_ENV: "https://monitor.example"}


class ParseAndRecordTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "monitor.sqlite3"

    def test_only_known_jobs_and_fixed_codes_are_accepted(self):
        self.assertEqual(cron_report.parse({"job": "production-watch", "ok": False, "codes": ["news", "live", "live"]}),
                         ("production-watch", False, ["live", "news"]))
        for bad in ({"job": "other", "ok": True}, {"job": "production-watch", "ok": "no"},
                    {"job": "production-watch", "ok": False, "codes": ["https://x.example/a"]},
                    {"job": "production-watch", "ok": False, "codes": []},
                    {"job": "production-watch", "ok": True, "extra": 1}):
            with self.assertRaises(ValueError):
                cron_report.parse(bad)

    def test_a_failure_opens_one_critical_incident_and_a_pass_resolves_it(self):
        with monitor.connect(self.path) as db:
            failed = {"job": "production-watch", "ok": False, "codes": ["live", "news"]}
            self.assertEqual(cron_report.record(db, failed, monitor), "opened")
            self.assertEqual(cron_report.record(db, failed, monitor), "ongoing")
            row = db.execute("SELECT category,subject,severity,status,last_error_code FROM operational_incidents").fetchone()
            self.assertEqual(tuple(row), ("cron-check", "production-watch", "critical", "open",
                                          "cron-check-failed:production-watch:live.news"))
            self.assertEqual(cron_report.record(db, {"job": "production-watch", "ok": True}, monitor), "resolved")
            self.assertEqual(cron_report.record(db, {"job": "production-watch", "ok": True}, monitor), "ok")
            transitions = [r[0] for r in db.execute("SELECT transition FROM incident_notification_outbox ORDER BY id")]
        self.assertEqual(transitions, ["opened", "resolved"], "the owner is alerted once, then once more when it is fixed")

    def test_phone_text_names_the_check_and_what_failed(self):
        claim = {"key": "cron:production-watch", "category": "cron-check", "subject": "production-watch", "transition": "opened",
                 "severity": "critical", "errorCode": "cron-check-failed:production-watch:live.news"}
        message = incident_delivery.push_message(claim)
        self.assertIn("本番点検", message["title"])
        self.assertIn("live、news", message["body"])
        self.assertIn("✅", incident_delivery.push_message({**claim, "transition": "resolved"})["title"])


class SendTests(unittest.TestCase):
    def test_not_configured_without_url_and_token(self):
        self.assertEqual(cron_report.send("production-watch", False, ["live"], env={}), "not-configured")
        self.assertEqual(cron_report.send("production-watch", False, ["live"], env={**CLIENT, cron_report.URL_ENV: "http://x.example"}),
                         "not-configured")

    def test_delivers_only_the_job_flag_and_codes(self):
        sent = []

        def opener(request, timeout):
            sent.append((request.full_url, request.get_header("Authorization"), json.loads(request.data)))
            return SimpleNamespace(status=200, close=lambda: None)

        self.assertEqual(cron_report.send("production-watch", False, ["news", "live"], env=CLIENT, opener=opener), "delivered")
        self.assertEqual(sent, [("https://monitor.example/internal/cron-report", "Bearer " + TOKEN,
                                 {"job": "production-watch", "ok": False, "codes": ["live", "news"]})])

    def test_a_refused_or_unreachable_monitor_is_a_failed_delivery(self):
        def refuse(request, timeout):
            raise HTTPError(request.full_url, 503, "x", {}, None)
        self.assertEqual(cron_report.send("production-watch", False, ["live"], env=CLIENT, opener=refuse), "failed")


class EndpointTests(unittest.TestCase):
    def test_route_records_with_the_token_and_refuses_without_it(self):
        import service
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        app = SimpleNamespace(db_path=Path(directory.name) / "monitor.sqlite3", db_lock=threading.Lock())
        server = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        server.app = app
        threading.Thread(target=server.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{server.server_port}/internal/cron-report"
        body = json.dumps({"job": "earnings-selfcheck", "ok": False, "codes": ["gaps"]}).encode()

        def post(token, data=body):
            headers = {"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})}
            try:
                with urlopen(Request(url, data=data, method="POST", headers=headers), timeout=5) as response:
                    return response.status, json.loads(response.read())
            except HTTPError as error:
                return error.code, json.loads(error.read())
        try:
            with mock.patch.dict(os.environ, {}, clear=True):
                self.assertEqual(post(TOKEN)[0], 404, "off unless the monitor has its own token")
            with mock.patch.dict(os.environ, {cron_report.TOKEN_ENV: TOKEN}, clear=True):
                self.assertEqual(post("w" * 40)[0], 401)
                self.assertEqual(post(None)[0], 401)
                self.assertEqual(post(TOKEN, b'{"job":"x","ok":true}')[0], 400)
                self.assertEqual(post(TOKEN), (200, {"ok": True, "transition": "opened"}))
        finally:
            server.shutdown()
            server.server_close()
        with monitor.connect(app.db_path) as db:
            self.assertEqual(db.execute("SELECT status FROM operational_incidents WHERE incident_key='cron:earnings-selfcheck'").fetchone()[0], "open")


class DailyChecksTests(unittest.TestCase):
    def run_main(self, checks, report):
        out = io.StringIO()
        with redirect_stdout(out):
            code = daily_checks.main(checks, report=report)
        return code, [json.loads(line) for line in out.getvalue().splitlines()]

    def test_a_reported_failure_exits_0(self):
        reports = []
        code, lines = self.run_main((("production-watch", lambda: ["live", "news"]), ("earnings-selfcheck", lambda: [])),
                                    lambda job, ok, codes: reports.append((job, ok, codes)) or "delivered")
        self.assertEqual(code, 0)
        self.assertEqual(reports, [("production-watch", False, ["live", "news"]), ("earnings-selfcheck", True, [])])
        self.assertEqual(lines[0], {"check": "production-watch", "report": "delivered"})

    def test_a_failure_that_cannot_be_reported_still_exits_1(self):
        for status in ("not-configured", "failed"):
            code, _ = self.run_main((("production-watch", lambda: ["live"]),), lambda *a: status)
            self.assertEqual(code, 1)

    def test_a_pass_exits_0_even_when_the_report_is_not_delivered(self):
        code, _ = self.run_main((("production-watch", lambda: []),), lambda *a: "not-configured")
        self.assertEqual(code, 0)

    def test_disabled_checks_report_nothing(self):
        code, lines = self.run_main((("production-watch", lambda: None),), lambda *a: self.fail("must not report"))
        self.assertEqual((code, lines), (0, []))

    def test_a_check_that_raises_exits_1_without_its_message_and_the_other_still_runs(self):
        ran = []

        def boom():
            raise RuntimeError("https://private.example/secret")
        code, lines = self.run_main((("earnings-selfcheck", boom), ("production-watch", lambda: ran.append(1) or [])),
                                    lambda *a: "delivered")
        self.assertEqual(code, 1)
        self.assertEqual(ran, [1])
        self.assertEqual(lines[0], {"check": "earnings-selfcheck", "ok": False, "error": "RuntimeError"})


class WeekendNewsTests(unittest.TestCase):
    def news(self, newest):
        return {"ok": True, "officialUpdates": [{"observedAt": newest}]}

    def test_a_quiet_weekend_is_not_a_failure(self):
        # Nov 22 (Sunday) 22:34 UTC: the newest FREE entry was Wednesday evening, 96.9 hours earlier (the run that crashed).
        now = datetime(2026, 11, 22, 22, 34, tzinfo=timezone.utc)
        result = watch.check_news(self.news("2026-11-19T21:40:00Z"), now, holidays=frozenset())
        self.assertTrue(result["valid"], result)
        self.assertLessEqual(result["tradingAgeSeconds"], 56 * 3600)

    def test_three_full_trading_days_without_news_still_fail(self):
        now = datetime(2026, 11, 20, 22, 0, tzinfo=timezone.utc)  # Friday
        self.assertFalse(watch.check_news(self.news("2026-11-16T22:00:00Z"), now, holidays=frozenset())["valid"])

    def test_a_market_holiday_does_not_count(self):
        now = datetime(2026, 11, 27, 22, 0, tzinfo=timezone.utc)  # Friday after Thanksgiving (Nov 26 closed)
        newest = "2026-11-24T21:00:00Z"
        self.assertTrue(watch.check_news(self.news(newest), now, holidays=frozenset({"2026-11-26"}))["valid"])
        self.assertFalse(watch.check_news(self.news(newest), now, holidays=frozenset())["valid"])

    def test_trading_day_seconds_skip_weekends(self):
        start = datetime(2026, 11, 21, 5, 0, tzinfo=timezone.utc)  # Saturday 00:00 New York
        self.assertEqual(watch.trading_day_seconds(start, datetime(2026, 11, 23, 5, 0, tzinfo=timezone.utc), frozenset()), 0)


if __name__ == "__main__":
    unittest.main()
