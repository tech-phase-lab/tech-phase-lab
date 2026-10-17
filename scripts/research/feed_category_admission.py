"""Publisher feed-category admission for explicitly configured official routes.

Publisher-supplied category proof is orthogonal to the title/body revision.
Parse before the writer transaction; persist with existing acquisition evidence.
Two additive tables retain semantic snapshot history and its current pointer.
"""
from datetime import datetime, timezone
import hashlib
import json
import re
import xml.etree.ElementTree as ET

import signals
import monitor

# Source-level fail-closed scope; no article URL, suffix, or post-ID allowlist.
REQUIRED_SOURCES = frozenset({'skhynix-news'})


def required(source=None, source_id=None):
    return bool(source_id in REQUIRED_SOURCES or (source and (
        source.get('id') in REQUIRED_SOURCES or source.get('publisherArticleCategories'))))

VERSION = 1
PARSER_VERSION = 2
MAX_CATEGORIES = 16
MAX_CATEGORY_BYTES = 256
MAX_CATEGORY_URL_BYTES = 1024
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
ATOM = '{http://www.w3.org/2005/Atom}'


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def sha(value):
    return hashlib.sha256(value).hexdigest()


def instant(value):
    try:
        result = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return result.astimezone(timezone.utc) if result.tzinfo else None
    except (TypeError, ValueError, AttributeError):
        return None


def schema(db):
    """Writer/startup migration only. Never invoke from a read projection."""
    db.executescript('''
      CREATE TABLE IF NOT EXISTS signal_feed_category_snapshots(
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, config_sha TEXT NOT NULL,
        feed_url TEXT NOT NULL, effective_url TEXT NOT NULL, parser_version INTEGER NOT NULL,
        response_sha TEXT NOT NULL, semantic_sha TEXT NOT NULL,
        entries_json TEXT NOT NULL, acquired_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signal_feed_category_heads(
        source_id TEXT PRIMARY KEY, snapshot_id INTEGER NOT NULL,
        generation INTEGER NOT NULL, confirmed_at TEXT NOT NULL,
        response_sha TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signal_category_evidence(
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL,
        config_sha TEXT NOT NULL, parser_version INTEGER NOT NULL, entry_json TEXT NOT NULL,
        evidence_sha TEXT NOT NULL, acquired_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS signal_category_evidence_heads(
        source_id TEXT NOT NULL, url TEXT NOT NULL, kind TEXT NOT NULL, evidence_id INTEGER NOT NULL,
        generation INTEGER NOT NULL, verified_at TEXT NOT NULL, evidence_sha TEXT NOT NULL,
        PRIMARY KEY(source_id,url,kind));
      CREATE TABLE IF NOT EXISTS signal_category_decisions(
        source_id TEXT NOT NULL, url TEXT NOT NULL, epoch INTEGER NOT NULL, semantic_sha TEXT NOT NULL,
        PRIMARY KEY(source_id,url));
    ''')
    if 'effective_url' not in {row[1] for row in db.execute('PRAGMA table_info(signal_feed_category_snapshots)')}:
        # An older proof cannot lend validators to an unknown representation.
        db.execute('ALTER TABLE signal_feed_category_snapshots ADD COLUMN effective_url TEXT')


def head(db, source_id):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='signal_feed_category_heads'").fetchone():
        return None
    row = db.execute('SELECT * FROM signal_feed_category_heads WHERE source_id=?', (source_id,)).fetchone()
    return dict(row) if row else None



def conditional_validators(db, source, tickers, existing):
    """One normal full poll on activation/migration; no extra request or cadence.

    Call after signals.validators_for. Missing baseline or parser upgrade must
    not keep returning304 forever with no authoritative category evidence.
    """
    if not required(source):
        return existing
    current = head(db, source['id'])
    if not current:
        return {}
    snapshot = db.execute('SELECT * FROM signal_feed_category_snapshots WHERE id=?',
                          (current['snapshot_id'],)).fetchone()
    if (not snapshot or snapshot['source_id'] != source['id']
            or snapshot['config_sha'] != signals.fingerprint(source, tickers)
            or snapshot['feed_url'] != source['url'] or snapshot['parser_version'] != PARSER_VERSION
            or not valid_effective_url(source, snapshot['effective_url'])
            or not _durable_feed_matches(db, snapshot)):
        return {}
    return existing


def valid_effective_url(source, value):
    try:
        return bool(value and signals.safe_url(value, source) == value)
    except (ValueError, TypeError, AttributeError):
        return False


def categories(entry):
    """All direct terms; never truncate first and accidentally discard Media."""
    nodes = [node for node in entry if node.tag in {'category', ATOM + 'category'}]
    raw = ET.tostring(entry, encoding='utf-8')
    result = {'state': 'missing', 'terms': [], 'entry_xml_sha': sha(raw)}
    if not nodes:
        return result
    if len(nodes) > MAX_CATEGORIES:
        return {**result, 'state': 'invalid-bound'}
    terms = []
    for node in nodes:
        term = node.get('term', '') if node.tag == ATOM + 'category' else ''.join(node.itertext())
        # Unsupported taxonomies need an explicit future policy; label is not term.
        if node.get('scheme') or node.get('domain') or list(node):
            return {**result, 'state': 'invalid-taxonomy'}
        if not term.strip() or len(term.encode()) > MAX_CATEGORY_BYTES or re.search(r'[\x00-\x1f\x7f]', term):
            return {**result, 'state': 'invalid-bound'}
        terms.append(term)
    return {**result, 'state': 'valid', 'terms': terms}


def prepare(source, body, tickers, expected_head, acquired_at, *, effective_url=None):
    """Pure preparation from one fetched response. No DB, filesystem or network."""
    if source.get('format') != 'feed' or len(body) > signals.MAX_BYTES or not instant(acquired_at):
        raise ValueError('invalid-feed-response')
    effective_url = source['url'] if effective_url is None else effective_url
    if not valid_effective_url(source, effective_url):
        raise ValueError('invalid-feed-effective-url')
    # Existing parse enforces XML/URL/item limits and computes the retained body.
    items = signals.parse(source, body, tickers)
    proof = {}
    for entry in ET.fromstring(body).iter():
        if signals.local_name(entry) not in {'item', 'entry'}:
            continue
        link = signals.child_text(entry, 'link') or next((c.get('href', '') for c in entry
            if signals.local_name(c) == 'link' and c.get('rel', 'alternate') == 'alternate'), '')
        try:
            url = signals.safe_url(link, source)
        except ValueError:
            continue
        current = categories(entry)
        if url in proof:
            current = {'state': 'ambiguous-url', 'terms': [], 'entry_xml_sha': sha(body)}
        proof[url] = current
    entries = {}
    for item in items:
        entries[sha(item['url'].encode())] = {**proof[item['url']],
            'url': item['url'], 'body_sha': sha(item['text'].encode()),
            'document_sha': sha((item['title'] + '\n' + item['text']).encode()),
            'title': item['title'], 'published_at': item['publishedAt'], 'published_on': item.get('publishedOn'),
            'truncated': bool(item['truncated'])}
        if len(item['url'].encode()) > MAX_CATEGORY_URL_BYTES:
            # Ordinary acquisition remains intact. Bound only category metadata;
            # an oversized identity cannot become an admitted truncated URL.
            entries[sha(item['url'].encode())].update(url=None, state='invalid-url-bound', terms=[])
    payload = encoded(entries)
    if len(payload.encode()) > MAX_SNAPSHOT_BYTES:
        # Retain every ordinary acquired document while withholding oversized
        # metadata. Never truncate terms into a misleading allowed prefix.
        entries = {key: {**entry, 'state': 'invalid-snapshot-bound', 'terms': []}
                   for key, entry in entries.items()}
        payload = encoded(entries)
        if len(payload.encode()) > MAX_SNAPSHOT_BYTES:
            raise ValueError('category-snapshot-bound')
    config = signals.fingerprint(source, tickers)
    identity = [source['id'], config, source['url'], effective_url, PARSER_VERSION, entries]
    return {'source_id': source['id'], 'config_sha': config, 'feed_url': source['url'], 'effective_url': effective_url,
            'parser_version': PARSER_VERSION, 'response_sha': sha(body),
            'semantic_sha': sha(encoded(identity).encode()), 'entries_json': payload,
            'acquired_at': acquired_at, 'expected_head': expected_head, 'items': items}


def persist_200(db, source, tickers, prepared):
    """Inside acquisition transaction, after save_evidence. Does not commit."""
    if not db.in_transaction:
        raise ValueError('acquisition-transaction-required')
    if (source['id'] != prepared['source_id'] or source['url'] != prepared['feed_url']
            or signals.fingerprint(source, tickers) != prepared['config_sha']):
        raise ValueError('source-identity-changed')
    previous = head(db, source['id'])
    if previous != prepared['expected_head']:
        raise ValueError('superseded-feed-response')
    if previous and instant(prepared['acquired_at']) < instant(previous['confirmed_at']):
        raise ValueError('older-feed-response')
    # Category proof cannot be committed independently of retained evidence.
    entries = json.loads(prepared['entries_json'])
    for item in prepared['items']:
        url = item['url']
        evidence = entries[sha(url.encode())]
        doc = db.execute('SELECT sha,title FROM signal_documents WHERE source_id=? AND url=?', (source['id'], url)).fetchone()
        if not doc or doc['sha'] != evidence['document_sha'] or doc['title'] != evidence['title']:
            raise ValueError('category-document-mismatch')
    last = db.execute('SELECT * FROM signal_feed_category_snapshots WHERE id=?',
                      (previous['snapshot_id'],)).fetchone() if previous else None
    if last and last['semantic_sha'] == prepared['semantic_sha']:
        snapshot_id = last['id']
    else:
        fields = ('source_id', 'config_sha', 'feed_url', 'effective_url', 'parser_version', 'response_sha',
                  'semantic_sha', 'entries_json', 'acquired_at')
        snapshot_id = db.execute('INSERT INTO signal_feed_category_snapshots('
            + ','.join(fields) + ') VALUES(?,?,?,?,?,?,?,?,?)', tuple(prepared[k] for k in fields)).lastrowid
    db.execute('''INSERT INTO signal_feed_category_heads VALUES(?,?,?,?,?)
      ON CONFLICT(source_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,
      generation=excluded.generation,confirmed_at=excluded.confirmed_at,response_sha=excluded.response_sha''',
      (source['id'], snapshot_id, (previous['generation'] if previous else 0) + 1,
       prepared['acquired_at'], prepared['response_sha']))
    for item in prepared['items']:
        _persist_evidence(db, source, prepared['config_sha'], item['url'], 'feed',
            entries[sha(item['url'].encode())], prepared['response_sha'], prepared['acquired_at'])


def request_validators(source, validators):
    """The exact validated HTTP conditionals sent by signals.fetch."""
    if not source.get('conditionalRequests', True):
        return {}
    return {key: value for key in ('etag', 'last_modified')
            if (value := monitor.http_validator(validators.get(key)))}


def request_identity(source, validators):
    return {'url': signals.safe_url(source['url'], source),
            'validators': request_validators(source, validators)}


def capture_request(db, source, tickers, validators):
    """Capture before HTTP; no proof can be recovered from a 304 alone."""
    route = db.execute('SELECT * FROM signal_routes WHERE id=?', (source['id'],)).fetchone()
    return {'source_id': source['id'], 'config_sha': signals.fingerprint(source, tickers),
            'request': request_identity(source, validators), 'head': head(db, source['id']),
            'route': dict(route) if route else None}


def check_request(db, source, tickers, request):
    route = db.execute('SELECT * FROM signal_routes WHERE id=?', (source['id'],)).fetchone()
    if (source['id'] != request['source_id']
            or signals.fingerprint(source, tickers) != request['config_sha']):
        raise ValueError('source-identity-changed')
    if ((dict(route) if route else None) != request['route']
            or head(db, source['id']) != request['head']):
        raise ValueError('superseded-feed-response')


def persist_304(db, source, tickers, request, response, checked_at):
    """Renew only an actual conditional HTTP 304 for this current baseline.

    _feed_request is emitted by the HTTP transport from the Request headers,
    not derived from response headers or a caller's assertion that it sent one.
    The route, category head, parser and complete source policy must still match.
    """
    if not db.in_transaction:
        raise ValueError('acquisition-transaction-required')
    check_request(db, source, tickers, request)
    current = head(db, source['id'])
    expected = request['request']
    if (response.get('not_modified') is not True or response.get('_http_status') != 304
            or response.get('_feed_request') != expected or not expected['validators']
            or not current or current != request['head']):
        raise ValueError('304-without-current-category-proof')
    route = request['route']
    if (not route or not route['initialized'] or route['config_sha'] != request['config_sha']
            or request_validators(source, route) != expected['validators']):
        raise ValueError('304-validator-baseline-mismatch')
    snapshot = db.execute('SELECT * FROM signal_feed_category_snapshots WHERE id=?',
                          (current['snapshot_id'],)).fetchone()
    if (not snapshot or snapshot['source_id'] != source['id'] or snapshot['config_sha'] != request['config_sha']
            or snapshot['feed_url'] != source['url'] or snapshot['parser_version'] != PARSER_VERSION
            or not valid_effective_url(source, snapshot['effective_url'])
            or response.get('_effective_url') != snapshot['effective_url']
            or not _durable_feed_matches(db, snapshot)
            or not instant(checked_at) or not instant(current['confirmed_at'])
            or instant(checked_at) < instant(current['confirmed_at'])):
        raise ValueError('304-source-identity-changed')
    db.execute('UPDATE signal_feed_category_heads SET generation=generation+1,confirmed_at=? WHERE source_id=?',
               (checked_at, source['id']))
    entries = json.loads(snapshot['entries_json'])
    for entry in entries.values():
        _persist_evidence(db, source, request['config_sha'], entry['url'], 'feed',
                          entry, current['response_sha'], checked_at)




def _entry_reason(entry, policy):
    if not isinstance(entry, dict) or not isinstance(entry.get('state'), str):
        return 'category-proof-invalid'
    if entry['state'] != 'valid':
        return 'category-' + entry['state']
    terms = entry.get('terms')
    if (not isinstance(terms, list) or not 1 <= len(terms) <= MAX_CATEGORIES
            or any(not isinstance(term, str) or not term.strip() or len(term.encode()) > MAX_CATEGORY_BYTES for term in terms)):
        return 'category-proof-invalid'
    normalized = {term.strip().casefold() for term in terms}
    if normalized.intersection(term.strip().casefold() for term in (policy.get('denyAny') or []) if isinstance(term, str)):
        return 'publisher-excluded-category'
    if not normalized.intersection(term.strip().casefold() for term in (policy.get('allowAny') or []) if isinstance(term, str)):
        return 'publisher-category-not-allowed'
    return None


def _same_revision(entry, other):
    fields = ('document_sha', 'title', 'published_at', 'published_on', 'truncated')
    return bool(entry and other and all(key in entry and key in other and entry[key] == other[key] for key in fields))


def _evidence_rows(db, source_id, urls):
    result = {}
    if not urls:
        return result
    marks = ','.join('?' for _ in urls)
    for row in db.execute(f'''SELECT h.*,o.config_sha,o.parser_version,o.entry_json
      FROM signal_category_evidence_heads h JOIN signal_category_evidence o ON o.id=h.evidence_id
      WHERE h.source_id=? AND h.url IN ({marks})''', (source_id, *urls)):
        value = dict(row)
        try:
            value['entry'] = json.loads(value.pop('entry_json')) if len(value['entry_json'].encode()) <= 16384 else None
        except (ValueError, TypeError):
            value['entry'] = None
        result.setdefault(row['url'], {})[row['kind']] = value
    return result


def _durable_feed_matches(db, snapshot):
    """Missing migrated evidence forces a full response, never construction from 304."""
    try:
        if len(snapshot['entries_json'].encode()) > MAX_SNAPSHOT_BYTES:
            return False
        entries = json.loads(snapshot['entries_json'])
        if not isinstance(entries, dict) or len(entries) > signals.MAX_ITEMS:
            return False
        urls = [entry['url'] for entry in entries.values()]
        proofs = _evidence_rows(db, snapshot['source_id'], urls)
        for entry in entries.values():
            proof = proofs.get(entry['url'], {}).get('feed')
            if (not proof or proof['config_sha'] != snapshot['config_sha']
                    or proof['parser_version'] != PARSER_VERSION or proof['entry'] != entry
                    or not db.execute('SELECT 1 FROM signal_category_decisions WHERE source_id=? AND url=?',
                                      (snapshot['source_id'], entry['url'])).fetchone()):
                return False
        return True
    except (ValueError, TypeError, KeyError):
        return False


def _combined(source, config, proofs):
    """Latest explicit feed and article decisions both constrain permission.

    A newer affirmative feed observation cannot erase an explicit article denial,
    nor vice versa. Each authority must correct its own latest negative evidence.
    """
    feed = proofs.get('feed')
    if not feed or feed['config_sha'] != config or feed['parser_version'] != PARSER_VERSION:
        return None, None, 'category-proof-source-mismatch'
    entry = feed['entry']
    if not isinstance(entry, dict):
        return None, None, 'category-proof-invalid'
    article = proofs.get('article')
    if (article and _entry_reason(article['entry'], source.get('publisherArticleCategories', {})) is None
            and (article['config_sha'] != config or article['parser_version'] != PARSER_VERSION
                 or not _same_revision(article['entry'], entry))):
        # Positive body evidence never crosses a source revision. A negative
        # URL-bound article response survives RSS revisions/config migrations;
        # only a newly fetched, identity-validated article can correct it.
        article = None
    active = [feed] + ([article] if article else [])
    reason = next((reason for proof in active
                   if (reason := _entry_reason(proof['entry'], source.get('publisherArticleCategories', {})))), None)
    body_sha = (article or feed)['entry'].get('body_sha')
    semantic = sha(encoded([config, {key: entry.get(key) for key in
        ('document_sha', 'title', 'published_at', 'published_on', 'truncated')}, bool(reason), body_sha]).encode())
    return active, semantic, reason


def _persist_evidence(db, source, config, url, kind, entry, evidence_sha, verified_at):
    """Append semantic evidence; omission never calls this for the missing URL."""
    old = _evidence_rows(db, source['id'], [url]).get(url, {}).get(kind)
    encoded_entry = encoded(entry)
    if len(encoded_entry.encode()) > 16384 or not instant(verified_at):
        raise ValueError('category-evidence-bound')
    if old and instant(old['verified_at']) and instant(verified_at) < instant(old['verified_at']):
        raise ValueError('older-article-category-response')
    if (old and old['config_sha'] == config and old['parser_version'] == PARSER_VERSION
            and old['entry'] == entry):
        evidence_id = old['evidence_id']
    else:
        evidence_id = db.execute('''INSERT INTO signal_category_evidence
          (source_id,url,kind,config_sha,parser_version,entry_json,evidence_sha,acquired_at)
          VALUES(?,?,?,?,?,?,?,?)''', (source['id'], url, kind, config, PARSER_VERSION,
                                     encoded_entry, evidence_sha, verified_at)).lastrowid
    db.execute('''INSERT INTO signal_category_evidence_heads VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(source_id,url,kind) DO UPDATE SET evidence_id=excluded.evidence_id,
      generation=excluded.generation,verified_at=excluded.verified_at,evidence_sha=excluded.evidence_sha''',
      (source['id'], url, kind, evidence_id, (old['generation'] if old else 0) + 1, verified_at, evidence_sha))
    proofs = _evidence_rows(db, source['id'], [url])[url]
    _, semantic, _ = _combined(source, config, proofs)
    previous = db.execute('SELECT * FROM signal_category_decisions WHERE source_id=? AND url=?',
                          (source['id'], url)).fetchone()
    # Adding an agreeing article observation, refreshing it, or changing unrelated
    # feed entries does not consume an in-flight claim. Denial/revision/body
    # changes and later reversions always advance the authorization epoch.
    epoch = (previous['epoch'] if previous else 0) + int(not previous or previous['semantic_sha'] != semantic)
    db.execute('''INSERT INTO signal_category_decisions VALUES(?,?,?,?)
      ON CONFLICT(source_id,url) DO UPDATE SET epoch=excluded.epoch,semantic_sha=excluded.semantic_sha''',
      (source['id'], url, epoch, semantic or 'unavailable'))


def persist_article(db, source, tickers, row, category, body_sha, raw_sha, verified_at):
    """Caller rechecks the captured source/document/token under its save lock."""
    if not db.in_transaction:
        raise ValueError('acquisition-transaction-required')
    entry = {'document_sha': row['sha'], 'title': row['title'],
             'published_at': row['published_at'], 'published_on': row['published_on'],
             'truncated': bool(row['truncated']), 'body_sha': body_sha,
             'state': category['state'], 'terms': category['terms']}
    _persist_evidence(db, source, signals.fingerprint(source, tickers), row['url'],
                      'article', entry, raw_sha, verified_at)


def read_context(db, source, tickers, rows):
    """Bounded request-local read; historical decisions are independent of membership."""
    if len(rows) > signals.MAX_ITEMS:
        raise ValueError('category-candidate-bound')
    current = head(db, source['id'])
    snapshot = db.execute('SELECT * FROM signal_feed_category_snapshots WHERE id=?',
                          (current['snapshot_id'],)).fetchone() if current else None
    entries = None
    if snapshot and len(snapshot['entries_json'].encode()) <= MAX_SNAPSHOT_BYTES:
        try:
            parsed = json.loads(snapshot['entries_json'])
            if isinstance(parsed, dict) and len(parsed) <= signals.MAX_ITEMS:
                entries = parsed
        except (ValueError, TypeError):
            pass
    urls = sorted({row['url'] for row in rows})
    marks = ','.join('?' for _ in urls)
    documents = {row['url']: dict(row) for row in db.execute(
        'SELECT url,sha,title FROM signal_documents WHERE source_id=? AND url IN (' + marks + ')',
        (source['id'], *urls))} if urls else {}
    tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE name IN "
        "('signal_category_evidence','signal_category_evidence_heads','signal_category_decisions')")}
    proofs = _evidence_rows(db, source['id'], urls) if len(tables) == 3 else {}
    decisions = {row['url']: dict(row) for row in db.execute(
        'SELECT * FROM signal_category_decisions WHERE source_id=? AND url IN (' + marks + ')',
        (source['id'], *urls))} if urls and len(tables) == 3 else {}
    return {'source_id': source['id'], 'config_sha': signals.fingerprint(source, tickers),
            'head': current, 'snapshot': snapshot, 'entries': entries, 'documents': documents,
            'proofs': proofs, 'decisions': decisions}


def decision(db, source, tickers, row, reference, *, primary_owned_urls=(), expected_token=None,
             context=None, require_fresh=False, article_refresh=False):
    """Historical display and paid-claim freshness are separate explicit gates."""
    def held(reason, **detail):
        return {'admitted': False, 'reason': reason, 'token': None, **detail}
    if row['url'] in primary_owned_urls:
        return held('primary-owned-url')
    if (not source or source.get('enabled') is False or source.get('officialUpdates') is not True
            or source.get('format') != 'feed' or source.get('kind') != 'publisher-update'
            or row['source_id'] != source['id']):
        return held('source-not-admitted')
    policy = source.get('publisherArticleCategories', {})
    allow, deny, max_age = policy.get('allowAny'), policy.get('denyAny'), policy.get('maxAgeSeconds')
    if (policy.get('version') != VERSION or not isinstance(allow, list) or not allow
            or not isinstance(deny, list) or not deny or type(max_age) is not int
            or not 120 <= max_age <= 3600
            or any(not isinstance(term, str) or not term.strip() or len(term.encode()) > MAX_CATEGORY_BYTES for term in allow + deny)):
        return held('category-policy-unavailable')
    try:
        if signals.safe_url(row['url'], source) != row['url']:
            return held('source-url-mismatch')
        if not set(source.get('tickers', [])).intersection(json.loads(row['tickers_json'])):
            return held('source-ticker-mismatch')
    except (ValueError, TypeError):
        return held('source-identity-invalid')
    context = context or read_context(db, source, tickers, [row])
    config = signals.fingerprint(source, tickers)
    if context['source_id'] != source['id'] or context['config_sha'] != config:
        return held('category-proof-source-mismatch')
    snapshot = context['snapshot']
    if not context['head']:
        return held('category-proof-unavailable')
    if (not snapshot or snapshot['source_id'] != source['id'] or snapshot['config_sha'] != config
            or snapshot['feed_url'] != source['url'] or snapshot['parser_version'] != PARSER_VERSION
            or not valid_effective_url(source, snapshot['effective_url'])):
        return held('category-proof-source-mismatch')
    proofs = context['proofs'].get(row['url'], {})
    active, semantic, reason = _combined(source, config, proofs)
    if not active:
        return held(reason or 'category-proof-unavailable')
    proof = active[0]['entry']
    document = context['documents'].get(row['url'])
    identity = {'document_sha': row['sha'], 'title': row['title'], 'published_at': row['published_at'],
                'published_on': row['published_on'], 'truncated': bool(row['truncated'])}
    if (not document or document['sha'] != row['sha'] or document['title'] != row['title']
            or not _same_revision(proof, identity) or row['truncated']):
        return held('category-proof-revision-mismatch')
    decision_state = context['decisions'].get(row['url'])
    if not decision_state or decision_state['semantic_sha'] != semantic:
        return held('category-proof-invalid')
    token = (source['id'], row['url'], decision_state['epoch'], row['sha'])
    if expected_token is not None and token != expected_token:
        return held('category-proof-changed-in-flight')
    if article_refresh:
        # A previously known story may refresh a failed/negative article response,
        # but a current explicit feed Media/invalid decision never schedules one.
        reason = _entry_reason(proof, policy)
    if reason:
        return held(reason, refreshToken=token)
    article = active[-1] if active[-1]['kind'] == 'article' else None
    if (not article_refresh and article and 'body_sha' in row.keys()
            and row['body_sha'] != article['entry'].get('body_sha')):
        return held('category-proof-body-mismatch')
    clocks = [(instant(value['verified_at']), value['kind']) for value in active]
    if any(clock is None or clock > reference for clock, _ in clocks):
        return held('category-proof-clock-invalid')
    verified_at, kind = max(clocks)
    fresh = (reference - verified_at).total_seconds() <= max_age
    member = bool(context['entries'] is not None and sha(row['url'].encode()) in context['entries'])
    evidence = {'verifiedAt': verified_at.isoformat(), 'kind': kind, 'currentFeedMember': member,
                'freshForGeneration': fresh, 'status': 'current' if fresh and member else 'last-verified'}
    if require_fresh and not fresh:
        return held('category-proof-stale', evidence=evidence)
    return {'admitted': True, 'reason': 'publisher-category-allowed', 'token': token, 'evidence': evidence}


def refresh_candidates(db, sources, reference):
    """Continue the existing body-fetch retry path for known STORY identities.

    A negative article result stays private while this path can verify a later
    correction. Explicit feed Media/invalid rows (including attachments) never
    enter it. This adds neither a timer nor a second request loop.
    """
    import official_release_bridge as bridge
    import news_policy
    from datetime import timedelta
    configured = {source['id']: source for source in sources if required(source)
                  and source.get('officialUpdates') is True and source.get('enabled') is not False}
    if not configured:
        return []
    marks = ','.join('?' for _ in configured)
    rows = db.execute(f'''SELECT e.* FROM signal_events e JOIN signal_documents d
      ON d.source_id=e.source_id AND d.url=e.url AND d.sha=e.sha AND d.title=e.title
      WHERE e.source_id IN ({marks}) ORDER BY e.id DESC LIMIT 100''', tuple(configured)).fetchall()
    contexts = bridge.category_contexts(db, rows, sources=configured.values())
    primary_urls = bridge.primary_owned_urls(db, [row['url'] for row in rows])
    result, seen = [], set()
    for row in rows:
        source = configured[row['source_id']]
        observed, published = instant(row['observed_at']), instant(row['published_at'])
        if (row['url'] in seen or not observed or not reference - timedelta(days=7) <= observed <= reference
                or (row['published_at'] and (not published or not reference - timedelta(days=7) <= published <= reference))
                or (row['event_kind'] == 'baseline' and not row['published_at']) or not news_policy.eligible(row['title'])):
            continue
        if bridge.is_current(db, row, source=source, primary_urls=primary_urls, reference=reference,
                category_context=contexts.get(row['source_id']), article_refresh=True):
            result.append({'id': str(row['id']), 'url': row['url']})
            seen.add(row['url'])
    return result
