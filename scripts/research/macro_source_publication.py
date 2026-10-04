"""Audited, zero-retry macro copy after the existing materiality assessment.

The complete source supplies all public wording. A grammar match is not a
materiality decision. Original source, model, job, failure and call rows remain
immutable during held recovery; missing/damaged proof never licenses a retry.
"""
from datetime import datetime, timedelta, timezone
import json
import re
import time
from urllib.parse import urlsplit

import general_source_news as news
import macro_source_news as macro
import market_results
import official_release_bridge as bridge
import signals

VERSION = 1
MARKER = 'sourceMacroDerivation'
AUDIT_TABLE = 'source_macro_news_derivations'
POLICY = ('For a completely recognized macroeconomic results report, assess its materiality as '
          'general economic news independently of company or ticker mapping. A calendar, preview, '
          'unsupported claim or non-material item must remain review. Use the existing publish/review '
          'schema and the same single assessment call. On a positive materiality decision, the '
          'application renders all source-bound metrics, comparisons and periods deterministically; '
          'model wording does not supply public facts.')
SOURCE_FIELDS = ('id', 'source_id', 'url', 'sha', 'title', 'tickers_json', 'matches_json',
                 'event_kind', 'published_at', 'observed_at', 'truncated', 'body', 'body_sha',
                 'body_at', 'ticker', 'category', 'units', 'source_news', 'related_tickers', 'related_subject')


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def exists(db, table):
    return bool(db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone())


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS source_macro_news_derivations(
      event_id INTEGER NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,
      mode TEXT NOT NULL,lease TEXT NOT NULL,policy_version INTEGER NOT NULL,
      source_snapshot TEXT NOT NULL,original_artifacts TEXT NOT NULL,
      original_response TEXT NOT NULL,publication_snapshot TEXT NOT NULL,
      validated_payload_sha TEXT NOT NULL,derivation_started_at TEXT NOT NULL,
      derived_at TEXT NOT NULL,PRIMARY KEY(event_id,sha,body_sha))''')
    db.execute('''CREATE TABLE IF NOT EXISTS source_macro_assessment_proofs(
      lease TEXT PRIMARY KEY,event_id INTEGER NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,
      raw_response TEXT NOT NULL,raw_response_sha TEXT NOT NULL,completed_at TEXT NOT NULL)''')


def recognized(row):
    if not (row.get('general_source') and row.get('source_news') and row.get('semantic_assessment')):
        return False
    try:
        macro.parse(row['body'])
        return True
    except (ValueError, TypeError, KeyError):
        return False


def positive(value):
    if (not isinstance(value, dict) or set(value) != {'disposition', 'reason', 'facts'}
            or value['disposition'] != 'publish' or value['reason'] != 'material-company-development'
            or not isinstance(value['facts'], list) or not 1 <= len(value['facts']) <= news.MAX_UNITS):
        return False
    return all(isinstance(fact, dict) and set(fact) == {'ja', 'en', 'evidenceId'}
               and all(isinstance(fact[key], str) and 1 <= len(fact[key]) <= 600
                       for key in ('ja', 'en', 'evidenceId')) for fact in value['facts'])


def derived_note(row):
    if not (row.get('general_source') and row.get('source_news') and row.get('semantic_assessment')):
        raise ValueError('changed-source-news-claim')
    try:
        copy = macro.derive(row['body'])
    except (ValueError,TypeError,KeyError) as exc:
        raise ValueError('changed-source-news-claim') from exc
    if any(len(copy[key]) > 180 for key in ('titleJa', 'titleEn')):
        raise ValueError('invalid-copy')
    # The complete source, including its header, proves every displayed row.
    # This is a new typed note, never a claim that the rejected unit map passed.
    paragraphs = {lang: '\n\n'.join(copy['body' + lang.capitalize()].splitlines()) for lang in ('ja', 'en')}
    return {'generalSourceVersion': news.VERSION,
            'semanticAssessment': {'version': news.ASSESSMENT_VERSION, 'disposition': 'publish',
                                   'reason': 'material-company-development'},
            MARKER: {'version': VERSION, 'parserVersion': macro.VERSION},
            'macroTitles': {'ja': copy['titleJa'], 'en': copy['titleEn']},
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
    return {'id': str(row['id']), 'title': note['macroTitles']['en'],
            'translationJa': note['macroTitles']['ja'], 'url': row['url'],
            'publisher': 'Reported economic news', 'tickers': [],
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
    assessments = ([dict(value) for value in db.execute('SELECT * FROM source_macro_assessment_proofs WHERE event_id=? ORDER BY lease', (row['id'],))]
                   if exists(db, 'source_macro_assessment_proofs') else [])
    return {'job': dict(job) if job else None, 'failures': failures, 'proofs': proofs,
            'calls': calls, 'assessment_proofs': assessments, 'review': review_for(db, row)}


def retained(db, row, reference):
    values = db.execute('''SELECT * FROM signal_x_acquisition
      WHERE source_id=? AND lower(url)=lower(?) AND sha=?''', (row['source_id'], row['url'], row['sha'])).fetchall()
    if len(values) != 1:
        return None
    value = dict(values[0])
    if (value['truncated'] or value['title'] != row['title'] or value['text'] != row['body']
            or news.digest(value['title'] + '\n' + value['text']) != row['sha']
            or news.digest(value['text']) != row['body_sha']):
        return None
    clocks = [news.reconciliation.instant(value[key]) for key in ('published_at', 'first_seen_at', 'last_seen_at')]
    if (any(not isinstance(value[key], str) or not re.fullmatch(news.CLOCK_PATTERN, value[key])
            for key in ('published_at', 'first_seen_at', 'last_seen_at'))
            or any(clock is None for clock in clocks)
            or not clocks[0] <= clocks[1] <= clocks[2] <= reference
            or clocks[0] != news.reconciliation.instant(row['published_at'])
            or clocks[1] != news.reconciliation.instant(row['observed_at'])):
        return None
    return value


def source_snapshot(db, row, reference, *, ownership=None):
    proof = retained(db, row, reference)
    if proof is None:
        return None
    return {'row': {key: row.get(key) for key in SOURCE_FIELDS},
            'retained': {key: proof[key] for key in ('source_id','url','sha','title','text',
                         'published_at','first_seen_at','truncated')},
            'independent_history': ownership if ownership is not None else ownership_state(db, row, reference)}


def selection_snapshot(db, reference):
    # Full candidate derivation is unlocked. These exact cheap source inputs
    # pin current heads, origin policy and duplicate representative selection.
    heads = [[tuple(value) for value in db.execute(
        'SELECT source_id,url,sha,last_seen_at FROM ' + table
        + ' WHERE source_id IN (?,?,?) ORDER BY source_id,url,sha', news.SOURCE_IDS)]
        for table in ('signal_documents', 'signal_x_acquisition')]
    return encoded({'rows': [dict(row) for row in news.evidence_rows(db, reference)], 'heads': heads,
                    'sources': [source for source in signals.SOURCES if source['id'] in news.SOURCE_IDS]})


def current_row(db, row, reference):
    # include_review avoids recursive hold resolution/public readers.
    return next((value for value in news.candidates(db, reference, include_review=True)
                 if value['id'] == row['id'] and source_snapshot(db, value, reference)
                 == source_snapshot(db, row, reference)), None)


def market_ownership(db, row, record, reference, public_page):
    """Use the result feed's current projection and source-clock window.

    Raw historical presence is not current coverage. A recognized prior result
    must still have exact source/clock/metadata identity before expiry can stop
    it from owning the URL. The 20-row selection is reported, not assumed seen.
    """
    result = {'record': record, 'status': 'unverified', 'window': 'unknown',
              'withinPublicPageSelection': False, 'publicLimit': 20}
    original_public = clock_valid(record['published_at'])
    try:
        original_cutoff = (original_public-timedelta(hours=24)).isoformat() if original_public else 'invalid'
    except (OverflowError,ValueError,TypeError):
        return result  # Malformed history holds only this source; it cannot break the feed.
    event = db.execute('''SELECT e.*,d.text AS body,d.title AS current_title,d.sha AS current_sha,
      julianday(e.published_at)>=julianday(?) AS result_window_active,
      julianday(e.published_at)>=julianday(?) AS original_source_window_active,
      julianday(e.observed_at)>=julianday(?) AS original_observation_window_active
      FROM signal_events e LEFT JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url
      WHERE e.id=?''', ((reference-timedelta(hours=24)).isoformat(),original_cutoff,original_cutoff,record['event_id'])).fetchone()
    if not event:
        return result
    event = dict(event)
    result['sourceEvent'] = event
    source_at = clock_valid(event['published_at'])
    if source_at:
        # The route itself uses SQLite julianday precision, not Python's
        # microsecond comparison. Reuse that exact predicate at the boundary.
        result['window'] = 'future' if source_at > reference else 'active' if event['result_window_active'] == 1 else 'expired'
    try:
        account = re.fullmatch(r'/([A-Za-z0-9_]+)/status/\d+', urlsplit(record['url']).path)
        source = next((source for source in signals.SOURCES if source['id'] == event['source_id']), None)
        payload = json.loads(record['payload'])
        ticks = json.loads(event['tickers_json'])
        observed, published = clock_valid(event['observed_at']), clock_valid(record['published_at'])
        if (not account or account[1].lower() not in market_results.ACCOUNTS
                or not source or news.safe_reference(record['url'],source) != record['url']
                or record['source_id'] != event['source_id'] or event['url'] != record['url']
                or record['sha'] != event['sha'] or event['sha'] != row['sha']
                or event['current_sha'] != event['sha'] or event['truncated']
                or event['body'] != row['body'] or event['title'] != row['title']
                or event['current_title'] != event['title']
                or news.digest(event['title']+'\n'+event['body']) != event['sha']
                or not source_at or not observed or not published
                or not source_at <= observed <= published <= reference
                or source_at != news.reconciliation.instant(row['published_at'])
                or not isinstance(ticks,list) or any(not isinstance(tick,str) for tick in ticks)
                or not isinstance(payload,dict)):
            return result
        expected={'id':str(event['id']),'url':event['url'],'publisher':market_results.NAMES[account[1].lower()],
                  'publishedAt':event['published_at'],'observedAt':event['observed_at'],
                  'researchId':'x-result-'+str(event['id'])}
        if any(payload.get(key) != value for key,value in expected.items()):
            return result
        projected = market_results.projection(event['body'],ticks)
        if projected is None:
            return result
        # Establish that the historical record could actually have belonged to
        # the route, rather than guessing first publication from a read time.
        if event['original_source_window_active'] != 1 or event['original_observation_window_active'] != 1:
            return result
        result['status'] = 'active' if result['window'] == 'active' else 'expired'
        result['withinPublicPageSelection'] = result['status'] == 'active' and event['id'] in public_page
        result['projection'] = projected
        return result
    except (ValueError,TypeError,KeyError,AttributeError):
        return result


def result_public_page(db, reference):
    return {value[0] for value in db.execute('''SELECT p.event_id FROM market_result_publications p
      JOIN signal_documents d ON d.source_id=p.source_id AND d.url=p.url AND d.sha=p.sha
      JOIN signal_events e ON e.id=p.event_id WHERE julianday(e.published_at)>=julianday(?)
      ORDER BY julianday(e.published_at) DESC LIMIT 20''', ((reference-timedelta(hours=24)).isoformat(),))}


class PublicReadContext:
    """One request only; source selection precedes any proof reuse.

    No process/cross-request cache or database mutation. A concurrent commit or
    same-connection mutation invalidates every macro result for this request.
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
        return (VERSION,macro.VERSION,news.ASSESSMENT_VERSION,id(macro.parse),id(macro.render),
                id(derived_note),id(news.assess),
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


def ownership_state(db, row, reference, *, context=None):
    result = {'primary': bool(bridge.primary_owned_urls(db, [row['url']])), 'official': [], 'market': [], 'analyst': []}
    result['official'] = [dict(value) for value in db.execute('''SELECT p.* FROM official_research_publications p
      JOIN signal_events e ON e.id=p.event_id WHERE lower(e.url)=lower(?) AND p.event_id!=? AND p.sha=?''', (row['url'], row['id'], row['sha']))]
    if exists(db,'market_result_publications'):
        # Match public_feed's source cutoff, current-SHA join, order and cap.
        # Rows outside this selection may be eligible but are not confirmed
        # coverage; neither branch claims browser delivery.
        public_page = context.public_page() if context is not None else result_public_page(db,reference)
        records=[dict(value) for value in db.execute('SELECT * FROM market_result_publications WHERE lower(url)=lower(?) AND sha=? ORDER BY event_id',(row['url'],row['sha']))]
        result['market']=[market_ownership(db,row,value,reference,public_page) for value in records]
    if exists(db,'analyst_news_publications'):
        result['analyst']=[dict(value) for value in db.execute('SELECT * FROM analyst_news_publications WHERE lower(url)=lower(?) AND sha=? ORDER BY event_id',(row['url'],row['sha']))]
    return result


def ownership_reason(state):
    if state['primary']:
        return 'primary-source-owned'
    if state['official']:
        return 'same-url-official-publication-owned'
    if state['analyst']:
        return 'same-url-analyst-publication-owned'
    for item in state['market']:
        if item['status'] == 'unverified':
            return 'unverified-historical-market-result' if item['window'] == 'expired' else 'unverified-market-result'
    for item in state['market']:
        if item['status'] == 'active':
            return 'active-market-result-within-public-page' if item['withinPublicPageSelection'] else 'active-market-result-outside-public-page'
    return 'verified-expired-market-history' if state['market'] else 'no-independent-publication'


def unowned(state):
    return (not state['primary'] and not state['official'] and not state['analyst']
            and all(item['status'] == 'expired' for item in state['market']))


def clock_valid(value):
    return isinstance(value, str) and re.fullmatch(news.CLOCK_PATTERN, value) and news.reconciliation.instant(value)


def decision_after_failure(failed, decided_raw):
    """Only the recorder's explicit millisecond truncation gets tolerance."""
    decided = clock_valid(decided_raw)
    if not decided:
        return False
    if decided >= failed:
        return True
    return bool(re.search(r'\.\d{3}(?:Z|[+-]\d{2}:\d{2})$', decided_raw)
                and failed.replace(microsecond=failed.microsecond // 1000 * 1000) == decided)


def closed_proof(row, original, raw, mode, reference):
    """A positive original decision and one unambiguous closed attempt."""
    try:
        value = json.loads(raw)
        if not positive(value):
            return False
        job, review = original['job'], original['review']
        if not job or job['sha'] != row['sha'] or not isinstance(job['lease'], str):
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


def closed_attempt(db, row):
    # A missing or damaged proof/audit can only hold a closed current revision.
    if not recognized(row):
        return False
    job = db.execute('SELECT sha,state FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
    return bool(job and job['sha'] == row['sha'] and job['state'] in {'done', 'review', 'stale'})


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
                or call['sha'] != row['sha']):
            return False
        start = datetime.fromtimestamp(call['at'], timezone.utc)
        if not news.reconciliation.instant(row['body_at']) <= start <= reference:
            return False
        proof = db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?', (lease,)).fetchone()
        if proof and (proof['source_sha'] != row['sha'] or proof['body_sha'] != row['body_sha']):
            return False
        return not (db.execute('SELECT 1 FROM official_research_attempt_failures WHERE lease=?', (lease,)).fetchone()
                    or db.execute('SELECT 1 FROM source_macro_assessment_proofs WHERE lease=?', (lease,)).fetchone())
    except (ValueError, TypeError, KeyError, OverflowError, OSError):
        return False


def record_fresh_hold(db, row, raw, lease, failed_at):
    """Retain the paid response and conflicting proof under a terminal hold."""
    db.execute('INSERT OR IGNORE INTO official_research_attempt_failures VALUES(?,?,?,?,?,?,?)',
        (lease, row['id'], row['sha'], failed_at, 'source-event-identity-mismatch',
         'fresh-macro-audit-precondition-failed', raw if isinstance(raw, str) and len(raw.encode()) <= 131072 else None))
    if isinstance(raw, str) and len(raw.encode()) <= 131072:
        # This archives response bytes/request identity, never replaces the
        # conflicting generation-body proof or authorizes publication.
        db.execute('INSERT OR IGNORE INTO source_macro_assessment_proofs VALUES(?,?,?,?,?,?,?)',
                   (lease,row['id'],row['sha'],row['body_sha'],raw,news.digest(raw),failed_at))
    db.execute('UPDATE official_research_jobs SET failure_kind=? WHERE event_id=? AND lease=?',
               ('source-event-identity-mismatch', row['id'], lease))


def insert_audit(db, row, original, raw, publication, source, mode, started, derived):
    db.execute('INSERT INTO ' + AUDIT_TABLE + ' VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (row['id'], row['sha'], row['body_sha'], mode, original['job']['lease'], VERSION,
         encoded(source), encoded(original), raw, encoded(publication), news.digest(publication['payload']),
         started, derived))


def record_fresh(db, row, raw, note, lease, reference):
    """Called inside the normal successful-assessment transaction, after close."""
    if not db.in_transaction or recorded(db, row) or not recognized(row):
        raise ValueError('changed-source-news-claim')
    validate_note(note, row)
    if current_row(db, row, reference) is None or not unowned(ownership_state(db, row, reference)):
        raise ValueError('changed-source-news-claim')
    source = source_snapshot(db, row, reference)
    if source is None:
        raise ValueError('changed-source-news-claim')
    db.execute('INSERT OR IGNORE INTO official_research_attempt_body_proofs VALUES(?,?,?)', (lease, row['sha'], row['body_sha']))
    publication = db.execute('SELECT * FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
    if not publication:
        raise ValueError('changed-source-news-claim')
    db.execute('INSERT INTO source_macro_assessment_proofs VALUES(?,?,?,?,?,?,?)',
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
            if (selection_snapshot(db, reference) != selection
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
    return {'readOnly':True,'scope':'recognized-current-source-macro-reports','publicResultLimit':20,
            'browserDeliveryVerified':False,'records':records[:50],'recordsTruncated':len(records)>50}


def diagnostic_summary(db, reference):
    """Public operational counts; per-event ownership remains private."""
    detail = diagnostics(db, reference)
    reasons = {}
    for record in detail['records']:
        reason = record['ownershipReason']
        reasons[reason] = reasons.get(reason, 0) + 1
    return {'readOnly': True, 'scope': 'recognized-macro-reports',
            'publicResultLimit': detail['publicResultLimit'],
            'browserDeliveryVerified': False, 'ownershipReasons': reasons,
            'measured': len(detail['records']), 'truncated': detail['recordsTruncated']}
