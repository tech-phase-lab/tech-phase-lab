"""One source-bound reviewed Oracle announcement recovery; no provider calls.

The retained evidence is Oracle's PR Newswire distribution, independently
corroborated with its issuer announcement. Neither route is broadly enabled.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import time

from official_research_editorial_recovery import selected_paragraphs

EVENT_ID = 1179
SOURCE_ID = 'prnewswire-public'
URL = 'https://www.prnewswire.com/news-releases/oracle-announces-commitment-to-absorb-300-million-in-rising-point-beach-energy-costs-for-wisconsin-residents-302896645.html'
ISSUER_URL = 'https://www.oracle.com/news/announcement/oracle-announces-commitment-to-absorb-rising-point-beach-energy-costs-2026-10-02/'
TITLE = 'Oracle Announces Commitment to Absorb $300 Million in Rising Point Beach Energy Costs for Wisconsin Residents'
EVENT_SHA = '49a9e1fb81b60a52f694f96e3d7099efc64df15181070b2ba654100dead7bac2'
BODY_SHA = 'fd1201b9e518ea8855151cadb1eb3d0ca8fb462bcdc6a8f1390250fec70a2ac0'
BODY_CHARS = 2565
COPY_PATH = Path(__file__).with_name('oracle_point_beach_reviewed.json')
COPY_SHA = 'ff11746ddde75fddc155dd5805055fa7e1b9b6007e485ed61d519f3a059bdcce'
RECOVERY_ID = 'oracle-point-beach-reviewed-2026-10-03-v1'
GENERATION_METHOD = 'reviewed-editorial-recovery-v1'
STARTS_AT = datetime(2026, 10, 3, 7, 0, tzinfo=timezone.utc)
EXPIRES_AT = datetime(2026, 10, 4, 7, 0, tzinfo=timezone.utc)
PUBLISHED_SECOND = datetime(2026, 10, 2, 13, 0, tzinfo=timezone.utc)
OBSERVED_SECOND = datetime(2026, 10, 2, 13, 2, 2, tzinfo=timezone.utc)
ANCHORS = {
    'title': ('Oracle is stepping up',),
    'summary': ('AUSTIN, Texas, Oct. 2, 2026',),
    'facts': [('Oracle is stepping up',), ('AUSTIN, Texas, Oct. 2, 2026',),
              ("Oracle's planned subscription",), ('The planned commitment builds',),
              ('The planned commitment builds',)],
    'purpose': ('AUSTIN, Texas, Oct. 2, 2026',),
}


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, TypeError, AttributeError):
        return None


def publisher():
    return {'id': SOURCE_ID, 'name': 'Oracle / PR Newswire', 'kind': 'publisher-update',
            'allowedHosts': ['www.prnewswire.com'], 'tickers': ['ORCL']}


def candidate(db, reference):
    row = db.execute('''SELECT e.*,d.sha AS document_sha,d.title AS document_title,
      d.text AS body,d.first_seen_at,d.last_seen_at FROM signal_events e
      JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url
      WHERE e.id=? AND e.source_id=? AND e.url=? AND e.sha=? AND d.sha=e.sha''',
      (EVENT_ID, SOURCE_ID, URL, EVENT_SHA)).fetchone()
    if (not row or row['title'] != TITLE or row['document_title'] != TITLE
            or row['event_kind'] != 'new' or row['truncated']
            or len(row['body']) != BODY_CHARS or digest(row['body']) != BODY_SHA
            or digest(row['title'] + '\n' + row['body']) != EVENT_SHA):
        return None
    try:
        if json.loads(row['tickers_json']) != ['ORCL']:
            return None
    except (ValueError, TypeError):
        return None
    published, observed = instant(row['published_at']), instant(row['observed_at'])
    # Inspection exposed seconds, not the stored fractional precision. Match
    # that verified second, but preserve every original database clock byte.
    if (not published or not observed
            or published.replace(microsecond=0) != PUBLISHED_SECOND
            or observed.replace(microsecond=0) != OBSERVED_SECOND
            or not reference - timedelta(days=7) <= published <= observed <= reference):
        return None
    return row


def reviewed_note(row):
    raw = COPY_PATH.read_bytes()
    if hashlib.sha256(raw).hexdigest() != COPY_SHA:
        raise ValueError('changed-reviewed-copy')
    copy = json.loads(raw)
    if set(copy) != {'title', 'summary', 'facts', 'purpose'} or len(copy['facts']) != 5:
        raise ValueError('changed-reviewed-copy')
    def bind(value, anchors):
        if set(value) != {'ja', 'en'}:
            raise ValueError('changed-reviewed-copy')
        return {**value, 'evidenceQuote': selected_paragraphs(row['body'], anchors)}
    return {**{key: bind(copy[key], ANCHORS[key]) for key in ('title', 'summary', 'purpose')},
            'facts': [bind(value, anchors) for value, anchors in zip(copy['facts'], ANCHORS['facts'])]}


def reviewed_payload(row):
    return {**reviewed_note(row), 'generationMethod': GENERATION_METHOD,
            'reviewedRecoveryId': RECOVERY_ID, 'reviewedCopySha256': COPY_SHA,
            'corroboratingIssuerUrl': ISSUER_URL}


def public_event(db, reference):
    """Admit only a complete matching reviewed publication, never the source lane."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_publications'").fetchone():
        return None
    row = candidate(db, reference)
    if row is None:
        return None
    saved = db.execute('''SELECT p.payload,p.body_sha,b.body_sha AS cached_sha,b.body
      FROM official_research_publications p JOIN official_story_bodies b
      ON b.event_id=p.event_id AND b.sha=p.sha WHERE p.event_id=? AND p.sha=?''',
      (EVENT_ID, EVENT_SHA)).fetchone()
    if (not saved or saved['body_sha'] != BODY_SHA or saved['cached_sha'] != BODY_SHA
            or saved['body'] != row['body']):
        return None
    try:
        expected = reviewed_payload(row)
        if json.loads(saved['payload']) != expected:
            return None
        headline = db.execute("""SELECT headline_ja FROM signal_headline_translations
          WHERE source_id=? AND url=? AND sha=?""", (SOURCE_ID, URL, EVENT_SHA)).fetchone()
        if not headline or headline['headline_ja'] != expected['title']['ja']:
            return None
    except (ValueError, TypeError, KeyError, OSError):
        return None
    return row


def publish(db, reference, validator):
    """Atomically publish reviewed copy once from existing retained evidence."""
    if not STARTS_AT <= reference < EXPIRES_AT:
        return False
    row = candidate(db, reference)
    if row is None or db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (EVENT_ID,)).fetchone():
        return False
    started = time.monotonic()
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        row = candidate(db, reference)
        if (row is None or db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (EVENT_ID,)).fetchone()
                or db.execute('SELECT 1 FROM official_story_bodies WHERE event_id=?', (EVENT_ID,)).fetchone()):
            return False
        try:
            note = reviewed_note(row)
            exact = json.dumps(note, ensure_ascii=False, sort_keys=True)
            validator(note, row['body'], row['title'])
            if json.dumps(note, ensure_ascii=False, sort_keys=True) != exact:
                return False
            payload = reviewed_payload(row)
        except (ValueError, TypeError, KeyError, OSError):
            return False
        publication_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
        # Cache the already-retained extraction, preserving its original clock.
        # This is not another fetch, nor a change to signal_events/documents.
        db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                   (EVENT_ID, EVENT_SHA, BODY_SHA, row['body'], row['observed_at'], reference.timestamp(), None))
        db.execute('''INSERT INTO official_research_publications
          (event_id,sha,body_sha,payload,evidence,started_at,public_at,generation_ms)
          VALUES(?,?,?,?,?,?,?,?)''',
          (EVENT_ID, EVENT_SHA, BODY_SHA, json.dumps(payload, ensure_ascii=False),
           json.dumps([item['evidenceQuote'] for item in [note['title'], note['summary'], *note['facts'], note['purpose']]]),
           reference.isoformat(), publication_at, round((time.monotonic()-started)*1000)))
        # Reviewed Japanese copy avoids a separate paid headline translation.
        # A conflicting saved translation must not be silently overwritten.
        saved = db.execute('''SELECT headline_ja FROM signal_headline_translations
          WHERE source_id=? AND url=? AND sha=?''', (SOURCE_ID, URL, EVENT_SHA)).fetchone()
        if saved and saved['headline_ja'] != note['title']['ja']:
            raise ValueError('conflicting-reviewed-headline')
        db.execute('''INSERT OR IGNORE INTO signal_headline_translations
          (source_id,url,sha,headline_ja,model,created_at) VALUES(?,?,?,?,?,?)''',
          (SOURCE_ID, URL, EVENT_SHA, note['title']['ja'], 'reviewed-editorial-copy', publication_at))
    return True
