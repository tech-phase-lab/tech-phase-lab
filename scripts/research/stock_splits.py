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


def pre_split_previous(ticker, previous, latest, now=None, splits=None):
    """When a target published after a split still quotes the old target on the pre-split basis ("$1,400 -> $175"), the ratio of that
    split; otherwise None. Same rule as lib/research/price-target-splits.ts: within 60 days of the split, and the two figures nearer the
    split ratio apart than equal."""
    try:
        previous, latest = float(previous), float(latest)
    except (TypeError, ValueError):
        return None
    if not (previous > 0 and latest > 0 and math.isfinite(previous) and math.isfinite(latest)):
        return None
    today = (now or datetime.now(EASTERN)).astimezone(EASTERN).date()
    recent = [ratio for t, day, ratio in (known_splits() if splits is None else splits)
              if t == ticker and day <= today and today - day <= timedelta(days=60)]
    if not recent:
        return None
    ratio, move = recent[-1], math.log(previous / latest)
    return ratio if abs(move - math.log(ratio)) < abs(move) else None
