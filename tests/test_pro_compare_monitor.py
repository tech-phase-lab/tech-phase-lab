"""Nov 27 (HQ): the research monitor runs the PRO Stock Comparison check itself (it already holds COMPARISON_WARM_SECRET), once
shortly after start and then daily, logs the same two lines and alerts through its operational incidents."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[0]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import cron_report  # noqa: E402
import incident_delivery  # noqa: E402
import monitor  # noqa: E402
import production_watch as watch  # noqa: E402
from test_production_watch import NOW, pro_company, pro_payload  # noqa: E402

SECRET = "w" * 40
ENV = {"COMPARISON_WARM_URL": "https://techphase.app/api/research/compare/warm", "COMPARISON_WARM_SECRET": SECRET}


def site_fetch(payload, seen):
    def fetch(url, timeout, token=None):
        seen.append((url, token))
        return (200, payload, 3000, None) if token == SECRET else (404, None, 40, "http-error")
    return fetch


class MonitorProCompareTests(unittest.TestCase):
    def test_settings_come_from_the_warm_job_and_only_its_host_gets_the_secret(self):
        self.assertEqual(watch.monitor_settings(ENV), ("https://techphase.app", SECRET))
        for bad in ({}, {**ENV, "COMPARISON_WARM_SECRET": "short"}, {**ENV, "COMPARISON_WARM_URL": "http://techphase.app/x"},
                    {**ENV, "COMPARISON_WARM_URL": "https://u:p@techphase.app/x"}):
            self.assertIsNone(watch.monitor_settings(bad))
        self.assertIsNone(watch.monitor_pro_compare({}))

    def test_a_pass_prints_the_two_lines_and_calls_only_the_check_route(self):
        seen, out = [], io.StringIO()
        with redirect_stdout(out):
            self.assertEqual(watch.monitor_pro_compare(ENV, fetch=site_fetch(pro_payload(), seen), now=NOW), (True, []))
        self.assertEqual(seen, [("https://techphase.app/api/research/internal/pro-check", SECRET)])
        head, detail = [json.loads(line) for line in out.getvalue().strip().splitlines()]
        self.assertEqual((head["check"], head["source"], head["ok"], list(head["checks"])),
                         ("production-watch", "monitor", True, ["proCompare"]))
        self.assertEqual((detail["check"], detail["source"], len(detail["companies"])), ("pro-compare", "monitor", 12))
        self.assertNotIn(SECRET, out.getvalue())

    def test_a_failure_returns_fixed_codes_the_incident_accepts(self):
        broken = pro_payload(p1={"tickers": ["NVDA", "AMD"], "ok": True, "companies": [
            pro_company("NVDA", missing=("valuation",)), pro_company("AMD", invalid=("negative:debtTotal",))]},
            p0={"tickers": ["BRK-B", "ORCL"], "ok": False, "error": "unavailable"})
        with redirect_stdout(io.StringIO()):
            ok, codes = watch.monitor_pro_compare(ENV, fetch=site_fetch(broken, []), now=NOW)
        self.assertFalse(ok)
        self.assertEqual(codes, ["AMD-invalid", "NVDA-missing", "pairs"])
        self.assertEqual(cron_report.parse({"job": "pro-compare", "ok": False, "codes": codes})[0], "pro-compare")
        with redirect_stdout(io.StringIO()):
            _, refused = watch.monitor_pro_compare(ENV, fetch=lambda url, timeout, token=None: (404, None, 40, "http-error"), now=NOW)
        self.assertEqual(refused, ["http-404"])
        many = {t: {"missing": ["cash"], "invalid": []} for t in "ABCDEFGHIJ"}
        self.assertEqual(len(watch.incident_codes({"ok": False}, many)), 8)

    def test_the_phone_text_names_the_check(self):
        claim = {"key": "cron:pro-compare", "category": "cron-check", "subject": "pro-compare", "transition": "opened",
                 "severity": "critical", "errorCode": "cron-check-failed:pro-compare:NVDA-missing"}
        message = cron_report.push_message(claim)
        self.assertIn("PRO銘柄比較の点検", message["title"])
        self.assertIn("NVDA-missing", message["body"])
        self.assertIsNotNone(incident_delivery.push_message(claim))


class MonitorLaneTests(unittest.TestCase):
    def setUp(self):
        global service
        import service
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        with patch.dict("os.environ", ENV):
            self.app = service.AutomaticMonitor(root / "db.sqlite", root / "snapshot.json")

    def lane(self, check, rounds):
        waits, out = [], io.StringIO()

        def wait(seconds):
            waits.append(seconds)
            if len(waits) > rounds:
                self.app.stop_event.set()
            return self.app.stop_event.is_set()
        with patch.dict("os.environ", ENV), patch.object(self.app.stop_event, "wait", side_effect=wait), redirect_stdout(out):
            self.app.run_pro_compare(check=check)
        return waits, out.getvalue()

    def test_runs_after_start_then_daily_and_opens_then_resolves_the_incident(self):
        results = iter([(False, ["NVDA-missing"]), (True, [])])
        waits, out = self.lane(lambda: next(results), 2)
        self.assertEqual(waits, [watch.PRO_COMPARE_START_DELAY, watch.PRO_COMPARE_RETRY, watch.PRO_COMPARE_INTERVAL])
        events = [json.loads(line) for line in out.splitlines() if line.startswith('{"event"')]
        self.assertEqual([e["transition"] for e in events], ["opened", "resolved"])
        with monitor.connect(self.app.db_path) as db:
            row = db.execute("SELECT category,subject,status,last_error_code FROM operational_incidents"
                             " WHERE incident_key='cron:pro-compare'").fetchone()
            transitions = [r[0] for r in db.execute("SELECT transition FROM incident_notification_outbox ORDER BY id")]
        self.assertEqual(tuple(row), ("cron-check", "pro-compare", "resolved", "cron-check-failed:pro-compare:NVDA-missing"))
        self.assertEqual(transitions, ["opened", "resolved"])

    def test_a_first_404_is_retried_in_30_minutes_without_an_incident(self):
        # The site's route may not be deployed yet when the monitor starts: a 404 then a pass opens and sends nothing.
        results = iter([(False, ["http-404"]), (True, [])])
        waits, out = self.lane(lambda: next(results), 2)
        self.assertEqual(watch.PRO_COMPARE_NOT_FOUND_RETRY, 1800)
        self.assertEqual(waits, [watch.PRO_COMPARE_START_DELAY, watch.PRO_COMPARE_NOT_FOUND_RETRY, watch.PRO_COMPARE_INTERVAL])
        events = [json.loads(line) for line in out.splitlines() if line.startswith('{"event"')]
        self.assertEqual(events[0]["transition"], "deferred")
        with monitor.connect(self.app.db_path) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM operational_incidents WHERE incident_key='cron:pro-compare' AND status='open'").fetchone())
            self.assertEqual(db.execute("SELECT count(*) FROM incident_notification_outbox").fetchone()[0], 0)

    def test_a_second_failure_in_a_row_after_a_404_is_alerted(self):
        for second in (["http-404"], ["NVDA-missing"]):
            with self.subTest(second=second):
                self.setUp()
                results = iter([(False, ["http-404"]), (False, list(second))])
                waits, out = self.lane(lambda: next(results), 2)
                self.assertEqual(waits[:3], [watch.PRO_COMPARE_START_DELAY, watch.PRO_COMPARE_NOT_FOUND_RETRY, watch.PRO_COMPARE_RETRY])
                events = [json.loads(line) for line in out.splitlines() if line.startswith('{"event"')]
                self.assertEqual([e["transition"] for e in events], ["deferred", "opened"])

    def test_an_exception_is_logged_by_name_and_retried(self):
        def boom():
            raise TimeoutError(SECRET)
        waits, out = self.lane(boom, 1)
        self.assertIn('"pro-compare-failed","error":"TimeoutError"', out)
        self.assertNotIn(SECRET, out)
        self.assertEqual(waits, [watch.PRO_COMPARE_START_DELAY, watch.PRO_COMPARE_RETRY])

    def test_off_without_the_warm_settings(self):
        out = io.StringIO()
        with patch.dict("os.environ", {"COMPARISON_WARM_URL": "", "COMPARISON_WARM_SECRET": ""}), redirect_stdout(out):
            self.app.run_pro_compare(check=lambda: self.fail("must not run"))
        self.assertIn("pro-compare off", out.getvalue())


if __name__ == "__main__":
    unittest.main()
