"""Editor-only, read-only diagnosis of the current issuer-note candidate set.

Unrelated research retains its expiring exact repair-cohort context gate.
Current failed source-bound business jobs may expose sanitized bounded copy and
literal selected evidence to the existing editor-only queue. Never returns full
source bodies, arbitrary payload fields or provider arguments.
Replaying validation explains a gate; it does not establish factual correctness.
"""
from datetime import date, datetime, timezone
import hashlib
import re
import json
from pathlib import Path
import sqlite3

import factual_validation as facts
import official_research as research
import official_research_content_repair as repair
import news_pipeline_diagnostics


ISSUES = {'invalid-note', 'invalid-facts', 'invalid-item', 'unsupported-quote',
          'changed-action-capacity', 'changed-execution-period', 'changed-amount-relation',
          'invalid-copy', 'unsupported-number', 'incomplete', 'lost-forecast-modality', 'lost-negation', 'reversed-supply-demand', 'lost-fiscal-basis', 'lost-comparison', 'unsupported-comparison-baseline', 'source-event-identity-mismatch', 'invented-broker-action', 'source-copy-overlap', 'unsupported-actor', 'lost-action-status'} | research.general_source_news.FAILURE_CODES | {research.rollout_validation.FAILURE,research.material_relations.FAILURE}


def failure_kind(value):
    if value in ISSUES or value in {'provider-unavailable', 'classified-attempt'}:
        return value
    if isinstance(value, str) and value.startswith('provider-http-') and value[14:].isdigit():
        return value if 400 <= int(value[14:]) <= 599 else 'unclassified'
    return 'unclassified' if value else None


def instant(value):
    try:
        return datetime.fromtimestamp(value, timezone.utc).isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        return None


# The provider retry and editor diagnosis use the same exact checks.
quantities = facts.quantities
number_checks = facts.number_checks


def validation_report(payload, row):
    if not isinstance(payload, str) or not payload or len(payload) > 131072:
        return {'status': 'unavailable', 'issues': []}
    note = None
    try:
        note = json.loads(payload)
        if not isinstance(note, dict):
            raise ValueError('invalid-note')
        if row.get('issuer_business'):
            research.validate_row(note,row)
            return {'status':'valid','issues':[]}
        if row.get('general_source'):
            if 'generalSourceVersion' in note:
                research.validate_row(note,row)
            elif row.get('semantic_assessment'):
                research.general_source_news.bind_assessment(note,row)
            else:
                research.general_source_news.bind_note(note,row)
            return {'status':'valid','issues':[]}
        note = {key: value for key, value in note.items() if key in ('title', 'summary', 'facts', 'purpose')}
        research.validate(note, row['body'], row['title'])
        return {'status': 'valid', 'issues': []}
    except (ValueError, TypeError, KeyError) as exc:
        issue = str(exc) if str(exc) in ISSUES else 'invalid-note'
    if not isinstance(note, dict):
        return {'status': 'invalid', 'issues': [{'field': 'note', 'issue': issue, 'checks': []}]}
    if set(note) != {'title', 'summary', 'facts', 'purpose'} or not isinstance(note['facts'], list) or not 3 <= len(note['facts']) <= 5:
        return {'status': 'invalid', 'issues': [{'field': 'note', 'issue': issue, 'checks': []}]}
    fields = [('title', 'title', note['title']), ('summary', 'summary', note['summary']),
              *[(f'facts[{index}]', 'fact', item) for index, item in enumerate(note['facts'])],
              ('purpose', 'purpose', note['purpose'])]
    issues = []
    for field, kind, item in fields:
        try:
            research.validate_item(kind, item, row['body'], row['title'])
        except (ValueError, TypeError, KeyError) as exc:
            issue = str(exc) if str(exc) in ISSUES else 'invalid-item'
            checks = number_checks(item) if issue == 'unsupported-number' else []
            issues.append({'field': field, 'issue': issue, 'checks': checks})
    return {'status': 'invalid', 'issues': issues}


def context_authorized(db, row, job, failure, reference):
    """Prove this is the consumed repair's latest failure of the retained body."""
    if (not failure or not job or job['state'] != 'retry'
            or job['sha'] != row['sha'] or job['lease'] != failure['lease']
            or job['failure_kind'] != 'unsupported-number'
            or failure['reason'] != 'unsupported-number'
            or not repair.matches(db, row, reference)):
        return False
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='official_research_content_repairs'").fetchone():
        return False
    latest = db.execute('''SELECT lease FROM official_research_attempt_failures
      WHERE event_id=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1''',
                        (row['id'],)).fetchone()
    if not latest or latest['lease'] != failure['lease']:
        return False
    audit = db.execute('''SELECT claimed_at,mode,previous_attempts
      FROM official_research_content_repairs WHERE event_id=? AND source_id=?
      AND sha=? AND body_sha=? AND policy_id=? AND lease=?''',
                       (row['id'], row['source_id'], row['sha'], row['body_sha'],
                        repair.POLICY_ID, failure['lease'])).fetchone()
    claimed_at = repair.instant(audit['claimed_at']) if audit else None
    failed_at = repair.instant(failure['failed_at'])
    return bool(audit and audit['mode'] in {'expedited', 'scheduled'}
                and job['attempts'] == audit['previous_attempts'] + 1
                and claimed_at and failed_at
                and repair.DEPLOYED_AT <= claimed_at <= failed_at <= reference < repair.EXPIRES_AT)


def bounded_failure_context(payload, row, report):
    """Only known fields; preserve original pairs without validator mutations."""
    if report['status'] != 'invalid' or not report['issues']:
        return None
    try:
        note = json.loads(payload)
    except (ValueError, TypeError):
        return None
    if (not isinstance(note, dict) or not all(key in note for key in ('title', 'summary', 'facts', 'purpose'))
            or not isinstance(note['facts'], list) or not 3 <= len(note['facts']) <= 5):
        return None
    failed_fields = {issue['field'] for issue in report['issues']}
    fields = [('title', 'title', note['title']), ('summary', 'summary', note['summary']),
              *[(f'facts[{index}]', 'fact', item) for index, item in enumerate(note['facts'])],
              ('purpose', 'purpose', note['purpose'])]
    rejected, validated = [], []
    for field, kind, item in fields:
        if not isinstance(item, dict) or not all(isinstance(item.get(lang), str) for lang in ('ja', 'en')):
            continue
        pair = {'field': field, 'ja': item['ja'][:400], 'en': item['en'][:400],
                'jaTruncated': len(item['ja']) > 400, 'enTruncated': len(item['en']) > 400}
        if field in failed_fields:
            quote = item.get('evidenceQuote')
            literal = isinstance(quote, str) and bool(quote) and quote in row['body']
            pair['selectedEvidenceIsLiteralCurrentBody'] = literal
            if literal:
                pair['selectedEvidence'] = quote[:1800]
                pair['evidenceTruncated'] = len(quote) > 1800
            rejected.append(pair)
        else:
            try:
                research.validate_item(kind, dict(item), row['body'], row['title'])
            except (ValueError, TypeError, KeyError):
                continue
            validated.append(pair)
    if not rejected:
        return None
    return {'check': 'editor-only-authorized-bounded-context',
            'notice': 'editor-only authorized bounded context: rejected copy and literal selected evidence are included only for the expiring, revision-proven two-note repair. Validation is not editorial approval.',
            'rejectedFields': rejected, 'validatedFields': validated}


def current_failed_context(db,row,job,failure,reference):
    """Sanitized failed output for the current source-bound business job only.

    These generation routes already verify full retained/enriched-body integrity.
    This is an editor-only read, never a publication/retry or a provider request.
    Older unrelated research retains its existing explicit context gate.
    """
    if not (row.get('general_source') or row.get('issuer_business')):
        return None
    if (not job or not failure or job['state'] not in {'retry','review'} or job['sha']!=row['sha']
        or failure['sha']!=row['sha'] or job['lease']!=failure['lease']
        or not research.current_revision(db,row)):
        return None
    failed_at=research.general_source_news.reconciliation.instant(failure['failed_at'])
    body_at=research.general_source_news.reconciliation.instant(row['body_at'])
    if not failed_at or not body_at or not failed_at<=reference or body_at>reference:
        return None
    if row.get('general_source') and body_at>failed_at:
        return None
    proof=(db.execute('SELECT source_sha,body_sha FROM official_research_attempt_body_proofs WHERE lease=?',(failure['lease'],)).fetchone()
           if db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_attempt_body_proofs'").fetchone() else None)
    if job['state']=='review':
        review=research.general_source_news.semantic_review(db,row,reference)
        # A terminal assessment is a separate current, proven decision, never a
        # retry job. Its failed output requires the recorded generation body.
        if (not review or review['lease']!=job['lease'] or not proof
            or proof['source_sha']!=row['sha'] or proof['body_sha']!=row['body_sha']):
            return None
    if row.get('general_source'):
        # The retained post SHA already binds its complete title and body.
        provenance='verified-current-retained-body'
    elif proof and proof['source_sha']==row['sha'] and proof['body_sha']==row['body_sha']:
        provenance='verified-current-generation-body'
    elif proof:
        provenance='generation-body-differs-from-current'
    else:
        provenance='unverified-generation-body-not-recorded'
    latest=db.execute('SELECT lease FROM official_research_attempt_failures WHERE event_id=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1',(row['id'],)).fetchone()
    if not latest or latest['lease']!=failure['lease']:
        return None
    payload=failure['payload']
    if not isinstance(payload,str) or not payload or len(payload.encode('utf-8'))>131072:
        return None
    try:
        value=json.loads(payload)
    except (ValueError,TypeError):
        return None
    if not isinstance(value,dict):
        return None
    fields=[]
    if row.get('general_source'):
        raw_facts=value.get('facts')
        if not isinstance(raw_facts,list):
            return None
        fields=[(f'facts[{index}]',item) for index,item in enumerate(raw_facts[:8])]
        units={unit['id']:unit for unit in row['units']}
    else:
        raw_facts=value.get('facts')
        if not isinstance(raw_facts,list):
            return None
        fields=[('title',value.get('title')),('summary',value.get('summary')),
                *[(f'facts[{index}]',item) for index,item in enumerate(raw_facts[:5])],
                ('purpose',value.get('purpose'))]
        units={}
    records=[]
    for field,item in fields[:10]:
        if not isinstance(item,dict) or not all(isinstance(item.get(lang),str) for lang in ('ja','en')):
            continue
        record={'field':field,'ja':item['ja'][:600],'en':item['en'][:600],
                'jaTruncated':len(item['ja'])>600,'enTruncated':len(item['en'])>600}
        evidence_id=item.get('evidenceId')
        unit=units.get(evidence_id) if isinstance(evidence_id,str) else None
        quote=unit['quote'] if unit else item.get('evidenceQuote')
        literal=isinstance(quote,str) and 16<=len(quote)<=1800 and quote in row['body']
        record['selectedEvidenceIsLiteralCurrentBody']=literal
        if literal:
            record['selectedEvidence']=quote
            if unit:
                record['evidenceId']=unit['id']
                source=research.general_source_news.concepts(quote,'en')
                for lang in ('ja','en'):
                    actual=research.general_source_news.concepts(item[lang],lang)
                    if lang=='ja' and '需給' in item[lang]:
                        actual.add('demand')
                    record[lang+'MissingTopics']=sorted(source-actual)
                    record[lang+'AddedConsequentialTopics']=sorted((actual-source)&research.general_source_news.CONSEQUENTIAL)
        records.append(record)
    if not records:
        return None
    result={'check':'editor-only-current-failed-output','eventId':row['id'],
            'sourceSha':row['sha'],'currentBodySha':row['body_sha'],'failedAt':failure['failed_at'],
            'generationBodyProvenance':provenance,
            'generationBodyVerified':provenance.startswith('verified-'),
            'recordedGenerationBodySha':proof['body_sha'] if proof else None,
            'notice':'Private failed model output, not approved news. Generation-body provenance is reported separately; missing or different proof never approves this copy. Only selected evidence literal in the current verified body is included.',
            'fields':records,'fieldsTruncated':len(raw_facts)>(8 if row.get('general_source') else 5)}
    return result if len(json.dumps(result,ensure_ascii=False).encode())<=48000 else None


MAX_EVENT_ID = 9007199254740991


def valid_cursor(value):
    return value is None or (type(value) is int and 1 <= value <= MAX_EVENT_ID)


def page_metadata(items, total, available, limit, before):
    remaining = available - len(items)
    return {'limit': limit, 'beforeEventId': before, 'returned': len(items),
            'omitted': total - len(items), 'outsideCursor': total - available,
            'remaining': remaining,
            'nextBeforeEventId': items[-1]['eventId'] if remaining and items else None,
            'order': 'event-id-desc', 'consistency': 'fresh-read-per-page'}


STORED_CLOCK = re.compile(
    r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
    r'(?:\.[0-9]+)?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])')


def parse_stored_clock(value):
    try:
        # fromisoformat accepts basic/hour-only ISO and normalizes invalid
        # offset minutes. Presentation requires the same precise shape as UI.
        if not isinstance(value, str) or not STORED_CLOCK.fullmatch(value):
            return None
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def source_clock(row):
    # Primary bridge publication timestamps can be synthesized from a date.
    # Never turn that date into an apparently exact source clock or latency.
    published_on = row.get('published_on')
    if published_on:
        try:
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}', published_on):
                date.fromisoformat(published_on)
                return {'value': published_on, 'precision': 'date', 'basis': 'stored-source-date'}
        except (ValueError, TypeError):
            pass
        return {'value': None, 'precision': 'unknown', 'basis': 'unavailable'}
    published_at = row.get('published_at')
    if not row['source_id'].startswith('primary-ir-') and parse_stored_clock(published_at):
        return {'value': published_at, 'precision': 'timestamp', 'basis': 'stored-source-timestamp'}
    return {'value': None, 'precision': 'unknown', 'basis': 'unavailable'}


def stored_publication_clock(publication, row, valid, reference):
    """Presentation-only chronology check; never changes existing lane counts.

    Current body acquisition can be a later re-fetch. It is not a first-body
    clock and is deliberately not used to reconstruct publication history.
    """
    if not valid:
        return None
    clocks = []
    for value in (row['observed_at'], publication['started_at'], publication['public_at']):
        parsed = parse_stored_clock(value)
        if not parsed:
            return None
        clocks.append(parsed)
    return publication['public_at'] if clocks[0] <= clocks[1] <= clocks[2] <= reference else None


def current_recovery_audits(db, row, publication, reference, tables):
    """Bounded clock projection, not another publication/validation decision.

    New audit formats are used only for the exact current source/body/payload
    and stored publication clocks. Do not load retry archives, reconstruct
    history, invoke a writer, or substitute a current re-fetch for an old clock.
    """
    try:
        payload, body = publication['payload'], row['body']
        if (publication['sha'] != row['sha'] or publication['body_sha'] != row['body_sha']
                or not isinstance(payload, str) or not 0 < len(payload.encode('utf-8')) <= 131072
                or not isinstance(body, str) or not 0 < len(body) <= 160000
                or hashlib.sha256(body.encode('utf-8')).hexdigest() != row['body_sha']):
            return []
        values = (row['observed_at'], row['body_at'], publication['started_at'], publication['public_at'])
        if any(not isinstance(value, str) or len(value) > 64 for value in values):
            return []
        observed, body_at, started, public = map(parse_stored_clock, values)
        if (not all((observed, body_at, started, public))
                or not observed <= started <= public <= reference
                or not observed <= body_at <= reference):
            return []
        current = db.execute('''SELECT sha,body_sha,payload,started_at,public_at
          FROM official_research_publications WHERE event_id=? AND length(payload)<=131072''',
          (row['id'],)).fetchone()
        if not current or any(current[key] != publication[key] for key in current.keys()):
            return []
        payload_sha = hashlib.sha256(payload.encode('utf-8')).hexdigest()
        audits = []
        if ('reviewed_retry_article_recoveries' in tables and not (row.get('general_source') or row.get('issuer_business'))
                and len(db.execute('SELECT 1 FROM reviewed_retry_article_recoveries WHERE event_id=? LIMIT 2',
                                   (row['id'],)).fetchall()) == 1):
            audit = db.execute("""SELECT manifest_sha,source_revision,source_observed_at,source_body_at,
              started_at AS started,public_at AS at,payload_sha FROM reviewed_retry_article_recoveries
              WHERE event_id=? AND source_id=? AND event_sha=? AND body_sha=?
              AND payload_sha=? AND started_at=? AND public_at=?
              AND length(manifest_sha)=64 AND length(source_revision)=64
              AND length(source_observed_at)<=64 AND length(source_body_at)<=64""",
              (row['id'],row['source_id'],row['sha'],row['body_sha'],payload_sha,
               publication['started_at'],publication['public_at'])).fetchone()
            if audit:
                acquired = parse_stored_clock(audit['source_body_at'])
                note = json.loads(payload)
                cached = db.execute("""SELECT sha,body_sha,body,error FROM official_story_bodies
                  WHERE event_id=? AND length(body)<=160000""", (row['id'],)).fetchone()
                event = db.execute('SELECT source_id,url,sha,title,observed_at FROM signal_events WHERE id=?',
                                   (row['id'],)).fetchone()
                exact_event = bool(event and all(event[key] == row[key] for key in event.keys()))
                exact_body = bool(cached and not cached['error'] and cached['sha'] == row['sha']
                                  and cached['body_sha'] == row['body_sha'] and cached['body'] == body)
                if row['source_id'].startswith('primary-ir-'):
                    source = db.execute('SELECT sha256 FROM sources WHERE url=?', (row['url'],)).fetchone()
                    exact_source = bool(source and source['sha256'] == audit['source_revision']
                                        and research.bridge.is_current(db, row))
                else:
                    source = db.execute("""SELECT sha,title,text FROM signal_documents
                      WHERE source_id=? AND url=? AND length(text)<=160000""",
                      (row['source_id'],row['url'])).fetchone()
                    exact_source = bool(source and source['sha'] == audit['source_revision'] == row['sha']
                                        and source['title'] == row['title'] and source['text'] == body
                                        and hashlib.sha256((row['title']+'\n'+body).encode('utf-8')).hexdigest() == row['sha'])
                if (exact_event and exact_body and exact_source and isinstance(note, dict)
                        and note.get('generationMethod') == research.editorial_recovery.GENERATION_METHOD
                        and note.get('reviewedCopySha256') == audit['manifest_sha']
                        and isinstance(audit['manifest_sha'], str) and re.fullmatch(r'[0-9a-f]{64}', audit['manifest_sha'])
                        and audit['source_observed_at'] == row['observed_at']
                        and acquired and observed <= acquired <= started and acquired <= body_at):
                    audits.append(audit)
        if ('source_structured_buyback_derivations' in tables and row.get('general_source') and row.get('category') == 'share-buyback'
                and len(db.execute('SELECT 1 FROM source_structured_buyback_derivations WHERE event_id=? LIMIT 2',
                                   (row['id'],)).fetchall()) == 1):
            derived = research.buyback_structured_publication
            # Compare complete canonical snapshots in SQL. Never deserialize
            # arbitrary archived JSON or read original failed model artifacts.
            saved = db.execute("""SELECT * FROM official_research_publications WHERE event_id=?
              AND length(payload)<=131072 AND length(evidence)<=131072""", (row['id'],)).fetchone()
            if (saved and all(saved[key] == publication[key] for key in publication.keys())
                    and len(saved['evidence'].encode('utf-8')) <= 131072
                    and type(saved['generation_ms']) is int and saved['generation_ms'] >= 0
                    and body_at <= started):
                audit = db.execute("""SELECT derived_at AS at,validated_payload_sha AS payload_sha,
                  ? AS started FROM source_structured_buyback_derivations
                  WHERE event_id=? AND sha=? AND body_sha=? AND policy_version=?
                  AND source_snapshot=? AND publication_snapshot=? AND validated_payload_sha=? AND derived_at=?""",
                  (publication['started_at'],row['id'],row['sha'],row['body_sha'],research.buyback_structured.VERSION,
                   derived.encoded(derived.source_snapshot(row)),derived.encoded(dict(saved)),payload_sha,
                   publication['public_at'])).fetchone()
                if audit and derived.current_source(db, row, reference) is not None:
                    audits.append(audit)
        return audits
    except (ValueError, TypeError, KeyError, AttributeError, sqlite3.Error):
        # Optional absent/malformed audit inputs must not break the owner read.
        return []


def publication_history(db, row, publication, valid, reference):
    """Only authoritative same-revision audit clocks; never infer a first time.

    Recovery records are not a complete publication history. The earliest audit
    is labeled accordingly, even if it predates the current payload's clock.
    """
    result = {'earliestAuditedPublicationAt': None, 'currentPayloadAuditedAt': None,
              'firstValidatedAt': None, 'firstRenderedAt': None,
              'historyComplete': False}
    if not valid:
        return result
    payload_sha = hashlib.sha256(publication['payload'].encode('utf-8')).hexdigest()
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    audits = []
    if 'official_research_editorial_recoveries' in tables:
        audits.extend(db.execute("""SELECT public_at AS at, reviewed_payload_sha AS payload_sha,
          recovery_started_at AS started FROM official_research_editorial_recoveries
          WHERE event_id=? AND source_id=? AND sha=? AND body_sha=?""",
          (row['id'], row['source_id'], row['sha'], row['body_sha'])))
    if 'reviewed_retained_announcement_recoveries' in tables:
        audits.extend(db.execute("""SELECT public_at AS at, payload_sha, started_at AS started
          FROM reviewed_retained_announcement_recoveries
          WHERE event_id=? AND source_url=? AND event_sha=? AND body_text_sha=?""",
          (row['id'], row['url'], row['sha'], hashlib.sha256(row['body'].encode('utf-8')).hexdigest())))
    if 'business_news_revalidations' in tables:
        audits.extend(db.execute("""SELECT revalidated_at AS at, validated_payload_sha AS payload_sha,
          NULL AS started FROM business_news_revalidations WHERE event_id=? AND sha=? AND body_sha=?""",
          (row['id'], row['sha'], row['body_sha'])))
    audits.extend(current_recovery_audits(db, row, publication, reference, tables))
    parse = parse_stored_clock
    current_at = parse(publication['public_at'])
    observed_at = parse(row['observed_at'])
    if not current_at or not observed_at:
        return result
    proven = []
    for audit in audits:
        at, started = parse(audit['at']), parse(audit['started']) if audit['started'] else observed_at
        # The current body clock may be a later re-fetch of the same hash.
        # It must not erase an authoritative older same-revision audit.
        if at and started and observed_at <= started <= at <= current_at <= reference:
            proven.append((at, audit['at']))
            if audit['payload_sha'] == payload_sha and at == current_at:
                result['currentPayloadAuditedAt'] = audit['at']
    if proven:
        result['earliestAuditedPublicationAt'] = min(proven)[1]
    return result


def terminal_review_diagnostics(db,reference,limit,remaining_context_bytes,before_event_id=None):
    """Read current stopped semantic decisions separately from the work queue."""
    table=db.execute("SELECT 1 FROM sqlite_master WHERE name='general_source_semantic_reviews'").fetchone()
    if not table or not db.execute('SELECT 1 FROM general_source_semantic_reviews LIMIT 1').fetchone():
        return {'items':[],'total':0,'omitted':0,'pagination':page_metadata([],0,0,limit,before_event_id)},False
    rows=research.general_source_news.candidates(db,reference,include_review=True)
    items,total,available,raw_copy_included=[],0,0,False
    for row in sorted(rows,key=lambda item:item['id'],reverse=True):
        review=research.general_source_news.semantic_review(db,row,reference)
        job=db.execute('SELECT sha,state,attempts,next_at,failure_kind,lease FROM official_research_jobs WHERE event_id=?',(row['id'],)).fetchone()
        if (not review or not job or job['state']!='review' or job['sha']!=row['sha']
            or job['lease']!=review['lease'] or not research.current_revision(db,row)):
            continue
        total+=1
        if before_event_id is not None and row['id'] >= before_event_id:
            continue
        available+=1
        if len(items)>=limit:
            continue
        publication=db.execute('SELECT sha,body_sha,payload FROM official_research_publications WHERE event_id=?',(row['id'],)).fetchone()
        current_publication=bool(publication and publication['sha']==row['sha'] and publication['body_sha']==row['body_sha'])
        failure=db.execute('SELECT sha,failed_at,reason,payload,lease FROM official_research_attempt_failures WHERE event_id=? AND sha=? AND lease=?',
                           (row['id'],row['sha'],job['lease'])).fetchone()
        rejected=validation_report(failure['payload'],row) if failure else None
        context=current_failed_context(db,row,job,failure,reference)
        context_state='unavailable'
        if context:
            encoded=len(json.dumps(context,ensure_ascii=False).encode())
            if encoded<=remaining_context_bytes:
                if not rejected['issues']:
                    rejected['issues'].append({'field':'note','issue':'stored-attempt-failed','checks':[]})
                rejected['issues'][0]['checks'].append(context)
                remaining_context_bytes-=encoded
                raw_copy_included=True
                context_state='included'
            else:
                context_state='response-budget'
        items.append({
            'eventId':row['id'],'sourceId':row['source_id'],'url':row['url'],'title':row['title'][:500],
            'ticker':row['ticker'],'currentSha':row['sha'],'bodySha':row['body_sha'],
            'observedAt':row['observed_at'],'bodyReadyAt':row['body_at'],'sourceClock':source_clock(row),'status':'terminal-review',
            'review':{'reason':review['reason'],'decidedAt':review['decided_at']},
            'publication':{'present':bool(publication),'currentRevision':current_publication,
                           'validation':validation_report(publication['payload'],row) if current_publication else {'status':'unavailable','issues':[]}},
            'job':{'state':'review','attempts':job['attempts'],'nextRetryAt':None,
                   'currentRevision':True,'failureKind':failure_kind(job['failure_kind'])},
            'latestFailure':{'failedAt':failure['failed_at'],'reason':failure_kind(failure['reason']),
                             'currentSourceRevision':True,'validation':rejected,'failedCopyContext':context_state} if failure else None,
        })
    return {'items':items,'total':total,'omitted':total-len(items),
            'pagination':page_metadata(items,total,available,limit,before_event_id)},raw_copy_included


def queue(path, limit=20, view='pending', reference=None, *, before_event_id=None, terminal_before_event_id=None):
    if (type(limit) is not int or not 1 <= limit <= 50 or view not in {'pending', 'all'}
            or not valid_cursor(before_event_id) or not valid_cursor(terminal_before_event_id)):
        raise ValueError('invalid-request')
    reference = reference or datetime.now(timezone.utc)
    # Do not initialize/migrate schema, synchronize metadata or create a missing DB.
    db = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        db.execute('PRAGMA busy_timeout=5000')
        db.execute('BEGIN')
        rows = research.candidates(db, reference, read_only=True)
        result, published, available, raw_copy_included = [], 0, 0, False
        remaining_context_bytes=200000
        for row in sorted(rows, key=lambda item: item['id'], reverse=True):
            publication = db.execute('SELECT sha,body_sha,payload,started_at,public_at FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
            current_publication = bool(publication and publication['sha'] == row['sha'] and publication['body_sha'] == row['body_sha'])
            saved = validation_report(publication['payload'], row) if current_publication else {'status': 'unavailable', 'issues': []}
            valid = current_publication and saved['status'] == 'valid' and research.publication_clock_valid(publication,row,reference)
            published += int(valid)
            if view == 'pending' and valid:
                continue
            if before_event_id is not None and row['id'] >= before_event_id:
                continue
            available += 1
            if len(result) >= limit:
                continue
            job = db.execute('SELECT sha,state,attempts,next_at,failure_kind,lease FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
            failure = db.execute('SELECT sha,failed_at,reason,payload,lease FROM official_research_attempt_failures WHERE event_id=? AND sha=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1', (row['id'], row['sha'])).fetchone()
            rejected = validation_report(failure['payload'], row) if failure else None
            body_revision_recorded = bool(not valid and context_authorized(db, row, job, failure, reference))
            context = bounded_failure_context(failure['payload'], row, rejected) if body_revision_recorded else None
            if context is None:
                context=current_failed_context(db,row,job,failure,reference)
            context_state='unavailable'
            if context:
                encoded=len(json.dumps(context,ensure_ascii=False).encode())
                if encoded<=remaining_context_bytes:
                    if not rejected['issues']:
                        rejected['issues'].append({'field':'note','issue':'stored-attempt-failed','checks':[]})
                    rejected['issues'][0]['checks'].append(context)
                    raw_copy_included = True
                    remaining_context_bytes-=encoded
                    context_state='included'
                else:
                    context_state='response-budget'

            public_at = stored_publication_clock(publication,row,valid,reference)
            result.append({
                'eventId': row['id'], 'sourceId': row['source_id'], 'url': row['url'], 'title': row['title'][:500],
                'ticker': row['ticker'], 'currentSha': row['sha'], 'bodySha': row['body_sha'],
                'observedAt': row['observed_at'], 'bodyReadyAt': row['body_at'],
                'sourceClock': source_clock(row),
                'status': 'validated-publication' if valid else 'pending',
                'publication': {'present': bool(publication), 'currentRevision': current_publication,
                                'publicAt': public_at, 'validation': saved,
                                'publicId': str(row['id']) if valid else None,
                                'researchId': 'ir-result-' + str(row['id']) if valid and row['source_id'].startswith('primary-ir-') else None,
                                'publicFeedPresence': 'not-checked',
                                'clockBasis': 'current-validated-revision' if public_at else 'unavailable',
                                **publication_history(db,row,publication,bool(public_at),reference)},
                'job': {'state': job['state'] if job['state'] in {'done', 'retry', 'running', 'stale'} else 'unknown',
                        'attempts': job['attempts'], 'nextRetryAt': instant(job['next_at']),
                        'currentRevision': job['sha'] == row['sha'], 'failureKind': failure_kind(job['failure_kind'])} if job else None,
                'latestFailure': {'failedAt': failure['failed_at'], 'reason': failure_kind(failure['reason']),
                                  'currentSourceRevision': True, 'bodyRevisionRecorded': body_revision_recorded,
                                  'validation': rejected,'failedCopyContext':context_state} if failure else None,
            })
        terminal_reviews,terminal_copy_included=terminal_review_diagnostics(db,reference,limit,remaining_context_bytes,terminal_before_event_id)
        raw_copy_included=raw_copy_included or terminal_copy_included
        pipeline=news_pipeline_diagnostics.snapshot(db,reference)
        # Existing editor clients already render checks JSON. Keep this distinct
        # from the host record's failed copy and do not change lane counts.
        host=next((item['latestFailure']['validation'] for item in result if item['latestFailure']),None)
        if host is not None:
            if not host['issues']:
                host['issues'].append({'field':'pipeline','issue':'read-only-metadata','checks':[]})
            host['issues'][0]['checks'].append(pipeline)
        filtered_total = len(rows) if view == 'all' else len(rows) - published
        return {'pagination':page_metadata(result,filtered_total,available,limit,before_event_id),
                'coverage':{'completeSourceCoverage':False,'workerSelectionMayBeCapped':True,'omittedOutsideWorkerSelection':None},
                'pipelineDiagnostics':pipeline,'terminalReviews':terminal_reviews,'items': result, 'view': view, 'readOnly': True, 'generatedAt': reference.isoformat(),
                'counts': {'candidates': len(rows), 'validatedPublications': published, 'pending': len(rows) - published},
                'filteredTotal': filtered_total,
                'scope': 'current-worker-candidates', 'rawCopyIncluded': raw_copy_included}
    finally:
        db.close()
