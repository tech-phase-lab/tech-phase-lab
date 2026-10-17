"""Bounded owner-only read-only policy recovery predicates, never authority.

No source copy, stored assessment, provider fields, secrets, leases or clocks
are emitted. Only fixed refusal codes and booleans explain current guards.
"""
import json
import sqlite3
import attributed_policy_publication as publication


def recovery_probe(db, row, reference):
    if not publication.recognized(row):
        return None
    result = {'check': 'editor-only-policy-recovery', 'version': 1, 'readOnly': True,
              'firstRefusal': 'diagnostic-unavailable', 'checks': {},
              'atomicRecheckPerformed': False, 'publicationAuthorized': False}
    checks = result['checks']
    try:
        checks['currentSourceVerified'] = publication.current_row(db, row, reference) is not None
        if not checks['currentSourceVerified']:
            result['firstRefusal'] = 'current-source-unverified'
            return result
        checks['retainedSourceVerified'] = publication.retained(db, row, reference) is not None
        if not checks['retainedSourceVerified']:
            result['firstRefusal'] = 'retained-source-proof-unverified'
            return result
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
        checks['uniqueCurrentFailure'] = len(failures) == 1
        if not checks['uniqueCurrentFailure']:
            result['firstRefusal'] = 'current-failure-not-unique'
            return result
        raw = failures[0]['payload']
        checks['storedAssessmentPresent'] = isinstance(raw, str)
        checks['storedAssessmentWithinLimit'] = isinstance(raw, str) and len(raw.encode()) <= 131072
        if not checks['storedAssessmentWithinLimit']:
            result['firstRefusal'] = 'stored-assessment-unavailable'
            return result
        try:
            value = json.loads(raw)
            checks['storedAssessmentExplicitPositive'] = publication.positive(value)
        except (ValueError, TypeError):
            checks['storedAssessmentExplicitPositive'] = False
        if not checks['storedAssessmentExplicitPositive']:
            result['firstRefusal'] = 'stored-positive-assessment-unverified'
            return result
        checks['closedAttemptVerified'] = publication.closed_proof(row, original, raw, 'held-correction', reference)
        if not checks['closedAttemptVerified']:
            result['firstRefusal'] = 'closed-attempt-proof-unverified'
            return result
        checks['independentOwnershipAvailable'] = publication.unowned(publication.ownership_state(db, row, reference))
        if not checks['independentOwnershipAvailable']:
            result['firstRefusal'] = 'independent-ownership-held'
            return result
        publication.bind(value, row)
        checks['completePolicyDerivationVerified'] = True
        result['firstRefusal'] = 'preflight-passed-atomic-recheck-required'
    except (sqlite3.Error, ValueError, TypeError, KeyError, AttributeError, OverflowError):
        result['firstRefusal'] = 'diagnostic-unavailable'
    return result
