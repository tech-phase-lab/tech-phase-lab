"""Is a stored release new enough to be announced as an earnings result? (Nov 23 incidents)

Nov 23: a company's new source route (COHR's GlobeNewswire feed, LRCX's IR-top PDFs) listed releases that were weeks or months
old. The first time the monitor saw them it stored them "now", and the earnings lanes took that first-seen time for the release
time: three past COHR quarters went to phones as new results, and LRCX's October results came back as a new release.

The rule here is evidence only: a release counts as recent unless something the source itself states says it is older than
MAX_AGE (the SEC's acceptance time, the date the feed or page gives, or a date written into the release's own address).
A missing date never makes a release stale on its own; the first-seen gate (release_events, baselined per source) covers that.
"""
import re
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlsplit

MAX_AGE = timedelta(hours=36)
# A calendar date can be as late as 23:59 at UTC-12 of that day.
DATE_SLACK = timedelta(days=1, hours=12)
URL_DATE = re.compile(r'(?<!\d)(20\d\d)[-/_](0[1-9]|1[0-2])[-/_](0[1-9]|[12]\d|3[01])(?!\d)')


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else None


def url_date(url):
    """A date written into the release's own path (GlobeNewswire /news-release/2026/11/04/..., Lam's 2026-10-21-....pdf)."""
    try:
        path = urlsplit(str(url)).path
    except ValueError:
        return None
    match = URL_DATE.search(path)
    if not match:
        return None
    try:
        return date(int(match[1]), int(match[2]), int(match[3]))
    except ValueError:
        return None


def _calendar_date(value):
    if isinstance(value, str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
    return None


def latest_release_instant(*, url=None, published_on=None, sec_acceptance=None):
    """The latest moment the release can have been published, from the source's own evidence; None when nothing says."""
    candidates = []
    accepted = instant(sec_acceptance) if sec_acceptance else None
    if accepted is not None:
        candidates.append(accepted)
    for day in (_calendar_date(published_on), url_date(url) if url else None):
        if day is not None:
            candidates.append(datetime(day.year, day.month, day.day, tzinfo=timezone.utc) + DATE_SLACK)
    # Several pieces of evidence: the earliest one decides (a re-posted page keeps its original date in the address).
    return min(candidates) if candidates else None


def is_stale(reference, *, url=None, published_on=None, sec_acceptance=None, max_age=MAX_AGE):
    latest = latest_release_instant(url=url, published_on=published_on, sec_acceptance=sec_acceptance)
    return latest is not None and latest < reference - max_age


def row_value(row, key):
    try:
        return row[key]
    except (IndexError, KeyError):
        return None


def row_is_stale(row, reference, max_age=MAX_AGE):
    """A sources row (sqlite3.Row or dict) whose own dates put it more than max_age before reference."""
    return is_stale(reference, url=row_value(row, 'url'), published_on=row_value(row, 'published_on'),
                    sec_acceptance=row_value(row, 'sec_acceptance_datetime'), max_age=max_age)
