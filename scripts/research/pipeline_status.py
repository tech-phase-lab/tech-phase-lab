"""Per-article pipeline stages and acquisition-to-publication timing.

Every article that reaches a publication lane has one stage:

- ``waiting``     acquired, not yet picked up by its translation worker
- ``translating`` a model call is in flight
- ``failed``      the last attempt failed; it is retried automatically at
                  ``nextRetryAt`` (only failed articles are retried)
- ``held``        a stored translation no longer passes validation, so the
                  original is shown and the article is queued again
- ``published``   validated bilingual copy is being served

The state lives in the existing job/publication tables; this module only reads
them. Output carries internal ids, source ids, stages, failure codes and
clocks. It never carries titles, URLs, bodies, model output or credentials.
"""
from datetime import datetime, timezone
import json
import time

import headline_translation
import signals
import x_market_news

STAGES = ('waiting', 'translating', 'failed', 'held', 'published')


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed if parsed.tzinfo else None


def elapsed_ms(start, end):
    start, end = instant(start), instant(end)
    if not start or not end or end < start:
        return None
    return round((end - start).total_seconds() * 1000)


def timestamp(value):
    try:
        return datetime.fromtimestamp(float(value), timezone.utc).isoformat(timespec='seconds')
    except (TypeError, ValueError, OverflowError, OSError):
        return None


def job_stage(job, now):
    if not job:
        return 'waiting', None
    if job['state'] == 'running' and job['next_at'] > now:
        return 'translating', None
    if job['state'] in {'retry', 'stale', 'running'}:
        return 'failed', timestamp(job['next_at'])
    return 'waiting', None


def headline_articles(db, now=None, sources=signals.SOURCES, limit=100):
    now = time.time() if now is None else now
    reference = datetime.fromtimestamp(now, timezone.utc)
    articles = []
    for item in signals.public_official_updates(db, sources=sources, reference=reference, limit=500,
                                                include_bodies=False, read_only=True):
        row = db.execute('SELECT id,source_id,url,sha,observed_at,published_at,published_on FROM signal_events WHERE id=?',
                         (item['id'],)).fetchone()
        if not row:
            continue
        identity = (row['source_id'], row['url'], row['sha'])
        translated = db.execute('SELECT created_at FROM signal_headline_translations WHERE source_id=? AND url=? AND sha=?',
                                identity).fetchone()
        job = db.execute('SELECT attempts,next_at,state,failure_kind FROM signal_headline_translation_jobs '
                         'WHERE source_id=? AND url=? AND sha=?', identity).fetchone()
        if item.get('translationJa'):
            stage, retry_at = 'published', None
        elif translated:
            stage, retry_at = 'held', None
        else:
            stage, retry_at = job_stage(job, now)
        published_at = translated['created_at'] if translated and stage == 'published' else None
        articles.append({
            'lane': 'headline', 'id': str(row['id']), 'sourceId': row['source_id'], 'stage': stage,
            'sourcePublishedAt': row['published_at'] or row['published_on'], 'acquiredAt': row['observed_at'],
            'publishedAt': published_at, 'acquiredToPublishedMs': elapsed_ms(row['observed_at'], published_at),
            'attempts': job['attempts'] if job else 0,
            'failureKind': job['failure_kind'] if job and stage in {'failed', 'held'} else None,
            'nextRetryAt': retry_at,
        })
        if len(articles) >= limit:
            break
    return articles


def market_articles(db, now=None, limit=100):
    now = time.time() if now is None else now
    articles = []
    for row in x_market_news.candidates(db, now=now):
        identity = (row['source_id'], row['url'], row['sha'])
        publication = db.execute('SELECT payload,published_at FROM x_market_publications WHERE source_id=? AND url=? AND sha=?',
                                 identity).fetchone()
        job = db.execute('SELECT attempts,next_at,state,failure_kind FROM x_market_jobs WHERE source_id=? AND url=? AND sha=?',
                         identity).fetchone()
        stage, retry_at = ('published', None) if publication else job_stage(job, now)
        if publication:
            try:
                copy = x_market_news.publication_copy(row, json.loads(publication['payload']))
                x_market_news.validate({k: copy[k] for k in ('titleJa', 'titleEn')}, row['body'])
            except (KeyError, ValueError, TypeError):
                stage = 'held'
        published_at = publication['published_at'] if publication and stage == 'published' else None
        articles.append({
            'lane': 'market', 'id': str(row['id']), 'sourceId': row['source_id'], 'stage': stage,
            'sourcePublishedAt': row['published_at'], 'acquiredAt': row['observed_at'],
            'publishedAt': published_at, 'acquiredToPublishedMs': elapsed_ms(row['observed_at'], published_at),
            'attempts': job['attempts'] if job else 0,
            'failureKind': job['failure_kind'] if job and stage in {'failed', 'held'} else None,
            'nextRetryAt': retry_at,
        })
        if len(articles) >= limit:
            break
    return articles


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(round(fraction * (len(ordered) - 1))))]


def summary(articles):
    """Aggregate counts and timing for /health (no per-article identifiers)."""
    lanes = {}
    for article in articles:
        lane = lanes.setdefault(article['lane'], {'stages': {stage: 0 for stage in STAGES}, 'latencies': [],
                                                  'failureKinds': {}})
        lane['stages'][article['stage']] += 1
        if article.get('failureKind'):
            kinds = lane['failureKinds']
            kinds[article['failureKind']] = kinds.get(article['failureKind'], 0) + 1
        if article['acquiredToPublishedMs'] is not None:
            lane['latencies'].append(article['acquiredToPublishedMs'])
    return {lane: {'stages': value['stages'], 'failureKinds': value['failureKinds'],
                   'publishedSamples': len(value['latencies']),
                   'acquiredToPublishedP50Ms': percentile(value['latencies'], 0.5),
                   'acquiredToPublishedP95Ms': percentile(value['latencies'], 0.95),
                   'acquiredToPublishedMaxMs': max(value['latencies'], default=None)}
            for lane, value in lanes.items()}


def preview_articles(db, now=None, limit=100):
    """Bilingual summary stage of original-preview stories (shown as the card status)."""
    import original_preview_news
    import preview_summaries
    now = time.time() if now is None else now
    preview_summaries.schema(db)
    articles = []
    for row in preview_summaries.summarizable(db, datetime.fromtimestamp(now, timezone.utc)):
        identity = (row['key'], row['sha'])
        stored = db.execute('SELECT created_at FROM preview_summaries WHERE canonical_url=? AND revision=?', identity).fetchone()
        job = db.execute('SELECT attempts,next_at,state,failure_kind FROM preview_summary_jobs WHERE canonical_url=? AND revision=?',
                         identity).fetchone()
        stage, retry_at = ('published', None) if stored else job_stage(job, now)
        published_at = stored['created_at'] if stored else None
        acquired = row['item']['acquiredAt']
        articles.append({
            'lane': 'preview', 'id': row['item']['id'], 'sourceId': row['source_id'], 'stage': stage,
            'sourcePublishedAt': row['item'].get('sourcePublishedAt') or row['item'].get('sourcePublishedOn'),
            'acquiredAt': acquired, 'publishedAt': published_at,
            'acquiredToPublishedMs': elapsed_ms(acquired, published_at),
            'attempts': job['attempts'] if job else 0,
            'failureKind': job['failure_kind'] if job and stage == 'failed' else None,
            'nextRetryAt': retry_at,
        })
        if len(articles) >= limit:
            break
    return articles


def collect(path, now=None, limit=100):
    with headline_translation.connect(path) as db:
        return (headline_articles(db, now=now, limit=limit) + market_articles(db, now=now, limit=limit)
                + preview_articles(db, now=now, limit=limit))


def log_publication(lane, event_id, acquired_at, published_at=None, source_published_at=None, attempts=None):
    """One structured log line per publication: how long each stage took."""
    published_at = published_at or datetime.now(timezone.utc).isoformat(timespec='milliseconds')
    print(json.dumps({
        'event': 'news-published', 'lane': lane, 'id': str(event_id),
        'sourceToAcquiredMs': elapsed_ms(source_published_at, acquired_at),
        'acquiredToPublishedMs': elapsed_ms(acquired_at, published_at),
        'attempts': attempts,
    }), flush=True)


def model_budget(path, env=None, now=None):
    """Model calls in the rolling 24 hours against the configured daily limit.

    Counts only; never keys, prompts or output.
    """
    import os
    import preview_summaries
    env = os.environ if env is None else env
    now = time.time() if now is None else now
    config = headline_translation.configuration(env, now=now)
    if config is None:
        return {'enabled': False}
    limit = config[2]
    with headline_translation.connect(path) as db:
        used = len(headline_translation.budget_calls(db, now - 86400))
        preview = db.execute('SELECT COUNT(*) FROM signal_headline_translation_calls WHERE at>=? AND source_id LIKE ?',
                             (now - 86400, preview_summaries.LEDGER_PREFIX + '%')).fetchone()[0]
    return {'enabled': True, 'dailyLimit': limit, 'usedLast24h': used, 'exhausted': used >= limit,
            'previewUsedLast24h': preview, 'previewLimit': max(1, int(limit * preview_summaries.BUDGET_SHARE))}
