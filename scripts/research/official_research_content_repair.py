"""One bounded repair of two retained notes rejected before the policy rollout.

This is consumed only by the existing worker's budgeted claim transaction. It
does not reset jobs, fetch evidence, or create another generation entry point.
Keep the audit after expiry so a restart cannot grant another expedited attempt.
"""
from datetime import datetime, timedelta, timezone

import official_release_bridge as bridge


POLICY_ID = 'issuer-note-exact-numeric-evidence-2026-10-03-v1'
DEPLOYED_AT = datetime(2026, 10, 3, 1, 17, 17, 899000, tzinfo=timezone.utc)
EXPIRES_AT = DEPLOYED_AT + timedelta(days=1)
PINS = {
    1213: {
        'source_id': 'primary-ir-NVDA',
        'url': 'https://blogs.nvidia.com/blog/geforce-now-thursday-october-2026-games-list/',
        'title': 'Fall Into 25 New Games on GeForce NOW This October',
        'published_on': '2026-10-01',
        'body_sha': 'f6162e00f9fd23754125ecce1192fb92332e95c05616c9d801133b199e8ffdd3',
    },
    1214: {
        'source_id': 'primary-ir-NVDA',
        'url': 'https://blogs.nvidia.com/blog/productive-durable-fungible-ai-factories/',
        'title': 'Productive, Durable, Fungible: How NVIDIA AI Factories Maximize Return on Investment',
        'published_on': '2026-10-01',
        'body_sha': 'e4cefec4c13a7487ae2a0e9b391323dad0dd9e57819515d10b3a9f138ee229da',
    },
}


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS official_research_content_repairs(
      event_id INTEGER NOT NULL, source_id TEXT NOT NULL, sha TEXT NOT NULL,
      body_sha TEXT NOT NULL, policy_id TEXT NOT NULL, lease TEXT NOT NULL UNIQUE,
      claimed_at TEXT NOT NULL, mode TEXT NOT NULL,
      previous_attempts INTEGER NOT NULL, previous_next_at REAL,
      previous_lease TEXT, previous_failure_at TEXT, previous_failure_kind TEXT,
      PRIMARY KEY(event_id,source_id,sha,body_sha,policy_id))''')


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def matches(db, row, reference):
    """Recheck the immutable cohort and retained candidate while claim is locked."""
    pin = PINS.get(row['id'])
    if (not pin or not DEPLOYED_AT <= reference < EXPIRES_AT
            or row.get('body_cached') or row.get('ticker') != 'NVDA'
            or any(row.get(key) != value for key, value in pin.items())
            or row['sha'] != bridge.revision(pin['title'], pin['body_sha'], pin['published_on'])):
        return False
    current = db.execute('''SELECT e.*, s.sha256 AS body_sha, s.ticker,
      s.title AS source_title, s.published_on AS source_date, s.status, s.error,
      r.extracted_text AS body, r.observed_at AS body_at
      FROM signal_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.id=?''', (row['id'],)).fetchone()
    if (not current or current['status'] in {'held', 'rejected'} or current['error']
            or current['ticker'] != 'NVDA' or current['source_title'] != pin['title']
            or current['source_date'] != pin['published_on']
            or any(current[key] != value for key, value in pin.items())
            or any(current[key] != row[key] for key in ('sha', 'body', 'body_at', 'observed_at'))
            or not 1200 <= len(current['body']) <= 160000):
        return False
    observed = instant(current['observed_at'])
    return bool(observed and reference - timedelta(days=7) <= observed <= reference)


def previous_failure(db, row):
    return db.execute('''SELECT * FROM official_research_attempt_failures
      WHERE event_id=? ORDER BY julianday(failed_at) DESC, rowid DESC LIMIT 1''',
                      (row['id'],)).fetchone()


def can_expedite(db, row, job):
    """Only the latest matching pre-policy content failure may skip its deadline."""
    if (not job or job['sha'] != row['sha'] or job['state'] != 'retry'
            or job['failure_kind'] != 'unsupported-number' or job['attempts'] < 1):
        return False
    failure = previous_failure(db, row)
    failed_at = instant(failure['failed_at']) if failure else None
    observed_at = instant(row['observed_at'])
    if (not failure or failure['lease'] != job['lease'] or failure['sha'] != row['sha']
            or failure['reason'] != 'unsupported-number' or not failed_at
            or not observed_at or not observed_at <= failed_at < DEPLOYED_AT):
        return False
    if db.execute('''SELECT 1 FROM official_research_publications
      WHERE event_id=? AND sha=?''', (row['id'], row['sha'])).fetchone():
        return False
    return not db.execute('''SELECT 1 FROM official_research_content_repairs
      WHERE event_id=? AND source_id=? AND sha=? AND body_sha=? AND policy_id=?''',
                          (row['id'], row['source_id'], row['sha'], row['body_sha'], POLICY_ID)).fetchone()


def record_claim(db, row, job, lease, reference, expedited):
    """Ordinary attempts also consume the policy marker, without changing retries."""
    failure = previous_failure(db, row)
    db.execute('''INSERT OR IGNORE INTO official_research_content_repairs
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
               (row['id'], row['source_id'], row['sha'], row['body_sha'], POLICY_ID,
                lease, reference.isoformat(), 'expedited' if expedited else 'scheduled',
                job['attempts'] if job else 0, job['next_at'] if job else None,
                job['lease'] if job else None, failure['failed_at'] if failure else None,
                job['failure_kind'] if job else None))
