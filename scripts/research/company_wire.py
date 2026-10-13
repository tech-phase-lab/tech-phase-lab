"""Per-company headline watch for the monitored roster (stage 1: collect + measure).

Reads two public per-company headline feeds (Yahoo Finance ticker feed and a
Google News company query) every few minutes and keeps headline, publisher,
link and publication time. Nothing here is shown on the site, translated or
summarised; article text is never fetched. Each headline is tagged ``wire``
when its publisher is a press-release wire or the company itself, otherwise
``third-party``, so the two are never presented as the same thing.
"""
import hashlib
import json
import re
import sqlite3
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import quote, urlsplit

import monitor

FEEDS = (
    ('yahoo', 'https://feeds.finance.yahoo.com/rss/2.0/headline?s={ticker}&region=US&lang=en-US'),
    ('gnews', 'https://news.google.com/rss/search?q={query}+when:2d&hl=en-US&gl=US&ceid=US:en'),
)
ALLOWED_HOSTS = {'feeds.finance.yahoo.com', 'news.google.com'}
USER_AGENT = 'Mozilla/5.0 (compatible; research-monitor/1.0)'
MAX_BYTES = 2_000_000
KEEP_DAYS = 14
WIRES = re.compile(r'business ?wire|globe ?newswire|pr ?newswire|accesswire|newsfile|mfn|cision', re.I)
# Search wording where the display name would miss the news (Oct 13).
QUERIES = {'GOOGL': 'Alphabet Google', 'SKHY': 'SK hynix', 'TSM': 'TSMC', 'ANET': 'Arista Networks',
           'BE': 'Bloom Energy', 'ARM': 'Arm Holdings', 'AMD': 'AMD chips', 'MU': 'Micron Technology',
           'CRDO': 'Credo Technology'}


def roster():
    return [p['ticker'] for p in monitor.PROVIDERS.values() if p.get('scope') != 'earnings']


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS company_wire(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, source TEXT NOT NULL, title TEXT NOT NULL,
      publisher TEXT NOT NULL, url TEXT NOT NULL, origin TEXT NOT NULL,
      published_at TEXT NOT NULL, first_seen_at TEXT NOT NULL)''')
    db.execute('CREATE INDEX IF NOT EXISTS company_wire_ticker ON company_wire(ticker, published_at)')


def connect(path):
    db = sqlite3.connect(path, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA journal_mode=WAL')
    schema(db)
    return db


def now():
    return datetime.now(timezone.utc)


def normalized(title):
    return re.sub(r'[^a-z0-9]+', ' ', title.lower()).strip()


def fetch_feed(url):
    host = urlsplit(url).hostname
    if host not in ALLOWED_HOSTS:
        raise ValueError('wire-host-not-allowed')
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(request, timeout=20) as response:
        body = response.read(MAX_BYTES + 1)
    if len(body) > MAX_BYTES:
        raise ValueError('wire-feed-too-large')
    if re.search(rb'<!(?:DOCTYPE|ENTITY)', body[:4096], re.I):
        raise ValueError('wire-feed-doctype')
    return body


def parse(body, source, ticker):
    """Headline rows from one RSS body; malformed items are skipped."""
    rows = []
    for item in ET.fromstring(body).iter('item'):
        title = (item.findtext('title') or '').strip()
        link = (item.findtext('link') or '').strip()
        publisher = (item.findtext('source') or '').strip()
        try:
            published = parsedate_to_datetime(item.findtext('pubDate') or '').astimezone(timezone.utc)
        except (TypeError, ValueError):
            continue
        if publisher and title.endswith(' - ' + publisher):
            title = title[:-len(publisher) - 3].rstrip()
        if not title or not link.startswith('https://'):
            continue
        rows.append({'ticker': ticker, 'source': source, 'title': title, 'publisher': publisher,
                     'url': link, 'published': published})
    return rows


def origin(row, name):
    publisher = row['publisher']
    if not publisher:
        return 'unknown'  # Yahoo states no publisher; never guessed.
    words = [w for w in re.findall(r'[a-z0-9]+', name.lower()) if len(w) > 2]
    if WIRES.search(publisher) or (words and all(w in publisher.lower() for w in words)):
        return 'wire'
    return 'third-party'


def store(db, rows, name, seen_at=None):
    """Insert unseen headlines; return how many were new."""
    seen_at = (seen_at or now()).isoformat()
    added = 0
    for row in rows:
        key = hashlib.sha256(f"{row['ticker']}|{normalized(row['title'])}".encode()).hexdigest()[:32]
        cursor = db.execute('INSERT OR IGNORE INTO company_wire VALUES(?,?,?,?,?,?,?,?,?)',
                            (key, row['ticker'], row['source'], row['title'], row['publisher'], row['url'],
                             origin(row, name), row['published'].isoformat(), seen_at))
        added += cursor.rowcount
    db.commit()
    return added


def poll_company(db, ticker, errors):
    """Read both feeds for one company; a failing feed is recorded, not raised."""
    name = monitor.PROVIDERS[ticker]['name']
    added = 0
    for source, template in FEEDS:
        url = template.format(ticker=quote(ticker), query=quote(QUERIES.get(ticker, name)))
        try:
            added += store(db, parse(fetch_feed(url), source, ticker), name)
            errors.pop((ticker, source), None)
        except Exception as error:
            errors[(ticker, source)] = type(error).__name__
    return added


def prune(db):
    cutoff = (now() - timedelta(days=KEEP_DAYS)).isoformat()
    db.execute('DELETE FROM company_wire WHERE first_seen_at < ?', (cutoff,))
    db.commit()


def status(db, errors):
    """Per-company counts and freshness. No titles or links."""
    current = now()
    day = (current - timedelta(hours=24)).isoformat()
    out = {}
    for ticker in roster():
        rows = db.execute('SELECT origin, published_at, first_seen_at FROM company_wire WHERE ticker=? AND published_at>=?',
                          (ticker, day)).fetchall()
        wire = [r for r in rows if r['origin'] == 'wire']
        newest = max((r['published_at'] for r in rows), default=None)
        lags = sorted((datetime.fromisoformat(r['first_seen_at']) - datetime.fromisoformat(r['published_at'])).total_seconds()
                      for r in rows)
        out[ticker] = {'headlines24h': len(rows), 'wire24h': len(wire), 'newestPublishedAt': newest,
                       'newestWireAt': max((r['published_at'] for r in wire), default=None),
                       'medianSeenLagMinutes': round(lags[len(lags) // 2] / 60) if lags else None,
                       'feedErrors': sorted(f'{s}:{e}' for (t, s), e in errors.items() if t == ticker)}
    return out
