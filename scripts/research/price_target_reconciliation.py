"""Editor-only reconciliation of retained X evidence; never changes publication.

Broad candidate discovery deliberately does not depend on recognized brokers or
strict target grammar. Reasons are the existing parser's first failing gate.
No source copy, exception text, credential, or upstream request is returned.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import re
from urllib.parse import urlsplit

import signals

# A discovery cue, not a financial-fact parser or an eligibility rule.
CANDIDATE = re.compile(
    r"\b(?:price[ -]?(?:targets?|objectives?)|target price|PT)\b"
    r"|\btargets?\b[^\n.!?]{0,100}\$\s*\d"
    r"|\$\s*\d[^\n.!?]{0,100}\btargets?\b", re.I)
RECORD_LIMIT = 50
FEED_LIMIT = 20


def instant(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def safe_reference(value, source):
    """Only fixed, approved X account/status URLs; never queries or userinfo."""
    try:
        if not source or not isinstance(value, str) or len(value) > 250:
            return None
        url = urlsplit(value)
        match = re.fullmatch(r'/([A-Za-z0-9_]+)/status/(\d+)', url.path)
        if (url.scheme != 'https' or url.hostname != 'x.com' or url.username
                or url.password or url.port or url.query or url.fragment or not match
                or match[1].lower() not in {name.lower() for name in source.get('accounts', [])}
                or match[1].lower() not in {'tipranks', 'wallstengine', 'fabymetal4'}):
            return None
        return value
    except (TypeError, ValueError):
        return None


def action_key(item):
    return (item['ticker'], signals.canonical_target_firm(item['firm']).casefold(),
            item['previous'], item['latest'], instant(item['publishedAt']).date())


def report(db, sources=signals.SOURCES, now=None):
    """Read an already initialized database, including mode=ro connections.

    Counts cover all retained rows, never the current editorial queue page or
    filter. Publication means inclusion in the backend's current 20-action
    projection, not verification of a network response or browser delivery.
    """
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError('reconciliation-reference-timezone')
    now = now.astimezone(timezone.utc)
    since = now - timedelta(days=7)
    approved = {source['id']: source for source in sources if source.get('format') == 'x-api'}
    marks = signals.PRICE_TARGET_SOURCE_MARKS
    acquired = list(db.execute(f'''SELECT rowid AS acquisition_id,* FROM signal_x_acquisition
        WHERE source_id IN ({marks})''', signals.PRICE_TARGET_SOURCE_IDS))
    documents = {(row['source_id'], row['url']): row for row in db.execute(
        f'SELECT source_id,url,sha,last_seen_at FROM signal_documents WHERE source_id IN ({marks})', signals.PRICE_TARGET_SOURCE_IDS)}
    retained_counts = Counter(row['source_id'] for row in acquired)
    newest = {}
    revisions = {}
    excluded = Counter()
    for row in acquired:
        identity = row['source_id'], row['url']
        seen = instant(row['last_seen_at'])
        if seen and seen <= now:
            order = seen, instant(row['first_seen_at']) or seen, row['acquisition_id']
            if identity not in newest or order > newest[identity][0]:
                newest[identity] = order, row['sha']
        if not isinstance(row['text'], str) or not CANDIDATE.search(row['text']):
            continue
        published = instant(row['published_at'])
        if published is None:
            excluded['invalid-publication-timestamp'] += 1
            continue
        if not since <= published <= now:
            excluded['outside-publication-window'] += 1
            continue
        key = (*identity, row['sha'])
        revisions[key] = {'acquisition': row, 'events': []}
    # Use real event evidence exactly as the public parser does. An acquisition
    # body can identify a candidate, but may never supplement an event's parse.
    for row in signals.price_target_rows(db, since, now):
        published = instant(row['published_at'])
        if published is not None and not since <= published <= now:
            continue
        key = row['source_id'], row['url'], row['sha']
        text = row['document_text'] or row['title']
        if key not in revisions and not (isinstance(text, str) and CANDIDATE.search(text)):
            continue
        revisions.setdefault(key, {'acquisition': None, 'events': []})['events'].append(row)
    projection = signals.price_target_projection(db, sources, now)
    returned = {action_key(item) for item in projection[:FEED_LIMIT]}
    records = []
    event_rows = 0
    acquisition_gaps = Counter()
    for (source_id, url, sha), evidence in revisions.items():
        acquired_row, events = evidence['acquisition'], evidence['events']
        identity = source_id, url
        document = documents.get(identity)
        retained_head = newest.get(identity)
        document_seen = instant(document['last_seen_at']) if document else None
        # Resolve one head. A newly acquired revision must remain an intake gap
        # while an older document is still projected; two conflicting heads
        # must never make both revisions 'superseded'. last_seen also supports
        # A -> B -> A reversions without relabeling the restored A as old.
        current_sha = (document['sha'] if document and (not retained_head or
                       (document_seen and document_seen > retained_head[0][0]))
                       else retained_head[1] if retained_head else None)
        current = not current_sha or current_sha == sha
        event_rows += len(events)
        assessments = [(row, *signals.price_target_observation(row, approved.get(source_id), now)) for row in events]
        eligible = next((entry for entry in assessments if entry[1] is not None), None)
        chosen = eligible or next(iter(assessments), None)
        if eligible:
            disposition = 'published' if action_key(eligible[1]) in returned else 'unpublished'
            reason = (('included-in-public-feed' if current else 'published-superseded-retained-revision')
                      if disposition == 'published' else 'public-feed-limit')
        elif chosen:
            disposition, reason = 'rejected', chosen[2]
        elif not current:
            disposition, reason = 'rejected', 'superseded-revision'
        elif acquired_row['truncated']:
            disposition, reason = 'rejected', 'truncated-evidence'
        elif not safe_reference(url, approved.get(source_id)):
            disposition, reason = 'rejected', 'source-url-not-approved'
        elif (not instant(acquired_row['first_seen_at']) or
              instant(acquired_row['first_seen_at']) < instant(acquired_row['published_at'])):
            disposition, reason = 'rejected', 'invalid-observation-timestamp'
        elif instant(acquired_row['first_seen_at']) > now:
            disposition, reason = 'rejected', 'future-observation'
        else:
            disposition = 'unpublished'
            reason = ('selected' if acquired_row['selected_for_processing'] else 'unselected') + '-no-matching-event'
            acquisition_gaps[reason] += 1
        row = chosen[0] if chosen else acquired_row
        records.append({'sourceId': source_id, 'url': safe_reference(url, approved.get(source_id)),
                        'eventId': chosen[0]['id'] if chosen else None,
                        'sha': sha if isinstance(sha, str) and re.fullmatch(r'[a-fA-F0-9]{64}', sha) else None,
                        'publishedAt': instant(row['published_at']).isoformat() if instant(row['published_at']) else None,
                        'observedAt': (instant(row['observed_at'] if chosen else row['first_seen_at']).isoformat()
                                       if instant(row['observed_at'] if chosen else row['first_seen_at']) else None),
                        'disposition': disposition, 'reason': reason, 'currentRevision': current,
                        'acquisitionRetained': acquired_row is not None,
                        '_post': url.lower()})
    posts = defaultdict(list)
    for record in records:
        posts[record['_post']].append(record)
    post_counts = Counter()
    # A post may have multiple routes/revisions. Current evidence determines its
    # disposition; historical-only target evidence remains explicitly rejected.
    for entries in posts.values():
        current = [record for record in entries if record['currentRevision']] or entries
        disposition = next((value for value in ('published', 'unpublished', 'rejected')
                            if any(record['disposition'] == value for record in current)), 'rejected')
        post_counts[disposition] += 1
    reasons = dict(sorted(Counter(record['reason'] for record in records).items()))
    records.sort(key=lambda record: (record['disposition'] == 'published', not record['currentRevision'],
                                    record['publishedAt'] or '', record['sourceId'], record['_post']))
    for record in records:
        del record['_post']
    return {'generatedAt': now.isoformat(), 'windowDays': 7, 'windowBasis': 'publishedAt',
            'since': since.isoformat(), 'until': now.isoformat(), 'readOnly': True,
            'counts': {'candidateRevisionRows': len(records), 'candidateEventRows': event_rows,
                       'retainedAcquisitionRevisionRows': len(acquired), 'uniqueSourcePosts': len(posts),
                       'publishedPosts': post_counts['published'], 'unpublishedPosts': post_counts['unpublished'],
                       'rejectedPosts': post_counts['rejected'],
                       'publishedRevisionRows': sum(record['disposition'] == 'published' for record in records),
                       'unpublishedRevisionRows': sum(record['disposition'] == 'unpublished' for record in records),
                       'rejectedRevisionRows': sum(record['disposition'] == 'rejected' for record in records),
                       'supersededRevisionRows': sum(not record['currentRevision'] for record in records),
                       'eventWithoutRetainedAcquisitionRows': sum(not record['acquisitionRetained'] for record in records),
                       'acquisitionOnlyGapRows': sum(acquisition_gaps.values()),
                       'eligibleActions': len(projection), 'returnedActions': min(FEED_LIMIT, len(projection)),
                       'actionsOutsideFeedLimit': max(0, len(projection) - FEED_LIMIT)},
            'reasons': reasons, 'excludedRetainedReasons': dict(sorted(excluded.items())),
            'records': records[:RECORD_LIMIT], 'recordLimit': RECORD_LIMIT, 'recordsTruncated': len(records) > RECORD_LIMIT,
            'coverage': {'retainedOnly': True, 'rowsPerSourceLimit': 1000,
                         'acquisitionSourcesAtRetentionCap': sum(value >= 1000 for value in retained_counts.values()),
                         'completeUpstreamCoverage': False, 'browserDeliveryVerified': False, 'feedLimit': FEED_LIMIT}}
