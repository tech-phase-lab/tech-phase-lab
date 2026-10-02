"""Editor-only, read-only diagnosis of the current issuer-note candidate set.

Never returns rejected copy, evidence excerpts, source bodies or provider data.
Replaying validation explains a gate; it does not establish factual correctness.
"""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3

import factual_validation as facts
import official_research as research


ISSUES = {'invalid-note', 'invalid-facts', 'invalid-item', 'unsupported-quote',
          'invalid-copy', 'unsupported-number', 'incomplete'}


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


def quantities(values):
    counts = Counter(values)
    ordered = sorted(counts, key=lambda item: (item[1], item[0]))
    return [{'value': str(value), 'dimension': unit, 'count': counts[(value, unit)]}
            for value, unit in ordered[:20]]


def number_checks(item):
    """Expose only parsed quantities/relationships, never surrounding prose."""
    if not all(isinstance(item.get(key), str) for key in ('ja', 'en', 'evidenceQuote')):
        return []
    result = []
    for language in ('ja', 'en'):
        text, evidence = item[language], item['evidenceQuote']
        unsupported = set(facts.numeric_values(text)) - set(facts.numeric_values(evidence))
        if unsupported:
            result.append({'check': language + '-evidence-quantity',
                           'unsupported': quantities(unsupported), 'truncated': len(unsupported) > 20})
        quarters = sorted(set(facts.quarter_values(text)) - set(facts.quarter_values(evidence)))
        if quarters:
            result.append({'check': language + '-evidence-quarter', 'unsupported': quarters})
        try:
            source_dates = facts.dates(evidence)
            unsupported_dates = [list(value) for value in facts.dates(text)
                                 if not any(value[1:] == source[1:] and (value[0] is None or value[0] == source[0])
                                            for source in source_dates)]
            if unsupported_dates:
                result.append({'check': language + '-evidence-date',
                               'unsupported': unsupported_dates[:20], 'truncated': len(unsupported_dates) > 20})
        except ValueError:
            result.append({'check': language + '-invalid-calendar-date'})
    ja, en = Counter(facts.numeric_values(item['ja'])), Counter(facts.numeric_values(item['en']))
    if ja != en:
        result.append({'check': 'bilingual-quantity-count', 'jaOnly': quantities((ja - en).elements()),
                       'enOnly': quantities((en - ja).elements()), 'truncated': len(ja - en) > 20 or len(en - ja) > 20})
    for language, other in [('ja', 'en'), ('en', 'ja')]:
        try:
            facts.validate_numbers(item[language], item[other])
        except ValueError:
            result.append({'check': language + '-other-language-numbers'})
    return result


def validation_report(payload, row):
    if not isinstance(payload, str) or not payload or len(payload) > 131072:
        return {'status': 'unavailable', 'issues': []}
    note = None
    try:
        note = json.loads(payload)
        if not isinstance(note, dict):
            raise ValueError('invalid-note')
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
        result, published = [], 0
        for row in sorted(rows, key=lambda item: item['id'], reverse=True):
            publication = db.execute('SELECT sha,body_sha,payload,public_at FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone()
            current_publication = bool(publication and publication['sha'] == row['sha'] and publication['body_sha'] == row['body_sha'])
            saved = validation_report(publication['payload'], row) if current_publication else {'status': 'unavailable', 'issues': []}
            valid = current_publication and saved['status'] == 'valid'
            published += int(valid)
            if view == 'pending' and valid:
                continue
            if len(result) >= limit:
                continue
            job = db.execute('SELECT sha,state,attempts,next_at,failure_kind FROM official_research_jobs WHERE event_id=?', (row['id'],)).fetchone()
            failure = db.execute('SELECT sha,failed_at,reason,payload FROM official_research_attempt_failures WHERE event_id=? AND sha=? ORDER BY failed_at DESC LIMIT 1', (row['id'], row['sha'])).fetchone()
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
                                  'currentSourceRevision': True, 'bodyRevisionRecorded': False,
                                  'validation': validation_report(failure['payload'], row)} if failure else None,
            })
        return {'items': result, 'view': view, 'readOnly': True, 'generatedAt': reference.isoformat(),
                'counts': {'candidates': len(rows), 'validatedPublications': published, 'pending': len(rows) - published},
                'filteredTotal': len(rows) if view == 'all' else len(rows) - published,
                'scope': 'current-worker-candidates', 'rawCopyIncluded': False}
    finally:
        db.close()
