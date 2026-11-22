"""Stock splits for the monitor's own per-share figures (price-target notices).

The list is the app's manual split list, lib/research/stock-splits.json (date = first split-adjusted trading day, ET; ratio = new shares
per old share, 8 for Sandisk's 8-for-1 of 2026-11-20). A missing or damaged file means no known split: notices are then sent as read.
"""
from datetime import date, datetime, timedelta
from functools import lru_cache
import json
import math
from pathlib import Path
import re
from zoneinfo import ZoneInfo

SPLITS_FILE = Path(__file__).resolve().parents[2] / 'lib' / 'research' / 'stock-splits.json'
EASTERN = ZoneInfo('America/New_York')


@lru_cache(maxsize=1)
def known_splits(path=SPLITS_FILE):
    try:
        rows = json.loads(Path(path).read_text(encoding='utf-8')).get('splits', [])
    except (OSError, ValueError, AttributeError):
        return ()
    out = []
    for row in rows if isinstance(rows, list) else []:
        try:
            ticker, day, ratio = row['ticker'], date.fromisoformat(row['date']), float(row['ratio'])
        except (KeyError, TypeError, ValueError):
            continue
        if isinstance(ticker, str) and re.fullmatch(r'[A-Z][A-Z0-9.\-]{0,14}', ticker) and math.isfinite(ratio) and ratio > 0 and ratio != 1:
            out.append((ticker, day, ratio))
    return tuple(sorted(out, key=lambda x: x[1]))


def _et_day(value):
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return moment.astimezone(EASTERN).date() if moment.tzinfo else None


def pre_split_previous(ticker, firm, previous, latest, earlier=(), now=None, splits=None):
    """When a target published after a split still quotes the old target on the pre-split basis ("$1,400 -> $180"), the ratio of that
    split; otherwise None. Same rule as lib/research/price-target-splits.ts: within 60 days after the split, and never from the size of the
    change alone (a real 35% cut after a 2-for-1 stays a cut): the same firm's earlier target for the ticker (an item of `earlier`, with
    ticker, firm, latest and publishedAt) must have been published before the split at that old figure."""
    try:
        previous, latest = float(previous), float(latest)
    except (TypeError, ValueError):
        return None
    if not (previous > 0 and latest > 0 and math.isfinite(previous) and math.isfinite(latest)) or not isinstance(firm, str):
        return None
    today = (now or datetime.now(EASTERN)).astimezone(EASTERN).date()
    recent = [(day, ratio) for t, day, ratio in (known_splits() if splits is None else splits)
              if t == ticker and day <= today and today - day <= timedelta(days=60)]
    if not recent:
        return None
    day, ratio = recent[-1]
    name = firm.strip().lower()
    for item in earlier or ():
        if not isinstance(item, dict) or item.get('ticker') != ticker or not isinstance(item.get('firm'), str) or item['firm'].strip().lower() != name:
            continue
        published, old = _et_day(item.get('publishedAt')), item.get('latest')
        if published is None or published >= day or not isinstance(old, (int, float)) or isinstance(old, bool):
            continue
        if abs(old - previous) <= 0.005 * max(old, previous):
            return ratio
    return None
