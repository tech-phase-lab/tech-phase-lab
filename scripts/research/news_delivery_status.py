"""Read-only delivery accounting; a stopped assessment is not a delivered item."""
from collections import Counter

import monitor

OVERDUE_MS=300000
# After this many failed attempts for the same source revision an item stops costing paid calls and stays on the original text (a new release
# of the source starts again at attempt 1). It is counted as exhausted, not as overdue.
EXHAUSTED_AFTER_ATTEMPTS=8
# Only a copy the checks keep rejecting exhausts; a provider outage, timeout or token limit says nothing about the item and keeps retrying with backoff.
CONTENT_FAILURES=frozenset({
    'unsupported-number','changed-action-capacity','changed-negation','invalid-copy','changed-business-topic','unsupported-quote','invalid-note',
    'invalid-facts','invalid-item','changed-amount-relation','changed-execution-period','changed-direction','changed-metric-direction','changed-names',
    'lost-forecast-modality'})


def is_exhausted(state,attempts,failure_kind):
    """A job at or past the attempt cap whose last failure was a rejected copy (never a transient provider failure)."""
    return (state=='exhausted' or (state=='retry' and attempts>=EXHAUSTED_AFTER_ATTEMPTS and failure_kind in CONTENT_FAILURES))


def summarize(db,reference,rows,published_ids,reviews,publication_holds=()):
    # Keep each lane's existing selection window; this is not upstream coverage.
    semantic_held=[row for row,review in reviews if review['reason']!='not-material-business-news']
    held=semantic_held+[row for row,_ in publication_holds]
    held_ids={row['id'] for row in held}
    excluded=[row for row,review in reviews if review['reason']=='not-material-business-news']
    unpublished=[row for row in rows if row['id'] not in published_ids and row['id'] not in held_ids]
    states=Counter()
    has_jobs=db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_jobs'").fetchone()
    pending,exhausted=[],[]
    for row in unpublished:
        job=(db.execute('SELECT state,attempts,failure_kind FROM official_research_jobs WHERE event_id=? AND sha=?',(row['id'],row['sha'])).fetchone()
             if has_jobs else None)
        if job and is_exhausted(job['state'],job['attempts'],job['failure_kind']):
            exhausted.append(row)
            continue
        pending.append(row)
        states[job['state'] if job else 'not-started']+=1
    def age(row,key):
        value=row.get(key)
        # A date-only source does not provide an exact publication instant.
        return monitor.stored_latency_ms(value,reference.isoformat()) if isinstance(value,str) and 'T' in value else None
    def ages(selected,key):
        return [value for row in selected if (value:=age(row,key)) is not None]
    # Latest private attempt failure code per unpublished item (codes only,
    # never copy or origin), so a stuck backlog can be diagnosed from public health.
    failures=Counter()
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_attempt_failures'").fetchone():
        for row in pending+exhausted+held:
            last=db.execute('SELECT reason FROM official_research_attempt_failures WHERE event_id=? AND sha=? '
                            'ORDER BY failed_at DESC LIMIT 1',(row['id'],row['sha'])).fetchone()
            if last:
                failures[last['reason']]+=1
    held_capture=ages(held,'observed_at')
    held_source=ages(held,'published_at')
    pending_capture=ages(pending,'observed_at')
    return {
        'scope':'current-worker-candidates-and-current-semantic-reviews','reviewWindowDays':7,
        'tracked':len(rows)+len(semantic_held)+len(excluded),'validated':len(published_ids),
        'automaticPending':len(pending),'retryWaiting':states['retry'],'running':states['running'],
        'notStarted':states['not-started'],'reviewHeld':len(held),'semanticReviewHeld':len(semantic_held),
        'publicationHeld':len(publication_holds),'assessedExcluded':len(excluded),
        'unpublished':len(pending)+len(exhausted)+len(held),'exhausted':len(exhausted),
        'reviewReasons':dict(sorted(Counter(review['reason'] for _,review in reviews).items())),
        'publicationHoldReasons':dict(sorted(Counter(reason for _,reason in publication_holds).items())),
        'automaticOverdue':sum(value>=OVERDUE_MS for value in pending_capture),
        'reviewOverdue':sum(value>=OVERDUE_MS for value in held_capture),
        'reviewOldestCaptureAgeMs':max(held_capture,default=None),
        'reviewOldestPublicationAgeMs':max(held_source,default=None),
        'reviewCaptureAgeUnmeasured':len(held)-len(held_capture),
        'reviewPublicationAgeUnmeasured':len(held)-len(held_source),
        'overdueAfterMs':OVERDUE_MS,
        'attemptFailureKinds':dict(sorted(failures.items())),
    }
