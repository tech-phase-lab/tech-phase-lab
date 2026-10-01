"""Project fetched issuer releases into the existing headline/translation queue.

Only metadata is projected. Research drafts, evidence bodies and approvals remain
private. No additional network requests or provider-budget changes are involved.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from urllib.parse import urlsplit

import monitor
import news_policy

PREFIX = 'primary-ir-'


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
    rows = db.execute('''SELECT e.detected_at,s.url,s.ticker,s.title,s.sha256,s.published_on
      FROM release_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.detected_at>=? AND r.extracted_chars>0 AND s.status NOT IN ('rejected','held') ORDER BY e.id DESC LIMIT 500''', (cutoff,)).fetchall()
    for row in rows:
        title = row['title']
        if not title or not news_policy.eligible(title):
            continue
        # Generic SEC filings are evidence, not issuer news headlines.
        if urlsplit(row['url']).hostname in {'www.sec.gov', 'data.sec.gov'}:
            continue
        try:
            if monitor.article_url(row['url'], row['ticker']) != row['url']:
                continue
            published = datetime.fromisoformat(row['published_on']).replace(tzinfo=timezone.utc)
            observed = datetime.fromisoformat(row['detected_at'].replace('Z', '+00:00'))
            if not reference - timedelta(days=7) <= published <= reference or observed > reference:
                continue
        except (KeyError, ValueError, TypeError):
            continue
        db.execute('''INSERT OR IGNORE INTO signal_events(
          source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
          published_on,observed_at,excerpt,diff,truncated)
          VALUES(?,?,?,'',?,?, '{}','new',?,?,'','',0)''',
                   (PREFIX + row['ticker'], row['url'], revision(title, row['sha256'], row['published_on']),
                    title, json.dumps([row['ticker']]), row['published_on'], row['detected_at']))
