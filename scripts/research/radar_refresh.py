"""Twice a day, ask the site to calculate every Financial Radar company again (owner decision, Nov 15).

The site (app/api/research/radar/refresh) reads each company's SEC filing, at most four SEC requests a second, and saves the result; a
failed calculation is never saved, so the last good value stays. One call does about thirty seconds of work and answers a cursor; this
lane follows the cursor until the whole list is done. The address is the comparison warm URL's host with the refresh path, and the
secret is the same COMPARISON_WARM_SECRET, so no new setting exists: off unless the warm settings are set. The secret is sent only as the
Authorization header and never printed or kept in the result.

Fixed times, Japan time (JST, no daylight saving):
- 08:00 JST = 18:00 New York in winter (19:00 in summer): after EDGAR stops accepting the day's filings (17:30 New York), so the
  10-Q/10-K filed with after-the-close earnings are in the SEC's company facts.
- 22:30 JST = 08:30 New York in winter (09:30 in summer): after the morning's pre-market earnings filings, before or at the US open.
A slot missed by more than three hours (the monitor was down) is skipped; the next slot comes at most fourteen and a half hours later.
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

import comparison_warm

PATH = "/api/research/radar/refresh"
JST = timezone(timedelta(hours=9))
SLOTS_JST = ((8, 0), (22, 30))
GRACE = timedelta(hours=3)
MAX_CALLS = 30          # about 54 companies take two to four calls; this only stops a cursor that never ends
MAX_ATTEMPTS = 3        # per slot, when a run ends in an error
RETRY_AFTER = 600       # seconds between those attempts
SHOWN_FAILURES = 20
SHOWN_STALE = 60       # every radar company fits; tickers and codes only ("NBIS:behind")


def config(env=None):
    settings = comparison_warm.config(env)
    if not settings:
        return None
    url, secret = settings
    return f"https://{urlsplit(url).netloc}{PATH}", secret


def missing_settings(env=None):
    """The names of the settings this lane still needs (never their values)."""
    env = os.environ if env is None else env
    missing = [name for name in ("COMPARISON_WARM_URL", "COMPARISON_WARM_SECRET") if not (env.get(name) or "").strip()]
    if not missing and not comparison_warm.config(env):
        missing = ["COMPARISON_WARM_URL(https)", "COMPARISON_WARM_SECRET(32+)"]
    return missing


def _slots_around(now):
    day = now.astimezone(JST).date()
    for offset in (-1, 0, 1):
        current = day + timedelta(days=offset)
        for hour, minute in SLOTS_JST:
            yield datetime(current.year, current.month, current.day, hour, minute, tzinfo=JST).astimezone(timezone.utc)


def latest_slot(now):
    return max(slot for slot in _slots_around(now) if slot <= now)


def next_slot(now):
    return min(slot for slot in _slots_around(now) if slot > now)


class Schedule:
    """Which slot is due: the latest one, unless it is done, older than the grace, or tried MAX_ATTEMPTS times already."""

    def __init__(self):
        self.done_slot = None
        self.attempt_slot = None
        self.attempts = 0

    def due(self, now):
        slot = latest_slot(now)
        if slot == self.done_slot or now - slot > GRACE:
            return None
        return slot

    def record(self, slot, result):
        if slot != self.attempt_slot:
            self.attempt_slot, self.attempts = slot, 0
        self.attempts += 1
        if result.get("status") != "error" or self.attempts >= MAX_ATTEMPTS:
            self.done_slot = slot


def _call(url, secret, cursor, opener):
    target = url if not cursor else f"{url}?cursor={int(cursor)}"
    request = urllib.request.Request(target, data=b"", method="POST",
                                     headers={"Authorization": f"Bearer {secret}", "User-Agent": "TechPhaseMonitor/1.0"})
    with opener(request, timeout=75) as response:
        return json.loads(response.read(65536) or b"{}")


def run_once(env=None, opener=urllib.request.urlopen, should_stop=lambda: False):
    """One whole refresh: calls the site until the list is done. Counts and genre:ticker names only."""
    settings = config(env)
    if not settings:
        return {"status": "off"}
    url, secret = settings
    cursor, calls, refreshed, live, failures, stale, total = 0, 0, 0, 0, [], [], None
    try:
        while calls < MAX_CALLS and not should_stop():
            body = _call(url, secret, cursor, opener)
            calls += 1
            if not body.get("ok"):
                return {"status": "error", "error": "refused", "calls": calls, "refreshed": refreshed, "failed": len(failures)}
            if body.get("storage") is False:
                return {"status": "no-storage", "calls": calls}
            refreshed += int(body.get("refreshed") or 0)
            live += int(body.get("live") or 0)
            failures += [str(item)[:40] for item in body.get("failures") or []]
            # companies whose newest filed period the radar still lacks, more than two days after filing (Nov 18)
            stale += [str(item)[:40] for item in body.get("stale") or [] if str(item)[:40] not in stale]
            total = body.get("total")
            following = body.get("next")
            if body.get("done") or following is None:
                break
            if not isinstance(following, int) or following <= cursor:
                return {"status": "error", "error": "bad-cursor", "calls": calls, "refreshed": refreshed, "failed": len(failures)}
            cursor = following
        else:
            return {"status": "error", "error": "stopped" if should_stop() else "too-many-calls", "calls": calls,
                    "refreshed": refreshed, "failed": len(failures)}
    except Exception as exc:  # the schedule tries again in ten minutes
        return {"status": "error", "error": type(exc).__name__, "calls": calls, "refreshed": refreshed, "failed": len(failures)}
    return {"status": "ok" if not failures else "partial", "calls": calls, "total": total, "refreshed": refreshed, "live": live,
            "failed": len(failures), "failures": failures[:SHOWN_FAILURES], "stale": stale[:SHOWN_STALE]}


def iso(moment):
    return moment.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
