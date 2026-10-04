"""One expiring, reviewed recovery of two exact retained NVIDIA revisions.

This is deterministic editorial copy, never an LLM retry. It spends no provider
budget. The retained-announcement correction archives an invalid prior
publication before replacing it. Source evidence is selected literally
from the retained body; the reviewed data contains only bilingual paraphrases.
"""
from datetime import datetime, timezone
import hashlib
import json
import math
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
    db.execute('''CREATE TABLE IF NOT EXISTS reviewed_retry_article_recoveries(
      event_id INTEGER PRIMARY KEY, manifest_sha TEXT NOT NULL,
      source_id TEXT NOT NULL, event_sha TEXT NOT NULL, body_sha TEXT NOT NULL,
      source_revision TEXT NOT NULL, source_observed_at TEXT NOT NULL,
      source_body_at TEXT NOT NULL, failure_lease TEXT NOT NULL UNIQUE,
      failure_payload_sha TEXT NOT NULL, previous_history TEXT NOT NULL,
      started_at TEXT NOT NULL, public_at TEXT NOT NULL, payload_sha TEXT NOT NULL)''')
    db.execute('''CREATE TABLE IF NOT EXISTS reviewed_retained_announcement_recoveries(
      manifest_sha TEXT NOT NULL, source_url TEXT NOT NULL, body_text_sha TEXT NOT NULL,
      event_id INTEGER NOT NULL, event_sha TEXT NOT NULL, source_revision TEXT NOT NULL,
      source_observed_at TEXT NOT NULL, source_body_at TEXT NOT NULL,
      started_at TEXT NOT NULL, public_at TEXT NOT NULL, payload_sha TEXT NOT NULL,
      PRIMARY KEY(manifest_sha,source_url,body_text_sha))''')
    db.execute('''CREATE TABLE IF NOT EXISTS reviewed_retained_announcement_replacements(
      manifest_sha TEXT NOT NULL, source_url TEXT NOT NULL, body_text_sha TEXT NOT NULL,
      event_id INTEGER NOT NULL, replaced_at TEXT NOT NULL, reason TEXT NOT NULL,
      previous_publication TEXT NOT NULL, previous_job TEXT NOT NULL,
      previous_calls TEXT NOT NULL, publication_call_lease TEXT NOT NULL,
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
RETAINED_COPY_SHA = '52d5c3fbb5d290f22d9e636ee320cf98271633f699254ef6fd26ab26972d1d59'


def retained_candidate(db, pin, reference):
    """Require current validated article evidence, preserving inline feed provenance."""
    if pin.get('provenance') == 'signal-article':
        return retained_signal_article(db, pin, reference)
    import official_release_bridge as bridge
    row = db.execute("""SELECT e.*,s.sha256 AS source_revision,s.content_type,
      s.extractor_version,s.error,s.status,s.source_mode,r.extracted_text AS body,r.observed_at AS body_at,
      s.title AS source_title,s.published_on AS source_date,s.ticker AS source_ticker
      FROM signal_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.source_id=? AND e.url=? ORDER BY e.id DESC LIMIT 1""",
                     (pin['sourceId'], pin['url'])).fetchone()
    if (not row or not bridge.is_current(db, row) or row['truncated']
            or row['title'] != pin['title'] or row['source_title'] != pin['title']
            or row['source_ticker'] != pin['ticker']
            or row['published_on'] != pin['publishedOn'] or row['source_date'] != pin['publishedOn']
            or repair.instant(row['observed_at']) != repair.instant(pin['observedAt'])
            or row['error'] or row['status'] in {'held', 'rejected'}):
        return None
    if any(key in pin and row[column] != pin[key] for key, column in (
            ('eventId', 'id'), ('eventSha', 'sha'), ('sourceRevision', 'source_revision'))):
        return None
    # XML here may be a legitimate inline RSS description. Preserve that
    # source revision; a separately acquired article needs its own proof.
    primary_revision = pin.get('provenance') == 'primary-source-revision'
    if primary_revision:
        from signals import safe_url
        publisher = next((source for source in bridge.publishers() if source['id'] == row['source_id']), None)
        try:
            if not publisher or pin['ticker'] not in publisher['tickers'] or safe_url(row['url'], publisher) != pin['url']:
                return None
        except (ValueError, TypeError):
            return None
        # A stored primary revision identifies its acquisition serialization;
        # it need not equal the hash of its extracted article text. Do not
        # invent a second HTML-fetch proof or replace that revision identity.
        direct = (pin.get('bodyRevisionSha') == row['source_revision']
                  and (row['source_mode'] == 'inline' or row['content_type'] in {None, 'text/html', 'application/pdf'})
                  and 1200 <= len(row['body']) == pin['bodyChars'] <= 160000
                  and digest(row['body']) == pin['bodyTextSha'])
        if not direct:
            return None
    else:
        direct = (row['content_type'] == 'text/html'
                  and row['extractor_version'] == pin['extractorVersion']
                  and len(row['body']) == pin['bodyChars']
                  and digest(row['body']) == pin['bodyTextSha'])
    if not direct:
        cached = db.execute('''SELECT b.*,p.source_url,p.source_title,p.published_on,
          p.extractor_version FROM official_story_bodies b JOIN official_story_body_proofs p
          ON p.event_id=b.event_id AND p.sha=b.sha AND p.body_sha=b.body_sha AND p.fetched_at=b.fetched_at
          WHERE b.event_id=? AND b.sha=?''', (row['id'], row['sha'])).fetchone()
        if (not cached or cached['error'] or cached['source_url'] != pin['url']
                or cached['source_title'] != pin['title'] or cached['published_on'] != pin['publishedOn']
                or cached['extractor_version'] != pin['extractorVersion']
                or cached['body_sha'] != pin['bodyTextSha'] or len(cached['body']) != pin['bodyChars']
                or digest(cached['body']) != pin['bodyTextSha']):
            return None
        row = {**dict(row), 'body': cached['body'], 'body_at': cached['fetched_at']}
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


def retained_signal_article(db, pin, reference):
    """Keep a feed document and its separately proven article as distinct inputs."""
    import official_research as research
    if ('amendment' not in pin
            or pin.get('replacement', {}).get('reason') != 'reviewed-evidence-precision'):
        return None
    rows = [row for row in research.candidates(db, reference, read_only=True)
            if row['id'] == pin['eventId']]
    if len(rows) != 1:
        return None
    row = dict(rows[0])
    if (row.get('general_source') or row.get('issuer_business') or row.get('truncated')
            or row['source_id'].startswith('primary-ir-')
            or any(row.get(column) != pin[key] for key, column in (
                ('sourceId', 'source_id'), ('ticker', 'ticker'), ('url', 'url'),
                ('title', 'title'), ('eventSha', 'sha'), ('publishedOn', 'published_on'),
                ('publishedAt', 'published_at')))
            or repair.instant(row['observed_at']) != repair.instant(pin['observedAt'])
            or row['body_sha'] != pin['bodyTextSha']
            or not 120 <= len(row['body']) == pin['bodyChars'] <= 160000
            or digest(row['body']) != pin['bodyTextSha']
            or not research.current_revision(db, row)):
        return None
    snapshot = retry_source_snapshot(db, pin)
    policy = json.loads(snapshot['policy'])
    document, cached, proof = (snapshot[key] for key in ('document', 'cache', 'proof'))
    if (not policy or policy.get('enabled') is False or policy.get('officialUpdates') is not True
            or policy.get('requireCurrentDocument') is not True or policy.get('format') != 'feed'
            or not document or document['sha'] != pin['sourceRevision']
            or document['sha'] != row['sha'] or document['title'] != row['title']
            or len(document['text']) != pin['acquisitionChars']
            or digest(document['text']) != pin['acquisitionTextSha']
            or digest(document['title'] + '\n' + document['text']) != document['sha']
            or not cached or cached['error'] or cached['sha'] != row['sha']
            or cached['body_sha'] != row['body_sha'] or cached['body'] != row['body']
            or cached['fetched_at'] != row['body_at']
            or not proof or proof['sha'] != row['sha'] or proof['body_sha'] != row['body_sha']
            or proof['fetched_at'] != cached['fetched_at'] or proof['source_url'] != row['url']
            or proof['source_title'] != row['title'] or proof['published_on'] != pin['bodyPublishedOn']
            or proof['extractor_version'] != pin['extractorVersion']
            or proof['raw_sha'] != pin['rawContentSha']):
        return None
    observed, body_at = repair.instant(row['observed_at']), repair.instant(row['body_at'])
    reviewed_body_at = repair.instant(pin['bodyFetchedAt'])
    if (not observed or not body_at or not reviewed_body_at
            or not observed <= reviewed_body_at <= body_at <= reference
            or (pin.get('allowSameBodyRefetch') is not True and body_at != reviewed_body_at)
            or (reference - observed).total_seconds() > 7 * 86400):
        return None
    # Explicit opt-in treats the reviewed fetch clock as a lower bound only
    # after every source/body/provenance pin above matches. Even a same-body
    # re-fetch during validation changes the snapshot and prevents this commit.
    # The existing under-lock candidate comparison now covers the complete
    # policy/document/cache/proof snapshot without fabricating a primary row.
    return {**row, 'source_revision': document['sha'], '_reviewed_source_snapshot': snapshot}


def retained_amendment(row, pin, previous):
    """Change one reviewed fact-language cell in an exact, already saved payload."""
    amendment = pin['amendment']
    if (pin.get('provenance') != 'signal-article' or 'copy' in pin or not previous
            or not isinstance(amendment, dict)
            or set(amendment) != {'field', 'language', 'beforeSha', 'text', 'evidenceSpan'}
            or pin['replacement']['reason'] != 'reviewed-evidence-precision'
            or digest(previous['payload']) != pin['replacement']['payloadSha']
            or not pin.get('reviewedPayloadSha')):
        raise ValueError('changed-reviewed-copy')
    field = re.fullmatch(r'facts\[([0-4])\]', amendment['field'])
    note = json.loads(previous['payload'])
    if (not field or amendment['language'] not in {'ja', 'en'}
            or not isinstance(note, dict) or set(note) != {'title', 'summary', 'facts', 'purpose'}
            or not isinstance(note['facts'], list) or not 3 <= len(note['facts']) <= 5
            or int(field[1]) >= len(note['facts'])):
        raise ValueError('changed-reviewed-copy')
    item = note['facts'][int(field[1])]
    span = amendment['evidenceSpan']
    if (not isinstance(span, dict) or set(span) != {'start', 'end', 'sha256'}
            or type(span['start']) is not int or type(span['end']) is not int
            or not 0 <= span['start'] < span['end'] <= len(row['body'])
            or not 16 <= span['end'] - span['start'] <= MAX_EVIDENCE_CHARS):
        raise ValueError('unsafe-editorial-evidence')
    quote = row['body'][span['start']:span['end']]
    if (not isinstance(item, dict) or set(item) != {'ja', 'en', 'evidenceQuote'}
            or item['evidenceQuote'] != quote or digest(quote) != span['sha256']
            or not isinstance(item[amendment['language']], str)
            or digest(item[amendment['language']]) != amendment['beforeSha']):
        raise ValueError('changed-reviewed-evidence')
    item[amendment['language']] = amendment['text']
    if digest(json.dumps(note, ensure_ascii=False)) != pin['reviewedPayloadSha']:
        raise ValueError('changed-reviewed-copy')
    return note


def retained_note(row, pin, previous=None):
    if 'amendment' in pin:
        return retained_amendment(row, pin, previous)
    copy = pin['copy']
    if set(copy) != {'title', 'summary', 'facts', 'purpose'} or not 3 <= len(copy['facts']) <= 5:
        raise ValueError('changed-reviewed-copy')
    def bind(item):
        if set(item) == {'ja', 'en', 'evidenceSpan'}:
            # Preserve a reviewed, already selected contiguous source window,
            # including its exact whitespace, without copying the article into
            # the manifest. The complete source and reconstructed payload are
            # separately hash-bound to the reviewed correction.
            span = item['evidenceSpan']
            if (pin.get('provenance') != 'primary-source-revision'
                    or not pin.get('reviewedPayloadSha')
                    or not isinstance(span, dict) or set(span) != {'start', 'end', 'sha256'}
                    or type(span['start']) is not int or type(span['end']) is not int
                    or not 0 <= span['start'] < span['end'] <= len(row['body'])
                    or not 16 <= span['end'] - span['start'] <= MAX_EVIDENCE_CHARS):
                raise ValueError('unsafe-editorial-evidence')
            quote = row['body'][span['start']:span['end']]
            if digest(quote) != span['sha256'] or '\x00' in quote:
                raise ValueError('changed-reviewed-evidence')
        elif set(item) == {'ja', 'en', 'anchors'}:
            quote = selected_paragraphs(row['body'], item['anchors'])
        else:
            raise ValueError('changed-reviewed-copy')
        return {'ja': item['ja'], 'en': item['en'], 'evidenceQuote': quote}
    note = {**{key: bind(copy[key]) for key in ('title', 'summary', 'purpose')},
            'facts': [bind(item) for item in copy['facts']]}
    if pin.get('reviewedPayloadSha') and digest(json.dumps(note, ensure_ascii=False)) != pin['reviewedPayloadSha']:
        raise ValueError('changed-reviewed-copy')
    return note


def retained_call_history(db, row):
    calls = [dict(call) for call in db.execute('''SELECT * FROM signal_headline_translation_calls
      WHERE source_id=? AND sha=? ORDER BY at,lease''', ('research:'+row['source_id'], row['sha']))]
    job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    return (dict(job) if job else None), calls


def replaceable_retained_publication(db, previous, row, pin, validator):
    """Require the reviewed failure and an unambiguous original model call."""
    if previous['sha'] != row['sha']:
        return None
    replacement = pin.get('replacement')
    reason = 'source-event-identity-mismatch'
    if replacement:
        reason = replacement['reason']
        if (reason not in {'changed-rollout-status', 'unsupported-comparison-baseline', 'reviewed-evidence-precision'}
                or previous['body_sha'] != pin.get('bodyRevisionSha', pin['bodyTextSha'])
                or digest(previous['payload']) != replacement['payloadSha']
                or any(previous[column] != replacement[key] for key, column in (
                    ('bodySha', 'body_sha'), ('startedAt', 'started_at'),
                    ('publicAt', 'public_at'), ('generationMs', 'generation_ms')))):
            return None
    elif previous['body_sha'] == pin['bodyTextSha']:
        return None
    try:
        note = json.loads(previous['payload'])
        if not isinstance(note, dict):
            return None
        validator({key: note[key] for key in ('title', 'summary', 'facts', 'purpose')},
                  row['body'], row['title'])
    except ValueError as exc:
        if reason == 'reviewed-evidence-precision' or str(exc) != reason:
            return None
    except (TypeError, KeyError):
        return None
    else:
        # A source-reviewed precision correction can replace a generically
        # valid copy only when the manifest explicitly pins that exact payload,
        # body, publication clocks and completed model attempt above and below.
        if reason != 'reviewed-evidence-precision':
            return None
    started = repair.instant(previous['started_at'])
    job, calls = retained_call_history(db, row)
    if (pin.get('provenance') == 'signal-article'
            and any(call['state'] not in {'done', 'failed', 'stale'} for call in calls)):
        return None
    matching = [call for call in calls if started and call['state'] == 'done'
                and abs(call['at']-started.timestamp()) < 0.001]
    if (len(matching) != 1 or not job or job['sha'] != row['sha']
            or job['state'] != 'done' or job['lease'] != matching[0]['lease']
            or (replacement and job['attempts'] != replacement['jobAttempts'])):
        return None
    return {'publication': dict(previous), 'job': job, 'calls': calls,
            'callLease': matching[0]['lease'], 'reason': reason}


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
    def record(value):
        return dict(value) if value is not None else None

    def consumed(pin, row):
        if not pin.get('replacement'):
            # Adding an unrelated reviewed entry changes the manifest hash,
            # not this recovery's identity. A withdrawn publication must stay
            # withdrawn. New source/body revisions remain separately eligible.
            return db.execute('''SELECT 1 FROM reviewed_retained_announcement_recoveries
              WHERE event_id=? AND event_sha=? AND source_revision=?
              AND source_url=? AND body_text_sha=? LIMIT 1''',
                              (row['id'], row['sha'], row['source_revision'],
                               pin['url'], pin['bodyTextSha'])).fetchone()
        return db.execute('''SELECT 1 FROM reviewed_retained_announcement_recoveries
          WHERE manifest_sha=? AND source_url=? AND body_text_sha=?''',
                          (RETAINED_COPY_SHA, pin['url'], pin['bodyTextSha'])).fetchone()

    db.commit()
    retry_result = publish_retry_articles(db, manifest.get('retryArticles', []), reference, validator)
    if retry_result:
        return retry_result
    for pin in manifest['announcements']:
        row = record(retained_candidate(db, pin, reference))
        if row is None or consumed(pin, row):
            continue
        previous = record(db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone())
        if pin.get('replacement') and previous is None:
            continue  # This reviewed correction cannot recreate a withdrawn copy.
        archive = None
        if previous:
            archive = replaceable_retained_publication(db, previous, row, pin, validator)
            if archive is None:
                continue
        primary_revision = pin.get('provenance') == 'primary-source-revision'
        publication_body_sha = pin.get('bodyRevisionSha', pin['bodyTextSha'])
        if primary_revision:
            import official_research as research
            # Use the ordinary current issuer candidate before validation. All
            # of its source/event/text inputs are rechecked under the lock below.
            matches = [r for r in research.candidates(db, reference, read_only=True, primary_only=True)
                       if r['id'] == row['id']]
            if (len(matches) != 1 or matches[0]['ticker'] != pin['ticker']
                    or matches[0]['body_sha'] != publication_body_sha or matches[0]['body'] != row['body']
                    or matches[0]['sha'] != row['sha'] or not research.current_revision(db, matches[0])):
                continue
        cached = record(db.execute('SELECT * FROM official_story_bodies WHERE event_id=?', (row['id'],)).fetchone())
        if cached and (cached['sha'] != row['sha'] or cached['body_sha'] not in {pin['bodyTextSha'], publication_body_sha}
                       or cached['body'] != row['body'] or cached['error']):
            continue
        started = time.monotonic()
        started_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
        try:
            note = retained_note(row, pin, previous)
            exact = json.dumps(note, ensure_ascii=False, sort_keys=True)
            validator(note, row['body'], row['title'])
            if json.dumps(note, ensure_ascii=False, sort_keys=True) != exact:
                return False
        except (ValueError, TypeError, KeyError):
            return False
        # Pure validation must not hold SQLite's writer slot. Recheck all input
        # snapshots after acquiring the short archive/publication transaction.
        db.commit()
        with db:
            db.execute('BEGIN IMMEDIATE')
            if (record(retained_candidate(db, pin, reference)) != row or consumed(pin, row)
                    or record(db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()) != previous
                    or record(db.execute('SELECT * FROM official_story_bodies WHERE event_id=?', (row['id'],)).fetchone()) != cached):
                continue
            if archive and retained_call_history(db, row) != (archive['job'], archive['calls']):
                continue
            public_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            note.update(generationMethod=GENERATION_METHOD, reviewedCopySha256=RETAINED_COPY_SHA)
            payload = json.dumps(note, ensure_ascii=False)
            if not cached and not primary_revision:
                db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,?)',
                           (row['id'], row['sha'], pin['bodyTextSha'], row['body'], row['body_at'], reference.timestamp()+900, None))
            if archive:
                db.execute('''INSERT INTO reviewed_retained_announcement_replacements
                  VALUES(?,?,?,?,?,?,?,?,?,?)''',
                           (RETAINED_COPY_SHA, pin['url'], pin['bodyTextSha'], row['id'], public_at,
                            archive['reason'], json.dumps(archive['publication'], ensure_ascii=False),
                            json.dumps(archive['job'], ensure_ascii=False), json.dumps(archive['calls'], ensure_ascii=False),
                            archive['callLease']))
            db.execute('''INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)
              ON CONFLICT(event_id) DO UPDATE SET sha=excluded.sha,body_sha=excluded.body_sha,
              payload=excluded.payload,evidence=excluded.evidence,started_at=excluded.started_at,
              public_at=excluded.public_at,generation_ms=excluded.generation_ms''',
                       (row['id'], row['sha'], publication_body_sha, payload,
                        json.dumps([item['evidenceQuote'] for item in [note['title'], note['summary'], *note['facts'], note['purpose']]]),
                        started_at, public_at, round((time.monotonic()-started)*1000)))
            db.execute('INSERT INTO reviewed_retained_announcement_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                       (RETAINED_COPY_SHA, pin['url'], pin['bodyTextSha'], row['id'], row['sha'], row['source_revision'],
                        row['observed_at'], row['body_at'], started_at, public_at, digest(payload)))
            return True
    return False


def retry_source_snapshot(db, pin):
    """Exact current evidence and source policy, with no projection or writes."""
    import signals
    import official_release_bridge as bridge
    def record(sql, args):
        row = db.execute(sql, args).fetchone()
        return dict(row) if row is not None else None
    event_id, url = pin['eventId'], pin['url']
    source = next((s for s in [*signals.SOURCES, *bridge.publishers()]
                   if s['id'] == pin['sourceId']), None)
    result = {
        'policy': json.dumps(source, ensure_ascii=False, sort_keys=True),
        'event': record('SELECT * FROM signal_events WHERE id=?', (event_id,)),
        'cache': record('SELECT * FROM official_story_bodies WHERE event_id=?', (event_id,)),
        'proof': record('SELECT * FROM official_story_body_proofs WHERE event_id=?', (event_id,)),
    }
    if pin['provenance'] == 'primary-article':
        result['source'] = record('SELECT * FROM sources WHERE url=?', (url,))
        result['revision'] = record('SELECT * FROM source_revisions WHERE url=? AND sha256=?',
                                    (url, pin['sourceRevision']))
    elif pin['provenance'] in {'signal-document', 'signal-article', 'issuer-business-document'}:
        result['document'] = record('SELECT * FROM signal_documents WHERE source_id=? AND url=?',
                                    (pin['sourceId'], url))
    if pin['provenance'] == 'issuer-business-document':
        result['syndication'] = record('SELECT * FROM issuer_syndication_bodies WHERE event_id=?', (event_id,))
    return result


def retry_candidate(db, pin, reference, rows):
    """Use the normal configured issuer projection, then bind the reviewed body."""
    import official_research as research
    matches = [r for r in rows if r['id'] == pin['eventId']]
    if len(matches) != 1:
        return None
    row = dict(matches[0])
    issuer_business = pin['provenance'] == 'issuer-business-document'
    if (row.get('general_source') or bool(row.get('issuer_business')) != issuer_business or row.get('truncated')
            or any(row.get(column) != pin[key] for key, column in (
                ('sourceId', 'source_id'), ('ticker', 'ticker'), ('url', 'url'),
                ('title', 'title'), ('eventSha', 'sha'), ('publishedOn', 'published_on'),
                ('publishedAt', 'published_at')))
            or repair.instant(row['observed_at']) != repair.instant(pin['observedAt'])
            or row['body_sha'] != pin['bodyTextSha'] or len(row['body']) != pin['bodyChars']
            or digest(row['body']) != pin['bodyTextSha'] or not research.current_revision(db, row,
                require_fresh_category=pin.get('requireFreshCategory') is True)):
        return None
    snapshot = retry_source_snapshot(db, pin)
    policy = json.loads(snapshot['policy'])
    if issuer_business:
        return retry_issuer_candidate(row, pin, reference, snapshot)
    if not policy or policy.get('enabled') is False or policy.get('officialUpdates') is not True:
        return None
    cached = snapshot['cache']
    if (not cached or cached['error'] or cached['sha'] != row['sha']
            or cached['body_sha'] != row['body_sha'] or cached['body'] != row['body']):
        return None
    if pin['provenance'] == 'primary-article':
        proven = retained_candidate(db, pin, reference)
        if not proven or proven['body'] != row['body'] or proven['body_at'] != row['body_at']:
            return None
    elif pin['provenance'] == 'signal-document':
        document = snapshot['document']
        if (not document or document['sha'] != pin['sourceRevision']
                or document['sha'] != row['sha'] or document['title'] != row['title']
                or document['text'] != row['body']
                or digest(document['title'] + '\n' + document['text']) != row['sha']):
            return None
    else:
        return None
    observed, body_at = repair.instant(row['observed_at']), repair.instant(row['body_at'])
    if (not observed or not body_at or not observed <= body_at <= reference
            or (reference - observed).total_seconds() > 7 * 86400):
        return None
    row['source_revision'] = pin['sourceRevision']
    return row, snapshot



def retry_issuer_candidate(row, pin, reference, snapshot):
    """Bind a reviewed distributor document through its normal issuer proof.

    Unlike feed/primary recovery, this route's authoritative body lives in
    issuer_syndication_bodies. Never manufacture an official body cache or make
    a distributor a generally approved issuer source.
    """
    import issuer_business_news as issuer
    policy = json.loads(snapshot['policy'])
    document, source = snapshot.get('document'), snapshot.get('syndication')
    metadata = row.get('issuer_metadata')
    if (not policy or policy.get('enabled') is False
            or pin.get('issuerBusinessPolicy') != issuer.POLICY
            or row['source_id'] not in issuer.syndication.SOURCES
            or not metadata or metadata.get('issuer') != pin.get('issuer')
            or not document or document['sha'] != pin['sourceRevision']
            or document['sha'] != row['sha'] or document['title'] != row['title']
            or document['text'] != row['body']
            or digest(document['title'] + '\n' + document['text']) != row['sha']
            or not source or source['error'] or source['sha'] != row['sha']
            or source['body_sha'] != row['body_sha'] or source['body'] != row['body']
            or source['fetched_at'] != pin['bodyFetchedAt']
            or source['fetched_at'] != row['body_at']):
        return None
    try:
        if json.loads(source['metadata']) != metadata:
            return None
    except (ValueError, TypeError):
        return None
    observed, body_at = repair.instant(row['observed_at']), repair.instant(row['body_at'])
    if (not observed or not body_at or not observed <= body_at <= reference
            or (reference - observed).total_seconds() > 7 * 86400):
        return None
    row['source_revision'] = pin['sourceRevision']
    return row, snapshot


def retry_history(db, pin):
    """Keep all failed outputs and paid-call states unchanged, including older tries."""
    event_id = pin['eventId']
    job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (event_id,)).fetchone()
    failures = [dict(r) for r in db.execute('''SELECT * FROM official_research_attempt_failures
      WHERE event_id=? ORDER BY julianday(failed_at),rowid''', (event_id,))]
    calls = [dict(r) for r in db.execute('''SELECT * FROM signal_headline_translation_calls
      WHERE source_id=? AND sha=? ORDER BY at,lease''', ('research:' + pin['sourceId'], pin['eventSha']))]
    proofs = [dict(r) for r in db.execute('''SELECT p.* FROM official_research_attempt_body_proofs p
      JOIN official_research_attempt_failures f ON f.lease=p.lease
      WHERE f.event_id=? ORDER BY p.lease''', (event_id,))]
    return {'job': dict(job) if job else None, 'failures': failures, 'calls': calls, 'bodyProofs': proofs}


def retry_failure(db, pin, reference):
    """A pinned latest rejection must belong to the current closed retry lease."""
    if (db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (pin['eventId'],)).fetchone()
            or db.execute('SELECT 1 FROM reviewed_retry_article_recoveries WHERE event_id=?', (pin['eventId'],)).fetchone()):
        return None
    history = retry_history(db, pin)
    job, failures = history['job'], history['failures']
    expected = pin['failure']
    if not job or not failures or max(len(failures), len(history['calls']), len(history['bodyProofs'])) > 100:
        return None
    times = [repair.instant(failure['failed_at']) for failure in failures]
    if any(at is None or at > reference for at in times) or len(set(times)) != len(times):
        return None
    failure = max(failures, key=lambda value: repair.instant(value['failed_at']))
    payload = failure['payload']
    if (job['sha'] != pin['eventSha'] or job['state'] != 'retry'
            or job['attempts'] != expected['attempts'] or job['failure_kind'] != expected['reason']
            or not job['lease'] or job['lease'] != failure['lease']
            or failure['sha'] != pin['eventSha'] or failure['reason'] != expected['reason']
            or failure['failed_at'] != expected['failedAt']
            or not isinstance(payload, str) or not 1 <= len(payload) <= 131072
            or digest(payload) != expected['payloadSha']):
        return None
    observed_at = repair.instant(pin['observedAt'])
    if (not observed_at or any(call['state'] == 'running' for call in history['calls'])
            or any(not isinstance(call['at'], (int, float)) or not math.isfinite(call['at'])
                   for call in history['calls'])):
        return None
    # The copy review may precede an ordinary later retry. Bind both the exact
    # reviewed original and the separately refreshed latest failed attempt.
    for required in (pin['reviewedFailure'], expected):
        selected = [f for f in failures if f['sha'] == pin['eventSha']
                    and f['failed_at'] == required['failedAt'] and f['reason'] == required['reason']
                    and isinstance(f['payload'], str) and 1 <= len(f['payload']) <= 131072
                    and digest(f['payload']) == required['payloadSha']]
        if len(selected) != 1:
            return None
        selected = selected[0]
        matching = [call for call in history['calls'] if call['lease'] == selected['lease']]
        proof = [proof for proof in history['bodyProofs'] if proof['lease'] == selected['lease']]
        failed_at = repair.instant(selected['failed_at'])
        if (len(matching) != 1 or matching[0]['state'] != 'failed' or len(proof) != 1
                or proof[0]['source_sha'] != pin['eventSha'] or proof[0]['body_sha'] != pin['bodyTextSha']
                or not observed_at <= failed_at <= reference
                or not observed_at.timestamp() <= matching[0]['at'] <= failed_at.timestamp()):
            return None
    return history


def publish_retry_articles(db, pins, reference, validator):
    """Publish only reviewed retry copies; validation runs outside the writer lock."""
    if not pins:
        return False
    reviewed_sha = RETAINED_COPY_SHA
    pending = [(pin, history) for pin in pins if (history := retry_failure(db, pin, reference)) is not None]
    if not pending:
        return False  # Completed or mismatched pins must not trigger repeated projection scans.
    import official_research as research
    # This is the ordinary source/issuer projection, not a manifest ticker override.
    rows = research.candidates(db, reference, read_only=True)
    for pin, history in pending:
        candidate = retry_candidate(db, pin, reference, rows)
        if candidate is None:
            continue
        row, source_snapshot = candidate
        started = time.monotonic()
        started_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
        try:
            note = retained_note(row, pin)
            exact = json.dumps(note, ensure_ascii=False, sort_keys=True)
            validator(note, row['body'], row['title'])
            if row.get('issuer_business'):
                import issuer_business_news as issuer
                issuer.validate_paraphrase(note)
            if json.dumps(note, ensure_ascii=False, sort_keys=True) != exact:
                return 'blocked'
        except (ValueError, TypeError, KeyError):
            return 'blocked'
        note.update(generationMethod=GENERATION_METHOD, reviewedCopySha256=RETAINED_COPY_SHA)
        if row.get('issuer_business'):
            note['issuerBusinessPolicy'] = issuer.POLICY
        payload = json.dumps(note, ensure_ascii=False)
        evidence = json.dumps([item['evidenceQuote'] for item in
                               [note['title'], note['summary'], *note['facts'], note['purpose']]])
        archived_history = json.dumps(history, ensure_ascii=False)
        failure = next(f for f in history['failures'] if f['lease'] == history['job']['lease'])
        db.commit()
        with db:
            db.execute('BEGIN IMMEDIATE')
            if (RETAINED_COPY_SHA != reviewed_sha or hashlib.sha256(RETAINED_COPY_PATH.read_bytes()).hexdigest() != reviewed_sha
                    or retry_source_snapshot(db, pin) != source_snapshot
                    or not research.current_revision(db, row,
                        require_fresh_category=pin.get('requireFreshCategory') is True)
                    or retry_failure(db, pin, reference) != history):
                continue
            public_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds')
            db.execute('INSERT INTO reviewed_retry_article_recoveries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                       (row['id'], RETAINED_COPY_SHA, row['source_id'], row['sha'], row['body_sha'],
                        row['source_revision'], row['observed_at'], row['body_at'], failure['lease'],
                        digest(failure['payload']), archived_history,
                        started_at, public_at, digest(payload)))
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                       (row['id'], row['sha'], row['body_sha'], payload, evidence,
                        started_at, public_at, round((time.monotonic() - started) * 1000)))
            changed = db.execute("""UPDATE official_research_jobs SET state='done'
              WHERE event_id=? AND sha=? AND lease=? AND attempts=? AND state='retry'""",
                                 (row['id'], row['sha'], history['job']['lease'], history['job']['attempts']))
            if changed.rowcount != 1:
                raise ValueError('changed-editorial-recovery-job')
            return True
    return False
