"""Persist fully derived buyback copy without changing retained model history.

Derivation and validation happen before the short writer transaction. The
writer only compares captured source/duplicate inputs and inserts the result.
Public readers require the private audit as well as a fresh derivation.
"""
from datetime import datetime, timezone
import json
import re
import time
import uuid

import buyback_structured as structured
import general_source_news as news
import signals

AUDIT_TABLE = 'source_structured_buyback_derivations'
REVIEWABLE = frozenset({'unsubstantiated-model-output', structured.FAILURE})
SOURCE_FIELDS = ('id', 'source_id', 'url', 'sha', 'title', 'tickers_json',
                 'event_kind', 'published_at', 'observed_at', 'truncated',
                 'body', 'body_sha', 'body_at', 'ticker', 'category', 'units')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS source_structured_buyback_derivations(
      event_id INTEGER PRIMARY KEY, sha TEXT NOT NULL, body_sha TEXT NOT NULL,
      policy_version INTEGER NOT NULL, source_snapshot TEXT NOT NULL,
      original_review TEXT NOT NULL, original_artifacts TEXT NOT NULL,
      publication_snapshot TEXT NOT NULL, validated_payload_sha TEXT NOT NULL,
      derived_at TEXT NOT NULL)''')


def review_for(db, row):
    saved = db.execute('''SELECT * FROM general_source_semantic_reviews
      WHERE event_id=? AND sha=? AND body_sha=?''',
      (row['id'], row['sha'], row['body_sha'])).fetchone()
    return dict(saved) if saved else None


def artifacts(db, row):
    """Keep original attempts, proofs, calls and jobs byte-for-byte auditable."""
    job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    failures = [dict(value) for value in db.execute('''SELECT * FROM official_research_attempt_failures
      WHERE event_id=? ORDER BY lease''', (row['id'],))]
    leases = sorted({value['lease'] for value in failures} | ({job['lease']} if job else set()))
    proofs = []
    calls = []
    for lease in leases:
        proof = db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?', (lease,)).fetchone()
        if proof:
            proofs.append(dict(proof))
        calls.extend(dict(value) for value in db.execute('''SELECT * FROM signal_headline_translation_calls
          WHERE lease=? ORDER BY lease''', (lease,)))
    return {'job': dict(job) if job else None, 'failures': failures, 'proofs': proofs, 'calls': calls}


def source_snapshot(row):
    return {key: row[key] for key in SOURCE_FIELDS}


def selection_snapshot(db, reference):
    """Cheap exact inputs for currentness and stable duplicate selection.

    No candidate assessment, public metadata lookup or source parsing is done
    here. Comparing every bounded evidence row also detects a newly inserted
    earlier duplicate between preparation and acquisition of the writer lock.
    """
    heads = []
    for table in ('signal_documents', 'signal_x_acquisition'):
        heads.append([tuple(value) for value in db.execute(
            'SELECT source_id,url,sha,last_seen_at FROM '+table+
            ' WHERE source_id IN (?,?,?) ORDER BY source_id,url,sha', news.SOURCE_IDS)])
    return ([dict(value) for value in news.evidence_rows(db, reference)], heads,
            encoded([source for source in signals.SOURCES if source['id'] in news.SOURCE_IDS]))


def current_source(db, row, reference):
    """Recheck one source without recursively rebuilding the public feed.

    The caller's candidate selection owns duplicate representation. A same-URL
    correction through any approved acquisition route still revokes this row.
    """
    sources = {source['id']: source for source in signals.SOURCES if source['id'] in news.SOURCE_IDS}
    raw = db.execute('''SELECT e.*,d.sha AS current_sha,d.title AS document_title,d.text AS body
      FROM signal_events e LEFT JOIN signal_documents d ON e.source_id=d.source_id AND e.url=d.url
      WHERE e.id=?''', (row['id'],)).fetchone()
    if not raw:
        return None
    head = None
    for table in ('signal_documents', 'signal_x_acquisition'):
        for value in db.execute('SELECT source_id,url,sha,last_seen_at FROM '+table+
                                ' WHERE source_id IN (?,?,?) AND lower(url)=lower(?)',
                                (*news.SOURCE_IDS, row['url'])):
            if not news.safe_reference(value['url'], sources.get(value['source_id'])):
                continue
            seen = news.reconciliation.instant(value['last_seen_at'])
            order = seen or datetime.max.replace(tzinfo=timezone.utc)
            sha = value['sha'] if seen and seen <= reference else None
            if head is None or order > head[0]:
                head = (order, sha)
            elif order == head[0] and sha != head[1]:
                head = (order, None)
    heads = {row['url'].casefold(): head[1]} if head is not None else {}
    current, _ = news.x_assess(raw, sources.get(raw['source_id']), reference, heads)
    return current if current and encoded(source_snapshot(current)) == encoded(source_snapshot(row)) else None


def clocks_valid(saved, row, reference):
    keys = ('started_at', 'public_at')
    if any(not isinstance(saved[key], str) or not re.fullmatch(news.CLOCK_PATTERN, saved[key]) for key in keys):
        return False
    started, public = (news.reconciliation.instant(saved[key]) for key in keys)
    observed, body_at = (news.reconciliation.instant(row[key]) for key in ('observed_at', 'body_at'))
    return bool(observed and body_at and started and public
                and observed <= body_at <= started <= public <= reference
                and isinstance(saved['generation_ms'], int) and saved['generation_ms'] >= 0)


def review_allowed(review, row, reference):
    if review is None:
        return True
    if (type(review['policy_version']) is not int or review['policy_version'] != news.ASSESSMENT_VERSION
            or review['reason'] not in REVIEWABLE
            or any(not isinstance(review[key], str) or not re.fullmatch(news.CLOCK_PATTERN, review[key])
                   for key in ('started_at', 'decided_at'))):
        return False
    start, decided = (news.reconciliation.instant(review[key]) for key in ('started_at', 'decided_at'))
    observed = news.reconciliation.instant(row['observed_at'])
    return bool(observed and start and decided and observed <= start <= decided <= reference)


def resolves(db, row, review, reference):
    """Recognize audited source derivation while preserving the old review."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (AUDIT_TABLE,)).fetchone():
        return False
    try:
        audit = db.execute('SELECT * FROM '+AUDIT_TABLE+' WHERE event_id=? AND sha=? AND body_sha=?',
                           (row['id'], row['sha'], row['body_sha'])).fetchone()
        saved = db.execute('''SELECT * FROM official_research_publications
          WHERE event_id=? AND sha=? AND body_sha=?''', (row['id'], row['sha'], row['body_sha'])).fetchone()
        review = dict(review) if review is not None else None
        if (not audit or not saved or audit['policy_version'] != structured.VERSION
                or encoded(review) != encoded(review_for(db, row))
                or not review_allowed(review, row, reference)
                or encoded(review) != audit['original_review']
                or encoded(source_snapshot(row)) != audit['source_snapshot']
                or encoded(dict(saved)) != audit['publication_snapshot']
                or news.digest(saved['payload']) != audit['validated_payload_sha']
                or saved['public_at'] != audit['derived_at']
                or not clocks_valid(saved, row, reference)
                or encoded(artifacts(db, row)) != audit['original_artifacts']):
            return False
        current = current_source(db, row, reference)
        if current is None:
            return False
        note, reason = structured.validated_note(current)
        return bool(note and reason is None and encoded(json.loads(saved['payload'])) == encoded(note)
                    and saved['evidence'] == encoded([fact['evidenceQuote'] for fact in note['facts']]))
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def publication_valid(db, row, saved, reference):
    """Also require the derivation audit for copy which had no prior review."""
    current = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
    if not current or encoded(dict(current)) != encoded(dict(saved)):
        return False
    return resolves(db, row, review_for(db, row), reference)


def recorded(db, row):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (AUDIT_TABLE,)).fetchone()
                and db.execute('SELECT 1 FROM '+AUDIT_TABLE+' WHERE event_id=?', (row['id'],)).fetchone())


def publish(db, reference, clock=None):
    """Handle one current buyback; do not fetch, call a model or alter a budget."""
    # Preparation may inspect public authorization context, but never holds the
    # SQLite writer while doing so. The captured inputs are rechecked below.
    db.commit()
    before = selection_snapshot(db, reference)
    rows = news.candidates(db, reference, include_review=True)
    for row in rows:
        if row.get('category') != 'share-buyback':
            continue
        if db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone():
            continue
        review = review_for(db, row)
        if not review_allowed(review, row, reference):
            continue
        original = artifacts(db, row)
        job = original['job']
        # Even an expired running lease can have an in-flight request. Leave it
        # to its owner rather than racing an unobserved completion.
        if job and job['sha'] == row['sha'] and job['state'] == 'running':
            continue
        started = time.monotonic()
        note, reason = structured.validated_note(row)
        if note is None and review:
            continue  # An existing decision already keeps this row private.
        public = (clock or (lambda: datetime.now(timezone.utc)))()
        if public.tzinfo is None or public < reference:
            continue
        publication = None
        if note is not None:
            publication = {'event_id': row['id'], 'sha': row['sha'], 'body_sha': row['body_sha'],
                           'payload': encoded(note), 'evidence': encoded([fact['evidenceQuote'] for fact in note['facts']]),
                           'started_at': reference.isoformat(), 'public_at': public.isoformat(),
                           'generation_ms': round((time.monotonic() - started) * 1000)}
            if not clocks_valid(publication, row, public):
                continue
        with db:
            db.execute('BEGIN IMMEDIATE')
            if (selection_snapshot(db, reference) != before or review_for(db, row) != review
                    or artifacts(db, row) != original
                    or db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
                    or db.execute('SELECT 1 FROM '+AUDIT_TABLE+' WHERE event_id=?', (row['id'],)).fetchone()):
                return 'stale'
            if publication is None:
                news.save_semantic_review(db, row, 'source-structured-'+uuid.uuid4().hex,
                                          reference.isoformat(), public.isoformat(), structured.FAILURE)
                return 'review'
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)', tuple(publication.values()))
            db.execute('INSERT INTO '+AUDIT_TABLE+' VALUES(?,?,?,?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], row['body_sha'], structured.VERSION,
                        encoded(source_snapshot(row)), encoded(review), encoded(original),
                        encoded(publication), news.digest(publication['payload']), public.isoformat()))
            return 'done'
    return None
