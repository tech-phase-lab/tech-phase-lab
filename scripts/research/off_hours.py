"""Off-hours pacing for the always-on monitor (owner, Nov 22: cut Railway cost, but 早さは命).

Only background pacing changes, never what is collected, filtered, translated or published. The monitor runs at its usual
speed whenever any of these holds, and slows down only when none does:

* the U.S. fast window: weekdays 04:00-20:30 America/New_York (pre-market through after-hours results), except NYSE
  holidays from price_alerts.HOLIDAYS (the calendar the price alerts already use; outside its years every weekday counts);
* a scheduled release (release_schedule.json: earnings releases and calls, CPI, jobs, PCE, ADP, ...) from
  EVENT_BEFORE before to EVENT_AFTER after its time, whatever the clock says (an Asian or European result at night included).

Even in off-hours, a company is never slowed when it has a scheduled result between EARNINGS_AFTER ago and EARNINGS_BEFORE
ahead ("today or the next morning"), or when it is in EXEMPT_TICKERS (issuers that publish in Asian or European business hours,
which are U.S. off-hours). Sources with their own fixed pace (providers.json pollSeconds: TSMC, ASML, Broadcom) and the 3-second
fast lane are never touched by default. Web push, price alerts, the incident watch and the health endpoints are not paced here.

RESEARCH_OFF_HOURS_ENABLED=false turns all of it off at once (the next loop pass uses the usual speed).
"""
from datetime import datetime, timedelta, timezone
import os
import threading
import time
from zoneinfo import ZoneInfo

import price_alerts
import release_watch

ET = ZoneInfo("America/New_York")
FAST_START_MINUTES = 4 * 60
FAST_END_MINUTES = 20 * 60 + 30
EVENT_BEFORE = timedelta(hours=3)
EVENT_AFTER = timedelta(hours=2)
EARNINGS_BEFORE = timedelta(hours=24)
EARNINGS_AFTER = timedelta(hours=12)
# SK hynix (Seoul), IREN (Sydney) and Nebius (Amsterdam) publish in their own business hours, which are U.S. off-hours.
DEFAULT_EXEMPT_TICKERS = "SKHY,IREN,NBIS"
RECHECK_SECONDS = 1.0


def _flag(env, name, default):
    value = env.get(name, "").strip().lower()
    if value in {"0", "false", "no", "off"}:
        return False
    if value in {"1", "true", "yes", "on"}:
        return True
    return default


def _seconds(env, name, default, minimum):
    try:
        return max(minimum, int(env.get(name, default)))
    except (TypeError, ValueError):
        return default


def us_fast_window(now):
    """True from 04:00 to 20:30 New York time on weekdays that are not NYSE holidays. `now` is epoch seconds."""
    local = datetime.fromtimestamp(now, ET)
    if local.weekday() >= 5:
        return False
    if local.strftime("%Y-%m-%d") in price_alerts.HOLIDAYS:
        return False
    minutes = local.hour * 60 + local.minute
    return FAST_START_MINUTES <= minutes < FAST_END_MINUTES


def _events_between(events, now, before, after):
    at_now = datetime.fromtimestamp(now, timezone.utc)
    for event in events:
        at = release_watch.instant(event.get("at")) if isinstance(event, dict) else None
        if at is not None and at_now - after <= at <= at_now + before:
            yield event


def event_near(now, events):
    """True when any scheduled release or call is within EVENT_BEFORE ahead or EVENT_AFTER behind."""
    return next(_events_between(events, now, EVENT_BEFORE, EVENT_AFTER), None) is not None


def earnings_tickers(now, events):
    """Companies with a scheduled result from EARNINGS_AFTER ago to EARNINGS_BEFORE ahead."""
    return frozenset(str(event["ticker"]).upper() for event in _events_between(events, now, EARNINGS_BEFORE, EARNINGS_AFTER)
                     if event.get("kind") == "earnings" and event.get("ticker"))


def decide(now, events, enabled=True):
    """(off_hours, reason, earnings tickers) for epoch `now`."""
    tickers = earnings_tickers(now, events)
    if not enabled:
        return False, "disabled", tickers
    if us_fast_window(now):
        return False, "us-window", tickers
    if event_near(now, events):
        return False, "scheduled-event", tickers
    return True, "off-hours", tickers


class Pacing:
    """Thread-safe, cached view of decide() plus the configured off-hours intervals (RESEARCH_OFF_HOURS_*)."""

    def __init__(self, env=None, clock=time.time, events=None):
        env = os.environ if env is None else env
        self.enabled = _flag(env, "RESEARCH_OFF_HOURS_ENABLED", True)
        self.standard_seconds = _seconds(env, "RESEARCH_OFF_HOURS_STANDARD_POLL_SECONDS", 30, 5)
        # 0 keeps the 3-second fast lane unchanged at all hours (the default).
        self.fast_seconds = _seconds(env, "RESEARCH_OFF_HOURS_FAST_POLL_SECONDS", 0, 0)
        self.body_interval = _seconds(env, "RESEARCH_OFF_HOURS_BODY_FETCH_INTERVAL_SECONDS", 60, 5)
        self.idle_seconds = _seconds(env, "RESEARCH_OFF_HOURS_IDLE_SECONDS", 30, 1)
        self.live_refresh_seconds = _seconds(env, "RESEARCH_OFF_HOURS_LIVE_REFRESH_SECONDS", 60, 15)
        self.exempt = frozenset(ticker.strip().upper() for ticker in
                                env.get("RESEARCH_OFF_HOURS_EXEMPT_TICKERS", DEFAULT_EXEMPT_TICKERS).split(",") if ticker.strip())
        self.clock = clock
        self.events = events
        self.lock = threading.Lock()
        self.checked = None
        self.current = (False, "starting", frozenset())

    def schedule(self):
        if self.events is not None:
            return self.events
        try:
            return release_watch.load_schedule()
        except Exception:
            return []

    def state(self):
        """(off_hours, reason, earnings tickers), recomputed at most every RECHECK_SECONDS."""
        now = self.clock()
        with self.lock:
            if self.checked is None or abs(now - self.checked) >= RECHECK_SECONDS:
                try:
                    self.current = decide(now, self.schedule(), self.enabled)
                except Exception:
                    self.current = (False, "error", frozenset())
                self.checked = now
            return self.current

    def off_hours(self):
        return self.state()[0]

    def slows(self, ticker):
        """True when this company's discovery may use the off-hours interval now."""
        off, _reason, tickers = self.state()
        ticker = str(ticker).upper()
        return off and ticker not in self.exempt and ticker not in tickers

    def idle(self, usual):
        """An idle wait: at least the off-hours idle seconds in off-hours, the usual wait otherwise."""
        return max(usual, self.idle_seconds) if self.off_hours() else usual

    def status(self):
        off, reason, tickers = self.state()
        return {"enabled": self.enabled, "offHours": off, "reason": reason, "earningsTickers": sorted(tickers),
                "standardPollSeconds": self.standard_seconds, "fastPollSeconds": self.fast_seconds or None,
                "bodyFetchIntervalSeconds": self.body_interval, "idleSeconds": self.idle_seconds,
                "liveRefreshSeconds": self.live_refresh_seconds, "exemptTickers": sorted(self.exempt)}
