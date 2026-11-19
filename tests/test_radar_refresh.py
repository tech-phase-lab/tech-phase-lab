"""The Financial Radar's twice-daily refresh: fixed JST times, the warm URL's host and secret, a cursor followed to the end, and a
/health entry with counts and times only."""
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts/research"))
import radar_refresh  # noqa: E402

SECRET = "s" * 40
ENV = {"COMPARISON_WARM_URL": "https://techphase.app/api/research/compare/warm", "COMPARISON_WARM_SECRET": SECRET}


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def utc(text):
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)


class RadarRefreshScheduleTest(unittest.TestCase):
    def test_off_unless_the_warm_settings_exist_and_same_host_is_used(self):
        self.assertIsNone(radar_refresh.config({}))
        self.assertIsNone(radar_refresh.config({**ENV, "COMPARISON_WARM_SECRET": "short"}))
        self.assertIsNone(radar_refresh.config({**ENV, "COMPARISON_WARM_URL": "http://techphase.app/api/research/compare/warm"}))
        self.assertEqual(radar_refresh.run_once({}), {"status": "off"})
        self.assertEqual(radar_refresh.config(ENV), ("https://techphase.app/api/research/radar/refresh", SECRET))
        self.assertEqual(radar_refresh.config({**ENV, "COMPARISON_WARM_URL": "https://www.techphase.app/x/y?z=1"})[0],
                         "https://www.techphase.app/api/research/radar/refresh")

    def test_slots_are_0800_and_2230_jst(self):
        self.assertEqual(radar_refresh.SLOTS_JST, ((8, 0), (22, 30)))
        # 2026-11-15 23:30 UTC = 11-16 08:30 JST -> the 08:00 JST slot (23:00 UTC)
        self.assertEqual(radar_refresh.latest_slot(utc("2026-11-15T23:30:00")), utc("2026-11-15T23:00:00"))
        self.assertEqual(radar_refresh.next_slot(utc("2026-11-15T23:30:00")), utc("2026-11-16T13:30:00"))
        # 13:30 UTC = 22:30 JST
        self.assertEqual(radar_refresh.latest_slot(utc("2026-11-16T13:30:00")), utc("2026-11-16T13:30:00"))
        self.assertEqual(radar_refresh.next_slot(utc("2026-11-16T13:30:00")), utc("2026-11-16T23:00:00"))

    def test_a_slot_runs_once_retries_errors_and_is_skipped_after_the_grace(self):
        schedule = radar_refresh.Schedule()
        self.assertIsNone(schedule.due(utc("2026-11-15T22:59:00")))  # 22:30 JST was nine and a half hours ago
        slot = schedule.due(utc("2026-11-15T23:01:00"))
        self.assertEqual(slot, utc("2026-11-15T23:00:00"))
        schedule.record(slot, {"status": "error", "error": "TimeoutError"})
        self.assertEqual(schedule.due(utc("2026-11-15T23:12:00")), slot)  # tried again
        schedule.record(slot, {"status": "error"})
        schedule.record(slot, {"status": "error"})
        self.assertIsNone(schedule.due(utc("2026-11-15T23:40:00")))  # three attempts: wait for the next slot
        self.assertEqual(schedule.due(utc("2026-11-16T13:31:00")), utc("2026-11-16T13:30:00"))
        schedule.record(utc("2026-11-16T13:30:00"), {"status": "ok"})
        self.assertIsNone(schedule.due(utc("2026-11-16T13:32:00")))
        # a monitor that starts long after a slot does not run it late
        self.assertIsNone(radar_refresh.Schedule().due(utc("2026-11-16T17:00:00")))
        self.assertIsNotNone(radar_refresh.Schedule().due(utc("2026-11-16T16:00:00")))


class RadarRefreshRunTest(unittest.TestCase):
    def test_follows_the_cursor_with_the_bearer_secret_and_keeps_no_secret(self):
        seen = []
        pages = [{"ok": True, "storage": True, "done": False, "next": 20, "total": 54, "refreshed": 19, "live": 1, "failures": []},
                 {"ok": True, "storage": True, "done": False, "next": 41, "total": 54, "refreshed": 20, "live": 0, "failures": ["semis:NVDA"],
                  "stale": ["NBIS:behind"]},
                 {"ok": True, "storage": True, "done": True, "next": None, "total": 54, "refreshed": 13, "live": 0, "failures": [],
                  "stale": ["NBIS:behind", "CEG:xbrl-unread"]}]

        def opener(request, timeout):
            seen.append((request.full_url, request.get_method(), request.get_header("Authorization"), timeout))
            return FakeResponse(json.dumps(pages[len(seen) - 1]).encode())

        result = radar_refresh.run_once(ENV, opener)
        self.assertEqual(result, {"status": "partial", "calls": 3, "total": 54, "refreshed": 52, "live": 1, "failed": 1, "failures": ["semis:NVDA"],
                                  "stale": ["NBIS:behind", "CEG:xbrl-unread"]})  # a company in two genres is listed once
        base = "https://techphase.app/api/research/radar/refresh"
        self.assertEqual([s[0] for s in seen], [base, base + "?cursor=20", base + "?cursor=41"])
        self.assertTrue(all(s[1] == "POST" and s[2] == f"Bearer {SECRET}" and s[3] > 60 for s in seen))
        self.assertNotIn(SECRET, json.dumps(result))

    def test_missing_settings_are_named_never_valued(self):
        self.assertEqual(radar_refresh.missing_settings({}), ["COMPARISON_WARM_URL", "COMPARISON_WARM_SECRET"])
        self.assertEqual(radar_refresh.missing_settings({"COMPARISON_WARM_URL": "https://x.example/a"}), ["COMPARISON_WARM_SECRET"])
        self.assertEqual(radar_refresh.missing_settings(ENV), [])
        short = radar_refresh.missing_settings({**ENV, "COMPARISON_WARM_SECRET": "short"})
        self.assertTrue(short and not any("short" in name for name in short))

    def test_errors_are_reported_without_details(self):
        def boom(request, timeout):
            raise TimeoutError("slow " + SECRET)
        result = radar_refresh.run_once(ENV, boom)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"], "TimeoutError")
        self.assertNotIn(SECRET, json.dumps(result))
        refused = radar_refresh.run_once(ENV, lambda r, timeout: FakeResponse(b'{"ok": false}'))
        self.assertEqual(refused["status"], "error")
        stuck = radar_refresh.run_once(ENV, lambda r, timeout: FakeResponse(json.dumps({"ok": True, "storage": True, "done": False, "next": 0}).encode()))
        self.assertEqual(stuck["error"], "bad-cursor")
        self.assertEqual(radar_refresh.run_once(ENV, lambda r, timeout: FakeResponse(b'{"ok": true, "storage": false, "done": true}'))["status"], "no-storage")


class RadarRefreshHealthTest(unittest.TestCase):
    def setUp(self):
        global service
        import service
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        with patch.dict("os.environ", ENV):
            self.app = service.AutomaticMonitor(root / "db.sqlite", root / "snapshot.json")

    def test_health_starts_waiting_and_shows_the_last_run_without_secrets(self):
        self.assertEqual(self.app.state["radarRefresh"]["status"], "waiting")
        self.assertEqual(self.app.state["radarRefresh"]["slotsJst"], ["08:00", "22:30"])
        moments = iter([utc("2026-11-15T23:01:00"), utc("2026-11-15T23:01:30")])
        result = {"status": "ok", "calls": 3, "total": 54, "refreshed": 53, "live": 1, "failed": 0, "failures": []}
        with patch.dict("os.environ", ENV), patch.object(service.radar_refresh, "run_once", return_value=result) as run, \
                patch.object(self.app.stop_event, "wait", side_effect=lambda seconds: self.app.stop_event.set()):
            self.app.run_radar_refresh(now=lambda: next(moments))
        run.assert_called_once()
        health = self.app.state["radarRefresh"]
        self.assertEqual(health["status"], "ok")
        self.assertEqual(health["refreshed"], 53)
        self.assertEqual(health["failed"], 0)
        self.assertEqual(health["slot"], "2026-11-15T23:00:00Z")
        self.assertEqual(health["nextAt"], "2026-11-16T13:30:00Z")
        self.assertTrue(health["checkedAt"])
        text = json.dumps(health)
        self.assertNotIn(SECRET, text)
        self.assertNotIn("techphase.app", text)

    def test_off_without_the_warm_settings(self):
        root = Path(self.temp.name)
        with patch.dict("os.environ", {"COMPARISON_WARM_URL": "", "COMPARISON_WARM_SECRET": ""}):
            app = service.AutomaticMonitor(root / "db2.sqlite", root / "snapshot2.json")
            self.assertEqual(app.state["radarRefresh"]["status"], "off")
            # Nov 18: production ran with this lane silently off; /health and the log name the missing settings (names, never values)
            self.assertEqual(app.state["radarRefresh"]["missing"], ["COMPARISON_WARM_URL", "COMPARISON_WARM_SECRET"])
            out = io.StringIO()
            with patch.object(service.radar_refresh, "run_once") as run, patch("sys.stdout", out):
                app.run_radar_refresh()
            run.assert_not_called()
            self.assertIn("radar-refresh off missing=COMPARISON_WARM_URL,COMPARISON_WARM_SECRET", out.getvalue())

    def test_the_run_line_lists_lagging_companies(self):
        moments = iter([utc("2026-11-15T23:01:00"), utc("2026-11-15T23:01:30")])
        result = {"status": "ok", "calls": 3, "total": 54, "refreshed": 54, "live": 0, "failed": 0, "failures": [], "stale": ["NBIS:behind"]}
        out = io.StringIO()
        with patch.dict("os.environ", ENV), patch.object(service.radar_refresh, "run_once", return_value=result), patch("sys.stdout", out), \
                patch.object(self.app.stop_event, "wait", side_effect=lambda seconds: self.app.stop_event.set()):
            self.app.run_radar_refresh(now=lambda: next(moments))
        self.assertIn("radar-refresh ok refreshed=54 failed=0 stale=NBIS:behind", out.getvalue())
        self.assertEqual(self.app.state["radarRefresh"]["stale"], ["NBIS:behind"])


if __name__ == "__main__":
    unittest.main()
