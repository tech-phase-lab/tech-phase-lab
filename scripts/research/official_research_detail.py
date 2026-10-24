"""Explicit one-row editor proof: current research body and bound saved copy.

Never returns provider arguments, prompts, arbitrary payload/audit JSON or bulk
bodies. This is a fresh read-only transaction, not publication or correction.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3

import official_research as research
import official_research_diagnostics as diagnostics
import signal_source_detail

MAX_BODY_CHARS = 160_000
MAX_PAYLOAD_BYTES = 131_072
MAX_COPY_CHARS = 2_000
MAX_EVIDENCE_CHARS = 1_800
MAX_FACTS = 12
MAX_EVIDENCE = 20


def digest(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def revision_hash(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{64}', value):
        raise ValueError('invalid-revision-hash')
    return value


def bounded(value, maximum):
    if not isinstance(value, str):
        return {'text': None, 'chars': None, 'truncated': False}
    return {'text': value[:maximum], 'chars': len(value), 'truncated': len(value) > maximum}


def stored_clocks(saved):
    return {'basis': 'raw-stored-record-not-validated-or-first-publication',
            'startedAt': bounded(saved['started_at'], 128),
            'publicAt': bounded(saved['public_at'], 128),
            'generationMs': saved['generation_ms'] if type(saved['generation_ms']) is int and 0 <= saved['generation_ms'] <= diagnostics.MAX_EVENT_ID else None,
            'firstValidatedAt': None, 'firstRenderedAt': None}


def acquisition_metadata(db, row):
    if row['source_id'].startswith('primary-ir-'):
        saved = db.execute('''SELECT s.sha256 AS revision,s.body_sha256 AS stored_body_sha,
          r.observed_at AS acquired_at,s.checked_at AS checked_at,
          length(r.extracted_text) AS chars,substr(r.extracted_text,1,?) AS body
          FROM sources s LEFT JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
          WHERE s.url=?''', (MAX_BODY_CHARS + 1, row['url'])).fetchone()
        kind = 'primary-source-revision'
    else:
        saved = db.execute('''SELECT sha AS revision,NULL AS stored_body_sha,
          first_seen_at AS acquired_at,last_seen_at AS checked_at,
          length(text) AS chars,substr(text,1,?) AS body FROM signal_documents
          WHERE source_id=? AND url=?''', (MAX_BODY_CHARS + 1, row['source_id'], row['url'])).fetchone()
        kind = 'discovery-document'
    if not saved:
        return {'kind': kind, 'present': False, 'textIncluded': False}
    full = isinstance(saved['body'], str) and type(saved['chars']) is int and 0 <= saved['chars'] <= MAX_BODY_CHARS
    return {'kind': kind, 'present': True, 'revisionSha': saved['revision'],
            'storedBodySha': saved['stored_body_sha'], 'bodyTextSha256': digest(saved['body']) if full else None,
            'chars': saved['chars'], 'textIncluded': False, 'hashUnavailableDueToLimit': not full,
            'sourceTruncated': bool(row.get('truncated')),
            'storedAcquiredAt': bounded(saved['acquired_at'], 128),
            'storedLastCheckedAt': bounded(saved['checked_at'], 128)}


def verified_body(db, row):
    body = row.get('body')
    if not isinstance(body, str) or not body or '\0' in body:
        return None, 'missing-or-invalid-body'
    if len(body) > MAX_BODY_CHARS:
        return None, 'body-limit'
    actual = digest(body)
    if row.get('body_cached'):
        saved = db.execute('SELECT sha,body_sha,body,fetched_at FROM official_story_bodies WHERE event_id=?', (row['id'],)).fetchone()
        if not saved or any(saved[k] != row[v] for k, v in (('sha', 'sha'), ('body_sha', 'body_sha'), ('body', 'body'), ('fetched_at', 'body_at'))) or saved['body_sha'] != actual:
            return None, 'research-body-integrity-mismatch'
        kind = 'official-story-body'
    elif row.get('general_source') or row.get('issuer_business'):
        if actual != row['body_sha']:
            return None, 'research-body-integrity-mismatch'
        kind = 'issuer-syndication-body' if row.get('issuer_business') else 'general-source-document'
    else:
        saved = db.execute('''SELECT s.sha256,s.body_sha256,r.extracted_text FROM sources s
          JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256 WHERE s.url=?''', (row['url'],)).fetchone()
        if not saved or saved['sha256'] != row['body_sha'] or saved['body_sha256'] != actual or saved['extracted_text'] != body:
            return None, 'research-body-integrity-unavailable'
        kind = 'primary-source-revision'
    proof = None
    if kind == 'official-story-body' and db.execute("SELECT 1 FROM sqlite_master WHERE name='official_story_body_proofs'").fetchone():
        saved_proof = db.execute('SELECT * FROM official_story_body_proofs WHERE event_id=?', (row['id'],)).fetchone()
        if (saved_proof and saved_proof['sha'] == row['sha'] and saved_proof['body_sha'] == row['body_sha']
                and saved_proof['source_url'] == row['url'] and saved_proof['source_title'] == row['title']):
            proof = {'sourceUrl': row['url'], 'sourceTitle': bounded(row['title'], 500),
                     'storedPublishedOn': bounded(saved_proof['published_on'], 128),
                     'storedFetchedAt': bounded(saved_proof['fetched_at'], 128),
                     'extractorVersion': bounded(saved_proof['extractor_version'], 128),
                     'rawContentSha': saved_proof['raw_sha'] if isinstance(saved_proof['raw_sha'], str) and re.fullmatch(r'[a-f0-9]{64}', saved_proof['raw_sha']) else None}
    return {'storageKind': kind, 'revisionSha': row['body_sha'], 'bodyTextSha256': actual,
            'recordedAcquisitionProof': proof,
            'text': body, 'chars': len(body), 'returnedChars': len(body), 'truncated': False,
            'storedBodyAt': bounded(row['body_at'], 128),
            'clockNotice': 'Current retained body retrieval clock, not first acquisition or proof of historical generation.'}, None


def selected_evidence(value, body):
    return {**bounded(value, MAX_EVIDENCE_CHARS),
            'literalCurrentResearchBody': isinstance(value, str) and bool(value) and value in body}


def selected_copy(payload, row):
    # Parse a separate original value. Validators may normalize their own copy;
    # they must never rewrite the JA/EN/evidence exported for editorial review.
    result = {'status': 'unavailable', 'payloadSha256': None, 'fields': [],
              'omittedFacts': 0, 'complete': False}
    if not isinstance(payload, str):
        return result
    result['payloadSha256'] = digest(payload)
    if len(payload.encode('utf-8')) > MAX_PAYLOAD_BYTES:
        result['status'] = 'payload-limit'
        return result
    try:
        value = json.loads(payload)
    except (ValueError, TypeError):
        return result
    if not isinstance(value, dict):
        return result
    facts = value.get('facts')
    fields = [(name, value[name]) for name in ('title', 'summary') if name in value]
    if isinstance(facts, list):
        fields.extend((f'facts[{index}]', item) for index, item in enumerate(facts[:MAX_FACTS]))
        result['omittedFacts'] = max(0, len(facts) - MAX_FACTS)
    if 'purpose' in value:
        fields.append(('purpose', value['purpose']))
    units = {unit['id']: unit['quote'] for unit in row.get('units', []) if isinstance(unit, dict) and isinstance(unit.get('id'), str) and isinstance(unit.get('quote'), str)}
    required = ('facts',) if row.get('general_source') else ('title', 'summary', 'facts', 'purpose')
    complete = result['omittedFacts'] == 0 and isinstance(facts, list) and bool(facts) and all(name in value for name in required)
    for field, item in fields:
        if not isinstance(item, dict):
            complete = False
            continue
        ja, en = bounded(item.get('ja'), MAX_COPY_CHARS), bounded(item.get('en'), MAX_COPY_CHARS)
        quote = selected_evidence(item.get('evidenceQuote'), row['body'])
        evidence_id = item.get('evidenceId')
        known_id = evidence_id if isinstance(evidence_id, str) and evidence_id in units else None
        resolved = selected_evidence(units[known_id], row['body']) if known_id else None
        result['fields'].append({'field': field, 'ja': ja, 'en': en, 'savedEvidenceQuote': quote,
                                 'currentEvidenceId': known_id, 'resolvedCurrentEvidence': resolved})
        evidence_complete = (isinstance(item.get('evidenceQuote'), str) and bool(item['evidenceQuote']) and not quote['truncated']
                             if 'evidenceQuote' in item else bool(resolved and resolved['text'] and not resolved['truncated']))
        complete = (complete and all(v['text'] is not None and not v['truncated'] for v in (ja, en))
                    and evidence_complete and ('evidenceId' not in item or known_id is not None)
                    and not (resolved and resolved['truncated']))
    result.update(status='included', complete=bool(result['fields']) and complete)
    return result


def saved_evidence(value, body):
    if not isinstance(value, str) or len(value.encode('utf-8')) > MAX_PAYLOAD_BYTES:
        return {'status': 'unavailable', 'items': [], 'omitted': None}
    try:
        values = json.loads(value)
    except (ValueError, TypeError):
        return {'status': 'unavailable', 'items': [], 'omitted': None}
    if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
        return {'status': 'unavailable', 'items': [], 'omitted': None}
    return {'status': 'included', 'items': [selected_evidence(v, body) for v in values[:MAX_EVIDENCE]],
            'omitted': max(0, len(values) - MAX_EVIDENCE)}


def derivation_metadata(db, row, saved, reference):
    import buyback_structured_publication as derived
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (derived.AUDIT_TABLE,)).fetchone():
        return None
    audit = db.execute('''SELECT sha,body_sha,policy_version,validated_payload_sha,derived_at
      FROM source_structured_buyback_derivations WHERE event_id=?''', (row['id'],)).fetchone()
    if not audit or audit['sha'] != row['sha'] or audit['body_sha'] != row['body_sha'] or audit['validated_payload_sha'] != digest(saved['payload']):
        return None
    return {'kind': 'source-structured-buyback', 'version': audit['policy_version'],
            'storedDerivedAt': bounded(audit['derived_at'], 128),
            'currentAuditValidated': derived.publication_valid(db, row, saved, reference),
            'firstValidatedAt': None, 'firstRenderedAt': None}


def latest_failure(db, row, job, reference):
    result = {'status': 'unavailable', 'copy': None}
    failure = db.execute('''SELECT * FROM official_research_attempt_failures WHERE event_id=?
      ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1''', (row['id'],)).fetchone()
    if not failure:
        return result
    result.update(reason=diagnostics.failure_kind(failure['reason']), storedFailedAt=bounded(failure['failed_at'], 128))
    proof = (db.execute('SELECT source_sha,body_sha FROM official_research_attempt_body_proofs WHERE lease=?', (failure['lease'],)).fetchone()
             if db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_attempt_body_proofs'").fetchone() else None)
    failed_at = diagnostics.parse_stored_clock(failure['failed_at'])
    observed_at = diagnostics.parse_stored_clock(row['observed_at'])
    if (not job or job['state'] != 'retry' or job['sha'] != row['sha'] or job['lease'] != failure['lease']
            or failure['sha'] != row['sha'] or not proof or proof['source_sha'] != row['sha'] or proof['body_sha'] != row['body_sha']
            or not failed_at or not observed_at or not observed_at <= failed_at <= reference):
        return result
    result.update(status='current-attempt-body-proven', sourceSha=proof['source_sha'], bodySha=proof['body_sha'],
                  copy=selected_copy(failure['payload'], row), validation=diagnostics.validation_report(failure['payload'], row))
    return result


def detail(path, requested_id, expected_source_sha, expected_body_sha, reference=None):
    requested_id = signal_source_detail.event_id(requested_id)
    expected_source_sha, expected_body_sha = revision_hash(expected_source_sha), revision_hash(expected_body_sha)
    reference = reference or datetime.now(timezone.utc)
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA busy_timeout=5000')
        db.execute('BEGIN')
        rows = [row for row in research.candidates(db, reference, read_only=True) if row['id'] == requested_id]
        if len(rows) != 1:
            return None
        row = rows[0]
        sources = {s['id']: s for s in [*research.signals.SOURCES, *research.bridge.publishers()]}
        source = sources.get(row['source_id'])
        if not source or research.signals.safe_url(row['url'], source) != row['url']:
            return None
        result = {'eventId': row['id'], 'readOnly': True, 'generatedAt': reference.isoformat(),
                  'status': 'stale-selection', 'currentRevision': False, 'researchBody': None,
                  'limits': {'bodyChars': MAX_BODY_CHARS, 'payloadBytes': MAX_PAYLOAD_BYTES,
                             'copyFieldChars': MAX_COPY_CHARS, 'evidenceChars': MAX_EVIDENCE_CHARS,
                             'facts': MAX_FACTS, 'selectedEvidence': MAX_EVIDENCE},
                  'publication': None, 'latestFailure': None,
                  'sourceId': row['source_id'], 'url': row['url'], 'title': bounded(row['title'], 500),
                  'sourceSha': row['sha'], 'bodySha': row['body_sha'], 'sourceClock': diagnostics.source_clock(row),
                  'storedObservedAt': bounded(row['observed_at'], 128)}
        if row['sha'] != expected_source_sha or row['body_sha'] != expected_body_sha or not research.current_revision(db, row):
            return result
        body, reason = verified_body(db, row)
        if not body:
            result.update(status=reason, omittedResearchBodyChars=len(row['body']) if isinstance(row.get('body'), str) else None)
            return result
        acquisition = acquisition_metadata(db, row)
        acquisition['matchesResearchBody'] = acquisition.get('bodyTextSha256') == body['bodyTextSha256'] if acquisition.get('bodyTextSha256') else None
        result.update(status='current', currentRevision=True, researchBody=body, acquisition=acquisition)
        job = db.execute('SELECT sha,state,attempts,lease FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
        result['job'] = {'state': job['state'] if job['state'] in {'done','retry','running','stale','review'} else 'unknown',
                         'attempts': job['attempts'], 'currentSourceRevision': job['sha'] == row['sha']} if job else None
        saved = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
        if saved:
            current = saved['sha'] == row['sha'] and saved['body_sha'] == row['body_sha']
            publication = {'present': True, 'currentRevision': current, 'sourceSha': saved['sha'], 'bodySha': saved['body_sha'],
                           'storedClocks': stored_clocks(saved), 'copy': None, 'selectedEvidence': None}
            if current:
                publication.update(copy=selected_copy(saved['payload'], row), selectedEvidence=saved_evidence(saved['evidence'], row['body']),
                                   validation=diagnostics.validation_report(saved['payload'], row),
                                   derivation=derivation_metadata(db, row, saved, reference))
            result['publication'] = publication
        else:
            result['publication'] = {'present': False, 'currentRevision': False, 'copy': None}
        result['latestFailure'] = latest_failure(db, row, job, reference)
        return result
    finally:
        db.close()
