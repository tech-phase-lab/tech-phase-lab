"""Earnings-date watch (owner, Nov 12): read each company's own date notice and compare it with the calendar.

The calendar (lib/research/calendar.ts, release_schedule.json) is written by hand. A wrong or missing entry means the
result watch starts at the wrong minute (Nebius, Nov 12: the calendar said 07:00 ET, the company said 08:00 ET).
This reads the company's date notice ("will release its third quarter 2026 financial results on Thursday, November 12, 2026 ...
conference call at 8:00 a.m. Eastern Time") from the pages the monitor has already stored, extracts the date and the call
time with fixed patterns, and reports one state per company for /health:

  ok            the calendar has this company on that day (and at that time when the notice gives one)
  differs       the calendar has the company on another day or at another time: a person must look
  missing       the calendar has no entry for that date
  unreadable    a date notice was found but no single date / time could be read (never guessed)

Nothing is written to the calendar and no model is involved: the notice is evidence for a person, not an update.
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import monitor
import release_watch

WINDOW = timedelta(days=75)
MONTHS = {name: number for number, name in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'], 1)}
MONTH = r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?'
DATE = re.compile(MONTH + r'\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)')
TIME = re.compile(r'\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*\(?\s*(Eastern|Pacific|Central(?!\s+European)|E\.?T\.?|P\.?T\.?|C\.?T\.?|EDT|EST|PDT|PST|CDT|CST)\b', re.I)
ZONES = {'e': 'America/New_York', 'p': 'America/Los_Angeles', 'c': 'America/Chicago'}
# A date notice names a release/call and a future date. Titles of date notices:
NOTICE_TITLE = re.compile(r'(?:\bdate\b|\bto (?:announce|report|release|host|hold|participate)\b|\bwill (?:announce|report|release|host|hold)\b|'
                          r'\bconference call\b|\bwebcast\b|\bsets?\b|\bschedules?\b)', re.I)
RESULT_WORDS = re.compile(r'\b(?:results|earnings)\b', re.I)
VERB = re.compile(r'\b(?:will|to)\s+(?:release|report|announce|publish|host|hold|discuss)\b|\bconference call\b|\bwebcast\b', re.I)
DATELINE_TAIL = re.compile(r'^\s*(?:[-–—]{1,2}|\(BUSINESS WIRE\)|\(GLOBE NEWSWIRE\)|\(PRNewswire\)|/PRNewswire/)', re.I)


def zone(text):
    return ZONES[text.strip().lstrip('(')[0].lower()]


def read_notice(text):
    """({'date': 'YYYY-MM-DD', 'call': ISO UTC or None, 'timing': 'before-open'|'after-close'|None}) or raises ValueError."""
    t = ' '.join((text or '').split())[:6000]
    sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z“"(])', t)
    dates = set()
    for sentence in sentences:
        if not (VERB.search(sentence) and (RESULT_WORDS.search(sentence) or 'conference call' in sentence.lower())):
            continue
        for match in DATE.finditer(sentence):
            if DATELINE_TAIL.match(sentence[match.end():]):
                continue  # the notice's own dateline ("Amsterdam, October 30, 2026 —"), not the release date
            name = next(k for k in MONTHS if k.startswith(match[1].lower()[:3]))
            dates.add(f'{match[3]}-{MONTHS[name]:02d}-{int(match[2]):02d}')
    if len(dates) != 1:
        raise ValueError('date-not-single' if dates else 'date-not-found')
    date = dates.pop()
    call = None
    times = {(m[1], m[2] or '00', m[3].lower(), zone(m[4])) for m in TIME.finditer(t)}
    # The same call time is usually repeated in several zones ("8:00 a.m. ET (5:00 a.m. PT)"): they must agree.
    instants = set()
    for hour, minute, meridiem, tz in times:
        hour = int(hour) % 12 + (12 if meridiem == 'p' else 0)
        local = datetime.fromisoformat(f'{date}T{hour:02d}:{minute}:00').replace(tzinfo=ZoneInfo(tz))
        instants.add(local.astimezone(timezone.utc))
    if len(instants) == 1:
        call = next(iter(instants)).isoformat()
    timing = ('before-open' if re.search(r'before (?:the )?(?:market|U\.?S\.? market|opening)', t, re.I) else
              'after-close' if re.search(r'after (?:the )?(?:market|U\.?S\.? market)\s*clos', t, re.I) else None)
    return {'date': date, 'call': call, 'timing': timing}


def compare(ticker, notice, events):
    """State of the calendar for one notice. `events` come from release_watch.load_schedule()."""
    own = [e for e in events if e.get('ticker') == ticker and e['at'].astimezone(ZoneInfo('America/New_York')).date().isoformat() == notice['date']]
    if not own:
        near = [e for e in events if e.get('ticker') == ticker
                and abs((e['at'].date() - datetime.fromisoformat(notice['date']).date()).days) <= 7]
        return 'differs' if near else 'missing'
    if notice['call']:
        want = datetime.fromisoformat(notice['call'])
        calls = [e for e in own if e['phase'] == 'call']
        if calls and not any(abs((e['at'] - want).total_seconds()) < 60 for e in calls):
            return 'differs'
    return 'ok'


_cache = {}
CACHE_SECONDS = 300


def diagnostics(db, reference=None, events=None):
    """Cached for a few minutes: /health is read often and the notices change a few times a day."""
    if events is None and _cache.get('at') is not None and time.monotonic() - _cache['at'] < CACHE_SECONDS:
        return _cache['value']
    value = _diagnostics(db, reference, events)
    if events is None:
        _cache.update(at=time.monotonic(), value=value)
    return value


def _diagnostics(db, reference=None, events=None):
    reference = reference or datetime.now(timezone.utc)
    events = release_watch.load_schedule() if events is None else events
    cutoff = (reference - WINDOW).isoformat()
    report = []
    # Sources first (small, no page text), then only the current revision of the few that look like date notices.
    for row in db.execute('''SELECT url,ticker,title,sha256,discovered_at FROM sources
        WHERE title IS NOT NULL AND status NOT IN ('held','rejected') AND julianday(discovered_at)>=julianday(?)''', (cutoff,)).fetchall():
        if not (NOTICE_TITLE.search(row['title']) and RESULT_WORDS.search(row['title'])
                and re.search(r'\b(?:Q[1-4]|quarter|fiscal|full[- ]year)\b', row['title'], re.I)):
            continue
        revision = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?', (row['url'], row['sha256'])).fetchone()
        if not revision:
            continue
        try:
            notice = read_notice(revision['extracted_text'])
        except ValueError as exc:
            report.append({'ticker': row['ticker'], 'state': 'unreadable', 'reason': str(exc), 'noticeAt': row['discovered_at']})
            continue
        report.append({'ticker': row['ticker'], 'state': compare(row['ticker'], notice, events), 'date': notice['date'],
                       'call': notice['call'], 'timing': notice['timing'], 'noticeAt': row['discovered_at']})
    attention = [r for r in report if r['state'] != 'ok']
    return {'checked': len(report), 'needAttention': len(attention), 'notices': sorted(report, key=lambda r: r['noticeAt'], reverse=True)[:30]}
