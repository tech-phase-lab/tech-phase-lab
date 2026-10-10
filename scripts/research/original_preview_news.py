"""Bounded original-language excerpts for the explicitly requested preview feed.

No fetch, classification, ticker requirement or model call. Only the existing
result worker writes admission receipts; the public projection is SELECT-only.
These clocks record first automatic availability to the preview capability,
never source publication, acquisition, verified publication or a browser view.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import re
import sqlite3
from urllib.parse import urlsplit, urlunsplit

import monitor
import news_policy
import signals
import sec_preview_notice
import configured_preview_notice
import x_api

WINDOW_DAYS = 7
SCAN_LIMIT = 200  # Per retained lane, not an unlimited historical backfill.
CARD_LIMIT = 30
STATUS = 'original-excerpt-unreviewed'
# Same conservative script-block union as the frontend; no Unicode-version drift.
CJK = re.compile(r'[\u1100-\u11ff\u2e80-\u9fff\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\uff61-\uffdc\U00016fe0-\U00016fff\U0001aff0-\U0001b16f\U0001d360-\U0001d37f\U0001f200-\U0001f2ff\U00020000-\U0003347f]')
CONTROL = re.compile(r'[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]')
PRIVATE_CONTENT = re.compile(r'(?:bearer\s+[A-Za-z0-9._~+/=-]{8,}|(?:sk-|ghp_|github_pat_|xox[baprs]-)[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|access[_ -]?token|password|client[_ -]?secret)\s*[:=])', re.I)
ERROR_PREFIX = re.compile(r'^\s*(?:[\[{]|Traceback\b|(?:Exception|Error|HTTPError)\s*:|Unauthorized\b|Access denied\b)', re.I)
NONNEWS_PATH = re.compile(r'/(?:careers?|jobs?|webinars?|events?|authors?|tags?|categories|category|feed|pricing)(?:/|$)', re.I)
# Negative exclusions only. No affirmative news/headline/ticker grammar.
REPOST = re.compile(r'^\s*(?:RT\s+@|repost(?:ed)?\s+(?:from|@))', re.I)
# Only explicit source-self withdrawal. Reporting another actor's denial is
# ordinary original news; canonical head checks already revoke stale revisions.
WITHDRAWAL = re.compile(r'^\s*(?:retraction\s*:|(?:this|our)\s+(?:post|tweet|headline|release|report)\s+(?:has (?:now )?been|is|was)\s+(?:retracted|withdrawn|rescinded)\b)', re.I)


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})', value):
        return None
    try:
        return datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def canonical_url(value):
    special = configured_preview_notice.special_identity(value)
    if special:
        return special['key']
    try:
        parsed = urlsplit(value)
        if (not isinstance(value, str) or len(value) > 4096 or CONTROL.search(value)
                or parsed.scheme != 'https' or not parsed.hostname or '.' not in parsed.hostname
                or parsed.username or parsed.password or parsed.port is not None
                or parsed.query or parsed.fragment):
            return None
        path = parsed.path.rstrip('/') or '/'
        if parsed.hostname == 'x.com':
            path = path.lower()
        return urlunsplit(('https', parsed.hostname.lower(), path, '', ''))
    except (TypeError, ValueError, AttributeError):
        return None


def excerpt(value):
    if (not isinstance(value, str) or PRIVATE_CONTENT.search(value) or ERROR_PREFIX.search(value)
            or re.search(r'[\x00\x7f\u202a-\u202e\u2066-\u2069]', value)):
        return None
    # End before a URL rather than joining originally separated claims.
    value = re.split(r'https?://\S+', value, maxsplit=1, flags=re.I)[0]
    text = ' '.join(value.split())
    cap = 40 if CJK.search(text) else 100
    bounded = ' '.join(text.split()[:20])
    if len(bounded) > cap:
        bounded = bounded[:cap]
        if not CJK.search(text) and ' ' in bounded:
            bounded = bounded.rsplit(' ', 1)[0]
    return bounded.strip() or None


def schema(db):
    """Writer-only migration. Receipts contain no copied source corpus."""
    db.executescript('''
      CREATE TABLE IF NOT EXISTS original_preview_receipts(
        canonical_url TEXT NOT NULL, source_id TEXT NOT NULL, source_url TEXT NOT NULL,
        revision TEXT NOT NULL, acquired_at TEXT NOT NULL, first_published_at TEXT NOT NULL,
        PRIMARY KEY(canonical_url,revision));
      CREATE INDEX IF NOT EXISTS original_preview_receipt_clock
        ON original_preview_receipts(julianday(acquired_at));
    ''')
    tables = table_names(db)
    if 'signal_x_acquisition' in tables:
        db.execute('CREATE INDEX IF NOT EXISTS original_preview_acquisition_clock ON signal_x_acquisition(julianday(first_seen_at))')
        db.execute("CREATE INDEX IF NOT EXISTS original_preview_acquisition_canonical ON signal_x_acquisition(lower(rtrim(url,'/')))")
    if 'signal_documents' in tables:
        db.execute("CREATE INDEX IF NOT EXISTS original_preview_document_canonical ON signal_documents(lower(rtrim(url,'/')))")
    if 'sources' in tables:
        db.execute('CREATE INDEX IF NOT EXISTS original_preview_primary_discovery_clock ON sources(julianday(discovered_at))')
        db.execute("CREATE INDEX IF NOT EXISTS original_preview_primary_canonical ON sources(lower(rtrim(url,'/')))")
    if 'signal_events' in tables:
        db.execute('CREATE INDEX IF NOT EXISTS original_preview_event_url ON signal_events(url)')


def table_names(db):
    return {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _sources(sources):
    # Enabled configuration permits use of retained evidence, not new reads.
    # Do not consult X credentials or acquisition flags from the display lane.
    return {s['id']: s for s in sources if s.get('enabled') is not False
            and s.get('kind') == 'publisher-update'
            and s.get('format') in {'feed', 'html-index', 'x-api'}
            and s.get('allowedHosts') and s.get('name')}


def _source_clock(at, on, acquired, now):
    if at:
        parsed = instant(at)
        if not parsed or not now - timedelta(days=WINDOW_DAYS) <= parsed <= acquired:
            return None
        return {'sourcePublishedAt': at, 'sourcePublishedOn': None, 'sourceTimePrecision': 'timestamp'}
    if on:
        try:
            date = datetime.strptime(on, '%Y-%m-%d').date()
        except (TypeError, ValueError):
            return None
        if on != date.isoformat() or not (now - timedelta(days=WINDOW_DAYS)).date() <= date <= acquired.date():
            return None
        return {'sourcePublishedAt': None, 'sourcePublishedOn': on, 'sourceTimePrecision': 'date'}
    return {'sourcePublishedAt': None, 'sourcePublishedOn': None, 'sourceTimePrecision': 'missing'}


def _primary_denied_keys(db, rows, tables, now):
    """An explicit primary source denial binds the complete canonical family.

    Mere discovery, a missing body, or unsuccessful translation is not denial.
    """
    if 'sources' not in tables:
        return set()
    columns = {row[1] for row in db.execute('PRAGMA table_info(sources)')}
    current_title = 'discovery_title' if 'discovery_title' in columns else 'NULL AS discovery_title'
    title_clock = 'discovery_title_at' if 'discovery_title_at' in columns else 'NULL AS discovery_title_at'
    keys = {key for row in rows if (key := canonical_url(row['url']))}
    aliases = sorted({key.rstrip('/').lower() for key in keys})
    denied = set()
    for start in range(0, len(aliases), 400):
        batch = aliases[start:start + 400]
        marks = ','.join('?' for _ in batch)
        for row in db.execute(f"SELECT url,ticker,title,{current_title},{title_clock},discovered_at,status,extracted_text FROM sources WHERE lower(rtrim(url,'/')) IN ({marks})", batch):
            if canonical_url(row['url']) not in keys or not (monitor.article_url(row['url'], row['ticker']) == row['url']
                    or configured_preview_notice.special_identity(row['url'], row['ticker'])):
                continue
            current = row['discovery_title']
            observed, discovered = instant(row['discovery_title_at']), instant(row['discovered_at'])
            if (row['status'] in {'held', 'rejected'} or WITHDRAWAL.search(row['extracted_text'] or '')
                    or WITHDRAWAL.search(row['title'] or '') or WITHDRAWAL.search(current or '')
                    or (current is not None and (not isinstance(current, str) or len(current) > 300 or not excerpt(current)
                        or not observed or not discovered or not discovered <= observed <= now))):
                denied.add(canonical_url(row['url']))
    return denied


def _raw_current(db, row, approved, now):
    """Resolve cross-route X revisions before eligibility, including withdrawals."""
    heads = db.execute('''SELECT source_id,sha,first_seen_at,last_seen_at FROM signal_x_acquisition
        WHERE lower(rtrim(url,'/'))=? ORDER BY julianday(last_seen_at) DESC,rowid DESC LIMIT 201''', (canonical_url(row['url']),)).fetchall()
    if len(heads) > 200:
        return False
    states = []
    for head in heads:
        if head['source_id'] not in approved:
            continue
        seen = instant(head['last_seen_at'])
        if not seen or seen > now:
            return False
        states.append((seen, head['sha']))
    if not states:
        return False
    newest = max(state[0] for state in states)
    return {sha for seen, sha in states if seen == newest} == {row['sha']}


def _document_current(db, row, approved, now):
    """Newer canonical-alias documents revoke older eligible article spellings."""
    key = canonical_url(row['url'])
    heads = db.execute('''SELECT source_id,url,sha,last_seen_at FROM signal_documents
      WHERE lower(rtrim(url,'/'))=? ORDER BY julianday(last_seen_at) DESC LIMIT 201''',
      (key.lower().rstrip('/'),)).fetchall()
    if len(heads) > 200:
        return False
    states = []
    for head in heads:
        if head['source_id'] not in approved or canonical_url(head['url']) != key:
            continue
        seen = instant(head['last_seen_at'])
        if not seen or seen > now:
            return False
        states.append((seen, head['sha']))
    if not states:
        return False
    newest = max(seen for seen, _sha in states)
    return {sha for seen, sha in states if seen == newest} == {row['sha']}


def _category_current(db, source, row, now):
    """Honor retained publisher taxonomy withdrawal without a ticker gate."""
    import feed_category_admission as category
    if not category.required(source):
        return True
    context = category.read_context(db, source, list(signals.ALIASES), [row])
    snapshot, config = context['snapshot'], context['config_sha']
    if (not context['head'] or not snapshot or snapshot['config_sha'] != config
            or snapshot['parser_version'] != category.PARSER_VERSION
            or snapshot['feed_url'] != source['url']
            or not category.valid_effective_url(source, snapshot['effective_url'])):
        return False
    active, semantic, reason = category._combined(source, config, context['proofs'].get(row['url'], {}))
    if not active or reason:
        return False
    identity = {'document_sha': row['sha'], 'title': row['title'], 'published_at': row['published_at'],
                'published_on': row['published_on'], 'truncated': bool(row['truncated'])}
    decision = context['decisions'].get(row['url'])
    return bool(category._same_revision(active[0]['entry'], identity)
                and decision and decision['semantic_sha'] == semantic
                and all(instant(proof['verified_at']) is not None
                        and instant(proof['verified_at']) <= now for proof in active))


ENGLISH_FUNCTION_WORDS = frozenset({
    'the', 'and', 'of', 'to', 'in', 'for', 'with', 'on', 'is', 'an', 'its', 'by', 'that', 'as', 'at',
    'from', 'will', 'has', 'are', 'was', 'be', 'this', 'which', 'it', 'or', 'have', 'our', 'we',
})
# German, Spanish, French, Portuguese and Italian function words (wire services
# repeat one release in several languages).
FOREIGN_FUNCTION_WORDS = frozenset({
    'der', 'die', 'das', 'und', 'mit', 'für', 'eine', 'ein', 'einer', 'nicht', 'ist', 'von', 'zu', 'den',
    'dem', 'des', 'sich', 'auf', 'el', 'los', 'las', 'y', 'del', 'con', 'para', 'una', 'por', 'que', 'su',
    'sus', 'le', 'les', 'et', 'du', 'pour', 'avec', 'une', 'est', 'dans', 'sur', 'au', 'aux', 'com', 'uma',
    'não', 'il', 'della', 'per', 'che', 'nel',
})


def english_or_japanese(text):
    """Only English or Japanese sources can get a checked bilingual summary."""
    if len(re.findall(r'[぀-ヿ一-鿿]', text)) >= 5:
        return True
    words = re.findall(r"[a-zà-öø-ÿ]+", text[:2000].lower())
    foreign = sum(word in FOREIGN_FUNCTION_WORDS for word in words)
    return foreign < 3 or foreign <= sum(word in ENGLISH_FUNCTION_WORDS for word in words)


def candidates(db, now, sources=None, *, stats=None):
    """Bounded retained evidence, not a claim of exhaustive upstream coverage."""
    sources = signals.SOURCES if sources is None else sources
    approved, tables = _sources(sources), table_names(db)
    cutoff = (now - timedelta(days=WINDOW_DAYS)).isoformat()
    bounds = (cutoff, now.isoformat(), SCAN_LIMIT)
    rows = []
    lane_counts = []
    if 'signal_x_acquisition' in tables:
        rows.extend({**dict(r), 'lane': 'raw', 'published_on': None,
                     'acquired_at': r['first_seen_at']} for r in db.execute('''
          SELECT * FROM signal_x_acquisition
          WHERE julianday(first_seen_at) BETWEEN julianday(?) AND julianday(?)
          ORDER BY julianday(first_seen_at) DESC,rowid DESC LIMIT ?''', bounds))
    lane_counts.append(len(rows))
    if {'signal_events', 'signal_documents'} <= tables:
        rows.extend({**dict(r), 'lane': 'signal', 'acquired_at': r['observed_at']}
                    for r in db.execute('''SELECT e.*,d.text,d.first_seen_at,d.last_seen_at,d.sha AS current_sha,d.title AS current_title
          FROM signal_events e JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url
          WHERE julianday(e.observed_at) BETWEEN julianday(?) AND julianday(?)
          ORDER BY julianday(e.observed_at) DESC,e.id DESC LIMIT ?''', bounds))
    lane_counts.append(len(rows) - sum(lane_counts))
    if {'sources', 'source_revisions'} <= tables:
        rows.extend({**dict(r), 'lane': 'primary', 'source_id': 'primary-ir-' + r['ticker'],
                     'sha': r['sha256'], 'text': r['revision_text'], 'published_at': None,
                     'acquired_at': r['revision_acquired_at'], 'last_seen_at': r['checked_at']}
                    for r in db.execute('''SELECT s.*,r.observed_at AS revision_acquired_at,r.extracted_text AS revision_text FROM sources s
          JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
          WHERE julianday(r.observed_at) BETWEEN julianday(?) AND julianday(?)
          ORDER BY julianday(r.observed_at) DESC,s.url LIMIT ?''', bounds))
    lane_counts.append(len(rows) - sum(lane_counts))
    # Explicit source withdrawals/holds constrain aliases, even outside the scan.
    primary_denied = _primary_denied_keys(db, rows, tables, now)
    result = {}
    for row in rows:
        source = approved.get(row['source_id'])
        if row['lane'] == 'primary':
            provider = monitor.PROVIDERS.get(row['ticker'])
            if (not provider or row['status'] in {'held', 'rejected'} or not row['sha']
                    or monitor.article_url(row['url'], row['ticker']) != row['url']
                    or urlsplit(row['url']).hostname in {'www.sec.gov', 'data.sec.gov'}):
                continue
            name, allowed_hosts = provider['name'] + ' IR', provider['allowedHosts']
        elif not source:
            continue
        else:
            name, allowed_hosts = source['name'], source['allowedHosts']
        key = canonical_url(row['url'])
        if (not key or key in primary_denied or urlsplit(key).hostname not in allowed_hosts
                or NONNEWS_PATH.search(urlsplit(key).path)
                or (source and key == canonical_url(source.get('url')))):
            continue
        if source and source['id'] in {'prnewswire-public', 'globenewswire-public'}:
            import issuer_syndication
            try:
                issuer_syndication.release_url(row['url'], source)
            except (ValueError, TypeError):
                continue
        acquired, last = instant(row['acquired_at']), instant(row['last_seen_at'])
        if not acquired or not last or not now - timedelta(days=WINDOW_DAYS) <= acquired <= last <= now:
            continue
        text = row['text']
        if not isinstance(text, str) or not text.strip() or '\x00' in text:
            continue
        if not english_or_japanese((row['title'] or '') + '\n' + text):
            continue  # e.g. German/Spanish wire copies: no bilingual summary can be checked.
        if row['lane'] != 'primary':
            if (row['truncated'] or hashlib.sha256((row['title'] + '\n' + text).encode()).hexdigest() != row['sha']):
                continue
            if row['lane'] == 'raw':
                match = re.fullmatch(r'/([A-Za-z0-9_]+)/status/\d+', urlsplit(row['url']).path)
                if (not match or source.get('format') != 'x-api'
                        or match[1].lower() not in {a.lower() for a in source.get('accounts', [])}
                        or match[1].lower() not in x_api.ALLOWED_ACCOUNT_NAMES
                        or not _raw_current(db, row, approved, now)):
                    continue
                name = '@' + match[1] + ' · X'
            else:
                if (source.get('format') == 'x-api' or row['sha'] != row['current_sha']
                        or row['title'] != row['current_title']
                        or not _document_current(db, row, approved, now)
                        or row['event_kind'] not in {'baseline', 'new', 'changed'}):
                    continue  # X uses acquisition, never a ticker-gated event fallback.
                # Respect existing publisher category withdrawal, without new
                # article/header/ticker classification in this preview lane.
                if not _category_current(db, source, row, now):
                    continue
        if (REPOST.search(text) or WITHDRAWAL.search(text)
                or news_policy.PROMOTION.search(row['title'] or '')):
            continue
        if row['lane'] == 'primary':
            # Raw HTML, analytics and transport bytes are not a new story.
            # Bind receipt versions to retained visible content + source date.
            row['sha'] = hashlib.sha256(json.dumps([row['title'], text, row['published_on']],
                ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        copy = excerpt(text if row['lane'] == 'raw' else row['title'])
        clocks = _source_clock(row['published_at'], row['published_on'], acquired, now)
        if not copy or not clocks or not isinstance(name, str) or not 1 <= len(name) <= 80 or CONTROL.search(name):
            continue
        item = {'id': 'original-preview-' + hashlib.sha256(key.encode()).hexdigest()[:24],
                'sourceName': name, 'sourceUrl': row['url'], 'excerptOriginal': copy,
                **clocks, 'acquiredAt': row['acquired_at'], 'status': STATUS}
        candidate = {'key': key, 'source_id': row['source_id'], 'sha': row['sha'], 'item': item, 'primary': row['lane'] == 'primary',
                     # Private: full retained source for the summary worker, never published.
                     'source_title': row['title'] or '', 'source_text': text}
        # Same URL has exactly one owner and one copied excerpt.
        previous = result.get(key)
        if previous is None or (candidate['primary'], instant(item['acquiredAt']), row['source_id']) > (
                previous['primary'], instant(previous['item']['acquiredAt']), previous['source_id']):
            result[key] = candidate
    if 'sources' in tables:
        notices, scanned = sec_preview_notice.candidates(db, now, window_days=WINDOW_DAYS,
            scan_limit=SCAN_LIMIT, instant=instant, withdrawal=WITHDRAWAL)
        lane_counts.append(scanned)
        result.update({row['key']: row for row in notices})
    notices, counts = configured_preview_notice.candidates(db, now, sources, window_days=WINDOW_DAYS,
        scan_limit=SCAN_LIMIT, instant=instant, excerpt=excerpt, canonical_url=canonical_url,
        withdrawal=WITHDRAWAL, promotion=news_policy.PROMOTION)
    lane_counts.extend(counts)
    primary_denied.update(_primary_denied_keys(db, [{'url': row['item']['sourceUrl']} for row in notices], tables, now))
    notices = {row['key']: row for row in notices if row['key'] not in primary_denied}
    # Once metadata has been made available, later body arrival enriches that
    # same notice. It must not mint a second publication or refresh its age.
    # Existing original-body cards (without a metadata receipt) stay unchanged.
    if 'original_preview_receipts' in tables:
        for key, row in list(result.items()):
            if not row['source_id'].startswith('primary-ir-'):
                continue
            revision = hashlib.sha256(('metadata:' + key).encode()).hexdigest()
            if db.execute('SELECT 1 FROM original_preview_receipts WHERE canonical_url=? AND revision=?', (key, revision)).fetchone():
                result.pop(key)
    for key, row in notices.items():
        result.setdefault(key, row)
    if stats is not None:
        stats.update({'recentWindowDays': WINDOW_DAYS, 'scanLimitPerLane': SCAN_LIMIT,
                      'displayLimit': CARD_LIMIT, 'eligibleInScan': len(result),
                      'scanLimited': any(count >= SCAN_LIMIT for count in lane_counts)})
    return sorted(result.values(), key=lambda r: (instant(r['item']['acquiredAt']), r['key']), reverse=True)[:CARD_LIMIT]


def publish_once(path, *, reference=None, sources=None):
    """Called by the existing no-model result worker, never by /news."""
    now = reference or datetime.now(timezone.utc)
    db = sqlite3.connect(path, timeout=1)
    db.row_factory = sqlite3.Row
    try:
        schema(db)
        # A short local transaction binds eligibility and the original receipt.
        with db:
            db.execute('BEGIN IMMEDIATE')
            rows = candidates(db, now, sources)
            for row in rows:
                item = row['item']
                db.execute('''INSERT OR IGNORE INTO original_preview_receipts VALUES(?,?,?,?,?,?)''',
                  (row['key'], row['source_id'], item['sourceUrl'], row['sha'], item['acquiredAt'], now.isoformat(timespec='milliseconds')))
            # Keep compact immutable historical clocks; only query/display are
            # window-limited. No corpus duplication or lifetime capacity stop.
        return len(rows)
    finally:
        db.close()


def public_feed(db, reference=None, *, sources=None, verified_urls=(), stats=None):
    """A missing receipt is pending, not permission to invent a display clock."""
    if 'original_preview_receipts' not in table_names(db):
        return []
    now = reference or datetime.now(timezone.utc)
    verified = {canonical_url(url) for url in verified_urls}
    verified.update(ref['key'] for url in verified_urls if (ref := sec_preview_notice.identity(url)))
    items = []
    for row in candidates(db, now, sources, stats=stats):
        if row['key'] in verified:
            continue
        receipt = db.execute('SELECT * FROM original_preview_receipts WHERE canonical_url=? AND revision=?', (row['key'], row['sha'])).fetchone()
        if not receipt or receipt['revision'] != row['sha']:
            continue
        acquired, published = instant(receipt['acquired_at']), instant(receipt['first_published_at'])
        if not acquired or not published or not now - timedelta(days=WINDOW_DAYS) <= acquired <= published <= now:
            continue
        item = {**row['item'], 'acquiredAt': receipt['acquired_at'], 'previewPublishedAt': receipt['first_published_at']}
        import preview_summaries
        items.append(preview_summaries.attach(db, row, item))
    return items


def _visible_urls(db, payload):
    """Use only actually emitted validated cards, never saved/held copy rows."""
    urls = [item.get('url') for key in ('items', 'officialUpdates', 'marketUpdates', 'resultBriefs')
            for item in payload.get(key, []) if isinstance(item, dict)]
    urls.extend(source.get('url') for item in payload.get('officialResearch', []) if isinstance(item, dict)
                for source in item.get('sources', []) if isinstance(source, dict))
    # Analyst cards intentionally omit public source URLs. Resolve only those
    # emitted IDs through current retained evidence, privately and SELECT-only.
    if {'analyst_news_publications', 'signal_events', 'signal_documents'} <= table_names(db):
        for item in payload.get('analystUpdates', [])[:30]:
            if not isinstance(item, dict) or not re.fullmatch(r'[0-9]{1,24}', str(item.get('id', ''))):
                continue
            rows = db.execute('''SELECT e.url FROM signal_events e
              JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url AND d.sha=e.sha
              JOIN analyst_news_publications p ON p.event_id=e.id AND p.source_id=e.source_id
                AND p.url=e.url AND p.sha=e.sha WHERE e.id=?''', (int(item['id']),))
            urls.extend(row['url'] for row in rows)
    return urls


def preview_payload(db, verified_payload, reference=None):
    """Add an optional lane without evicting or modifying any verified section."""
    import news_history
    urls = _visible_urls(db, verified_payload)
    stats = {'recentWindowDays': WINDOW_DAYS, 'scanLimitPerLane': SCAN_LIMIT, 'displayLimit': CARD_LIMIT,
             'eligibleInScan': 0, 'scanLimited': False}
    items = public_feed(db, reference, verified_urls=urls, stats=stats)
    result = {**verified_payload, 'originalPreviewItems': items, 'originalPreviewWindow': stats}
    def counts():
        stats.update({'returned': len(items), 'omittedInScan': max(0, stats['eligibleInScan'] - len(items))})
    counts()
    while items and news_history.encoded_size(result) > news_history.TARGET_BYTES:
        items.pop()
        counts()
    if news_history.encoded_size(result) > news_history.HARD_BYTES:
        return verified_payload
    return result
