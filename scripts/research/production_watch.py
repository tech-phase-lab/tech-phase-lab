"""Daily production watch (owner, Nov 20). Read-only.

Requests the public production pages' APIs on techphase.app and the research monitor's /health once, and checks their content,
not only the status: non-empty answers, fresh timestamps, no snapshot fallback or diagnostic error mode, and response times.
It prints ONE line of JSON of true/false values, counts, HTTP statuses and milliseconds (never titles, URLs, figures or any
environment value). Run on its own it exits 1 when any check fails; in the daily cron (daily_checks.py, Nov 23) the result goes to
the monitor's incident alerts instead and the run exits 0. It writes nothing and sends no credential: every request is the same
anonymous GET a visitor's browser makes.

    PRODUCTION_WATCH=true python3 scripts/research/production_watch.py

It runs from the earnings self-check's cron container (scripts/research/daily_checks.py), which already has
EARNINGS_SELFCHECK=true; that flag enables it too. PRODUCTION_WATCH=false turns it off. Without either it prints DISABLED and
exits 0. PRODUCTION_WATCH_SITE_URL and PRODUCTION_WATCH_MONITOR_URL override the two hosts (for a local check only).

Nov 27 (HQ): one check is not anonymous. `proCompare` reads the PRO-only Stock Comparison of six fixed large-cap pairs from the site's
internal check route (app/api/research/internal/pro-check, read-only, 404 without the token) with `Authorization: Bearer
<COMPARISON_WARM_SECRET>`, the secret the monitor already sends to the comparison's warm job. It passes when every company has all seven
factors and no invalid figure. The secret is sent only to the site host over https (or a local http host) and never printed. Without it
the check is skipped (shown as "skipped":"no-token", not a failure). Its per-company detail is a second line:
{"check":"pro-compare","companies":{"NVDA":{"missing":[],"invalid":[],"strengths":3,"weaknesses":1},...}} (factor ids, field codes and counts).
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

SITE = "https://techphase.app"
MONITOR = "https://research-monitor-staging-research-staging.up.railway.app"
USER_AGENT = "TechPhaseProductionWatch/1.0"
MAX_BYTES = 6_000_000
HOUR = 3600
ET = ZoneInfo("America/New_York")
NEWS_TRADING_HOURS = 72
PRO_COMPARE_PAIRS = (("BRK-B", "ORCL"), ("NVDA", "AMD"), ("JPM", "GS"), ("PG", "KO"), ("MET", "PRU"), ("AAPL", "MSFT"))
PRO_FACTORS = ("financial", "profitability", "valuation", "stability", "momentum", "growth", "cash")
PRO_COMPARE_LIMIT = 60


def enabled(env=None):
    env = os.environ if env is None else env
    flag = env.get("PRODUCTION_WATCH", "").strip().lower()
    if flag == "false":
        return False
    return flag == "true" or env.get("EARNINGS_SELFCHECK") == "true"


def parse_time(value):
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def newest_age_seconds(values, now):
    times = [t for t in (parse_time(v) for v in values) if t is not None]
    return round((now - max(times)).total_seconds()) if times else None


def fresh(age, window):
    return age is not None and -300 <= age <= window


def request(url, timeout, token=None):
    """(status, payload or None, milliseconds, error code or None). Error codes are fixed words, never exception text."""
    started = time.monotonic()
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    try:
        with urlopen(Request(url, headers=headers), timeout=timeout) as response:
            body = response.read(MAX_BYTES + 1)
            status = response.status
    except HTTPError as exc:
        return exc.code, None, round((time.monotonic() - started) * 1000), "http-error"
    except (TimeoutError, URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        code = "timeout" if isinstance(reason, TimeoutError) or "timed out" in str(reason) else "unreachable"
        return None, None, round((time.monotonic() - started) * 1000), code
    ms = round((time.monotonic() - started) * 1000)
    if len(body) > MAX_BYTES:
        return status, None, ms, "oversized"
    try:
        return status, json.loads(body), ms, None
    except (UnicodeDecodeError, json.JSONDecodeError):
        return status, None, ms, "invalid-json"


# Each validator returns a dict of booleans and counts; "valid" is the content verdict.

def check_company_wire(data, now):
    """Home LIVE band (company headlines, last 24 hours)."""
    items = [item for group in (data.get("items") or {}).values() if isinstance(group, list) for item in group]
    age = newest_age_seconds([item.get("publishedAt") for item in items], now)
    titled = sum(1 for item in items if item.get("titleJa") or item.get("titleEn"))
    return {"valid": data.get("ok") is True and len(items) >= 10 and titled == len(items) and fresh(age, 12 * HOUR),
            "items": len(items), "newestAgeSeconds": age}


def market_holidays():
    """NYSE holidays (the calendar the price alerts use); empty if it cannot be loaded, so only weekends are skipped."""
    try:
        import price_alerts
        return price_alerts.HOLIDAYS
    except Exception:
        return frozenset()


def trading_day_seconds(start, end, holidays=None):
    """Seconds between two instants that fall on U.S. trading days (New York weekdays that are not NYSE holidays)."""
    holidays = market_holidays() if holidays is None else holidays
    if start >= end:
        return 0
    start, end = start.astimezone(ET), end.astimezone(ET)
    total, day = 0.0, start.date()
    while day <= end.date():
        if day.weekday() < 5 and day.isoformat() not in holidays:
            begin = datetime(day.year, day.month, day.day, tzinfo=ET)
            finish = begin + timedelta(days=1)
            total += max(0.0, (min(finish, end) - max(begin, start)).total_seconds())
        day += timedelta(days=1)
    return round(total)


def check_news(data, now, holidays=None):
    """Home news list: the public (FREE) view of /api/research/news."""
    lists = ("items", "officialUpdates", "analystUpdates", "marketUpdates", "resultBriefs")
    entries = [entry for key in lists for entry in (data.get(key) or []) if isinstance(entry, dict)]
    times = [t for t in (parse_time(entry.get("observedAt") or entry.get("publishedAt")) for entry in entries) if t is not None]
    age = round((now - max(times)).total_seconds()) if times else None
    # Nov 23 (owner): weekends and NYSE holidays have no economic releases or results, so only trading-day time counts.
    # The newest entry may be up to three trading days old (a Wednesday-evening entry still passes on Sunday night).
    trading_age = trading_day_seconds(max(times), now, holidays) if times else None
    return {"valid": data.get("ok") is True and len(entries) >= 1 and age is not None and age >= -300
                     and trading_age <= NEWS_TRADING_HOURS * HOUR,
            "entries": len(entries), "newestAgeSeconds": age, "tradingAgeSeconds": trading_age}


def check_live(data, now):
    """The operator intake page's live monitor answer: never the bundled snapshot fallback."""
    snapshot = data.get("snapshot") or {}
    monitor = data.get("monitor") or {}
    generated = newest_age_seconds([snapshot.get("generatedAt")], now)
    cycle = monitor.get("lastCycleAgeSeconds")
    sources = len(snapshot.get("sources") or [])
    return {"valid": (data.get("ok") is True and data.get("mode") == "automatic" and not data.get("error")
                      and not data.get("diagnosticReason") and sources >= 100 and fresh(generated, 600)
                      and isinstance(cycle, (int, float)) and cycle <= 600),
            "automatic": data.get("mode") == "automatic", "fallback": data.get("mode") == "snapshot",
            "sources": sources, "snapshotAgeSeconds": generated,
            "cycleAgeSeconds": round(cycle) if isinstance(cycle, (int, float)) else None}


def check_freshness(data, now):
    """The few bytes every page asks for: whether new information is still arriving."""
    age = newest_age_seconds([data.get("lastCycleAt")], now)
    return {"valid": data.get("ok") is True and data.get("status") == "ok" and fresh(age, 600),
            "statusOk": data.get("status") == "ok", "cycleAgeSeconds": age}


def check_earnings(data, now):
    """Calendar earnings results (the recent window)."""
    briefs = [brief for brief in (data.get("resultBriefs") or []) if isinstance(brief, dict)]
    age = newest_age_seconds([brief.get("publicAt") or brief.get("observedAt") or brief.get("publishedAt") for brief in briefs], now)
    with_facts = sum(1 for brief in briefs if brief.get("facts"))
    # Between reporting seasons a few weeks can pass without results.
    return {"valid": data.get("ok") is True and data.get("complete") is True and len(briefs) >= 1 and with_facts >= 1
                     and fresh(age, 30 * 24 * HOUR),
            "complete": data.get("complete") is True, "results": len(briefs), "withFacts": with_facts, "newestAgeSeconds": age}


def check_compare_search(data, now):
    """Stock Comparison search (scope=compare) finds a tracked company."""
    results = [row for row in (data.get("results") or []) if isinstance(row, dict)]
    found = any(row.get("ticker") == "NVDA" for row in results)
    return {"valid": data.get("ok") is True and found, "results": len(results), "found": found}


def check_monitor_health(data, now):
    """The research monitor itself (the public /health of the production monitor)."""
    health = data.get("health") or {}
    age = newest_age_seconds([data.get("lastCycleAt")], now)
    issues = health.get("issues") if isinstance(health.get("issues"), list) else []
    return {"valid": data.get("ready") is True and health.get("status") == "ready" and not issues and fresh(age, 600),
            "ready": data.get("ready") is True, "statusReady": health.get("status") == "ready",
            "issues": len(issues), "cycleAgeSeconds": age}


def check_pro_compare(data, now):
    """The PRO-only Stock Comparison of the fixed pairs (site's internal check route): every pair built, every company with all seven
    factors and no invalid figure. "detail" (factor ids, field codes, counts) goes to its own log line, not into the summary."""
    pairs = [pair for pair in (data.get("pairs") or []) if isinstance(pair, dict)]
    by_tickers = {tuple(pair.get("tickers") or ()): pair for pair in pairs}
    detail, problems, missing_total, invalid_total, failed_pairs = {}, [], 0, 0, []
    for tickers in PRO_COMPARE_PAIRS:
        pair = by_tickers.get(tickers)
        if not pair or pair.get("ok") is not True:
            failed_pairs.append("/".join(tickers))
            problems.append("/".join(tickers) + "=" + str((pair or {}).get("error") or "absent"))
            continue
        companies = {c.get("ticker"): c for c in (pair.get("companies") or []) if isinstance(c, dict)}
        for ticker in tickers:
            company = companies.get(ticker)
            if not company:
                failed_pairs.append("/".join(tickers))
                problems.append(ticker + "=absent")
                continue
            factors = company.get("factors") or {}
            present = [f for f in (factors.get("present") or []) if f in PRO_FACTORS]
            missing = [f for f in PRO_FACTORS if f not in present]
            invalid = [str(code) for code in (company.get("invalid") or [])][:10]
            if company.get("status") != "ready" and not any(code.startswith("status:") for code in invalid):
                invalid.append("status:" + str(company.get("status")))
            missing_total += len(missing)
            invalid_total += len(invalid)
            if missing:
                problems.append(ticker + ":missing=" + ",".join(missing))
            if invalid:
                problems.append(ticker + ":invalid=" + ",".join(invalid))
            detail[ticker] = {"missing": missing, "invalid": invalid, "strengths": len(company.get("strengths") or []),
                              "weaknesses": len(company.get("weaknesses") or [])}
    complete = len(detail) == sum(len(t) for t in PRO_COMPARE_PAIRS)
    return {"valid": data.get("ok") is True and complete and not failed_pairs and missing_total == 0 and invalid_total == 0,
            "pairs": len(PRO_COMPARE_PAIRS) - len(set(failed_pairs)), "companies": len(detail), "missingFactors": missing_total,
            "invalidNumbers": invalid_total, "problems": ";".join(problems)[:600], "detail": detail}


def token_allowed(site):
    """The secret goes only to the site over https, or to a local host for a local check."""
    parts = urlsplit(site)
    return parts.scheme == "https" or (parts.scheme == "http" and parts.hostname in ("localhost", "127.0.0.1"))


def checks(site=SITE, monitor=MONITOR):
    """(name, url, validator, response-time limit in seconds)."""
    return [
        ("homeBand", f"{site}/api/research/company-wire", check_company_wire, 5),
        ("news", f"{site}/api/research/news", check_news, 5),
        ("live", f"{site}/api/research/live", check_live, 8),
        ("freshness", f"{site}/api/research/freshness", check_freshness, 8),
        ("earningsResults", f"{site}/api/research/earnings-results?month=recent", check_earnings, 5),
        ("compareSearch", f"{site}/api/research/stocks?scope=compare&q=NVDA&limit=10", check_compare_search, 5),
        ("monitorHealth", f"{monitor}/health", check_monitor_health, 15),
    ]


def run(fetch=None, now=None, site=SITE, monitor=MONITOR, token=None):
    fetch = fetch or request  # looked up at call time
    results, details = {}, {}
    plan = [(name, url, validator, limit, None) for name, url, validator, limit in checks(site, monitor)]
    if token and token_allowed(site):
        plan.append(("proCompare", f"{site}/api/research/internal/pro-check", check_pro_compare, PRO_COMPARE_LIMIT, token))
    else:
        results["proCompare"] = {"ok": True, "skipped": "no-token" if not token else "insecure-site"}
    for name, url, validator, limit, secret in plan:
        status, data, ms, error = fetch(url, limit + 10, secret) if secret else fetch(url, limit + 10)
        result = {"status": status, "ms": ms, "fast": ms <= limit * 1000}
        if error:
            result["error"] = error
        if isinstance(data, dict):
            try:
                verdict = validator(data, now or datetime.now(timezone.utc))
                if "detail" in verdict:
                    details[name] = verdict.pop("detail")
                result.update(verdict)
            except Exception:
                result["valid"] = False
                result["error"] = "unexpected-shape"
        else:
            result["valid"] = False
        result["ok"] = status == 200 and result["valid"] and result["fast"] and not error
        results[name] = result
    failed = [name for name, result in results.items() if not result["ok"]]
    return {"ok": not failed, "failed": failed, "checks": results, "details": details,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def check():
    """Run and print the one line. None when disabled, otherwise the names of the failed checks ([] when all passed)."""
    if not enabled():
        print("DISABLED: set PRODUCTION_WATCH=true (or EARNINGS_SELFCHECK=true) to run the production watch")
        return None
    site = os.environ.get("PRODUCTION_WATCH_SITE_URL", "").strip().rstrip("/") or SITE
    monitor = os.environ.get("PRODUCTION_WATCH_MONITOR_URL", "").strip().rstrip("/") or MONITOR
    token = os.environ.get("COMPARISON_WARM_SECRET", "").strip()
    summary = run(site=site, monitor=monitor, token=token if len(token) >= 32 else None)
    details = summary.pop("details")
    print(json.dumps({"check": "production-watch", **summary}, separators=(",", ":")), flush=True)
    if "proCompare" in details:
        print(json.dumps({"check": "pro-compare", "ok": summary["checks"]["proCompare"]["ok"], "companies": details["proCompare"]},
                         separators=(",", ":")), flush=True)
    return list(summary["failed"])


def main():
    return 1 if check() else 0


if __name__ == "__main__":
    sys.exit(main())
