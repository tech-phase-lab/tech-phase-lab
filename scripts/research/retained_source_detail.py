"""Opt-in, editor-only disclosure of one retained X acquisition revision.

No event, candidate selection, research-body lookup, initialization, network or
write is needed. Exact stored UTF-8 text is verified before it is disclosed.
"""
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import re
import sqlite3
import time

import signals

MAX_BODY_CHARS = 160_000
MAX_BODY_BYTES = MAX_BODY_CHARS * 4
MAX_TITLE_CHARS = 2_000
MAX_TITLE_BYTES = MAX_TITLE_CHARS * 4
MAX_ORIGIN_ROWS = 256
MAX_SOURCES = 32
MAX_VM_STEPS = 500_000
MAX_QUERY_SECONDS = 2
HASH = re.compile(r'[a-f0-9]{64}')
URL = re.compile(r'https://x\.com/([A-Za-z0-9_]{1,15})/status/([1-9][0-9]{0,19})')
CLOCK = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)')


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def selector(source_id, url, expected_sha):
    if not isinstance(source_id, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,79}', source_id):
        raise ValueError('invalid-retained-source')
    if not isinstance(url, str) or not URL.fullmatch(url):
        raise ValueError('invalid-retained-url')
    if not isinstance(expected_sha, str) or not HASH.fullmatch(expected_sha):
        raise ValueError('invalid-revision-hash')
    return source_id, url, expected_sha


def approved_url(url, source):
    match = URL.fullmatch(url)
    if (not match or source.get('format') != 'x-api'
            or match[1].casefold() not in {account.casefold() for account in source.get('accounts', [])}):
        return False
    try:
        return signals.safe_url(url, source) == url
    except (KeyError, TypeError, ValueError):
        return False


def instant(value):
    if not isinstance(value, str) or not CLOCK.fullmatch(value):
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def clock(value):
    return {'value': value[:128] if isinstance(value, str) else None,
            'omitted': isinstance(value, str) and len(value) > 128}


def origin_head(db, sources, url, reference):
    """Bounded, metadata-only current origin proof across approved routes.

    Existing PKs constrain each lookup by source_id. NOCASE must cover stored
    handle casing; the VM/time budget bounds those source-prefix index ranges.
    A row cap or incomplete/invalid head fails closed, never picks a partial max.
    """
    newest = None
    count = 0
    for source in sources:
        if not approved_url(url, source):
            continue
        for table in ('signal_documents', 'signal_x_acquisition'):
            rows = db.execute('''SELECT substr(sha,1,129) AS sha,
              substr(last_seen_at,1,129) AS seen FROM ''' + table + '''
              WHERE source_id=? AND url=? COLLATE NOCASE LIMIT ?''',
              (source['id'], url, MAX_ORIGIN_ROWS + 1)).fetchall()
            count += len(rows)
            if count > MAX_ORIGIN_ROWS:
                return None, 'origin-limit'
            for row in rows:
                seen = instant(row['seen'])
                if not seen or seen > reference:
                    return None, 'invalid-origin-clock'
                revision = row['sha'] if isinstance(row['sha'], str) and HASH.fullmatch(row['sha']) else None
                if newest is None or seen > newest[0]:
                    newest = (seen, revision)
                elif seen == newest[0] and revision != newest[1]:
                    newest = (seen, None)
    return (newest[1], None) if newest else (None, 'missing-origin')


def detail(path, source_id, url, expected_sha, *, reference=None, sources=None):
    source_id, url, expected_sha = selector(source_id, url, expected_sha)
    sources = signals.SOURCES if sources is None else sources
    sources = [source for source in sources if source.get('format') == 'x-api']
    source = next((item for item in sources if item['id'] == source_id), None)
    if not source or len(sources) > MAX_SOURCES or not approved_url(url, source):
        return None
    reference = reference or datetime.now(timezone.utc)
    if reference.tzinfo is None:
        raise ValueError('invalid-reference-time')
    result = {'sourceId': source_id, 'url': url, 'expectedSourceSha': expected_sha,
              'sourceSha': expected_sha, 'currentOriginSha': None,
              'sourceKind': 'retained-x-acquisition', 'currentRevision': False,
              'status': 'missing-record', 'text': None, 'title': None,
              'bodySha256': None, 'bodyChars': None, 'bodyBytes': None,
              'returnedBodyChars': 0, 'omittedBodyChars': None,
              'textIncluded': False, 'researchBodyIncluded': False,
              'sourceTruncated': None, 'selectedForProcessing': None,
              'generatedAt': reference.isoformat()}
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=2)
    db.row_factory = sqlite3.Row
    started = time.monotonic()
    steps = 0
    def budget():
        nonlocal steps
        steps += 1000
        return int(steps > MAX_VM_STEPS or time.monotonic() - started > MAX_QUERY_SECONDS)
    db.set_progress_handler(budget, 1000)
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        for table in ('signal_documents', 'signal_x_acquisition'):
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                result['status'] = 'schema-unavailable'
                return result
        # Exact PK lookup; the body is bounded in SQL before crossing into Python.
        # BLOB length/substr preserve NULs and avoid SQLite text length clipping.
        row = db.execute('''SELECT typeof(title) AS title_type,typeof(text) AS body_type,
          length(CAST(title AS BLOB)) AS title_bytes,length(CAST(text AS BLOB)) AS body_bytes,
          substr(CAST(title AS BLOB),1,?) AS title,substr(CAST(text AS BLOB),1,?) AS body,
          substr(published_at,1,129) AS published_at,substr(first_seen_at,1,129) AS first_seen_at,
          substr(last_seen_at,1,129) AS last_seen_at,truncated=1 AS truncated,
          selected_for_processing=1 AS selected_for_processing
          FROM signal_x_acquisition WHERE source_id=? AND url=? AND sha=?''',
          (MAX_TITLE_BYTES + 1, MAX_BODY_BYTES + 1, source_id, url, expected_sha)).fetchone()
        if row is None:
            return None
        result.update(bodyBytes=row['body_bytes'], sourceTruncated=row['truncated'] == 1,
                      selectedForProcessing=row['selected_for_processing'] == 1,
                      publishedAt=clock(row['published_at']), firstSeenAt=clock(row['first_seen_at']),
                      lastSeenAt=clock(row['last_seen_at']))
        head, reason = origin_head(db, sources, url, reference)
        result['currentOriginSha'] = head
        if reason or head != expected_sha:
            result['status'] = reason or 'stale-selection'
            return result
        if row['body_type'] != 'text' or row['title_type'] != 'text':
            result['status'] = 'invalid-stored-text'
            return result
        if row['body_bytes'] > MAX_BODY_BYTES or row['title_bytes'] > MAX_TITLE_BYTES:
            result['status'] = 'body-limit' if row['body_bytes'] > MAX_BODY_BYTES else 'title-limit'
            return result
        try:
            title, body = row['title'].decode('utf-8'), row['body'].decode('utf-8')
        except UnicodeDecodeError:
            result['status'] = 'invalid-stored-text'
            return result
        result.update(bodyChars=len(body), omittedBodyChars=len(body))
        if len(body) > MAX_BODY_CHARS or len(title) > MAX_TITLE_CHARS:
            result['status'] = 'body-limit' if len(body) > MAX_BODY_CHARS else 'title-limit'
            return result
        if not body or '\0' in body or '\0' in title:
            result['status'] = 'invalid-stored-text'
            return result
        if digest(title + '\n' + body) != expected_sha:
            result['status'] = 'integrity-mismatch'
            return result
        result.update(status='current', currentRevision=True, text=body, title=title,
                      bodySha256=digest(body), returnedBodyChars=len(body), omittedBodyChars=0,
                      textIncluded=True)
        return result
    except sqlite3.OperationalError as exc:
        # Fail closed on bounded-work exhaustion or an older/partial schema.
        if str(exc) == 'interrupted':
            result['status'] = 'query-limit'
        elif str(exc).startswith(('no such table:', 'no such column:')):
            result['status'] = 'schema-unavailable'
        else:
            raise
        return result
    finally:
        db.close()
