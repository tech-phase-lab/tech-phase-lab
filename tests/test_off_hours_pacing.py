"""Off-hours pacing (Nov 22): slower background work only while U.S. markets are closed and no scheduled release is near."""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/research"))
import off_hours  # noqa: E402

service_spec = importlib.util.spec_from_file_location("off_hours_service", ROOT / "scripts/research/service.py")
service = importlib.util.module_from_spec(service_spec)
service_spec.loader.exec_module(service)

ET = ZoneInfo("America/New_York")


def et(*args):
    return datetime(*args, tzinfo=ET).timestamp()


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc).timestamp()


def pacing(at, events=(), **env):
    return off_hours.Pacing(env=env, clock=lambda: at, events=list(events))


class WindowTests(unittest.TestCase):
    def test_weekday_window_edges_in_new_york_time(self):
        # Tuesday Nov 24, 2026 (EST, UTC-5).
        self.assertFalse(off_hours.us_fast_window(et(2026, 11, 24, 3, 59)))
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 24, 4, 0)))
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 24, 16, 5)))
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 24, 20, 29)))
        self.assertFalse(off_hours.us_fast_window(et(2026, 11, 24, 20, 30)))
        self.assertFalse(off_hours.us_fast_window(et(2026, 11, 24, 23, 0)))

    def test_weekend_is_off_hours_all_day(self):
        for hour in (0, 4, 9, 12, 16, 20, 23):
            self.assertFalse(off_hours.us_fast_window(et(2026, 11, 21, hour, 0)))  # Saturday
            self.assertFalse(off_hours.us_fast_window(et(2026, 11, 22, hour, 0)))  # Sunday
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 20, 20, 0)))   # Friday evening
        self.assertFalse(off_hours.us_fast_window(et(2026, 11, 20, 20, 30)))
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 23, 4, 0)))    # Monday 04:00

    def test_nyse_holidays_from_the_price_alert_calendar_are_off_hours(self):
        self.assertFalse(off_hours.us_fast_window(et(2026, 11, 26, 10, 0)))  # Thanksgiving
        self.assertTrue(off_hours.us_fast_window(et(2026, 11, 27, 10, 0)))   # early close still counts as a trading day

    def test_dst_transitions_follow_new_york_local_time(self):
        # Spring forward: Monday Mar 9, 2026 is EDT (UTC-4); 04:00 local is 08:00 UTC, not 09:00.
        self.assertFalse(off_hours.us_fast_window(utc(2026, 3, 9, 7, 59)))
        self.assertTrue(off_hours.us_fast_window(utc(2026, 3, 9, 8, 0)))
        # Friday Mar 6 (still EST): 04:00 local is 09:00 UTC.
        self.assertFalse(off_hours.us_fast_window(utc(2026, 3, 6, 8, 30)))
        self.assertTrue(off_hours.us_fast_window(utc(2026, 3, 6, 9, 0)))
        # Fall back: Friday Oct 30 (EDT) ends 20:30 local = 00:30 UTC; Monday Nov 2 (EST) ends at 01:30 UTC.
        self.assertFalse(off_hours.us_fast_window(utc(2026, 10, 31, 0, 30)))
        self.assertTrue(off_hours.us_fast_window(utc(2026, 11, 3, 1, 29)))
        self.assertFalse(off_hours.us_fast_window(utc(2026, 11, 3, 1, 30)))


class ExceptionTests(unittest.TestCase):
    ASIA = {"id": "skhy", "kind": "earnings", "ticker": "SKHY", "phase": "release", "at": "2026-11-21T23:00:00.000Z"}
    CPI = {"id": "cpi", "kind": "economic", "indicator": "cpi", "phase": "release", "at": "2026-12-10T13:30:00.000Z"}

    def test_a_release_near_turns_off_hours_off_for_everything(self):
        # Saturday 15:00 ET = 20:00 UTC, three hours before the (illustrative) 23:00 UTC release.
        off, reason, _ = off_hours.decide(utc(2026, 11, 21, 20, 0), [self.ASIA])
        self.assertEqual((off, reason), (False, "scheduled-event"))
        self.assertTrue(off_hours.decide(utc(2026, 11, 21, 19, 59), [self.ASIA])[0])
        self.assertFalse(off_hours.decide(utc(2026, 11, 22, 1, 0), [self.ASIA])[0])   # two hours after
        self.assertTrue(off_hours.decide(utc(2026, 11, 22, 1, 1), [self.ASIA])[0])

    def test_indicator_slot_stays_fast_even_on_a_closed_day(self):
        # A release on a day the window treats as closed is still covered by the event rule.
        holiday_release = dict(self.CPI, at="2026-11-26T13:30:00.000Z")
        self.assertFalse(off_hours.decide(utc(2026, 11, 26, 13, 0), [holiday_release])[0])
        self.assertTrue(off_hours.decide(utc(2026, 11, 26, 18, 0), [holiday_release])[0])

    def test_company_with_results_today_or_next_morning_is_never_slowed(self):
        event = {"kind": "earnings", "ticker": "MU", "phase": "release", "at": "2026-12-17T21:00:00.000Z"}
        # Thursday 00:00 ET (off-hours), 16 hours before the release: MU stays at the usual pace, others slow down.
        p = pacing(et(2026, 12, 17, 0, 0), [event])
        self.assertTrue(p.off_hours())
        self.assertFalse(p.slows("MU"))
        self.assertTrue(p.slows("LRCX"))
        # Two days ahead: MU slows like the others.
        self.assertTrue(pacing(et(2026, 12, 15, 23, 0), [event]).slows("MU"))
        # The night after the release (within 12 hours) it is still at the usual pace.
        self.assertFalse(pacing(et(2026, 12, 17, 23, 0), [event]).slows("MU"))

    def test_asian_and_european_issuers_and_the_switch(self):
        night = et(2026, 11, 24, 23, 0)
        self.assertFalse(pacing(night).slows("SKHY"))
        self.assertFalse(pacing(night).slows("IREN"))
        self.assertTrue(pacing(night).slows("CRWV"))
        self.assertFalse(pacing(night, RESEARCH_OFF_HOURS_ENABLED="false").off_hours())
        self.assertFalse(pacing(night, RESEARCH_OFF_HOURS_ENABLED="false").slows("CRWV"))
        self.assertFalse(pacing(et(2026, 11, 24, 10, 0)).slows("CRWV"))
        self.assertTrue(pacing(night, RESEARCH_OFF_HOURS_EXEMPT_TICKERS="").slows("SKHY"))

    def test_the_bundled_schedule_loads(self):
        status = pacing(et(2026, 11, 24, 23, 0), events=()).status()
        self.assertEqual(status["standardPollSeconds"], 30)
        self.assertIsNone(status["fastPollSeconds"])
        real = off_hours.Pacing(env={}, clock=lambda: et(2026, 11, 24, 23, 0))
        self.assertIsInstance(real.schedule(), list)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.app = service.AutomaticMonitor(Path(self.temp.name) / "a.sqlite", Path(self.temp.name) / "s.json")

    def tearDown(self):
        self.temp.cleanup()

    def use(self, at, **env):
        self.app.pacing = pacing(at, **env)

    def test_only_the_standard_lane_and_background_work_slow_down(self):
        self.use(et(2026, 11, 22, 3, 0))  # Sunday night
        self.assertEqual(self.app.interval_for("CRWV"), 30)    # standard lane
        self.assertEqual(self.app.interval_for("SKHY"), 5)     # Asian issuer: usual pace
        self.assertEqual(self.app.interval_for("NVDA"), 3)     # fast lane unchanged
        self.assertEqual(self.app.interval_for("TSM"), 3)      # its own fixed pace
        self.assertEqual(self.app.current_body_interval(), 60)
        self.assertEqual(self.app.idle_wait(5), 30)
        self.assertEqual(self.app.live_refresh_interval(), 60)
        self.assertGreater(self.app.live_max_age(), 60)
        self.use(et(2026, 11, 23, 9, 0))  # Monday morning
        self.assertEqual(self.app.interval_for("CRWV"), 5)
        self.assertEqual(self.app.current_body_interval(), 10)
        self.assertEqual(self.app.idle_wait(5), 5)
        self.assertEqual((self.app.live_refresh_interval(), self.app.live_max_age()), (15, 45))

    def test_fast_lane_can_be_slowed_only_when_asked(self):
        self.use(et(2026, 11, 22, 3, 0), RESEARCH_OFF_HOURS_FAST_POLL_SECONDS="10")
        self.assertEqual(self.app.interval_for("NVDA"), 10)
        self.assertEqual(self.app.interval_for("TSM"), 3)

    def test_freshness_view_never_builds_the_snapshot(self):
        with patch.object(service.monitor, "bounded_live_snapshot", side_effect=AssertionError("snapshot built")):
            answer = self.app.live_payload(view="freshness")
            self.assertEqual((answer["ok"], answer["mode"]), (True, "automatic"))
            self.assertNotIn("snapshot", answer)
            self.assertIn("lastCycleAgeSeconds", answer["monitor"])
            # The background step only rebuilds the state while no full reader asked (and the full payload is warm).
            self.app.live_cache = (time.monotonic() - 200, {"ok": True, "mode": "automatic", "monitor": {}, "snapshot": {}})
            self.app.live_full_requested_at -= service.LIVE_IDLE_SECONDS + 1
            self.app.live_state_cache = (self.app.live_state_cache[0] - 120, self.app.live_state_cache[1])
            self.assertTrue(self.app.refresh_live())
        full = self.app.live_payload()
        self.assertIn("snapshot", full)
        self.assertIs(self.app.newest_live_state(), self.app.live_state_cache)


if __name__ == "__main__":
    unittest.main()
