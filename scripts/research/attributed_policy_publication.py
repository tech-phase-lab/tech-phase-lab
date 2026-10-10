"""Audited, zero-retry attributed-policy copy after the existing materiality assessment.

The complete source supplies all public wording. A grammar match is not a
materiality decision. Original source, model, job, failure and call rows remain
immutable during held recovery; missing/damaged proof never licenses a retry.
"""
from datetime import datetime, timedelta, timezone
import json
import re
import time

import general_source_news as news
import financing_policy_source as grammar
from macro_source_publication import (
    clock_valid, current_row, decision_after_failure, encoded, exists, ownership_reason, ownership_state,
    positive, result_public_page, retained, selection_snapshot, source_snapshot, unowned,
)
import signals

VERSION = 1
MARKER = 'sourcePolicyDerivation'
AUDIT_TABLE = 'source_policy_news_derivations'
ROUTE_TABLE = 'source_policy_route_owners'
POLICY = ('For a completely recognized attributed policy report, assess its materiality as '
          'general economic or policy news independently of company or ticker mapping. Preserve '
          'the speaker as attribution context for all claims, approximation, past assessment, '
          'commitment and negative desire. Unsupported or non-material items must remain review. '
          'Use the existing publish/review schema and the same single assessment call. On a positive '
          'materiality decision, the application renders the complete source-bound report '
          'deterministically; model wording does not supply public facts.')
SOURCE_FIELDS = ('id', 'source_id', 'url', 'sha', 'title', 'tickers_json', 'matches_json',
                 'event_kind', 'published_at', 'observed_at', 'truncated', 'body', 'body_sha',
                 'body_at', 'ticker', 'category', 'units', 'source_news', 'related_tickers', 'related_subject')


def route_schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS source_policy_route_owners(
      origin TEXT NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,
      source_id TEXT NOT NULL,event_id INTEGER NOT NULL,policy_version INTEGER NOT NULL,
      source_snapshot TEXT NOT NULL,assigned_at TEXT NOT NULL,
      PRIMARY KEY(origin,sha))''')


def schema(db):
    route_schema(db)
    db.execute('''CREATE TABLE IF NOT EXISTS source_policy_news_derivations(
      event_id INTEGER NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,
      mode TEXT NOT NULL,lease TEXT NOT NULL,policy_version INTEGER NOT NULL,
      source_snapshot TEXT NOT NULL,original_artifacts TEXT NOT NULL,
      original_response TEXT NOT NULL,publication_snapshot TEXT NOT NULL,
      validated_payload_sha TEXT NOT NULL,derivation_started_at TEXT NOT NULL,
      derived_at TEXT NOT NULL,PRIMARY KEY(event_id,sha,body_sha))''')
    db.execute('''CREATE TABLE IF NOT EXISTS source_policy_assessment_proofs(
      lease TEXT PRIMARY KEY,event_id INTEGER NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,
      raw_response TEXT NOT NULL,raw_response_sha TEXT NOT NULL,completed_at TEXT NOT NULL)''')


def recognized(row):
    if not (row.get('general_source') and row.get('source_news') and row.get('semantic_assessment')):
        return False
    try:
        return type(grammar.parse(row['body'])) is grammar.PolicyReport
    except (ValueError, TypeError, KeyError):
        return False


def derived_note(row):
    if not (row.get('general_source') and row.get('source_news') and row.get('semantic_assessment')):
        raise ValueError('changed-source-news-claim')
    try:
        report = grammar.parse(row['body'])
        if type(report) is not grammar.PolicyReport:
            raise ValueError('unsupported-policy-report')
        copy = grammar.render(report)
    except (ValueError,TypeError,KeyError) as exc:
        raise ValueError('changed-source-news-claim') from exc
    if any(len(copy[key]) > 180 for key in ('titleJa', 'titleEn')):
        raise ValueError('invalid-copy')
    # The complete source, including its header, proves every displayed row.
    # This is a new typed note, never a claim that the rejected unit map passed.
    paragraphs = {lang: '\n\n'.join(fact[lang] for fact in copy['facts']) for lang in ('ja', 'en')}
    return {'generalSourceVersion': news.VERSION,
            'semanticAssessment': {'version': news.ASSESSMENT_VERSION, 'disposition': 'publish',
                                   'reason': 'material-company-development'},
            MARKER: {'version': VERSION, 'parserVersion': grammar.VERSION},
            'policyTitles': {'ja': copy['titleJa'], 'en': copy['titleEn'],
                             'shortJa': 'ハセット氏、雇用報告はおおむね予想通りと発言',
                             'shortEn': 'Hassett: Jobs report was broadly as expected'},
            'facts': [{'ja': paragraphs['ja'], 'en': paragraphs['en'], 'evidenceQuote': row['body']}]}


def bind(value, row):
    if not positive(value):
        raise ValueError('invalid-note')
    return derived_note(row)


def validate_note(note, row):
    if encoded(note) != encoded(derived_note(row)):
        raise ValueError('changed-source-news-claim')
    return note


def public_item(row, note):
    validate_note(note, row)
    copy = note['facts'][0]
    return {'id': str(row['id']), 'title': note['policyTitles']['en'],
            'translationJa': note['policyTitles']['ja'],
            'shortTitleJa': note['policyTitles']['shortJa'], 'shortTitleEn': note['policyTitles']['shortEn'],
            'url': row['url'],
            'publisher': 'Reported economic news', 'newsCategory': 'policy',
            'tickers': [],
            'publishedAt': row['published_at'], 'observedAt': row['observed_at'],
            'bodyJa': copy['ja'], 'bodyEn': copy['en'], 'generalSource': news.VERSION}


def review_for(db, row):
    value = db.execute('''SELECT * FROM general_source_semantic_reviews
      WHERE event_id=? AND sha=? AND body_sha=?''', (row['id'], row['sha'], row['body_sha'])).fetchone()
    return dict(value) if value else None


def artifacts(db, row):
    job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    failures = [dict(value) for value in db.execute('SELECT * FROM official_research_attempt_failures WHERE event_id=? ORDER BY lease', (row['id'],))]
    leases = sorted({value['lease'] for value in failures} | ({job['lease']} if job else set()))
    proofs = []
    for lease in leases:
        proof = db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?', (lease,)).fetchone()
        if proof:
            proofs.append(dict(proof))
    marks = ','.join('?' for _ in leases) or '?'
    calls = [dict(value) for value in db.execute('''SELECT * FROM signal_headline_translation_calls
      WHERE (source_id=? AND sha=?) OR lease IN (''' + marks + ') ORDER BY lease',
      ('research:' + row['source_id'], row['sha'], *(leases or [None])))]
    assessments = ([dict(value) for value in db.execute('SELECT * FROM source_policy_assessment_proofs WHERE event_id=? ORDER BY lease', (row['id'],))]
                   if exists(db, 'source_policy_assessment_proofs') else [])
    return {'job': dict(job) if job else None, 'failures': failures, 'proofs': proofs,
            'calls': calls, 'assessment_proofs': assessments, 'review': review_for(db, row)}


class PublicReadContext:
    """One request only; source selection precedes any proof reuse.

    No process/cross-request cache or database mutation. A concurrent commit or
    same-connection mutation invalidates every policy result for this request.
    """
    def __init__(self, db, reference):
        self.db = db
        self.reference = reference
        self.changes = db.total_changes
        self.data_version = db.execute('PRAGMA data_version').fetchone()[0]
        self.policy = self.policy_identity()
        self.rows = {}
        self.audits = {}
        self.checks = {}
        self._public_page = None

    @staticmethod
    def policy_identity():
        return (VERSION,grammar.VERSION,news.ASSESSMENT_VERSION,id(grammar.parse),id(grammar.render),
                id(derived_note),id(news.assess),id(closed_proof),id(positive),
                encoded([source for source in signals.SOURCES if source['id'] in news.SOURCE_IDS]))

    def bind_rows(self, rows):
        self.rows = {row['id']:encoded({key:row.get(key) for key in SOURCE_FIELDS}) for row in rows}
        if self.rows and exists(self.db,AUDIT_TABLE):
            marks=','.join('?' for _ in self.rows)
            self.audits={(audit['event_id'],audit['sha'],audit['body_sha']):dict(audit)
                         for audit in self.db.execute('SELECT * FROM '+AUDIT_TABLE+' WHERE event_id IN ('+marks+')',tuple(self.rows))}

    def recorded(self,row):
        return (row['id'],row['sha'],row['body_sha']) in self.audits

    def current(self,row):
        return self.rows.get(row['id']) == encoded({key:row.get(key) for key in SOURCE_FIELDS})

    def public_page(self):
        if self._public_page is None:
            self._public_page=result_public_page(self.db,self.reference)
        return self._public_page

    def unchanged(self):
        return (self.db.total_changes == self.changes and self.policy == self.policy_identity()
                and self.db.execute('PRAGMA data_version').fetchone()[0] == self.data_version)


def closed_proof(row, original, raw, mode, reference):
    """Full retained assessment JSON plus one unambiguous current attempt.

    The real historical writer stores parsed schema assessment JSON only after
    status=completed and extraction. This is not a raw HTTP provider envelope,
    proof of valid model wording, or a reassessment under the policy prompt.
    """
    try:
        value = json.loads(raw)
        if not recognized(row) or not positive(value):
            return False
        job, review = original['job'], original['review']
        if (not job or job['sha'] != row['sha'] or not isinstance(job['lease'], str)
                or type(job['attempts']) is not int or job['attempts'] != 1):
            return False
        current_calls = [call for call in original['calls']
                         if call['source_id'] == 'research:' + row['source_id'] and call['sha'] == row['sha']]
        if len(current_calls) != 1:
            return False
        calls = [call for call in original['calls'] if call['lease'] == job['lease']]
        proofs = [proof for proof in original['proofs'] if proof['lease'] == job['lease']]
        if len(calls) != 1 or len(proofs) != 1:
            return False
        call, proof = calls[0], proofs[0]
        start = datetime.fromtimestamp(call['at'], timezone.utc)
        if (call['source_id'] != 'research:' + row['source_id'] or call['sha'] != row['sha']
                or proof['source_sha'] != row['sha'] or proof['body_sha'] != row['body_sha']
                or not news.reconciliation.instant(row['body_at']) <= start <= reference):
            return False
        failures = [failure for failure in original['failures'] if failure['sha'] == row['sha']]
        if mode == 'held-correction':
            current_calls = [call for call in original['calls']
                             if call['source_id'] == 'research:' + row['source_id'] and call['sha'] == row['sha']]
            if (len(current_calls) != 1 or len(failures) != 1 or job['attempts'] != 1
                    or job['state'] != 'review' or call['state'] != 'failed' or not review
                    or review['lease'] != job['lease'] or review['reason'] != 'unsubstantiated-model-output'
                    or review['policy_version'] != news.ASSESSMENT_VERSION):
                return False
            failure = failures[0]
            failed = clock_valid(failure['failed_at'])
            decided, reviewed = clock_valid(review['decided_at']), clock_valid(review['started_at'])
            return bool(failure['lease'] == job['lease'] and failure['payload'] == raw
                        and failure['reason'] in news.FAILURE_CODES and failure['reason'] == job['failure_kind']
                        and reviewed == start and failed and decided and start <= failed <= reference
                        and decided <= reference and decision_after_failure(failed, review['decided_at']))
        assessment = [proof for proof in original['assessment_proofs'] if proof['lease'] == job['lease']]
        if len(assessment) != 1:
            return False
        assessment = assessment[0]
        completed = clock_valid(assessment['completed_at'])
        return bool(mode == 'fresh-assessment' and review is None and job['state'] == 'done'
                    and call['state'] == 'done' and not any(failure['lease'] == job['lease'] for failure in failures)
                    and assessment['event_id'] == row['id'] and assessment['sha'] == row['sha']
                    and assessment['body_sha'] == row['body_sha'] and assessment['raw_response'] == raw
                    and assessment['raw_response_sha'] == news.digest(raw)
                    and completed and start <= completed <= reference)
    except (ValueError, TypeError, KeyError, OverflowError, OSError):
        return False


def recorded(db, row):
    return bool(exists(db, AUDIT_TABLE) and db.execute('SELECT 1 FROM ' + AUDIT_TABLE
        + ' WHERE event_id=? AND sha=? AND body_sha=?', (row['id'], row['sha'], row['body_sha'])).fetchone())


def attempt_spent(db, row):
    # Missing/damaged proof never licenses another reserved or dispatched call.
    owned = recognized(row) or route_owned(db, row)
    if not owned and exists(db, 'source_policy_assessment_proofs'):
        owned = bool(db.execute('SELECT 1 FROM source_policy_assessment_proofs WHERE event_id=? AND sha=?',
                                (row['id'], row['sha'])).fetchone())
    if not owned:
        saved = db.execute('SELECT payload FROM official_research_publications WHERE event_id=? AND sha=?',
                           (row['id'], row['sha'])).fetchone()
        try:
            value = json.loads(saved['payload']) if saved else None
            owned = isinstance(value, dict) and MARKER in value
        except (ValueError, TypeError):
            pass
    if not owned:
        return False
    # A previously reserved call is conservatively ambiguous even when no
    # dispatch evidence survived. Audit rollback, process death and missing
    # jobs never authorize a replacement paid request.
    if db.execute('SELECT 1 FROM signal_headline_translation_calls WHERE source_id=? AND sha=?',
                  ('research:' + row['source_id'], row['sha'])).fetchone():
        return True
    job = db.execute('SELECT sha,state FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    return bool(job and job['sha'] == row['sha'] and job['state'] in {'done', 'review', 'stale'})


def closed_attempt(db, row):
    """Terminal-publication hold; an in-flight first assessment stays pending."""
    job = db.execute('SELECT sha,state FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    return bool(job and job['sha'] == row['sha'] and job['state'] in {'done', 'review', 'stale'}
                and attempt_spent(db, row))


def route_owned(db, event):
    """A denial-only receipt binds the canonical post/revision, not an event ID."""
    origin = event['url'].casefold()
    if exists(db, ROUTE_TABLE) and db.execute(
            'SELECT 1 FROM '+ROUTE_TABLE+' WHERE origin=? AND sha=?',
            (origin, event['sha'])).fetchone():
        return True
    # Existing validated policy audits also remember their route across upgrade.
    return bool(exists(db, AUDIT_TABLE) and db.execute(
        'SELECT 1 FROM '+AUDIT_TABLE+' a JOIN signal_events e ON e.id=a.event_id '
        'WHERE lower(e.url)=? AND a.sha=?', (origin, event['sha'])).fetchone())


def fresh_route_candidate(db, event, reference):
    try:
        if type(grammar.parse(event['body'])) is not grammar.PolicyReport:
            return None
        source = next((source for source in signals.SOURCES
                       if source['id'] == event['source_id'] and source['id'] in news.SOURCE_IDS), None)
        if source is None or not exists(db, 'signal_x_acquisition'):
            return None
        current = db.execute('SELECT e.*,d.sha AS current_sha,d.title AS document_title,d.text AS body '
                             'FROM signal_events e JOIN signal_documents d '
                             'ON d.source_id=e.source_id AND d.url=e.url WHERE e.id=?', (event['id'],)).fetchone()
        if not current or any(current[key] != event.get(key) for key in
                              ('source_id','url','sha','title','body','current_sha','document_title',
                               'published_at','observed_at','truncated','tickers_json','matches_json','event_kind')):
            return None
        candidate, _ = news.assess(dict(current), source, reference, news.origin_heads(db, signals.SOURCES, reference))
        return candidate if (candidate and recognized(candidate)
                             and retained(db, candidate, reference) is not None) else None
    except (ValueError, TypeError, KeyError):
        return None


def owns_fresh_result_route(db, event, reference):
    """Read-only routing check; never publication or materiality approval."""
    return route_owned(db, event) or fresh_route_candidate(db, event, reference) is not None


def record_route_owner(db, row, reference):
    """Remember an exact proven assignment in the caller's writer transaction.

    The receipt only denies a competing partial flash. It survives withdrawal,
    rejection, restart and duplicate event IDs; it never bypasses body, source,
    materiality, audit or current-publication validation.
    """
    if not db.in_transaction:
        raise ValueError('policy-route-requires-transaction')
    if route_owned(db, row):
        return True
    policy = PublicReadContext.policy_identity()
    candidate = fresh_route_candidate(db, row, reference)
    if candidate is None:
        return False
    proof = retained(db, candidate, reference)
    if proof is None or PublicReadContext.policy_identity() != policy:
        return False
    snapshot = {'row': {key:candidate.get(key) for key in SOURCE_FIELDS},
                'retained': {key:proof[key] for key in ('source_id','url','sha','title','text',
                             'published_at','first_seen_at','truncated')}}
    db.execute('INSERT OR IGNORE INTO '+ROUTE_TABLE+' VALUES(?,?,?,?,?,?,?,?)',
               (row['url'].casefold(),row['sha'],candidate['body_sha'],row['source_id'],row['id'],
                VERSION,encoded(snapshot),reference.isoformat()))
    return True


def reserve_fresh_result_route(db, event, reference):
    """Result writer's atomic choice before creating any competing flash."""
    if route_owned(db, event):
        return True
    policy = PublicReadContext.policy_identity()
    if fresh_route_candidate(db, event, reference) is None:
        return False
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        # Recheck after acquiring the lock; no stale read can assign ownership.
        if PublicReadContext.policy_identity() != policy:
            return True
        record_route_owner(db, event, reference)
        return True  # A changed preflight is withheld this cycle, never a flash fallback.


def fresh_inputs_valid(db, row, reference):
    """Read-only source/ownership gate before spend and at successful commit."""
    return bool(recognized(row) and source_snapshot(db, row, reference) is not None
                and unowned(ownership_state(db, row, reference)) and current_row(db, row, reference) is not None)


def fresh_attempt_valid(db, row, raw, note, lease, reference):
    """Verify before closing/publishing so proof damage cannot cause a retry."""
    try:
        if not positive(json.loads(raw)) or recorded(db, row) or review_for(db, row) is not None:
            return False
        validate_note(note, row)
        if db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone():
            return False
        job = db.execute('SELECT * FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
        call = db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?', (lease,)).fetchone()
        if (not job or job['lease'] != lease or job['state'] != 'running' or job['sha'] != row['sha']
                or not call or call['state'] != 'running' or call['source_id'] != 'research:' + row['source_id']
                or call['sha'] != row['sha'] or type(job['attempts']) is not int or job['attempts'] != 1):
            return False
        calls = db.execute('SELECT lease FROM signal_headline_translation_calls WHERE source_id=? AND sha=?',
                           ('research:' + row['source_id'], row['sha'])).fetchall()
        if len(calls) != 1 or calls[0]['lease'] != lease:
            return False
        start = datetime.fromtimestamp(call['at'], timezone.utc)
        if not news.reconciliation.instant(row['body_at']) <= start <= reference:
            return False
        proof = db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?', (lease,)).fetchone()
        if proof and (proof['source_sha'] != row['sha'] or proof['body_sha'] != row['body_sha']):
            return False
        return not (db.execute('SELECT 1 FROM official_research_attempt_failures WHERE lease=?', (lease,)).fetchone()
                    or db.execute('SELECT 1 FROM source_policy_assessment_proofs WHERE lease=?', (lease,)).fetchone())
    except (ValueError, TypeError, KeyError, OverflowError, OSError):
        return False


def publication_state(db, row):
    saved = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
    audit = (db.execute('SELECT * FROM ' + AUDIT_TABLE + ' WHERE event_id=? AND sha=? AND body_sha=?',
                       (row['id'], row['sha'], row['body_sha'])).fetchone() if exists(db, AUDIT_TABLE) else None)
    return {'publication': dict(saved) if saved else None, 'audit': dict(audit) if audit else None}


def scoped_selection_snapshot(db, row, reference):
    """Only this origin and possible exact-body representatives can replace it."""
    rows = [dict(value) for value in db.execute(
        """SELECT e.*,d.sha AS current_sha,d.title AS document_title,d.text AS body
        FROM signal_events e LEFT JOIN signal_documents d
          ON e.source_id=d.source_id AND e.url=d.url
        WHERE e.source_id IN (?,?,?)
          AND julianday(e.published_at) BETWEEN julianday(?) AND julianday(?)
          AND (lower(e.url)=lower(?) OR d.text=?)
        ORDER BY julianday(e.published_at) DESC,julianday(e.observed_at),e.id""",
        (*news.SOURCE_IDS,(reference-timedelta(days=7)).isoformat(),reference.isoformat(),row['url'],row['body']))]
    origins = sorted({value['url'].casefold() for value in rows} | {row['url'].casefold()})
    marks = ','.join('?' for _ in origins)
    heads = [[tuple(value) for value in db.execute(
        'SELECT source_id,url,sha,last_seen_at FROM '+table
        +' WHERE source_id IN (?,?,?) AND lower(url) IN ('+marks+') ORDER BY source_id,url,sha',
        (*news.SOURCE_IDS,*origins))] for table in ('signal_documents','signal_x_acquisition')]
    return encoded({'rows': rows, 'heads': heads,
                    'sources': [source for source in signals.SOURCES if source['id'] in news.SOURCE_IDS]})


def fresh_preflight(db, row, raw, note, lease, reference):
    """One coherent WAL read snapshot; validation never takes a writer lock.

    All predicates observe the same database version even during ABA writes.
    Other feed/cache commits neither invalidate this snapshot nor create a
    terminal hold. The writer later compares only this report's relevant inputs.
    """
    if db.in_transaction:
        raise ValueError('policy-preflight-requires-unlocked-reader')
    changes = db.total_changes
    db.execute('BEGIN')  # Deferred read transaction; independent writers stay free.
    try:
        snapshot = {'policy': PublicReadContext.policy_identity(),
                    'selection': scoped_selection_snapshot(db, row, reference),
                    'source': source_snapshot(db, row, reference),
                    'publication': publication_state(db, row),
                    'artifacts': artifacts(db, row), 'note': encoded(note),
                    'raw': raw, 'lease': lease, 'reference': reference}
        snapshot['source_valid'] = fresh_inputs_valid(db, row, reference)
        snapshot['attempt_valid'] = fresh_attempt_valid(db, row, raw, note, lease, reference)
        snapshot['stable'] = (db.total_changes == changes
                              and snapshot['policy'] == PublicReadContext.policy_identity())
        return snapshot
    finally:
        db.rollback()  # End the read snapshot before acquiring any writer lock.


def fresh_preflight_unchanged(db, row, raw, note, lease, reference, snapshot):
    """Exact cheap inputs only; never rescan candidates or render under lock."""
    return bool(snapshot and snapshot['stable'] and snapshot['policy'] == PublicReadContext.policy_identity()
                and snapshot['selection'] == scoped_selection_snapshot(db, row, reference)
                and snapshot['source'] == source_snapshot(db, row, reference)
                and snapshot['artifacts'] == artifacts(db, row)
                and snapshot['publication'] == publication_state(db, row)
                and snapshot['note'] == encoded(note) and snapshot['raw'] == raw
                and snapshot['lease'] == lease and snapshot['reference'] == reference)


def record_fresh_hold(db, row, raw, lease, failed_at):
    """Retain the paid response and conflicting proof under a terminal hold."""
    db.execute('INSERT OR IGNORE INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
        (lease, row['id'], row['sha'], failed_at, 'source-event-identity-mismatch',
         'fresh-policy-audit-precondition-failed', raw if isinstance(raw, str) and len(raw.encode()) <= 131072 else None))
    if isinstance(raw, str) and len(raw.encode()) <= 131072:
        # This archives response bytes/request identity, never replaces the
        # conflicting generation-body proof or authorizes publication.
        db.execute('INSERT OR IGNORE INTO source_policy_assessment_proofs VALUES(?,?,?,?,?,?,?)',
                   (lease,row['id'],row['sha'],row['body_sha'],raw,news.digest(raw),failed_at))
    db.execute('UPDATE official_research_jobs SET failure_kind=? WHERE event_id=? AND lease=?',
               ('source-event-identity-mismatch', row['id'], lease))


def insert_audit(db, row, original, raw, publication, source, mode, started, derived):
    db.execute('INSERT INTO ' + AUDIT_TABLE + ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (row['id'], row['sha'], row['body_sha'], mode, original['job']['lease'], VERSION,
         encoded(source), encoded(original), raw, encoded(publication), news.digest(publication['payload']),
         started, derived))


def record_fresh(db, row, raw, note, lease, reference, *, preflight=None):
    """Called inside the normal successful-assessment transaction, after close."""
    if (not db.in_transaction or recorded(db, row) or not preflight
            or not preflight['stable'] or not preflight['source_valid'] or not preflight['attempt_valid']
            or preflight['policy'] != PublicReadContext.policy_identity()
            or preflight['note'] != encoded(note) or preflight['raw'] != raw
            or preflight['lease'] != lease or preflight['reference'] != reference
            or preflight['source'] != source_snapshot(db, row, reference)):
        raise ValueError('changed-source-news-claim')
    # Source/artifact snapshots were checked before this transaction's own
    # publication/call/job writes. Only this already validated copy is stored.
    source = preflight['source']
    db.execute('INSERT OR IGNORE INTO official_research_attempt_body_proofs VALUES(?,?,?)', (lease, row['sha'], row['body_sha']))
    publication = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
    if not publication:
        raise ValueError('changed-source-news-claim')
    db.execute('INSERT INTO source_policy_assessment_proofs VALUES(?,?,?,?,?,?,?)',
               (lease,row['id'],row['sha'],row['body_sha'],raw,news.digest(raw),publication['public_at']))
    original = artifacts(db, row)
    if (not publication or publication['payload'] != json.dumps(note, ensure_ascii=False)
            or not closed_proof(row, original, raw, 'fresh-assessment', reference)):
        raise ValueError('changed-source-news-claim')
    publication = dict(publication)
    insert_audit(db, row, original, raw, publication, source, 'fresh-assessment',
                 publication['started_at'], publication['public_at'])


def publication_valid(db, row, saved, reference, *, context=None):
    scoped = context is not None and context.db is db and context.reference == reference
    if scoped and (not context.unchanged() or not context.current(row)):return False
    if not recognized(row) or not (context.recorded(row) if scoped else recorded(db,row)):
        return False
    cache_key = (row['id'],row['sha'],row['body_sha'],encoded(dict(saved)))
    if scoped and cache_key in context.checks:return context.checks[cache_key]
    owner=ownership_state(db,row,reference,context=context if scoped else None)
    if not unowned(owner):return False
    try:
        audit = (context.audits[(row['id'],row['sha'],row['body_sha'])] if scoped else
                 dict(db.execute('SELECT * FROM ' + AUDIT_TABLE + ' WHERE event_id=? AND sha=? AND body_sha=?',
                                 (row['id'], row['sha'], row['body_sha'])).fetchone()))
        current = saved if scoped else db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
        original = artifacts(db, row)
        start, public = clock_valid(saved['started_at']), clock_valid(saved['public_at'])
        if (saved['event_id'] != row['id'] or saved['sha'] != row['sha'] or saved['body_sha'] != row['body_sha']
                or audit['policy_version'] != VERSION or audit['mode'] not in {'fresh-assessment', 'held-correction'}
                or not current or encoded(dict(current)) != encoded(dict(saved))
                or encoded(dict(saved)) != audit['publication_snapshot']
                or news.digest(saved['payload']) != audit['validated_payload_sha']
                or audit['source_snapshot'] != encoded(source_snapshot(db, row, reference, ownership=owner))
                or audit['original_artifacts'] != encoded(original)
                or not closed_proof(row, original, audit['original_response'], audit['mode'], reference)
                or audit['lease'] != original['job']['lease']
                or not start or not public or not news.reconciliation.instant(row['body_at']) <= start <= public <= reference
                or audit['derivation_started_at'] != saved['started_at'] or audit['derived_at'] != saved['public_at']
                or type(saved['generation_ms']) is not int or saved['generation_ms'] < 0
                or not (context.current(row) if scoped else current_row(db,row,reference) is not None)):
            return False
        note = json.loads(saved['payload'])
        validate_note(note, row)
        expected_evidence = [fact['evidenceQuote'] for fact in note['facts']]
        valid=json.loads(saved['evidence']) == expected_evidence
        if scoped:context.checks[cache_key]=valid
        return valid
    except (ValueError, TypeError, KeyError, AttributeError):
        return False


def resolves(db, row, review, reference):
    if not recorded(db, row) or review != review_for(db, row):
        return False
    saved = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
    return bool(saved and publication_valid(db, row, saved, reference))


def publish_held(db, reference, *, clock=None):
    """One audited current-source correction; no original row is modified."""
    clock = clock or (lambda: datetime.now(timezone.utc))
    db.commit()
    policy = PublicReadContext.policy_identity()
    selection = selection_snapshot(db, reference)
    rows = news.candidates(db, reference, include_review=True)
    for row in rows:
        if not recognized(row) or recorded(db, row):
            continue
        if db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone():
            continue
        original = artifacts(db, row)
        failures = [failure for failure in original['failures'] if failure['sha'] == row['sha']]
        if len(failures) != 1 or not isinstance(failures[0]['payload'], str):
            continue
        raw = failures[0]['payload']
        if len(raw.encode()) > 131072 or not closed_proof(row, original, raw, 'held-correction', reference):
            continue
        source = source_snapshot(db, row, reference)
        owner = ownership_state(db, row, reference)
        if source is None or not unowned(owner):
            continue
        started = clock()
        before = time.monotonic()
        if started.tzinfo is None or started < reference:
            continue
        try:
            note = bind(json.loads(raw), row)
        except (ValueError, TypeError, KeyError):
            continue  # One unsupported item never blocks the next candidate.
        public = clock()
        if public.tzinfo is None or public < started:
            continue
        publication = {'event_id': row['id'], 'sha': row['sha'], 'body_sha': row['body_sha'],
            'payload': json.dumps(note, ensure_ascii=False), 'evidence': json.dumps([row['body']]),
            'started_at': started.isoformat(), 'public_at': public.isoformat(),
            'generation_ms': round((time.monotonic() - before) * 1000)}
        with db:
            db.execute('BEGIN IMMEDIATE')
            if (PublicReadContext.policy_identity() != policy
                    or selection_snapshot(db, reference) != selection
                    or source_snapshot(db, row, reference) != source
                    or artifacts(db, row) != original or ownership_state(db, row, reference) != owner
                    or recorded(db, row)
                    or db.execute('SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()):
                return 'stale'
            db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)', tuple(publication.values()))
            insert_audit(db, row, original, raw, publication, source, 'held-correction',
                         publication['started_at'], publication['public_at'])
        return 'done'
    return None


def diagnostics(db, reference):
    """Bounded read-only reasons; private source/model bytes never leave here."""
    rows=[row for row in news.candidates(db,reference,include_review=True) if recognized(row)]
    records=[]
    for row in rows:
        ownership=ownership_state(db,row,reference)
        records.append({'eventId':row['id'],'ownershipReason':ownership_reason(ownership),
                        'blockedByIndependentOwner':not unowned(ownership),
                        'marketRecords':[{'eventId':item['record']['event_id'],'status':item['status'],
                            'sourceWindow':item['window'],'withinPublicPageSelection':item['withinPublicPageSelection']}
                            for item in ownership['market']]})
    return {'readOnly':True,'scope':'recognized-current-source-policy-reports','publicResultLimit':20,
            'browserDeliveryVerified':False,'records':records[:50],'recordsTruncated':len(records)>50}


def diagnostic_summary(db, reference):
    """Public operational counts; per-event ownership remains private."""
    detail = diagnostics(db, reference)
    reasons = {}
    for record in detail['records']:
        reason = record['ownershipReason']
        reasons[reason] = reasons.get(reason, 0) + 1
    return {'readOnly': True, 'scope': 'recognized-policy-reports',
            'publicResultLimit': detail['publicResultLimit'],
            'browserDeliveryVerified': False, 'ownershipReasons': reasons,
            'measured': len(detail['records']), 'truncated': detail['recordsTruncated']}
