"""One expiring, reviewed recovery of two exact retained NVIDIA revisions.

This is deterministic editorial copy, never an LLM retry. It spends no provider
budget and cannot replace a publication. Source evidence is selected literally
from the retained body; the reviewed data contains only bilingual paraphrases.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import time

import official_research_content_repair as repair


RECOVERY_ID = 'nvidia-reviewed-note-recovery-2026-10-03-v1'
GENERATION_METHOD = 'reviewed-editorial-recovery-v1'
REVIEWED_COPY_SHA = 'ffdbab9ab115a95b5c14d04a267f31aabe3f2acad4e6d1cc14ee28e7144a8492'
REVIEWED_COPY_PATH = Path(__file__).with_name('official_research_reviewed_notes.json')
EXPECTED_ATTEMPTS = 7
MAX_EVIDENCE_CHARS = 1800

# Short, literal selectors only. Ranges include complete adjacent paragraphs.
# Never add source prose or synthetic evidence to the reviewed payload.
ANCHORS = {
    1214: {
        'title': ('AI factories are built by the megawatt', 'deepens and broadens the demand they can serve.'),
        'summary': ('AI factories are built by the megawatt', 'deepens and broadens the demand they can serve.'),
        'facts': [('Each megawatt',), ('A100 GPU shipped',), ('Barkr',),
                  ('1,000 ready-made',)],
        'purpose': ('AI factories are built by the megawatt', 'deepens and broadens the demand they can serve.'),
    },
    1213: {
        'title': ('25 new games',),
        'summary': ('25 new games', 'launched Tuesday'),
        'facts': [('launched Tuesday',), ('RTX 5080-class',), ('Dates listed above',)],
        'purpose': ('handles the rendering',),
    },
}


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS reviewed_retained_announcement_recoveries(
      manifest_sha TEXT NOT NULL, source_url TEXT NOT NULL, body_text_sha TEXT NOT NULL,
      event_id INTEGER NOT NULL, event_sha TEXT NOT NULL, source_revision TEXT NOT NULL,
      source_observed_at TEXT NOT NULL, source_body_at TEXT NOT NULL,
      started_at TEXT NOT NULL, public_at TEXT NOT NULL, payload_sha TEXT NOT NULL,
      PRIMARY KEY(manifest_sha,source_url,body_text_sha))''')
    db.execute('''CREATE TABLE IF NOT EXISTS official_research_editorial_recoveries(
      event_id INTEGER NOT NULL, source_id TEXT NOT NULL, sha TEXT NOT NULL,
      body_sha TEXT NOT NULL, policy_id TEXT NOT NULL, recovery_id TEXT NOT NULL,
      source_failure_lease TEXT NOT NULL UNIQUE, source_failure_at TEXT NOT NULL,
      source_failure_payload_sha TEXT NOT NULL, reviewed_copy_sha TEXT NOT NULL,
      reviewed_payload_sha TEXT NOT NULL, source_text_sha TEXT NOT NULL,
      source_observed_at TEXT NOT NULL, source_body_at TEXT NOT NULL,
      recovery_started_at TEXT NOT NULL, public_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL, generation_method TEXT NOT NULL,
      PRIMARY KEY(event_id,source_id,sha,body_sha,recovery_id))''')


def selected_paragraphs(body, anchors):
    """Select one unique paragraph or a bounded, contiguous paragraph range."""
    if (not isinstance(body, str) or '\x00' in body
            or not isinstance(anchors, (tuple, list)) or not 1 <= len(anchors) <= 2):
        raise ValueError('unsafe-editorial-evidence')
    paragraphs = list(re.finditer(r'[^\r\n]+', body))
    selected = []
    for anchor in anchors:
        if (not isinstance(anchor, str) or not 3 <= len(anchor) <= 80
                or anchor != anchor.strip() or any(ord(char) < 32 for char in anchor)
                or body.count(anchor) != 1):
            raise ValueError('ambiguous-editorial-evidence')
        offset = body.index(anchor)
        paragraph = next((index for index, match in enumerate(paragraphs)
                          if match.start() <= offset and offset + len(anchor) <= match.end()), None)
        if paragraph is None:
            raise ValueError('unsafe-editorial-evidence')
        selected.append(paragraph)
    if selected[0] > selected[-1]:
        raise ValueError('unsafe-editorial-evidence')
    quote = body[paragraphs[selected[0]].start():paragraphs[selected[-1]].end()]
    if not 16 <= len(quote) <= MAX_EVIDENCE_CHARS:
        raise ValueError('unsafe-editorial-evidence')
    return quote


def reviewed_note(row):
    raw = REVIEWED_COPY_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != REVIEWED_COPY_SHA:
        raise ValueError('changed-reviewed-copy')
    copies = json.loads(raw)['notes']
    matches = [copy for copy in copies if copy['eventId'] == row['id']]
    if len(matches) != 1 or row['id'] not in ANCHORS:
        raise ValueError('missing-reviewed-copy')
    copy = matches[0]
    if copy['sourceUrl'] != row['url'] or copy['sourceDate'] != row['published_on']:
        raise ValueError('changed-reviewed-source')
    selectors = ANCHORS[row['id']]
    if len(copy['facts']) != len(selectors['facts']):
        raise ValueError('changed-reviewed-copy')
    def item(value, anchors):
        if set(value) != {'ja', 'en'}:
            raise ValueError('changed-reviewed-copy')
        return {**value, 'evidenceQuote': selected_paragraphs(row['body'], anchors)}
    return {**{key: item(copy[key], selectors[key]) for key in ('title', 'summary', 'purpose')},
            'facts': [item(value, anchors) for value, anchors in zip(copy['facts'], selectors['facts'])]}


def eligible_failure(db, row, reference, current_revision):
    """Recheck source, consumed repair, latest numeric rejection and paid call."""
    if not current_revision(db, row) or not repair.matches(db, row, reference):
        return None
    if db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?',
                  (row['id'],)).fetchone():
        return None
    if db.execute('SELECT 1 FROM official_research_editorial_recoveries WHERE event_id=?',
                  (row['id'],)).fetchone():
        return None
    job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    failure = repair.previous_failure(db, row)
    if (not job or not failure or job['sha'] != row['sha'] or job['state'] != 'retry'
            or job['failure_kind'] != 'unsupported-number' or job['attempts'] != EXPECTED_ATTEMPTS
            or failure['lease'] != job['lease'] or failure['sha'] != row['sha']
            or failure['reason'] != 'unsupported-number'
            or not isinstance(failure['payload'], str) or not 1 <= len(failure['payload']) <= 131072):
        return None
    audit = db.execute('''SELECT * FROM official_research_content_repairs
      WHERE event_id=? AND source_id=? AND sha=? AND body_sha=? AND policy_id=? AND lease=?''',
                       (row['id'], row['source_id'], row['sha'], row['body_sha'],
                        repair.POLICY_ID, failure['lease'])).fetchone()
    claimed_at = repair.instant(audit['claimed_at']) if audit else None
    failed_at = repair.instant(failure['failed_at'])
    if (not audit or audit['mode'] not in {'expedited', 'scheduled'}
            or audit['previous_attempts'] != EXPECTED_ATTEMPTS - 1
            or not claimed_at or not failed_at
            or not repair.DEPLOYED_AT <= claimed_at <= failed_at <= reference < repair.EXPIRES_AT):
        return None
    paid = db.execute('''SELECT * FROM signal_headline_translation_calls
      WHERE lease=? AND source_id=? AND sha=? AND state='failed' ''',
                      (failure['lease'], 'research:' + row['source_id'], row['sha'])).fetchone()
    return failure if paid else None


def publish(db, rows, reference, validator, current_revision):
    """Return done, blocked, or None; all durable changes share one write lock.

    A failed evidence/validator check does not fall through to another paid
    attempt. The original deadline, rejection, lease and attempt count survive.
    """
    started = time.monotonic()
    started_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        for row in rows:
            failure = eligible_failure(db, row, reference, current_revision)
            if failure is None:
                continue
            try:
                note = reviewed_note(row)
                before = json.dumps(note, ensure_ascii=False, sort_keys=True)
                validator(note, row['body'], row['title'])
                # A validator may normalize names, but approval binds exact copy.
                if json.dumps(note, ensure_ascii=False, sort_keys=True) != before:
                    raise ValueError('changed-reviewed-copy')
            except (ValueError, TypeError, KeyError, OSError):
                return 'blocked'
            note['generationMethod'] = GENERATION_METHOD
            payload = json.dumps(note, ensure_ascii=False)
            public_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            elapsed = round((time.monotonic() - started) * 1000)
            db.execute('''INSERT INTO official_research_publications
              (event_id,sha,body_sha,payload,evidence,started_at,public_at,generation_ms)
              VALUES(?,?,?,?,?,?,?,?)''',
                       (row['id'], row['sha'], row['body_sha'], payload,
                        json.dumps([item['evidenceQuote'] for item in
                                    [note['title'], note['summary'], *note['facts'], note['purpose']]]),
                        started_at, public_at, elapsed))
            db.execute('''INSERT INTO official_research_editorial_recoveries
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                       (row['id'], row['source_id'], row['sha'], row['body_sha'], repair.POLICY_ID,
                        RECOVERY_ID, failure['lease'], failure['failed_at'], digest(failure['payload']),
                        REVIEWED_COPY_SHA, digest(payload), digest(row['body']), row['observed_at'],
                        row['body_at'], started_at, public_at, elapsed, GENERATION_METHOD))
            updated = db.execute("""UPDATE official_research_jobs SET state='done'
              WHERE event_id=? AND sha=? AND lease=? AND attempts=? AND state='retry'
              AND failure_kind='unsupported-number'""",
                                 (row['id'], row['sha'], failure['lease'], EXPECTED_ATTEMPTS))
            if updated.rowcount != 1:
                raise ValueError('changed-editorial-recovery-job')
            return 'done'
    return None


RETAINED_COPY_PATH = Path(__file__).with_name('reviewed_retained_announcements.json')
RETAINED_COPY_SHA = '3ce2b505390d880a82cf2249f8b97b47744f620e9d52959635adeffb55b66514'


def retained_candidate(db, pin, reference):
    """Require newly validated article evidence, never legacy XML/feed text."""
    import official_release_bridge as bridge
    row = db.execute("""SELECT e.*,s.sha256 AS source_revision,s.content_type,
      s.extractor_version,s.error,s.status,r.extracted_text AS body,r.observed_at AS body_at,
      s.title AS source_title,s.published_on AS source_date
      FROM signal_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.source_id=? AND e.url=? ORDER BY e.id DESC LIMIT 1""",
                     (pin['sourceId'], pin['url'])).fetchone()
    if (not row or not bridge.is_current(db, row) or row['truncated']
            or row['title'] != pin['title'] or row['source_title'] != pin['title']
            or row['published_on'] != pin['publishedOn'] or row['source_date'] != pin['publishedOn']
            or repair.instant(row['observed_at']) != repair.instant(pin['observedAt'])
            or row['content_type'] != 'text/html'
            or row['extractor_version'] != pin['extractorVersion'] or row['error']
            or row['status'] in {'held', 'rejected'} or len(row['body']) != pin['bodyChars']
            or digest(row['body']) != pin['bodyTextSha']):
        return None
    try:
        if json.loads(row['tickers_json']) != [pin['ticker']]:
            return None
    except (ValueError, TypeError):
        return None
    observed, body_at = repair.instant(row['observed_at']), repair.instant(row['body_at'])
    if (not observed or not body_at or not observed <= body_at <= reference
            or (reference - observed).total_seconds() > 7 * 86400):
        return None
    return row


def retained_note(row, pin):
    copy = pin['copy']
    if set(copy) != {'title', 'summary', 'facts', 'purpose'} or not 3 <= len(copy['facts']) <= 5:
        raise ValueError('changed-reviewed-copy')
    def bind(item):
        if set(item) != {'ja', 'en', 'anchors'}:
            raise ValueError('changed-reviewed-copy')
        return {'ja': item['ja'], 'en': item['en'],
                'evidenceQuote': selected_paragraphs(row['body'], item['anchors'])}
    return {**{key: bind(copy[key]) for key in ('title', 'summary', 'purpose')},
            'facts': [bind(item) for item in copy['facts']]}


def publish_retained(db, reference, validator):
    """Apply reviewed source-bound copy once through the existing worker.

    This extension does not acquire sources, retry models or turn a prior
    provider failure into success. It preserves all source/job/call histories.
    """
    try:
        raw = RETAINED_COPY_PATH.read_bytes()
        if hashlib.sha256(raw).hexdigest() != RETAINED_COPY_SHA:
            return False
        manifest = json.loads(raw)
        start, expiry = repair.instant(manifest['startsAt']), repair.instant(manifest['expiresAt'])
        if (manifest['policy'] != 'reviewed-retained-announcement-v1' or not start or not expiry
                or not start <= reference < expiry):
            return False
    except (ValueError, TypeError, KeyError, OSError):
        return False
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        for pin in manifest['announcements']:
            row = retained_candidate(db, pin, reference)
            if (row is None or db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
                    or db.execute('SELECT 1 FROM reviewed_retained_announcement_recoveries WHERE manifest_sha=? AND source_url=? AND body_text_sha=?',
                                  (RETAINED_COPY_SHA, pin['url'], pin['bodyTextSha'])).fetchone()):
                continue
            cached = db.execute('SELECT * FROM official_story_bodies WHERE event_id=?', (row['id'],)).fetchone()
            if cached and (cached['sha'] != row['sha'] or cached['body_sha'] != pin['bodyTextSha']
                           or cached['body'] != row['body'] or cached['error']):
                continue
            started = time.monotonic()
            started_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            try:
                note = retained_note(row, pin)
                exact = json.dumps(note, ensure_ascii=False, sort_keys=True)
                validator(note, row['body'], row['title'])
                if json.dumps(note, ensure_ascii=False, sort_keys=True) != exact:
                    return False
            except (ValueError, TypeError, KeyError):
                return False
            public_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            note.update(generationMethod=GENERATION_METHOD, reviewedCopySha256=RETAINED_COPY_SHA)
            payload = json.dumps(note, ensure_ascii=False)
            if not cached:
                db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                           (row['id'], row['sha'], pin['bodyTextSha'], row['body'], row['body_at'], reference.timestamp()+900, None))
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], pin['bodyTextSha'], payload,
                        json.dumps([item['evidenceQuote'] for item in [note['title'], note['summary'], *note['facts'], note['purpose']]]),
                        started_at, public_at, round((time.monotonic()-started)*1000)))
            db.execute('INSERT INTO reviewed_retained_announcement_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (RETAINED_COPY_SHA, pin['url'], pin['bodyTextSha'], row['id'], row['sha'], row['source_revision'],
                        row['observed_at'], row['body_at'], started_at, public_at, digest(payload)))
            return True
    return False
