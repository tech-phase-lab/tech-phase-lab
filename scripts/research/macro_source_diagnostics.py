"""Owner-only, read-only explanations of the existing macro recovery guards.

Only fixed codes, counts, booleans and explicitly bounded matched clock fields are exported. This is neither an audit nor
publication authority. It never executes publish_held, initializes schema,
exports stored responses/leases, or changes any admission predicate.
"""
from datetime import datetime, timezone
import json
import sqlite3

import macro_source_publication as publication

VERSION = 1


def _clock(value):
    try:
        return publication.clock_valid(value)
    except (ValueError, TypeError, OverflowError):
        return None


def _instant(value):
    try:
        return publication.news.reconciliation.instant(value)
    except (ValueError, TypeError, OverflowError):
        return None


def _proof_checks(row, original, raw, reference):
    """Supplement the authoritative closed_proof result with bounded bindings."""
    job, review = original['job'], original['review']
    lease = job.get('lease') if job else None
    calls = [value for value in original['calls'] if value['lease'] == lease] if job else []
    proofs = [value for value in original['proofs'] if value['lease'] == lease] if job else []
    failures = [value for value in original['failures'] if value['sha'] == row['sha']]
    current_calls = [value for value in original['calls']
                     if value['source_id'] == 'research:' + row['source_id'] and value['sha'] == row['sha']]
    counts = {'currentFailures': len(failures), 'currentCalls': len(current_calls),
              'jobLeaseCalls': len(calls), 'jobLeaseBodyProofs': len(proofs)}
    checks = {'jobPresent': bool(job), 'jobCurrentSource': bool(job and job['sha'] == row['sha']),
              'jobLeaseTyped': bool(job and isinstance(lease, str)),
              'jobSingleAttempt': bool(job and job['attempts'] == 1),
              'jobInReview': bool(job and job['state'] == 'review'),
              'reviewPresent': bool(review),
              'reviewSameJob': bool(job and review and review['lease'] == lease),
              'reviewReasonAllowed': bool(review and review['reason'] == 'unsubstantiated-model-output'),
              'reviewPolicyCurrent': bool(review and review['policy_version'] == publication.news.ASSESSMENT_VERSION)}
    call, proof, failure = (calls[0] if len(calls) == 1 else None,
                            proofs[0] if len(proofs) == 1 else None,
                            failures[0] if len(failures) == 1 else None)
    start = None
    if call:
        try:
            start = datetime.fromtimestamp(call['at'], timezone.utc)
        except (ValueError, TypeError, OverflowError, OSError):
            pass
    body_at = _instant(row.get('body_at'))
    failed = _clock(failure.get('failed_at')) if failure else None
    reviewed = _clock(review.get('started_at')) if review else None
    decided = _clock(review.get('decided_at')) if review else None
    checks.update({
        'callIdentityMatches': bool(call and call['source_id'] == 'research:' + row['source_id'] and call['sha'] == row['sha']),
        'callFailed': bool(call and call['state'] == 'failed'),
        'callClockValid': bool(start),
        'callAfterCurrentBody': bool(start and body_at and body_at <= start),
        'callNotFuture': bool(start and start <= reference),
        'bodyProofMatches': bool(proof and proof['source_sha'] == row['sha'] and proof['body_sha'] == row['body_sha']),
        'failureSameJob': bool(job and failure and failure['lease'] == lease),
        'failurePayloadMatches': bool(failure and failure['payload'] == raw),
        'failureReasonAllowed': bool(failure and failure['reason'] in publication.news.FAILURE_CODES),
        'failureReasonMatchesJob': bool(job and failure and failure['reason'] == job['failure_kind']),
        'failureClockValid': bool(failed),
        'failureAfterCall': bool(failed and start and start <= failed),
        'failureNotFuture': bool(failed and failed <= reference),
        'reviewStartMatchesCall': bool(reviewed and start and reviewed == start),
        'reviewDecisionClockValid': bool(decided),
        'reviewDecisionNotFuture': bool(decided and decided <= reference),
        'reviewDecisionAfterFailure': bool(failed and decided and publication.decision_after_failure(failed, review['decided_at'])),
    })
    clocks = None
    unique_closed = (len(current_calls) == len(calls) == 1 and job and review and failure
                     and checks['jobCurrentSource'] and checks['callIdentityMatches']
                     and checks['callFailed'] and checks['reviewSameJob'] and checks['failureSameJob'])
    checks['matchedClockEvidenceAvailable'] = bool(unique_closed)
    if unique_closed:
        def bounded(value):
            return {'value': value[:128] if isinstance(value, str) else None,
                    'truncated': isinstance(value, str) and len(value) > 128}
        clocks = {'basis': 'unique-current-closed-call',
                  'callStartEpochSeconds': call['at'] if start else None,
                  'callStartUtc': start.isoformat() if start else None,
                  'reviewStartedAt': bounded(review['started_at']),
                  'reviewDecidedAt': bounded(review['decided_at']),
                  'failureFailedAt': bounded(failure['failed_at']),
                  'jobStartEndRecorded': False, 'callEndRecorded': False}
    return counts, checks, clocks


def _market_metadata_checks(row, item, reference):
    """Explain exact existing identity predicates without approving history."""
    result = {'sourceAndClocksMatch': False, 'payloadIdentityMatches': False,
              'originalWindowEligible': False}
    event, record = item.get('sourceEvent'), item['record']
    if not event:
        return result
    result['originalWindowEligible'] = bool(event.get('original_source_window_active') == 1
                                            and event.get('original_observation_window_active') == 1)
    try:
        account = publication.re.fullmatch(r'/([A-Za-z0-9_]+)/status/\d+', publication.urlsplit(record['url']).path)
        source = next((value for value in publication.signals.SOURCES if value['id'] == event['source_id']), None)
        source_at, observed, published = (_clock(event['published_at']), _clock(event['observed_at']), _clock(record['published_at']))
        result['sourceAndClocksMatch'] = bool(
            account and account[1].lower() in publication.market_results.ACCOUNTS and source
            and publication.news.safe_reference(record['url'], source) == record['url']
            and record['source_id'] == event['source_id'] and event['url'] == record['url']
            and record['sha'] == event['sha'] == row['sha'] and event['current_sha'] == event['sha']
            and not event['truncated'] and event['body'] == row['body'] and event['title'] == row['title']
            and event['current_title'] == event['title']
            and publication.news.digest(event['title']+'\n'+event['body']) == event['sha']
            and source_at and observed and published and source_at <= observed <= published <= reference
            and source_at == _instant(row['published_at']))
        if not isinstance(record['payload'], str) or len(record['payload'].encode()) > 131072:
            return result
        payload = json.loads(record['payload'])
        expected = {'id': str(event['id']), 'url': event['url'],
                    'publisher': publication.market_results.NAMES[account[1].lower()],
                    'publishedAt': event['published_at'], 'observedAt': event['observed_at'],
                    'researchId': 'x-result-'+str(event['id'])} if account else {}
        result['payloadIdentityMatches'] = bool(expected and isinstance(payload, dict)
                                                and all(payload.get(key) == value for key, value in expected.items()))
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
        pass
    return result


def _ownership(db, row, reference):
    owner = publication.ownership_state(db, row, reference)
    records = owner['market']
    # A None projection is an ordinary negative result, never a query/parser
    # exception. Neither result changes the current ownership guard.
    projections = {'supported': 0, 'notProjectable': 0, 'unavailable': 0}
    metadata = {'sourceAndClocksMatch': 0, 'payloadIdentityMatches': 0, 'originalWindowEligible': 0}
    for item in records:
        for key, value in _market_metadata_checks(row, item, reference).items():
            metadata[key] += value
        event = item.get('sourceEvent')
        if not event:
            projections['unavailable'] += 1
            continue
        try:
            ticks = json.loads(event['tickers_json'])
            if (not isinstance(event['body'], str) or not isinstance(ticks, list)
                    or any(not isinstance(tick, str) for tick in ticks)):
                raise TypeError('unavailable projection inputs')
            projected = publication.market_results.projection(event['body'], ticks)
            projections['supported' if projected is not None else 'notProjectable'] += 1
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            projections['unavailable'] += 1
    return owner, {'classification': publication.ownership_reason(owner),
                  'blocked': not publication.unowned(owner),
                  'primaryOwned': bool(owner['primary']), 'officialRecords': len(owner['official']),
                  'analystRecords': len(owner['analyst']), 'marketRecords': len(records),
                  'activeMarketRecords': sum(item['status'] == 'active' for item in records),
                  'verifiedExpiredMarketRecords': sum(item['status'] == 'expired' for item in records),
                  'unverifiedMarketRecords': sum(item['status'] == 'unverified' for item in records),
                  'expiredSourceWindowRecords': sum(item['window'] == 'expired' for item in records),
                  'withinPublicPageSelection': sum(item['withinPublicPageSelection'] for item in records),
                  'currentProjection': projections, 'marketMetadata': metadata}


def recovery_probe(db, row, reference):
    """First existing writer refusal, without attempting a write or clock claim.

    The caller selects the exact current source row in its existing read-only
    snapshot. A successful preflight remains subject to the writer's real
    correction clock and atomic source/history/ownership snapshot rechecks.
    """
    if not publication.recognized(row):
        return None
    result = {'check': 'editor-only-macro-recovery', 'version': VERSION, 'readOnly': True,
              'firstRefusal': 'diagnostic-unavailable', 'checks': {}, 'counts': {},
              'ownership': {'classification': 'not-evaluated', 'blocked': True},
              'atomicRecheckPerformed': False, 'publicationAuthorized': False}
    checks = result['checks']
    try:
        owner, result['ownership'] = _ownership(db, row, reference)
    except (sqlite3.Error, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        owner = None
        result['ownership'] = {'classification': 'diagnostic-unavailable', 'blocked': True}
    try:
        checks['auditPresent'] = publication.recorded(db, row)
        if checks['auditPresent']:
            result['firstRefusal'] = 'existing-current-audit'
            return result
        checks['publicationPresent'] = bool(db.execute(
            'SELECT 1 FROM official_research_publications WHERE event_id=?', (row['id'],)).fetchone())
        if checks['publicationPresent']:
            result['firstRefusal'] = 'existing-publication-record'
            return result
        original = publication.artifacts(db, row)
        failures = [failure for failure in original['failures'] if failure['sha'] == row['sha']]
        result['counts']['currentFailures'] = len(failures)
        if len(failures) != 1:
            result['firstRefusal'] = 'current-failure-not-unique'
            return result
        raw = failures[0]['payload']
        checks['storedResponsePresent'] = isinstance(raw, str)
        if not checks['storedResponsePresent']:
            result['firstRefusal'] = 'stored-response-unavailable'
            return result
        checks['storedResponseWithinLimit'] = len(raw.encode()) <= 131072
        if not checks['storedResponseWithinLimit']:
            result['firstRefusal'] = 'stored-response-limit'
            return result
        try:
            checks['originalPositiveEnvelope'] = publication.positive(json.loads(raw))
        except (ValueError, TypeError):
            checks['originalPositiveEnvelope'] = False
        result['counts'], detail, clocks = _proof_checks(row, original, raw, reference)
        checks.update(detail)
        if clocks is not None:
            result['matchedClocks'] = clocks
        checks['closedAttemptVerified'] = publication.closed_proof(row, original, raw, 'held-correction', reference)
        if not checks['closedAttemptVerified']:
            result['firstRefusal'] = 'closed-attempt-proof-unverified'
            return result
        checks['retainedSourceVerified'] = publication.retained(db, row, reference) is not None
        if not checks['retainedSourceVerified']:
            result['firstRefusal'] = 'retained-source-proof-unverified'
            return result
        if owner is None:
            result['firstRefusal'] = 'ownership-diagnostic-unavailable'
            return result
        checks['ownershipAvailable'] = publication.unowned(owner)
        if not checks['ownershipAvailable']:
            result['firstRefusal'] = 'independent-ownership-held'
            return result
        try:
            publication.bind(json.loads(raw), row)
            checks['deterministicDerivationValid'] = True
        except (ValueError, TypeError, KeyError):
            checks['deterministicDerivationValid'] = False
            result['firstRefusal'] = 'deterministic-derivation-invalid'
            return result
        result['firstRefusal'] = 'eligible-awaiting-atomic-recheck'
        return result
    except (sqlite3.Error, ValueError, TypeError, KeyError, AttributeError, OverflowError, OSError):
        return result
