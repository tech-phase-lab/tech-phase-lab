"""Project fetched issuer releases into the existing headline/translation queue.

Only metadata is projected. Research drafts, evidence bodies and approvals remain
private. No additional network requests or provider-budget changes are involved.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from urllib.parse import urlsplit

import monitor
import news_policy

PREFIX = 'primary-ir-'
VERTIV_DATELINE_LIMIT = 12000


def vertiv_retained_publication_date(ticker, url, text):
    """Recover only Vertiv's issuer dateline from retained IR release evidence."""
    if ticker != 'VRT' or not isinstance(text, str):
        return None
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return None
    if (parsed.scheme != 'https' or parsed.netloc != 'investors.vertiv.com'
            or parsed.query or parsed.fragment):
        return None
    path = re.fullmatch(r'/news/news-details/(\d{4})/Vertiv-[A-Za-z0-9-]+/default\.aspx', parsed.path)
    if not path:
        return None
    # This is the verified release's PRNewswire dateline, not a generic date
    # search. Refuse other/partial datelines rather than selecting one date out
    # of a mixed article or related-release excerpt.
    excerpt = text[:VERTIV_DATELINE_LIMIT]
    markers = re.findall(r'/\s*PRNewswire\s*/', excerpt, re.I)
    datelines = list(re.finditer(
        r'^[ \t]*COLUMBUS\s*,\s*Ohio\s*,\s*'
        r'(?P<month>[A-Za-z]+)\.?\s+(?P<day>\d{1,2})\s*,\s*(?P<year>\d{4})'
        r'\s+/\s*PRNewswire\s*/\s*(?:--|\u2013|\u2014)\s*'
        r'Vertiv\s+Holdings\s+Co\.?\s*\(\s*NYSE\s*:\s*VRT\s*\)(?=[\s,.])',
        excerpt, re.I | re.M,
    ))
    if not datelines or len(datelines) != len(markers):
        return None
    months = {name: number for number, name in enumerate(
        'january february march april may june july august september october november december'.split(), 1
    )}
    dates = set()
    for dateline in datelines:
        if dateline['year'] != path[1] or not excerpt[dateline.end():].strip():
            return None
        try:
            dates.add(datetime(int(dateline['year']), months[dateline['month'].lower()],
                               int(dateline['day'])).date().isoformat())
        except (KeyError, ValueError):
            return None
    return dates.pop() if len(dates) == 1 else None


def publishers():
    return [{'id': PREFIX + ticker, 'name': provider['name'] + ' IR',
             'kind': 'publisher-update', 'officialUpdates': True,
             'allowedHosts': provider['allowedHosts'], 'tickers': [ticker]}
            for ticker, provider in monitor.PROVIDERS.items()]


def revision(title, body_sha, published_on):
    return hashlib.sha256(json.dumps([title, body_sha, published_on], ensure_ascii=False).encode()).hexdigest()


def is_current(db, row):
    if not row['source_id'].startswith(PREFIX):
        return True
    current = db.execute('SELECT title,sha256,published_on,status FROM sources WHERE url=?', (row['url'],)).fetchone()
    return bool(current and current['status'] not in {'rejected', 'held'} and revision(current['title'], current['sha256'], current['published_on']) == row['sha'])


def sync(db, reference):
    # Some isolated signal databases have no primary monitor tables.
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='release_events'").fetchone():
        return
    cutoff = (reference - timedelta(days=7)).isoformat()
    rows = db.execute('''SELECT e.detected_at,s.url,s.ticker,s.title,s.sha256,s.published_on,r.extracted_text
      FROM release_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.detected_at>=? AND r.extracted_chars>0 AND s.status NOT IN ('rejected','held') ORDER BY e.id DESC LIMIT 500''', (cutoff,)).fetchall()
    for row in rows:
        title = row['title']
        # Some issuer index links carry no title. Recover only an explicit
        # release heading present in the fetched evidence, never from a URL slug.
        if not title and row['ticker'] == 'MU':
            heading = re.search(r'^Micron Technology,? Inc\.? Reports[^\n]{1,230}Results\s*$',
                                row['extracted_text'][:3000], re.M)
            if heading:
                title = heading[0].strip()
                db.execute('UPDATE sources SET title=? WHERE url=? AND sha256=? AND title IS NULL',
                           (title,row['url'],row['sha256']))
        if (not title or not news_policy.eligible(title)
                or re.fullmatch(r'(?:read (?:story|more)|learn more|press release|news)', title.strip(), re.I)):
            continue
        # Generic SEC filings are evidence, not issuer news headlines.
        if urlsplit(row['url']).hostname in {'www.sec.gov', 'data.sec.gov'}:
            continue
        try:
            if monitor.article_url(row['url'], row['ticker']) != row['url']:
                continue
            published_on = row['published_on']
            if not published_on:
                recovered = vertiv_retained_publication_date(row['ticker'], row['url'], row['extracted_text'])
                if recovered:
                    updated = db.execute('''UPDATE sources SET published_on=?
                      WHERE url=? AND sha256=? AND (published_on IS NULL OR published_on='')''',
                                         (recovered, row['url'], row['sha256']))
                    if updated.rowcount != 1:
                        continue
                    published_on = recovered
            published = (datetime.fromisoformat(published_on).replace(tzinfo=timezone.utc)
                         if published_on else None)
            observed = datetime.fromisoformat(row['detected_at'].replace('Z', '+00:00'))
            if ((published and not reference - timedelta(days=7) <= published <= reference)
                    or not reference - timedelta(days=7) <= observed <= reference):
                continue
        except (KeyError, ValueError, TypeError):
            continue
        db.execute('''INSERT OR IGNORE INTO signal_events(
          source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
          published_on,observed_at,excerpt,diff,truncated)
          VALUES(?,?,?,'',?,?, '{}','new',?,?,'','',0)''',
                   (PREFIX + row['ticker'], row['url'], revision(title, row['sha256'], published_on),
                    title, json.dumps([row['ticker']]), published_on, row['detected_at']))
