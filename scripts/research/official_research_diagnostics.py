"""Editor-only, read-only diagnosis of the current issuer-note candidate set.

Unrelated research retains its expiring exact repair-cohort context gate.
Current failed source-bound business jobs may expose sanitized bounded copy and
literal selected evidence to the existing editor-only queue. Never returns full
source bodies, arbitrary payload fields or provider arguments.
Replaying validation explains a gate; it does not establish factual correctness.
"""
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

import factual_validation as facts
import official_research as research
import official_research_content_repair as repair
import news_pipeline_diagnostics


ISSUES = {'invalid-note', 'invalid-facts', 'invalid-item', 'unsupported-quote',
          'invalid-copy', 'unsupported-number', 'incomplete', 'lost-forecast-modality', 'lost-negation', 'reversed-supply-demand', 'lost-fiscal-basis', 'lost-comparison', 'invented-broker-action', 'source-copy-overlap', 'unsupported-actor', 'lost-action-status'} | research.general_source_news.FAILURE_CODES


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
    if (not job or not failure or job['state']!='retry' or job['sha']!=row['sha']
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


def queue(path, limit=20, view='pending', reference=None):
    if type(limit) is not int or not 1 <= limit <= 50 or view not in {'pending', 'all'}:
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
        result, published, raw_copy_included = [], 0, False
        remaining_context_bytes=200000
        for row in sorted(rows, key=lambda item: item['id'], reverse=True):
            publication = db.execute('SELECT sha,body_sha,payload,started_at,public_at FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
            current_publication = bool(publication and publication['sha'] == row['sha'] and publication['body_sha'] == row['body_sha'])
            saved = validation_report(publication['payload'], row) if current_publication else {'status': 'unavailable', 'issues': []}
            valid = current_publication and saved['status'] == 'valid' and research.publication_clock_valid(publication,row,reference)
            published += int(valid)
            if view == 'pending' and valid:
                continue
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

            result.append({
                'eventId': row['id'], 'sourceId': row['source_id'], 'url': row['url'], 'title': row['title'][:500],
                'ticker': row['ticker'], 'currentSha': row['sha'], 'bodySha': row['body_sha'],
                'observedAt': row['observed_at'], 'bodyReadyAt': row['body_at'],
                'status': 'validated-publication' if valid else 'pending',
                'publication': {'present': bool(publication), 'currentRevision': current_publication,
                                'publicAt': publication['public_at'] if valid else None, 'validation': saved},
                'job': {'state': job['state'] if job['state'] in {'done', 'retry', 'running', 'stale'} else 'unknown',
                        'attempts': job['attempts'], 'nextRetryAt': instant(job['next_at']),
                        'currentRevision': job['sha'] == row['sha'], 'failureKind': failure_kind(job['failure_kind'])} if job else None,
                'latestFailure': {'failedAt': failure['failed_at'], 'reason': failure_kind(failure['reason']),
                                  'currentSourceRevision': True, 'bodyRevisionRecorded': body_revision_recorded,
                                  'validation': rejected,'failedCopyContext':context_state} if failure else None,
            })
        pipeline=news_pipeline_diagnostics.snapshot(db,reference)
        # Existing editor clients already render checks JSON. Keep this distinct
        # from the host record's failed copy and do not change lane counts.
        host=next((item['latestFailure']['validation'] for item in result if item['latestFailure']),None)
        if host is not None:
            if not host['issues']:
                host['issues'].append({'field':'pipeline','issue':'read-only-metadata','checks':[]})
            host['issues'][0]['checks'].append(pipeline)
        return {'pipelineDiagnostics':pipeline,'items': result, 'view': view, 'readOnly': True, 'generatedAt': reference.isoformat(),
                'counts': {'candidates': len(rows), 'validatedPublications': published, 'pending': len(rows) - published},
                'filteredTotal': len(rows) if view == 'all' else len(rows) - published,
                'scope': 'current-worker-candidates', 'rawCopyIncluded': raw_copy_included}
    finally:
        db.close()
