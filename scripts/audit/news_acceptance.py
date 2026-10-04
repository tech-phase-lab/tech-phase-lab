"""Offline acceptance evidence from an existing SQLite DB. No writes or network.

Stored translations/publications are not proof of valid copy or browser delivery.
Independent source inventories and browser observations are separate JSON inputs.
This tool never declares acceptance passed.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
from math import ceil
from pathlib import Path
import sqlite3
from statistics import mean, median


def timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except ValueError:
        return None


def elapsed(first, last):
    a, b = timestamp(first), timestamp(last)
    return (b-a).total_seconds() if a and b and b >= a else None


def distribution(values):
    values = sorted(v for v in values if v is not None)
    return {'count': len(values), 'meanSeconds': mean(values) if values else None,
            'medianSeconds': median(values) if values else None,
            'p95Seconds': values[ceil(len(values)*.95)-1] if values else None,
            'maxSeconds': max(values) if values else None}


def table_rows(db, table, columns, missing):
    # Callers pass constant table/column names only. Never initialize schemas.
    available = {r[1] for r in db.execute(f'PRAGMA table_info({table})')}
    if not set(columns).issubset(available):
        missing.add(table)
        return []
    return [dict(zip(columns, r)) for r in db.execute(f'SELECT {",".join(columns)} FROM {table}')]


def build_report(db, start, end, as_of, inventories=(), observations=(), required_sources=()):
    if not all(x and x.tzinfo for x in (start, end, as_of)) or end <= start or as_of < start:
        raise ValueError('Require aware start < end and as-of >= start')
    cutoff = min(end, as_of)
    missing = set()
    def in_window(value):
        t = timestamp(value)
        return t is not None and start <= t < cutoff
    events = table_rows(db, 'signal_events', (
        'id','source_id','url','sha','previous_sha','event_kind','published_at','published_on','observed_at'), missing)
    first = {}
    for row in sorted(events, key=lambda r: (timestamp(r['observed_at']) or datetime.max.replace(tzinfo=timezone.utc), r['id'])):
        if timestamp(row['observed_at']) and timestamp(row['observed_at']) < cutoff:
            first.setdefault((row['source_id'], row['url']), row['id'])
    stored = defaultdict(dict)
    specs = (
        ('signal_headline_translations', 'headlineJa', 'created_at'),
        ('x_market_publications', 'marketBilingual', 'published_at'),
        ('market_result_publications', 'resultBilingual', 'published_at'),
    )
    for table, channel, clock in specs:
        for row in table_rows(db, table, ('source_id','url','sha',clock), missing):
            t = timestamp(row[clock])
            if t and t < cutoff:
                stored[(row['source_id'],row['url'],row['sha'])][channel] = row[clock]
    event_by_id = {r['id']: r for r in events}
    for row in table_rows(db, 'official_research_publications', ('event_id','sha','public_at'), missing):
        event = event_by_id.get(row['event_id'])
        t = timestamp(row['public_at'])
        if event and row['sha'] == event['sha'] and t and t < cutoff:
            stored[(event['source_id'],event['url'],row['sha'])]['researchBilingual'] = row['public_at']
    browser = defaultdict(dict)
    invalid_observations = []
    for observation in observations:
        key = (observation.get('sourceId'),observation.get('url'),observation.get('sha'))
        language = observation.get('language')
        t = timestamp(observation.get('observedAt'))
        matching = [r for r in events if (r['source_id'],r['url'],r['sha'])==key]
        detection = min((timestamp(r['observed_at']) for r in matching if timestamp(r['observed_at'])), default=None)
        if (language not in {'ja','en'} or not all(key) or not observation.get('evidence')
                or not t or not start <= t < cutoff or not detection or t < detection):
            invalid_observations.append(observation)
            continue
        prior = browser[key].get(language)
        if not prior or t < timestamp(prior):
            browser[key][language] = observation['observedAt']
    records = []
    duplicate_event_rows = []
    seen = set()
    for row in events:
        if not in_window(row['observed_at']):
            continue
        key = (row['source_id'],row['url'],row['sha'])
        if key in seen:
            duplicate_event_rows.append(row['id'])
            continue
        seen.add(key)
        source_at = timestamp(row['published_at'])
        if row['event_kind'] == 'baseline':
            category = 'baseline'
        elif row['event_kind'] != 'new' or row['previous_sha'] or first.get(key[:2]) != row['id']:
            category = 'revision'
        elif source_at is None:
            category = 'source-time-unknown'
        elif source_at > timestamp(row['observed_at']):
            category = 'clock-conflict'
        elif source_at < start:
            category = 'historical-backfill'
        else:
            category = 'new-source-publication'
        ready = stored.get(key, {})
        observed = browser.get(key, {})
        records.append({'eventId':row['id'],'sourceId':row['source_id'],'url':row['url'],'sha':row['sha'],
            'category':category,'sourcePublishedAt':row['published_at'],'sourcePublishedOn':row['published_on'],
            'detectedAt':row['observed_at'],'storedOutputAt':ready,'browserObservedAt':observed,
            'sourceToDetectionSeconds':elapsed(row['published_at'],row['observed_at']),
            'detectionToStoredSeconds':{k:elapsed(row['observed_at'],v) for k,v in ready.items()},
            'sourceToBrowserSeconds':{k:elapsed(row['published_at'],v) for k,v in observed.items()},
            'copyAccuracy':'requires-original-ja-en-review'})
    records.sort(key=lambda r:(timestamp(r['detectedAt']),r['eventId']))
    fresh = [r for r in records if r['category']=='new-source-publication']
    inventory_results = []
    independently_covered = set()
    scope_reviews = defaultdict(set)
    known_urls = {(r['source_id'],r['url']) for r in events
                  if timestamp(r['observed_at']) and timestamp(r['observed_at']) < cutoff}
    for inventory in inventories:
        sid = inventory.get('sourceId')
        began, ended, checked = (timestamp(inventory.get(k)) for k in ('windowStart','windowEnd','checkedAt'))
        items = inventory.get('items', [])
        valid_items = isinstance(items,list) and all(isinstance(x,dict) and isinstance(x.get('url'),str)
            and x['url'].startswith('https://') and type(x.get('eligible')) is bool
            and timestamp(x.get('publishedAt')) for x in items)
        if inventory.get('method')=='independent-source-inventory' and inventory.get('evidence') and valid_items:
            for item in items:
                scope_reviews[(sid,item['url'],timestamp(item['publishedAt']))].add(item['eligible'])
        complete = bool(sid and inventory.get('method')=='independent-source-inventory'
            and inventory.get('evidence') and inventory.get('complete') is True
            and began and ended and began <= start and ended >= cutoff
            and checked and cutoff <= checked <= as_of and valid_items)
        if complete:
            independently_covered.add(sid)
        expected = [x for x in items if isinstance(x,dict) and x.get('eligible') is True
                    and in_window(x.get('publishedAt'))] if isinstance(items,list) else []
        urls = sorted({x.get('url') for x in expected if isinstance(x.get('url'),str)})
        inventory_results.append({'sourceId':sid,'coverage':'declared-complete' if complete else 'unverified',
            'eligibleUrls':len(urls),'missingFromIntake':[u for u in urls if (sid,u) not in known_urls]})
    for record in records:
        decisions=scope_reviews.get((record['sourceId'],record['url'],timestamp(record['sourcePublishedAt'])),set())
        record['publicationEligibility']=('eligible' if decisions=={True} else 'excluded' if decisions=={False}
            else 'conflicting-review' if len(decisions)>1 else 'unreviewed')
    eligible=[r for r in fresh if r['publicationEligibility']=='eligible']
    failures = {}
    carry_in = {}
    for table, clock, columns in (
        ('signal_route_transitions','occurred_at',('source_id','occurred_at','outcome','previous_kind','current_kind')),
        ('incident_events','at',('incident_key','revision','at','event','error_code')),
        ('official_research_attempt_failures','failed_at',('event_id','sha','failed_at','reason','detail')),
    ):
        history = table_rows(db,table,columns,missing)
        failures[table] = [r for r in history if in_window(r[clock])]
        if table == 'incident_events':
            for row in sorted(history, key=lambda r: (timestamp(r['at']) or datetime.min.replace(tzinfo=timezone.utc), r['revision'])):
                if timestamp(row['at']) and timestamp(row['at']) < start:
                    carry_in[row['incident_key']] = row
    failures['translationCalls'] = []
    for row in table_rows(db,'signal_headline_translation_calls',('at','source_id','sha','state'),missing):
        try:
            t = datetime.fromtimestamp(float(row['at']),timezone.utc)
        except (ValueError,TypeError,OverflowError,OSError):
            continue
        if start <= t < cutoff and row['state'] != 'done':
            failures['translationCalls'].append(row)
    return {'schemaVersion':1,'windowStart':start.isoformat(),'windowEnd':end.isoformat(),
        'asOf':as_of.isoformat(),'measuredThrough':cutoff.isoformat(),
        'windowStatus':'elapsed-needs-review' if as_of>=end else 'in-progress',
        'acceptance':'not-assessed','eventCounts':dict(Counter(r['category'] for r in records)),
        'newSourcePublications':len(fresh),'duplicateStoredEventIds':duplicate_event_rows,
        'newPublicationEligibilityCounts':dict(Counter(r['publicationEligibility'] for r in fresh)),
        'intakeLatencyAllNewCandidates':distribution(r['sourceToDetectionSeconds'] for r in fresh),
        'latencyPopulation':'independently-reviewed-eligible-new-source-publications',
        'latency':{'sourceToDetection':distribution(r['sourceToDetectionSeconds'] for r in eligible),
            'detectionToStored':{ch:distribution(r['detectionToStoredSeconds'].get(ch) for r in eligible)
                for ch in ('headlineJa','marketBilingual','resultBilingual','researchBilingual')},
            'sourceToBrowser':{lang:distribution(r['sourceToBrowserSeconds'].get(lang) for r in eligible) for lang in ('ja','en')}},
        'records':records,'independentInventories':inventory_results,
        'inventoryScope':'explicit-required-sources' if required_sources else 'not-specified',
        'sourcesWithoutCompleteInventory':sorted((set(required_sources)|{r['sourceId'] for r in records})-independently_covered),
        'invalidBrowserObservations':invalid_observations,'timestampedHistory':failures,
        'incidentsOpenAtWindowStart':[r for r in carry_in.values() if r['event']=='opened'],
        'incidentHistoryScope':'all-database-incidents-including-legacy-body-fetch',
        'missingEvidenceTables':sorted(missing),
        'limitations':[
            'Persisted output timestamps do not establish API eligibility, first-ever publication, or browser display.',
            'Missing stored output does not prove a pending job: publication eligibility needs source review.',
            'No independent inventory means missed posts remain unverified; an empty sample is not success.',
            'Duplicate stored rows are not equivalent to duplicate user-visible publication.',
            'Price targets rendered directly from events have no persisted publication clock here.',
            'Copy fidelity, per-metric number association, and original-language meaning require bilingual evidence review.',
            'Historical rows overwritten or pruned by the application cannot be recovered by this report.',
        ]}


def read_report(path, **kwargs):
    with sqlite3.connect(Path(path).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')  # One consistent read snapshot; never schema helpers.
        return build_report(db,**kwargs)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',type=Path,required=True)
    parser.add_argument('--start',required=True)
    parser.add_argument('--end',required=True)
    parser.add_argument('--as-of',default=datetime.now(timezone.utc).isoformat())
    parser.add_argument('--inventories',type=Path,help='JSON list of independently checked source inventories')
    parser.add_argument('--browser-observations',type=Path,help='JSON list of actual revision-bound JA/EN observations')
    parser.add_argument('--required-source',action='append',default=[])
    args=parser.parse_args()
    try:
        result=read_report(args.db,start=timestamp(args.start),end=timestamp(args.end),as_of=timestamp(args.as_of),
            inventories=json.loads(args.inventories.read_text()) if args.inventories else [],
            observations=json.loads(args.browser_observations.read_text()) if args.browser_observations else [],
            required_sources=args.required_source)
    except (ValueError,OSError,sqlite3.Error) as exc:
        parser.error(str(exc))
    print(json.dumps(result,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
