"""Project fetched issuer releases into the existing headline/translation queue.

Only metadata is projected. Research drafts, evidence bodies and approvals remain
private. No additional network requests or provider-budget changes are involved.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
from urllib.parse import urlsplit

import monitor
import news_policy

PREFIX = 'primary-ir-'
VERTIV_DATELINE_LIMIT = 12000
# These newly admitted routes cannot downgrade to legacy headline-only policy
# by removing a configuration flag. This is source scope, never article scope.
CURRENT_DOCUMENT_SOURCES = frozenset({'microsoft-blog'})
POLICY_FIELDS = ('id', 'enabled', 'kind', 'officialUpdates', 'requireCurrentDocument', 'allowedHosts', 'tickers')
EVENT_IDENTITY_FIELDS = ('id', 'source_id', 'url', 'sha', 'title', 'published_at', 'published_on',
                         'observed_at', 'tickers_json', 'event_kind', 'truncated')


def vertiv_retained_publication_date(ticker, url, text):
    """Recover only Vertiv's issuer dateline from retained IR release evidence."""
    if ticker != 'VRT' or not isinstance(text, str):
        return None
    try:
        parsed = urlsplit(url)
    except (TypeError, ValueError):
        return None
    if (parsed.scheme != 'https' or parsed.netloc != 'investors.vertiv.com'
            or parsed.query or parsed.fragment):
        return None
    path = re.fullmatch(r'/news/news-details/(\d{4})/Vertiv-[A-Za-z0-9-]+/default\.aspx', parsed.path)
    if not path:
        return None
    # This is the verified release's PRNewswire dateline, not a generic date
    # search. Refuse other/partial datelines rather than selecting one date out
    # of a mixed article or related-release excerpt.
    excerpt = text[:VERTIV_DATELINE_LIMIT]
    markers = re.findall(r'/\s*PRNewswire\s*/', excerpt, re.I)
    datelines = list(re.finditer(
        r'^[ \t]*COLUMBUS\s*,\s*Ohio\s*,\s*'
        r'(?P<month>[A-Za-z]+)\.?\s+(?P<day>\d{1,2})\s*,\s*(?P<year>\d{4})'
        r'\s+/\s*PRNewswire\s*/\s*(?:--|\u2013|\u2014)\s*'
        r'Vertiv\s+Holdings\s+Co\.?\s*\(\s*NYSE\s*:\s*VRT\s*\)(?=[\s,.])',
        excerpt, re.I | re.M,
    ))
    if not datelines or len(datelines) != len(markers):
        return None
    months = {name: number for number, name in enumerate(
        'january february march april may june july august september october november december'.split(), 1
    )}
    dates = set()
    for dateline in datelines:
        if dateline['year'] != path[1] or not excerpt[dateline.end():].strip():
            return None
        try:
            dates.add(datetime(int(dateline['year']), months[dateline['month'].lower()],
                               int(dateline['day'])).date().isoformat())
        except (KeyError, ValueError):
            return None
    return dates.pop() if len(dates) == 1 else None


def publishers():
    return [{'id': PREFIX + ticker, 'name': provider['name'] + ' IR',
             'kind': 'publisher-update', 'officialUpdates': True,
             'allowedHosts': provider['allowedHosts'], 'tickers': [ticker]}
            for ticker, provider in monitor.PROVIDERS.items()]


def revision(title, body_sha, published_on):
    return hashlib.sha256(json.dumps([title, body_sha, published_on], ensure_ascii=False).encode()).hexdigest()


def primary_owned_urls(db, urls):
    """Resolve exact issuer ownership, including withdrawn/stale retained rows.

    Ownership precedes publication eligibility. A supplemental discovery must
    never become a fallback for a held primary, or replace its source clocks.
    The URL-bound lookups use existing indexes, not a scan per candidate; they
    deliberately have no publication window, status or current-SHA filter.
    """
    urls = list(dict.fromkeys(urls))
    owned = set()
    if not urls:
        return owned
    tables = {r[0] for r in db.execute(
        "SELECT name FROM sqlite_master WHERE name IN ('sources','signal_events')")}
    providers = {PREFIX + ticker: ticker for ticker in monitor.PROVIDERS}
    for start in range(0, len(urls), 400):
        batch = urls[start:start + 400]
        marks = ','.join('?' for _ in batch)
        if 'sources' in tables:
            for row in db.execute(f'SELECT url,ticker FROM sources WHERE url IN ({marks})', batch):
                if monitor.article_url(row['url'], row['ticker']) == row['url']:
                    owned.add(row['url'])
        retained = [url for url in batch if url not in owned]
        if 'signal_events' in tables and retained:
            marks = ','.join('?' for _ in retained)
            source_marks = ','.join('?' for _ in providers)
            for row in db.execute(f'''SELECT DISTINCT source_id,url,tickers_json FROM signal_events
              WHERE source_id IN ({source_marks}) AND url IN ({marks})''', [*providers, *retained]):
                ticker = providers[row['source_id']]
                try:
                    matches = json.loads(row['tickers_json'])
                    if (isinstance(matches, list) and ticker in matches
                            and monitor.article_url(row['url'], ticker) == row['url']):
                        owned.add(row['url'])
                except (ValueError, TypeError):
                    continue
    return owned


def source_policy(source):
    return json.dumps({key: source.get(key) for key in POLICY_FIELDS}, sort_keys=True) if source else None


def bind_source_policy(row, source=None):
    """Carry a private admission snapshot through unlocked fetch/model work."""
    if source is None:
        import signals
        source = next((s for s in signals.SOURCES if s['id'] == row['source_id']), None)
    result = dict(row)
    if row['source_id'] in CURRENT_DOCUMENT_SOURCES or (source and source.get('requireCurrentDocument')):
        result['_publication_source_policy'] = source_policy(source)
    return result


def matches_public_snapshot(row, item, reference):
    """Recheck new-route metadata when a caller reuses a request's public list."""
    if row['source_id'].startswith(PREFIX):
        return True
    import signals
    source = next((s for s in signals.SOURCES if s['id'] == row['source_id']), None)
    try:
        # A changed source ID cannot downgrade a retained Microsoft snapshot
        # into a legacy publisher lane with a foreign URL or issuer. Preserve
        # existing reviewed discovery publishers, whose public name may differ.
        if (not item or not source or signals.safe_url(row['url'], source) != row['url']
                or row['url'] != item['url']
                or (source.get('officialUpdates') is True and item['publisher'] != source['name'])):
            return False
        if source.get('tickers'):
            tickers = [ticker for ticker in json.loads(row['tickers_json']) if ticker in source['tickers']][:5]
            if tickers != item['tickers']:
                return False
    except (ValueError, TypeError, KeyError):
        return False
    if row['source_id'] not in CURRENT_DOCUMENT_SOURCES and '_publication_source_policy' not in row.keys():
        return True
    if not item or not news_policy.eligible(row['title']):
        return False
    try:
        def instant(value):
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed.replace(tzinfo=parsed.tzinfo or timezone.utc).astimezone(timezone.utc)
        observed = instant(row['observed_at'])
        published = row['published_at'] or row['published_on']
        stamp = instant(published) if published else None
        cutoff = reference - timedelta(days=7)
        if (not cutoff <= observed <= reference or (stamp and not cutoff <= stamp <= reference)
                or (row['event_kind'] == 'baseline' and not published)):
            return False
        publication = {}
        if published and re.fullmatch(r'\d{4}-\d{2}-\d{2}', published):
            publication = {'publishedOn': published}
        elif published and re.search(r'T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$', published):
            publication = {'publishedAt': stamp.isoformat()}
        return bool(row['url'] == item['url'] and news_policy.headline(row['title'])[:180] == item['title']
                    and observed.isoformat() == item['observedAt']
                    and publication == {key: item[key] for key in ('publishedAt', 'publishedOn') if key in item})
    except (ValueError, TypeError, KeyError):
        return False


def is_current(db, row, *, source=None, primary_urls=None):
    if not row['source_id'].startswith(PREFIX):
        if primary_urls is None:
            primary_urls = primary_owned_urls(db, [row['url']])
        if row['url'] in primary_urls:
            return False
        if source is None:
            import signals
            source = next((s for s in signals.SOURCES if s['id'] == row['source_id']), None)
        requires_document = (row['source_id'] in CURRENT_DOCUMENT_SOURCES
                             or '_publication_source_policy' in row.keys()
                             or (source and source.get('requireCurrentDocument')))
        if requires_document:
            import signals
            configured = next((s for s in signals.SOURCES if s['id'] == row['source_id']), None)
            if source is not None and source_policy(source) != source_policy(configured):
                return False
            source = configured
            if (not source or source.get('enabled') is False or source.get('officialUpdates') is not True
                    or source.get('requireCurrentDocument') is not True or source.get('kind') != 'publisher-update'
                    or not source.get('allowedHosts') or not source.get('tickers') or row['truncated']
                    or ('_publication_source_policy' in row.keys()
                        and row['_publication_source_policy'] != source_policy(source))):
                return False
            # Newly admitted issuer feeds must retain their own current source
            # identity. No body/copy proof is inherited from an exact-URL peer.
            current = db.execute('''SELECT d.sha,d.title FROM signal_documents d
              JOIN signal_events e ON e.id=? AND e.source_id=d.source_id AND e.url=d.url
              WHERE d.source_id=? AND d.url=? AND e.sha=? AND e.title=?
              AND e.published_at IS ? AND e.published_on IS ? AND e.observed_at=? AND e.truncated=0
              AND e.tickers_json=? AND e.event_kind=?''',
              (row['id'], row['source_id'], row['url'], row['sha'], row['title'], row['published_at'],
               row['published_on'], row['observed_at'], row['tickers_json'], row['event_kind'])).fetchone()
            try:
                import signals
                if signals.safe_url(row['url'], source) != row['url']:
                    return False
                tickers = json.loads(row['tickers_json'])
                return bool(current and current['sha'] == row['sha'] and current['title'] == row['title']
                            and isinstance(tickers, list) and any(
                                ticker in tickers and monitor.article_url(row['url'], ticker) == row['url']
                                for ticker in source.get('tickers', [])))
            except (ValueError, TypeError):
                return False
        return True
    current = db.execute('SELECT title,sha256,published_on,status FROM sources WHERE url=?', (row['url'],)).fetchone()
    return bool(current and current['status'] not in {'rejected', 'held'} and revision(current['title'], current['sha256'], current['published_on']) == row['sha'])


def sync(db, reference):
    # Some isolated signal databases have no primary monitor tables.
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='release_events'").fetchone():
        return
    cutoff = (reference - timedelta(days=7)).isoformat()
    rows = db.execute('''SELECT e.detected_at,s.url,s.ticker,s.title,s.sha256,s.published_on,r.extracted_text
      FROM release_events e JOIN sources s ON s.url=e.url
      JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE e.detected_at>=? AND r.extracted_chars>0 AND s.status NOT IN ('rejected','held') ORDER BY e.id DESC LIMIT 500''', (cutoff,)).fetchall()
    for row in rows:
        title = row['title']
        # Some issuer index links carry no title. Recover only an explicit
        # release heading present in the fetched evidence, never from a URL slug.
        if not title and row['ticker'] == 'MU':
            heading = re.search(r'^Micron Technology,? Inc\.? Reports[^\n]{1,230}Results\s*$',
                                row['extracted_text'][:3000], re.M)
            if heading:
                title = heading[0].strip()
                db.execute('UPDATE sources SET title=? WHERE url=? AND sha256=? AND title IS NULL',
                           (title,row['url'],row['sha256']))
        if (not title or not news_policy.eligible(title)
                or re.fullmatch(r'(?:read (?:story|more)|learn more|press release|news)', title.strip(), re.I)):
            continue
        # Generic SEC filings are evidence, not issuer news headlines.
        if urlsplit(row['url']).hostname in {'www.sec.gov', 'data.sec.gov'}:
            continue
        try:
            if monitor.article_url(row['url'], row['ticker']) != row['url']:
                continue
            published_on = row['published_on']
            if not published_on:
                recovered = vertiv_retained_publication_date(row['ticker'], row['url'], row['extracted_text'])
                if recovered:
                    updated = db.execute('''UPDATE sources SET published_on=?
                      WHERE url=? AND sha256=? AND (published_on IS NULL OR published_on='')''',
                                         (recovered, row['url'], row['sha256']))
                    if updated.rowcount != 1:
                        continue
                    published_on = recovered
            published = (datetime.fromisoformat(published_on).replace(tzinfo=timezone.utc)
                         if published_on else None)
            observed = datetime.fromisoformat(row['detected_at'].replace('Z', '+00:00'))
            if ((published and not reference - timedelta(days=7) <= published <= reference)
                    or not reference - timedelta(days=7) <= observed <= reference):
                continue
        except (KeyError, ValueError, TypeError):
            continue
        db.execute('''INSERT OR IGNORE INTO signal_events(
          source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
          published_on,observed_at,excerpt,diff,truncated)
          VALUES(?,?,?,'',?,?, '{}','new',?,?,'','',0)''',
                   (PREFIX + row['ticker'], row['url'], revision(title, row['sha256'], published_on),
                    title, json.dumps([row['ticker']]), published_on, row['detected_at']))
