"""Compare private earnings Posts with verified, explicitly timed official releases.

References are JSON records with ticker, releaseAt (ISO timestamp with timezone),
and officialUrl. A filing date or a scheduled earnings time is not a release time.
"""

import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
from statistics import median
from x_api import EARNINGS_PATTERN, EARNINGS_PREVIEW_PATTERN


SOURCES = ("x-tipranks", "x-thefly", "x-wallstengine")


def parse_time(value):
    try:
        value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value.astimezone(timezone.utc) if value.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def report(db, references=(), now=None, hours=24):
    now = now or datetime.now(timezone.utc)
    since = now - timedelta(hours=hours)
    verified = []
    for reference in references:
        if not isinstance(reference, dict):
            continue
        release = parse_time(reference.get("releaseAt"))
        if (release and isinstance(reference.get("ticker"), str) and
                str(reference.get("officialUrl", "")).startswith("https://")):
            verified.append((reference, release))

    sources = {}
    for source in SOURCES:
        rows = db.execute("""SELECT url,title,tickers_json,event_kind,published_at,observed_at
            FROM signal_events WHERE source_id=? ORDER BY observed_at""", (source,)).fetchall()
        baselines = 0
        samples = []
        for row in rows:
            observed = parse_time(row["observed_at"])
            if (not observed or observed < since or
                    not EARNINGS_PATTERN.search(row["title"]) or
                    EARNINGS_PREVIEW_PATTERN.search(row["title"])):
                continue
            if row["event_kind"] == "baseline":
                baselines += 1
                continue
            if row["event_kind"] != "new":
                continue
            posted = parse_time(row["published_at"])
            tickers = json.loads(row["tickers_json"])
            candidate = max(((ref, release) for ref, release in verified
                             if ref["ticker"] in tickers and posted and
                             release <= posted < release + timedelta(hours=24)),
                            key=lambda entry: entry[1], default=None)
            samples.append({
                "url": row["url"], "tickers": tickers,
                "postedAt": posted.isoformat() if posted else None,
                "firstSeenAt": observed.isoformat(),
                "postToFirstSeenSeconds": (observed - posted).total_seconds()
                if posted and observed >= posted else None,
                "officialUrl": candidate[0]["officialUrl"] if candidate else None,
                "releaseAt": candidate[1].isoformat() if candidate else None,
                "releaseToPostSeconds": (posted - candidate[1]).total_seconds()
                if candidate else None,
            })
        detected = [sample["postToFirstSeenSeconds"] for sample in samples
                    if sample["postToFirstSeenSeconds"] is not None]
        sources[source] = {
            "baselinePosts": baselines,
            "newPosts": len(samples),
            "verifiedReleaseMatches": sum(item["releaseAt"] is not None for item in samples),
            "medianPostToFirstSeenSeconds": median(detected) if detected else None,
            "samples": samples,
        }
    return {"generatedAt": now.isoformat(), "windowHours": hours, "sources": sources,
            "note": "Release-to-Post requires independently verified official releaseAt; no timestamp is inferred."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--references", type=Path, help="JSON list of verified official release timestamps")
    parser.add_argument("--hours", type=int, default=24)
    args = parser.parse_args()
    if not 1 <= args.hours <= 168:
        parser.error("--hours must be between 1 and 168")
    references = json.loads(args.references.read_text()) if args.references else []
    if not isinstance(references, list):
        parser.error("--references must contain a JSON list")
    with sqlite3.connect(f"file:{args.db}?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        print(json.dumps(report(db, references, hours=args.hours), ensure_ascii=False))


if __name__ == "__main__":
    main()
