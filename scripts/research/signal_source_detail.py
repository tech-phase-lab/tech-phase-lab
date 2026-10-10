"""Opt-in editor-only inspection of one current retained source revision.

This reader never initializes schema, downloads a source, calls a provider or
changes publication state. Stored extraction is not proof of full-page coverage.
"""
import hashlib
import json
from pathlib import Path
import re
import sqlite3

import monitor
import official_release_bridge as bridge
import signals

MAX_BODY_CHARS = 160_000


def event_id(value):
    if type(value) is int:
        value = str(value)
    if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,11}', value):
        raise ValueError('invalid-event-id')
    return int(value)


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def detail(path, requested_id):
    requested_id = event_id(requested_id)
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA busy_timeout=5000')
        db.execute('BEGIN')
        event = db.execute('''SELECT id,source_id,url,sha,title,tickers_json,
          published_at,published_on,observed_at,truncated FROM signal_events
          WHERE id=?''', (requested_id,)).fetchone()
        if not event:
            return None
        sources = {source['id']: source for source in [*signals.SOURCES, *bridge.publishers()]}
        source = sources.get(event['source_id'])
        if not source or not source.get('allowedHosts'):
            return None
        try:
            url = signals.safe_url(event['url'], source)
            if url != event['url']:
                return None
            tickers = json.loads(event['tickers_json'])
            if (not isinstance(tickers, list) or len(tickers) > 100
                    or any(not isinstance(t, str) or not re.fullmatch(r'[A-Z][A-Z0-9.-]{0,9}', t) for t in tickers)):
                return None
        except (TypeError, ValueError):
            return None
        result = {
            'eventId': event['id'], 'sourceId': event['source_id'],
            'sourceName': source['name'], 'sourceKind': 'publisher-discovery',
            'url': url, 'title': event['title'][:500], 'tickers': tickers,
            'eventSha256': event['sha'], 'publishedAt': event['published_at'],
            'publishedOn': event['published_on'], 'observedAt': event['observed_at'],
            'currentRevision': False, 'status': 'missing-document',
            'documentSha256': None, 'bodySha256': None, 'bodyChars': None,
            'bodyAt': None, 'firstSeenAt': None, 'lastSeenAt': None,
            'sourceTruncated': bool(event['truncated']), 'text': None,
        }
        if event['source_id'].startswith(bridge.PREFIX):
            result['sourceKind'] = 'issuer-primary'
            ticker = event['source_id'][len(bridge.PREFIX):]
            if ticker not in monitor.PROVIDERS or monitor.article_url(url, ticker) != url:
                return None
            row = db.execute('''SELECT s.ticker,s.title,s.published_on,s.sha256,s.body_sha256,
              s.discovered_at,s.checked_at,r.observed_at,length(r.extracted_text) AS chars,
              substr(r.extracted_text,1,?) AS body
              FROM sources s LEFT JOIN source_revisions r
              ON r.url=s.url AND r.sha256=s.sha256 WHERE s.url=?''',
              (MAX_BODY_CHARS + 1, url)).fetchone()
            if not row or not row['sha256'] or row['body'] is None:
                return result
            result.update(documentSha256=row['sha256'], bodyChars=row['chars'],
                          bodyAt=row['observed_at'], firstSeenAt=row['discovered_at'],
                          lastSeenAt=row['checked_at'])
            current = (row['ticker'] == ticker and row['title'] == event['title']
                       and bridge.revision(row['title'], row['sha256'], row['published_on']) == event['sha'])
        else:
            row = db.execute('''SELECT sha,title,first_seen_at,last_seen_at,
              length(text) AS chars,substr(text,1,?) AS body FROM signal_documents
              WHERE source_id=? AND url=?''',
              (MAX_BODY_CHARS + 1, event['source_id'], url)).fetchone()
            if not row:
                return result
            result.update(documentSha256=row['sha'], bodyChars=row['chars'],
                          bodyAt=event['observed_at'], firstSeenAt=row['first_seen_at'],
                          lastSeenAt=row['last_seen_at'])
            current = row['sha'] == event['sha'] and row['title'] == event['title']
        if not current:
            result['status'] = 'stale'
            return result
        if type(row['chars']) is not int or not 1 <= row['chars'] <= MAX_BODY_CHARS:
            result['status'] = 'body-limit' if row['chars'] else 'missing-document'
            return result
        if (result['sourceKind'] == 'publisher-discovery'
                and digest(row['title'] + '\n' + row['body']) != row['sha']):
            result['status'] = 'integrity-mismatch'
            return result
        if (result['sourceKind'] == 'issuer-primary' and row['body_sha256']
                and row['body_sha256'] != digest(row['body'])):
            result['status'] = 'integrity-mismatch'
            return result
        result.update(currentRevision=True, status='current', text=row['body'],
                      bodySha256=digest(row['body']))
        return result
    finally:
        db.close()
