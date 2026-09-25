"""Private X publisher comparison from the existing editorial queue; no API calls."""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from statistics import median
from x_api import TARGET_PATTERN


SOURCES = ("x-tipranks", "x-thefly", "x-wallstengine")
MAX_RESULTS = 10


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (TypeError, ValueError):
        return None


def report(db, now=None, hours=24, ticker=None):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    result = {"generatedAt": now.isoformat(), "windowHours": hours,
              "note": "Post-to-first-seen measures monitor discovery. Analyst publication time and missed posts require independent references.",
              "sources": {}}
    for source in SOURCES:
        rows = db.execute("""SELECT url,title,tickers_json,event_kind,published_at,observed_at
            FROM signal_events WHERE source_id=? ORDER BY observed_at""", (source,)).fetchall()
        fresh = []
        baseline = 0
        for row in rows:
            observed = parse_time(row["observed_at"])
            if not observed or observed < since:
                continue
            if not TARGET_PATTERN.search(row["title"]) or (
                    ticker and ticker not in json.loads(row["tickers_json"])):
                continue
            if row["event_kind"] == "baseline":
                baseline += 1
                continue
            if row["event_kind"] != "new":
                continue
            fresh.append((row, observed))
        lag_seconds = []
        tickers = Counter()
        samples = []
        for row, observed in fresh:
            matched = json.loads(row["tickers_json"])
            tickers.update(matched)
            published = parse_time(row["published_at"])
            seconds = (observed - published).total_seconds() if published and published <= observed else None
            if seconds is not None:
                lag_seconds.append(seconds)
            samples.append({
                "url": row["url"], "tickers": matched,
                "postedAt": published.isoformat() if published else None,
                "firstSeenAt": observed.isoformat(),
                "postToFirstSeenSeconds": seconds,
            })
        route = db.execute("SELECT checked_at,error,matched_items FROM signal_routes WHERE id=?", (source,)).fetchone()
        result["sources"][source] = {
            "baselinePosts": baseline,
            "newPosts": len(fresh),
            "targetMentions": sum(bool(TARGET_PATTERN.search(row["title"])) for row, _ in fresh),
            "medianArrivalSeconds": median(lag_seconds) if lag_seconds else None,
            "latestNewPostAt": max((observed.isoformat() for _, observed in fresh), default=None),
            "tickerCounts": dict(sorted(tickers.items())),
            "samples": samples,
            "lastCheckedAt": route["checked_at"] if route else None,
            "lastError": route["error"] if route else None,
            "lastSearchHitLimit": bool(route and route["matched_items"] >= MAX_RESULTS),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--hours", type=int, default=24)
    parser.add_argument("--ticker", help="Filter to one monitored ticker, including X-only pilots")
    args = parser.parse_args()
    if not 1 <= args.hours <= 168:
        parser.error("--hours must be between 1 and 168")
    with sqlite3.connect(f"file:{args.db}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        print(json.dumps(report(db, hours=args.hours, ticker=args.ticker), ensure_ascii=False))


if __name__ == "__main__":
    main()
