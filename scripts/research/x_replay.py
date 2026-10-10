"""Re-admit retained X evidence after parser repair, without an upstream read.

Replay is private intake, never publication approval. Original publication and
first-observation clocks are preserved so recovery cannot become a fast arrival.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from urllib.parse import urlsplit

import signals
import x_api


def replay_acquired(db, sources, tickers, now=None):
    now = now or datetime.now(timezone.utc)
    signals.schema(db)
    approved = {s['id']: s for s in sources
                if s.get('format') == 'x-api' and s.get('enabled') is not False}
    result = {'examined': 0, 'recovered': 0, 'invalidated': 0}
    if not approved:
        return result
    # Acquisition retention is already bounded to 1,000 rows per source. Stream
    # that bounded window rather than repeatedly stopping before later matches.
    rows = db.execute('''SELECT a.rowid AS acquisition_row_id FROM signal_x_acquisition a
      WHERE a.source_id IN (''' + ','.join('?' for _ in approved) + ''')
        AND a.selected_for_processing=0 AND a.truncated=0
        AND julianday(a.first_seen_at) BETWEEN julianday(?) AND julianday(?)
        AND NOT EXISTS (SELECT 1 FROM signal_x_acquisition newer
          WHERE newer.source_id=a.source_id AND newer.url=a.url
          AND (julianday(newer.first_seen_at)>julianday(a.first_seen_at)
            OR (julianday(newer.first_seen_at)=julianday(a.first_seen_at) AND newer.rowid>a.rowid)))
      ORDER BY julianday(a.first_seen_at),a.rowid''',
      (*approved, (now-timedelta(days=7)).isoformat(), now.isoformat())).fetchall()
    for identity in rows:
        row = db.execute('SELECT * FROM signal_x_acquisition WHERE rowid=?',
                         (identity['acquisition_row_id'],)).fetchone()
        if row is None or row['selected_for_processing']:
            continue
        result['examined'] += 1
        source = approved[row['source_id']]
        try:
            url = signals.safe_url(row['url'], source)
            path = re.fullmatch(r'/([A-Za-z0-9_]+)/status/(\d+)', urlsplit(url).path)
            published = datetime.fromisoformat(row['published_at'].replace('Z', '+00:00'))
            observed = datetime.fromisoformat(row['first_seen_at'].replace('Z', '+00:00'))
            last_seen = datetime.fromisoformat(row['last_seen_at'].replace('Z', '+00:00'))
            if (not path or not published.tzinfo or not observed.tzinfo or not last_seen.tzinfo
                    or not now-timedelta(days=7) <= published <= observed <= last_seen <= now
                    or path[1].lower() not in {name.lower() for name in source.get('accounts', [])}
                    or path[1].lower() not in x_api.ALLOWED_ACCOUNT_NAMES):
                continue
            if hashlib.sha256((row['title']+'\n'+row['text']).encode()).hexdigest() != row['sha']:
                continue
            # Invalidate stale source documents even when the current original
            # is an unsupported retraction. An unsupported *new* body must not
            # leave a supported but withdrawn old number publicly visible.
            db.commit()
            with db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT sha,last_seen_at FROM signal_documents WHERE source_id=? AND url=?',
                                     (row['source_id'], url)).fetchone()
                if current and current['sha'] != row['sha']:
                    current_seen = datetime.fromisoformat(current['last_seen_at'].replace('Z', '+00:00'))
                    if not current_seen.tzinfo or current_seen > last_seen:
                        continue
                    db.execute('''UPDATE signal_documents SET sha=?,title=?,text=?,last_seen_at=?
                      WHERE source_id=? AND url=? AND sha=?''',
                      (row['sha'], row['title'], row['text'], row['last_seen_at'],
                       row['source_id'], url, current['sha']))
                    result['invalidated'] += 1
            payload = {'data': [{'id': path[2], 'author_id': 'saved-author',
                        'text': row['text'], 'created_at': row['published_at']}],
                       'includes': {'users': [{'id': 'saved-author', 'username': path[1]}]}}
            items = x_api.parse_response(source, payload, tickers)
            if len(items) != 1 or items[0]['url'] != url:
                continue
            item = items[0]
            if item['truncated'] or item['title'] != row['title']:
                continue
        except (TypeError, ValueError, AttributeError, OverflowError):
            continue
        # Recheck after admission in case another writer installed a new source
        # revision. A current newer revision must never be overwritten.
        db.commit()
        with db:
            db.execute('BEGIN IMMEDIATE')
            current = db.execute('SELECT sha FROM signal_documents WHERE source_id=? AND url=?',
                                 (row['source_id'], url)).fetchone()
            if current and current['sha'] != row['sha']:
                continue
            db.execute('''INSERT OR IGNORE INTO signal_documents VALUES(?,?,?,?,?,?,?)''',
                       (row['source_id'], url, row['sha'], row['title'], row['text'],
                        row['first_seen_at'], row['last_seen_at']))
            existing = db.execute('''SELECT 1 FROM signal_events
              WHERE source_id=? AND url=? AND sha=?''', (row['source_id'], url, row['sha'])).fetchone()
            if not existing:
                db.execute('''INSERT INTO signal_events
                  (source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
                   published_at,observed_at,excerpt,diff,truncated)
                  VALUES(?,?,?,'',?,?,?,'baseline',?,?,?,'',0)''',
                  (row['source_id'], url, row['sha'], row['title'],
                   json.dumps(sorted(item['matches'])), json.dumps(item['matches']),
                   row['published_at'], row['first_seen_at'], signals.evidence_excerpt(item)))
                result['recovered'] += 1
            db.execute('''UPDATE signal_x_acquisition SET selected_for_processing=1
              WHERE source_id=? AND url=? AND sha=?''', (row['source_id'], url, row['sha']))
    return result
