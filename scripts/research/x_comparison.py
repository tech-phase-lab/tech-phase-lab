"""Private X publisher comparison from the existing editorial queue; no API calls."""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import re
import sqlite3
from statistics import median


SOURCES = ("x-tipranks", "x-thefly")
TARGET_PATTERN = re.compile(r"\b(?:price[ -]?target|target price|pt (?:raised|cut|lowered|hiked))\b", re.I)
MAX_RESULTS = 10


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (TypeError, ValueError):
        return None


def report(db, now=None, hours=24):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    result = {"generatedAt": now.isoformat(), "windowHours": hours,
              "note": "Missed posts require an independent reference; search results alone cannot prove complete coverage.",
              "sources": {}}
    for source in SOURCES:
        rows = db.execute("""SELECT title,tickers_json,event_kind,published_at,observed_at
            FROM signal_events WHERE source_id=? ORDER BY observed_at""", (source,)).fetchall()
        fresh = []
        baseline = 0
        for row in rows:
            observed = parse_time(row["observed_at"])
            if not observed or observed < since:
                continue
            if row["event_kind"] == "baseline":
                baseline += 1
                continue
            if row["event_kind"] != "new":
                continue
            fresh.append((row, observed))
        lag_seconds = []
        tickers = Counter()
        for row, observed in fresh:
            tickers.update(json.loads(row["tickers_json"]))
            published = parse_time(row["published_at"])
            if published and published <= observed:
                lag_seconds.append((observed - published).total_seconds())
        route = db.execute("SELECT checked_at,error,matched_items FROM signal_routes WHERE id=?", (source,)).fetchone()
        result["sources"][source] = {
            "baselinePosts": baseline,
            "newPosts": len(fresh),
            "targetMentions": sum(bool(TARGET_PATTERN.search(row["title"])) for row, _ in fresh),
            "medianArrivalSeconds": median(lag_seconds) if lag_seconds else None,
            "latestNewPostAt": max((observed.isoformat() for _, observed in fresh), default=None),
            "tickerCounts": dict(sorted(tickers.items())),
            "lastCheckedAt": route["checked_at"] if route else None,
            "lastError": route["error"] if route else None,
            "lastSearchHitLimit": bool(route and route["matched_items"] >= MAX_RESULTS),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--hours", type=int, default=24)
    args = parser.parse_args()
    if not 1 <= args.hours <= 168:
        parser.error("--hours must be between 1 and 168")
    with sqlite3.connect(f"file:{args.db}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        print(json.dumps(report(db, hours=args.hours), ensure_ascii=False))


if __name__ == "__main__":
    main()
