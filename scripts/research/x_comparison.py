"""Private X publisher comparison from the existing editorial queue; no API calls."""

import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from statistics import median
from monitor import persisted_route_error_code
from signals import (SOURCES as SIGNAL_SOURCES, PRICE_TARGET_SOURCE_IDS, PRICE_TARGET_LABEL,
                     price_target_rows, price_target_observation)


SOURCES = PRICE_TARGET_SOURCE_IDS
APPROVED_SOURCES = {source["id"]: source for source in SIGNAL_SOURCES if source.get("format") == "x-api"}
SOURCE_LIMITS = {source["id"]: int(source.get("maxResults", 10)) for source in SIGNAL_SOURCES if source.get("format") == "x-api"}


def parse_time(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def report(db, now=None, hours=24, ticker=None):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    result = {"generatedAt": now.isoformat(), "windowHours": hours,
              "note": "Post-to-first-seen measures monitor discovery. Eligibility is not browser delivery. Analyst publication time and missed posts require independent references.",
              "sources": {}}
    rows_by_source = {source: [] for source in SOURCES}
    for row in price_target_rows(db, since, now, "observed_at"):
        rows_by_source[row["source_id"]].append(row)
    for source in SOURCES:
        rows = rows_by_source[source]
        fresh = []
        baseline = 0
        changed = 0
        reasons = Counter()
        eligible = 0
        for row in rows:
            observed = parse_time(row["observed_at"])
            if not observed or not since <= observed <= now:
                continue
            text = row["document_text"] or row["title"]
            try:
                matched = json.loads(row["tickers_json"])
            except (TypeError, ValueError):
                matched = []
            if not isinstance(matched, list):
                matched = []
            if not PRICE_TARGET_LABEL.search(text) or (ticker and ticker not in matched):
                continue
            item, reason = price_target_observation(row, APPROVED_SOURCES.get(source), now)
            if item:
                eligible += 1
            else:
                reasons[reason] += 1
            if row["event_kind"] == "baseline":
                baseline += 1
                continue
            if row["event_kind"] == "changed":
                changed += 1
            if row["event_kind"] != "new":
                continue
            fresh.append((row, observed, matched, reason))
        lag_seconds = []
        tickers = Counter()
        samples = []
        for row, observed, matched, reason in fresh:
            tickers.update(item for item in matched if isinstance(item, str))
            published = parse_time(row["published_at"])
            seconds = (observed - published).total_seconds() if published and published <= observed else None
            if seconds is not None:
                lag_seconds.append(seconds)
            samples.append({
                "url": row["url"], "tickers": matched,
                "postedAt": published.isoformat() if published else None,
                "firstSeenAt": observed.isoformat(),
                "postToFirstSeenSeconds": seconds,
                "publicationStatus": reason,
            })
        route = db.execute("SELECT checked_at,error,matched_items FROM signal_routes WHERE id=?", (source,)).fetchone()
        result["sources"][source] = {
            "baselinePosts": baseline,
            "newPosts": len(fresh),
            "targetMentions": len(fresh),
            "changedPosts": changed,
            "publication": {"eligiblePosts": eligible, "withheldPosts": sum(reasons.values()),
                            "withheldReasons": dict(sorted(reasons.items()))},
            "medianArrivalSeconds": median(lag_seconds) if lag_seconds else None,
            "latestNewPostAt": max((observed.isoformat() for _, observed, _, _ in fresh), default=None),
            "tickerCounts": dict(sorted(tickers.items())),
            "samples": samples,
            "lastCheckedAt": route["checked_at"] if route else None,
            "lastError": persisted_route_error_code(route["error"]) if route else None,
            "lastSearchHitLimit": bool(route and route["matched_items"] >= SOURCE_LIMITS.get(source, 10)),
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
