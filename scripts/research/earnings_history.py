"""Every stored earnings result of a requested range, for the calendar's 「発表済みの結果」 (owner, Nov 18).

The news feed keeps results for about seven days (and 20 rows), so a month picked in the results view (October) showed nothing
although the monitor still holds every flash. This reads the same stores for an explicit, bounded range: the issuer-table
flashes (issuer_result_publications), the companies' own "announced" lines (earnings_announcements) and the verified
fallbacks (issuer_result_fallbacks), and each company's previous quarterly release stored in the background from SEC
(earnings_prior_releases, earnings_prior_backfill.py). The display floor of the live feed applies per result: an X post is never shown, a
result needs MIN_DISPLAY_FACTS figures, and an "announced" line gives way to figures of the same release.

Read only: the database is opened in read-only mode and nothing is written.
"""
import re
import sqlite3
from datetime import datetime, timedelta, timezone

import earnings_announce
import earnings_prior_backfill
import issuer_result_flash
import market_results
import result_fallback

MAX_DAYS = 95          # at most about one quarter per request (three months and a day on each side)
LIMIT = 400            # rows per answer (50 companies, a few results each)
SAME_EVENT = timedelta(hours=36)
DATE = re.compile(r'(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])')


def parse_range(query):
    """{'from': ['2026-10-01'], 'to': ['2026-10-31']} -> (start, end) with end exclusive (the day after 'to'). Raises ValueError."""
    if set(query) != {'from', 'to'} or any(len(query[key]) != 1 for key in ('from', 'to')):
        raise ValueError('invalid-range')
    days = []
    for key in ('from', 'to'):
        if not DATE.fullmatch(query[key][0]):
            raise ValueError('invalid-range')
        days.append(datetime.strptime(query[key][0], '%Y-%m-%d').replace(tzinfo=timezone.utc))
    start, end = days[0], days[1] + timedelta(days=1)
    if end <= start or end - start > timedelta(days=MAX_DAYS):
        raise ValueError('invalid-range')
    return start, end


def connect_read_only(path):
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def floor(items):
    """market_results.display_floor applied to each result on its own (one company can report twice in a range)."""
    events = []
    for item in sorted(items, key=lambda i: issuer_result_flash.instant(i.get('publishedAt')) or datetime.min.replace(tzinfo=timezone.utc)):
        at = issuer_result_flash.instant(item.get('publishedAt'))
        group = next((g for g in events if g[0]['ticker'] == item['ticker'] and at is not None
                      and abs(issuer_result_flash.instant(g[0]['publishedAt']) - at) <= SAME_EVENT), None)
        if group is None:
            events.append([item])
        else:
            group.append(item)
    return [item for group in events for item in market_results.display_floor(group)]


def results(db, start, end):
    """Stored earnings results observed in [start, end), newest first, in the shape of the news feed's resultBriefs."""
    since, until = start.isoformat(), end.isoformat()
    items = []
    # earnings_prior_backfill: each company's previous quarterly release read from SEC in the background (会社予想 / 上方修正, Nov 28)
    for read in (issuer_result_flash.public_feed, earnings_announce.public_feed, result_fallback.public_feed, earnings_prior_backfill.public_feed):
        try:
            items.extend(read(db, since, until))
        except sqlite3.Error:
            pass  # one store that is missing or busy never hides the others
    items = [item for item in items if item.get('kind') == 'earnings']
    items = floor(market_results.latest_source_posts(items))
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    items.sort(key=lambda item: issuer_result_flash.instant(item.get('publishedAt')) or epoch, reverse=True)
    return items[:LIMIT]


def answer(path, query):
    start, end = parse_range(query)
    db = connect_read_only(path)
    try:
        items = results(db, start, end)
    finally:
        db.close()
    return {'ok': True, 'from': start.date().isoformat(), 'to': (end - timedelta(days=1)).date().isoformat(), 'resultBriefs': items}
