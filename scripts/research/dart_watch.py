"""SK hynix's results notice on DART (Korea's official disclosure system): "announced" line, no figures, no key.

SK hynix files its preliminary results ("영업(잠정)실적(공정공시)") on DART at the moment it announces them in Seoul; the SEC copy (Form 6-K)
follows about ten hours later. DART publishes a public RSS list of the day's filings (https://dart.fss.or.kr/api/todayRSS.xml). Around SK hynix's
scheduled results time this reads that list every few seconds and, when SK hynix's results notice appears, records one
"SKHY announced its results" line with the link to the DART notice, in the same table earnings_announce uses.

What it does NOT do: it never opens the notice itself. dart.fss.or.kr/robots.txt disallows the notice viewer and downloads
(/dsaf001/main.do, /report/viewer.do, /report/download.do), so the link is shown to people and never fetched. Figures come from the SEC 6-K
(issuer_result_flash) and, with a free OpenDART key, from the OpenDART API (a separate step; not here).
Outside the window around a scheduled results time nothing is requested. Reads and writes nothing else.
"""
import hashlib
import json
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from xml.etree import ElementTree

import monitor
import release_watch

RSS_URL = 'https://dart.fss.or.kr/api/todayRSS.xml'
TICKER = 'SKHY'
BEFORE = timedelta(minutes=60)     # the Seoul announcement is at or shortly before the call
AFTER = timedelta(hours=2)
POLL_SECONDS = 5
MAX_BYTES = 600_000
COMPANY = re.compile(r'SK\s*하이닉스|SK\s*hynix', re.I)
NOTICE = re.compile(r'영업\s*\(?\s*잠정\s*\)?\s*실적')          # "영업(잠정)실적(공정공시)"
_last = {'at': 0.0}


def in_window(now, events=None):
    """True while `now` is within the window around a scheduled SK hynix results time."""
    events = release_watch.load_schedule() if events is None else events
    return any(event.get('ticker') == TICKER and event.get('kind') == 'earnings' and event['at'] - BEFORE <= now <= event['at'] + AFTER
               for event in events)


def fetch(url=RSS_URL):
    request = urllib.request.Request(url, headers={'User-Agent': 'TechPhaseResearch-SourceCheck/0.1', 'Accept': 'application/rss+xml,application/xml,text/xml',
                                                  'Accept-Encoding': 'identity'})
    with urllib.request.urlopen(request, timeout=8) as response:
        if urlsplit(response.geturl()).hostname != 'dart.fss.or.kr':
            raise ValueError('redirect-off-host')
        return response.read(MAX_BYTES + 1)


def notice_links(body):
    """[(title, https link)] of SK hynix's results notices in the RSS body. Nothing else is read."""
    if not isinstance(body, (bytes, bytearray)) or not body or len(body) > MAX_BYTES or b'<!DOCTYPE' in body[:2000].upper() or b'<!ENTITY' in body.upper():
        return []
    try:
        root = ElementTree.fromstring(bytes(body))
    except ElementTree.ParseError:
        return []
    found = []
    for item in root.iter('item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        if not (COMPANY.search(title) and NOTICE.search(title)) or len(link) > 240:
            continue
        parts = urlsplit(link)
        if parts.scheme not in ('http', 'https') or parts.hostname != 'dart.fss.or.kr' or parts.username or parts.password or parts.port not in (None, 80, 443):
            continue
        number = re.search(r'(?:^|&)rcpNo=(\d{14})(?:&|$)', parts.query)
        # one canonical address per notice (the same one the OpenDART path records), so the RSS and the API make one line
        found.append((title[:200], 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + number[1] if number
                      else 'https://dart.fss.or.kr' + parts.path + ('?' + parts.query if parts.query else '')))
    return found


def run_once(path, now=None, reader=None, events=None):
    """Record newly seen SK hynix results notices. Returns the number added. No request at all outside the window."""
    now = now or datetime.now(timezone.utc)
    if not in_window(now, events):
        return 0
    if time.monotonic() - _last['at'] < POLL_SECONDS:
        return 0
    _last['at'] = time.monotonic()
    started = time.monotonic()
    try:
        links = notice_links((reader or fetch)())
    except Exception:
        return 0           # the SEC route still carries the result: this line is only the early one
    if not links:
        return 0
    import earnings_announce
    added = 0
    with monitor.connect(path) as db:
        earnings_announce.schema(db)
        for title, url in links:
            key = hashlib.sha256('\0'.join([TICKER, url]).encode()).hexdigest()
            with db:
                added += db.execute('INSERT OR IGNORE INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                    (key, TICKER, url, 'Latest', now.isoformat(timespec='milliseconds'), datetime.now(timezone.utc).isoformat(timespec='milliseconds'),
                     round((time.monotonic() - started) * 1000))).rowcount
    return added
