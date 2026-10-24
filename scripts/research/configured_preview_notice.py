"""Source-bound metadata notices; no fetching, generated copy or body publication.

This is deliberately not a general query-URL or paid-content admission path.
"""
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
from urllib.parse import parse_qs, urlencode, urlsplit

import monitor

STATUS = 'source-metadata-notice-unreviewed'
DOCUMENTS = {
    'nebius-preemptible': 'https://docs.nebius.com/compute/virtual-machines/preemptible',
    'nebius-changelog': 'https://docs.nebius.com/changelog',
}
SEEDS = {row['url']: row for row in json.loads(Path(__file__).with_name('sources.json').read_text())
         if row['ticker'] == 'NBIS' and urlsplit(row['url']).hostname == 'assets.nebius.com'
         and urlsplit(row['url']).path.lower().endswith('.pdf')}


def special_identity(url, ticker=None):
    """Exact configured PDF seeds or canonical, configured TWSE record queries."""
    if not isinstance(url, str) or len(url) > 4096:
        return None
    if (url in SEEDS and ticker in (None, 'NBIS')
            and 'assets.nebius.com' in monitor.PROVIDERS.get('NBIS', {}).get('allowedHosts', [])):
        return {'key': url, 'ticker': 'NBIS', 'sourceClass': 'seeded-document'}
    try:
        p = urlsplit(url)
        if p.scheme != 'https' or p.username or p.password or p.port is not None or p.fragment:
            return None
        providers = [monitor.PROVIDERS[ticker]] if ticker in monitor.PROVIDERS else monitor.PROVIDERS.values() if ticker is None else []
        for provider in providers:
            for source in provider.get('fallbackSources', []) + provider.get('supplementalSources', []):
                if (source.get('format') != 'twse-material-json' or url.split('?', 1)[0] != source['url']
                        or p.hostname not in provider.get('allowedHosts', [])):
                    continue
                q = parse_qs(p.query, keep_blank_values=True)
                if set(q) != {'company', 'date', 'time', 'id'} or any(len(v) != 1 for v in q.values()):
                    return None
                values = {key: q[key][0] for key in ('company', 'date', 'time', 'id')}
                if (values['company'] != source.get('twseCompanyCode')
                        or not re.fullmatch(r'\d{1,6}', values['time'])
                        or not re.fullmatch(r'[0-9a-f]{16}', values['id'])
                        or source['url'] + '?' + urlencode(values) != url):
                    return None
                on = monitor.roc_date(values['date'])
                # Acquisition accepts digit strings; publication additionally
                # requires a real HHMMSS value, without inventing a timezone.
                datetime.strptime(values['time'].zfill(6), '%H%M%S')
                return {'key': url, 'ticker': provider['ticker'], 'sourceClass': 'exchange-disclosure',
                        'sourcePublishedOn': on, 'query': values}
    except (TypeError, ValueError, KeyError, AttributeError):
        pass
    return None


def _date(value, acquired):
    if value is None:
        return None, True
    try:
        parsed = datetime.strptime(value, '%Y-%m-%d').date()
        return value, parsed.isoformat() == value and parsed <= acquired.date()
    except (TypeError, ValueError):
        return None, False


def _primary_family(db, key, ticker, now, scan_limit, canonical_url, instant):
    """Resolve first discovery before the window; aliases cannot refresh age.

    Read only bounded metadata for the complete validated canonical family,
    including aliases outside the recent discovery scan. Ambiguous or oversized
    families fail closed instead of assigning a new acquisition clock.
    """
    columns = {row[1] for row in db.execute('PRAGMA table_info(sources)')}
    current = {'discovery_title', 'discovery_title_at'} <= columns
    title_fields = ('s.discovery_title,s.discovery_title_at' if current
                    else 'NULL AS discovery_title,NULL AS discovery_title_at')
    rows = db.execute(f"""SELECT s.url,s.ticker,s.title,s.discovered_at,s.published_on,{title_fields},
        r.observed_at AS body_at,CASE WHEN r.extracted_chars>0 AND length(trim(r.extracted_text))>0
          THEN 1 ELSE 0 END AS has_body
      FROM sources s LEFT JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
      WHERE lower(rtrim(s.url,'/'))=? ORDER BY s.url LIMIT ?""",
      (key.lower().rstrip('/'), scan_limit + 1)).fetchall()
    if len(rows) > scan_limit:
        return None
    family = [row for row in rows if canonical_url(row['url']) == key
              and (monitor.article_url(row['url'], row['ticker']) == row['url']
                   or special_identity(row['url'], row['ticker']))]
    if (not family or any(row['ticker'] != ticker or not instant(row['discovered_at'])
                          or instant(row['discovered_at']) > now for row in family)):
        return None
    first = min(family, key=lambda row: (instant(row['discovered_at']), row['url']))
    acquired = instant(first['discovered_at'])
    dates = [_date(row['published_on'], acquired) for row in family]
    known_dates = {on for on, valid in dates if on is not None and valid}
    if any(not valid for _on, valid in dates) or len(known_dates) > 1:
        return None
    titles, has_body = [], False
    for row in family:
        title = row['discovery_title'] if row['discovery_title'] is not None else row['title']
        observed = instant(row['discovery_title_at']) if row['discovery_title'] is not None else instant(row['discovered_at'])
        if row['discovery_title'] is not None and (not observed or not instant(row['discovered_at']) <= observed <= now):
            return None
        if title:
            titles.append((observed, title))
        if row['has_body']:
            body_at = instant(row['body_at'])
            if not body_at or not acquired <= body_at <= now:
                return None
            has_body = True
    newest = max(at for at, _title in titles) if titles else None
    heads = {title for at, title in titles if at == newest}
    if len(heads) > 1:
        return None  # Equal-clock contradictory aliases do not select arbitrary copy.
    return {'url': first['url'], 'acquired_at': first['discovered_at'], 'acquired': acquired,
            'published_on': next(iter(known_dates)) if known_dates else None,
            'title': next(iter(heads)) if heads else None, 'has_body': has_body}


def _item(key, source_id, source_name, source_class, url, title, at, on, body, revision):
    item = {'id': 'original-preview-' + hashlib.sha256(key.encode()).hexdigest()[:24],
            'status': STATUS, 'sourceName': source_name, 'sourceUrl': url,
            'sourceClass': source_class, 'titleOriginal': title,
            'sourcePublishedOn': on, 'bodyAvailability': body, 'acquiredAt': at}
    return {'key': key, 'source_id': source_id, 'sha': revision, 'item': item, 'primary': source_class != 'official-document'}


def candidates(db, now, sources, *, window_days, scan_limit, instant, excerpt, canonical_url, withdrawal, promotion):
    """Recent discoveries and exact document revisions, each with a bounded scan."""
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    cutoff = now - timedelta(days=window_days)
    bounds = (cutoff.isoformat(), now.isoformat(), scan_limit)
    result, counts = [], []
    if {'sources', 'source_revisions'} <= tables:
        columns = {row[1] for row in db.execute('PRAGMA table_info(sources)')}
        current = {'discovery_title', 'discovery_title_at'} <= columns
        title_fields = ('COALESCE(s.discovery_title,s.title) AS title,s.discovery_title_at AS title_observed_at'
                        if current else 's.title,NULL AS title_observed_at')
        rows = db.execute(f'''SELECT s.url,s.ticker,{title_fields},s.published_on,s.discovered_at,s.status,s.sha256,s.source_mode,
            substr(s.extracted_text,1,300) AS withdrawal_text,
            CASE WHEN s.source_mode='inline' AND s.url LIKE 'https://openapi.twse.com.tw/%'
              THEN r.extracted_text ELSE substr(r.extracted_text,1,300) END AS current_text,r.observed_at AS body_at
          FROM sources s LEFT JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
          WHERE julianday(s.discovered_at) BETWEEN julianday(?) AND julianday(?)
            AND s.url NOT LIKE 'https://www.sec.gov/%'
          ORDER BY julianday(s.discovered_at) DESC,s.url LIMIT ?''', bounds).fetchall()
        counts.append(len(rows))
        families = {}
        for r in rows:
            row = dict(r)
            provider = monitor.PROVIDERS.get(row['ticker'])
            acquired = instant(row['discovered_at'])
            if (not provider or not acquired or row['status'] in {'held', 'rejected'}
                    or (row['title_observed_at'] is not None and (not instant(row['title_observed_at'])
                        or not acquired <= instant(row['title_observed_at']) <= now))):
                continue
            title, text = row.get('title') or '', row.get('current_text') or ''
            if (withdrawal.search(title) or withdrawal.search(text) or withdrawal.search(row.get('withdrawal_text') or '')
                    or promotion.search(title)):
                continue
            special = special_identity(row['url'], row['ticker'])
            key = canonical_url(row['url'])
            if not key:
                continue
            if special:
                source_class = special['sourceClass']
                if source_class == 'exchange-disclosure':
                    q = special['query']
                    # Validate retained acquisition identity against the exact
                    # current inline body; a plausible query alone proves nothing.
                    if (row.get('source_mode') != 'inline' or not text
                            or hashlib.sha256(text.encode()).hexdigest() != row['sha256']
                            or row['sha256'][:16] != q['id']
                            or not text.startswith(f"公司代號: {q['company']}\n")
                            or f"\n發言日期: {q['date']}\n發言時間: {q['time']}\n主旨: {title}\n說明: " not in text
                            or row['published_on'] != special['sourcePublishedOn']):
                        continue
                    name = 'TWSE · ' + provider['name']
                else:
                    if row['published_on'] != SEEDS[row['url']]['publishedOn']:
                        continue
                    name = provider['name'] + ' · PDF'
            else:
                if (monitor.article_url(row['url'], row['ticker']) != row['url']
                        or urlsplit(row['url']).hostname in {'www.sec.gov', 'data.sec.gov'}
                        or re.search(r'/(?:careers?|jobs?|webinars?|events?|authors?|tags?|categories|category|feed|pricing)(?:/|$)', urlsplit(row['url']).path, re.I)):
                    continue
                source_class, name = 'issuer-metadata', provider['name']
            if key not in families:
                families[key] = _primary_family(db, key, row['ticker'], now, scan_limit, canonical_url, instant)
            family = families[key]
            if not family or family['acquired'] < cutoff:
                continue
            acquired = family['acquired']
            title = family['title'] or ''
            if withdrawal.search(title) or promotion.search(title):
                continue
            copy = excerpt(title) if title else None
            if (title and not copy) or (not copy and source_class != 'seeded-document'):
                continue
            on, valid = _date(family['published_on'], acquired)
            body_at = instant(row.get('body_at'))
            if not valid or (text and (not body_at or not body_at <= now)):
                continue
            # Detection, not a later body fetch or title/date enrichment, owns
            # this immutable metadata notice. Full-body original cards win.
            result.append(_item(key, 'primary-metadata-' + row['ticker'], name, source_class,
                family['url'], copy, family['acquired_at'], on, 'retained-unreviewed' if family['has_body'] else 'unavailable',
                hashlib.sha256(('metadata:' + key).encode()).hexdigest()))
    approved = {s['id']: s for s in sources if s.get('enabled') is not False
                and s.get('kind') == 'official-document' and s.get('format') == 'document'
                and DOCUMENTS.get(s.get('id')) == s.get('url') and s.get('tickers') == ['NBIS']
                and s.get('allowedHosts') == ['docs.nebius.com'] and s.get('reuse') == 'review-required'}
    if approved and {'signal_documents', 'signal_events'} <= tables:
        marks = ','.join('?' for _ in approved)
        rows = db.execute(f'''SELECT e.*,d.text,d.title AS current_title,d.sha AS current_sha,d.last_seen_at
          FROM signal_events e JOIN signal_documents d ON e.source_id=d.source_id AND e.url=d.url
          WHERE e.source_id IN ({marks}) AND julianday(e.observed_at) BETWEEN julianday(?) AND julianday(?)
          ORDER BY julianday(e.observed_at) DESC,e.id DESC LIMIT ?''', (*approved, *bounds)).fetchall()
        counts.append(len(rows))
        handled = set()
        for r in rows:
            row, source = dict(r), approved[r['source_id']]
            key = canonical_url(row['url'])
            acquired, seen = instant(row['observed_at']), instant(row['last_seen_at'])
            if (not key or key in handled or row['url'] != source['url'] or row['truncated']
                    or row['event_kind'] not in {'baseline', 'new', 'changed'}
                    or row['title'] != source['name'] or row['title'] != row['current_title']
                    or row['published_at'] is not None or row['published_on'] is not None
                    or row['sha'] != row['current_sha'] or not acquired or not seen or not acquired <= seen <= now
                    or not isinstance(row['text'], str) or not 120 <= len(row['text']) < 160000
                    or hashlib.sha256((row['title'] + '\n' + row['text']).encode()).hexdigest() != row['sha']
                    or withdrawal.search(row['text'])):
                continue
            handled.add(key)
            # The collector uses the configured document name, not a scraped
            # headline. Expose it as a source label, never an invented title.
            result.append(_item(key, source['id'], source['name'], 'official-document', row['url'], None,
                row['observed_at'], None, 'retained-unreviewed', row['sha']))
    return result, counts
