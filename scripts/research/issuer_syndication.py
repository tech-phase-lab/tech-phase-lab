"""Bounded issuer-release enrichment and deterministic capacity-contract news.

Distributor feeds stay private. A verified article is not automatically eligible
for paid generation. Only the supported source-bound grammar publishes, without
provider calls; unsupported announcements remain private with fixed diagnostics.
"""
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
import hashlib
import json
import re
from urllib.parse import urlsplit

import monitor
import signals
from html_signals import NewsHTML

POLICY = 'issuer-capacity-contract-v1'
QUEUE_CAPACITY = 500
CONTRACT_PARTNERS = {'NBIS': ['Nebius']}
SOURCES = {'globenewswire-public': ('GlobeNewswire', 'article-body'),
           'prnewswire-public': ('PR Newswire', 'release-body')}
MATERIAL = re.compile(r'\b(?:contract|agreement|partnership|acqui(?:re|res|red|sition)|capacity|commitment|launch(?:es|ed)?|introduc(?:es|ed)|production|business outlook|guidance)\b', re.I)
EXCLUDED = re.compile(r'\b(?:lawsuit|class action|investigation|shareholder alert|offering|debentures|warrants|webinar|conference|presentation)\b', re.I)


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def compact(text):
    return ' '.join(text.split())


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (AttributeError, ValueError, TypeError, OverflowError):
        return None


def schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS issuer_syndication_bodies(
        event_id INTEGER PRIMARY KEY, sha TEXT NOT NULL, body_sha TEXT NOT NULL,
        body TEXT NOT NULL, metadata TEXT NOT NULL, fetched_at TEXT,
        checked_at TEXT NOT NULL, next_at REAL NOT NULL, attempts INTEGER NOT NULL,
        error TEXT, reason TEXT NOT NULL, etag TEXT, last_modified TEXT);
      CREATE TABLE IF NOT EXISTS issuer_syndication_publications(
        event_id INTEGER PRIMARY KEY, sha TEXT NOT NULL, body_sha TEXT NOT NULL,
        policy TEXT NOT NULL, payload TEXT NOT NULL, public_at TEXT NOT NULL);
    ''')


def release_url(url, source):
    clean = signals.safe_url(url, source)
    parsed = urlsplit(clean)
    patterns = {
        'globenewswire-public': r'/news-release/20\d{2}/\d{2}/\d{2}/\d+/0/en/[a-z0-9-]+\.html',
        'prnewswire-public': r'/news-releases/[a-z0-9-]+-\d+\.html',
    }
    if clean != url or parsed.query or parsed.fragment or not re.fullmatch(patterns[source['id']], parsed.path, re.I):
        raise ValueError('invalid-release-url')
    return clean


class Metadata(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonical, self.author, self.records, self.provided = [], [], [], []
        self.awaiting_provider = False
        self.active, self.parts = False, []

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'link' and values.get('rel') == 'canonical':
            self.canonical.append(values.get('href'))
        if tag == 'meta' and values.get('name') == 'author':
            self.author.append(values.get('content'))
        if tag == 'script' and values.get('type') == 'application/ld+json':
            self.active, self.parts = True, []

    def handle_data(self, value):
        if self.active:
            self.parts.append(value)
        elif compact(value) == 'News provided by':
            self.awaiting_provider = True
        elif self.awaiting_provider and compact(value):
            self.provided.append(compact(value))
            self.awaiting_provider = False

    def handle_endtag(self, tag):
        if tag == 'script' and self.active:
            raw = ''.join(self.parts)
            self.active = False
            if len(raw) > 100000:
                return
            try:
                value = json.loads(raw)
                self.records.extend(value if isinstance(value, list) else [value])
            except ValueError:
                pass


def extract(source, row, raw):
    if not isinstance(raw, bytes) or len(raw) > signals.MAX_BYTES:
        raise ValueError('invalid-release-body')
    html = raw.decode('utf-8', errors='replace')
    article = NewsHTML(SOURCES[source['id']][1])
    article.feed(html)
    body = monitor.extract_html_text(''.join(article.selected).encode())
    title = compact(' '.join(article.title))
    if len(body) < 600 or len(body) >= signals.MAX_TEXT or compact(body) == compact(row['title']):
        raise ValueError('headline-only-or-incomplete-body')
    if title != compact(row['title']):
        raise ValueError('article-identity-mismatch')
    metadata = Metadata()
    metadata.feed(html)
    if metadata.canonical != [row['url']]:
        raise ValueError('article-identity-mismatch')
    records = [r for r in metadata.records if isinstance(r, dict) and r.get('@type') == 'NewsArticle']
    if len(records) != 1 or len(metadata.author) != 1:
        raise ValueError('issuer-unverified')
    record, issuer = records[0], compact(metadata.author[0] or '')
    identity = record.get('url') or (record.get('mainEntityOfPage') or {}).get('@id')
    if identity != row['url'] or compact(record.get('headline', '')) != title:
        raise ValueError('article-identity-mismatch')
    published = instant(record.get('datePublished'))
    if not published or published != instant(row['published_at']):
        raise ValueError('publication-mismatch')
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9 .,&'()-]{1,69}", issuer):
        raise ValueError('issuer-unverified')
    if source['id'] == 'globenewswire-public':
        organizations = record.get('sourceOrganization')
        if (not isinstance(organizations, list) or len(organizations) != 1
                or organizations[0].get('name') != issuer
                or (record.get('author') or {}).get('name') != issuer):
            raise ValueError('issuer-unverified')
    else:
        # PRNewswire supplies an author meta plus the visible "News provided by"
        # label, not a generic JSON-LD distributor as the release issuer.
        if metadata.provided != [issuer]:
            raise ValueError('issuer-unverified')
    short = re.sub(r'(?:,?\s+(?:Inc\.?|Corporation|Corp\.?|Ltd\.?|Limited))$', '', issuer)
    if not title.lower().startswith(short.lower() + ' ') or short not in body[:1600]:
        raise ValueError('issuer-unverified')
    return body, {'issuer': issuer, 'issuerShort': short, 'title': title,
                  'url': row['url'], 'publishedAt': record['datePublished'],
                  'distributor': SOURCES[source['id']][0]}


def candidates(db, reference, *, include_research=False):
    marks = ','.join('?' for _ in SOURCES)
    rows = db.execute(f'''SELECT e.*,d.text AS retained_body,d.first_seen_at
      FROM signal_events e JOIN signal_documents d
      ON d.source_id=e.source_id AND d.url=e.url AND d.sha=e.sha AND d.title=e.title
      WHERE e.source_id IN ({marks}) ORDER BY e.id DESC LIMIT 500''', tuple(SOURCES))
    result = []
    for raw in rows:
        row = dict(raw)
        published, observed = instant(row['published_at']), instant(row['observed_at'])
        if (digest(row['title']+'\n'+row['retained_body']) != row['sha']
                or row['truncated'] or not published or not observed
                or not reference-timedelta(days=7) <= published <= observed <= reference
                or not MATERIAL.search(row['title']) or EXCLUDED.search(row['title'])):
            continue
        try:
            tickers = json.loads(row['tickers_json'])
        except (ValueError, TypeError):
            continue
        if not isinstance(tickers, list) or not all(isinstance(t, str) for t in tickers):
            continue
        title_matches = signals.match_companies(row['title'], list(signals.ALIASES))
        if not title_matches or not set(title_matches).intersection(tickers):
            continue
        # Already reviewed original publications (including Oracle) are untouched.
        if db.execute("SELECT 1 FROM sqlite_master WHERE name='official_research_publications'").fetchone():
            previous=db.execute('SELECT payload FROM official_research_publications WHERE event_id=? AND sha=?', (row['id'],row['sha'])).fetchone()
            if previous and not include_research:
                try:
                    semantic=json.loads(previous['payload']).get('issuerBusinessPolicy')=='issuer-business-news-v1'
                except (ValueError,TypeError,AttributeError):
                    semantic=False
                if not semantic:
                    continue
                # Our semantic notes still need normal body refreshes: a
                # same-headline article correction must revoke old copy.
        result.append(row)
    return result


def projection(row, body, metadata):
    """One strict reusable issuer/counterparty capacity-contract grammar.

    Quantities vary with the source; identities are verified metadata + explicit
    company name and ticker, never a mention in boilerplate. Other syntax stays
    private rather than claiming general natural-language understanding.
    """
    if (not isinstance(metadata, dict)
            or not all(isinstance(metadata.get(key), str) for key in
                       ('url','title','publishedAt','distributor','issuer','issuerShort'))):
        raise ValueError('issuer-unverified')
    if (metadata.get('url') != row['url'] or metadata.get('title') != row['title']
            or instant(metadata.get('publishedAt')) != instant(row['published_at'])
            or metadata.get('distributor') != SOURCES[row['source_id']][0]):
        raise ValueError('article-identity-mismatch')
    issuer, short = metadata['issuer'], metadata['issuerShort']
    if (not re.fullmatch(r"[A-Za-z][A-Za-z0-9 .,&'()-]{1,69}", issuer)
            or short != re.sub(r'(?:,?\s+(?:Inc\.?|Corporation|Corp\.?|Ltd\.?|Limited))$', '', issuer)):
        raise ValueError('issuer-unverified')
    opening = body.split('\n')[:3]
    if len(opening) != 3 or any(len(p) > 1800 for p in opening):
        raise ValueError('unsupported-facts')
    first, funding, power = opening
    header = re.fullmatch(re.escape(short) + r' Signs Contract with (?P<partner>[A-Za-z][A-Za-z0-9 .-]{1,50}) for AI Data Center Capacity', row['title'])
    if not header or not first.startswith(('NEW YORK,', 'New York,')):
        raise ValueError('unsupported-facts')
    partner = header['partner']
    found = re.search(r'\btoday announced that it has entered into a binding agreement with ' + re.escape(partner)
        + r' \(Nasdaq: (?P<ticker>[A-Z]{1,5})\), the AI cloud company, for (?P<mw>\d+(?:\.\d+)?) MW of critical IT capacity at '
        + r"(?P<actor>[A-Za-z][A-Za-z0-9 .-]{0,40})[’']s facility located in the southeastern United States\.$", first)
    if not found or issuer not in first:
        raise ValueError('relevance-unverified')
    ticker, mw, actor = found['ticker'], found['mw'], found['actor']
    if (ticker not in json.loads(row['tickers_json']) or ticker not in CONTRACT_PARTNERS
            or partner not in CONTRACT_PARTNERS[ticker] or not short.startswith(actor + ' ')):
        raise ValueError('relevance-unverified')
    funded = re.fullmatch(re.escape(actor) + r' expects the customer prepayments under the initial (?P<years>\d+)-year term, together with project-level debt and preferred equity, to fund a substantial portion of the initial development costs for the '
        + re.escape(mw) + r' MW project, significantly reducing ' + re.escape(actor)
        + r'[’\']s anticipated need for corporate-level common equity and limiting potential dilution to shareholders\.', funding)
    powered = re.fullmatch(r"The contracted capacity is supported by " + re.escape(actor)
        + r"[’']s previously announced (?P<years>\d+)-year Electric Service Agreement for (?P<mw>\d+(?:\.\d+)?) MW of utility load at the site, which requires no significant additional electrical infrastructure upgrades\. "
        + re.escape(actor) + r' expects to deliver the capacity in two data halls\.', power)
    if not funded or not powered:
        raise ValueError('unsupported-facts')
    if re.search(r'\b(?:correction|retraction|cancelled|canceled|terminated|non-binding)\b', body, re.I):
        raise ValueError('corrected-or-retracted-evidence')
    def item(ja, en, quote):
        return {'ja': ja, 'en': en, 'evidenceQuote': quote}
    note = {
      'title': item(f'{short}、{partner}とAIデータセンター容量の契約を締結', row['title'], first),
      'summary': item(f'{short}は、米国南東部の施設で{mw} MWの重要IT容量を提供する拘束力のある契約を{partner}と締結したと発表した。',
          f'{short} announced a binding agreement with {partner} for {mw} MW of critical IT capacity at its facility in the southeastern United States.', first),
      'facts': [
        item(f'{short}によると、契約の当初期間は{funded["years"]}年。', f'According to {short}, the initial contract term is {funded["years"]} years.', funding),
        item(f'{short}は、顧客からの前払い金、プロジェクト単位の借入、優先株式で初期開発費の相当部分を賄う見込みとしている。',
             f'{short} expects customer prepayments, project-level debt and preferred equity to fund a substantial portion of initial development costs.', funding),
        item(f'{short}によると、容量は既発表の{powered["years"]}年間・{powered["mw"]} MWの電力供給契約に支えられる。これはIT容量とは別の電力負荷の数値。',
             f'{short} says the capacity is supported by a previously announced {powered["years"]}-year electric service agreement for {powered["mw"]} MW of utility load, distinct from IT capacity.', power),
        item(f'{short}は、2つのデータホールで容量を提供する予定としている。',
             f'{short} expects to deliver the capacity in two data halls.', power),
      ],
      'purpose': item(f'{short}は、{partner}向けAIデータセンター容量の契約を発表した。',
          f'{short} announced a contract for AI data center capacity for {partner}.', first),
    }
    from official_research import validate
    validate(note, body, row['title'])
    return note, ticker


def prepare_one(db, reference, request=None):
    request = request or signals.fetch
    sources = {s['id']: s for s in signals.SOURCES if s['id'] in SOURCES}
    # Keep unresolved retry clocks: evicting a failed entry would bypass its
    # access-control backoff when the retained feed candidate is seen again.
    with db:
        db.execute('''DELETE FROM issuer_syndication_bodies WHERE event_id NOT IN
          (SELECT e.id FROM signal_events e JOIN signal_documents d
           ON d.source_id=e.source_id AND d.url=e.url AND d.sha=e.sha
           WHERE julianday(e.published_at)>=julianday(?))''',
          ((reference-timedelta(days=7)).isoformat(),))
    available = QUEUE_CAPACITY-db.execute('SELECT count(*) FROM issuer_syndication_bodies').fetchone()[0]
    pending = []
    for row in candidates(db, reference):
        cached = db.execute('SELECT * FROM issuer_syndication_bodies WHERE event_id=?', (row['id'],)).fetchone()
        if not cached and available <= 0:
            continue
        if cached and cached['sha'] == row['sha'] and reference.timestamp() < cached['next_at'] <= reference.timestamp()+604800:
            continue
        pending.append((row, cached))
    # Unseen work first, then oldest due attempt. Fixed one-request budget per run.
    pending.sort(key=lambda pair: (bool(pair[1]), pair[1]['checked_at'] if pair[1] else '', -pair[0]['id']))
    if not pending:
        return 'idle'
    row, cached = pending[0]
    source = sources[row['source_id']]
    body, metadata, body_at, etag, modified = '', {}, None, None, None
    attempts = (cached['attempts'] if cached and cached['sha'] == row['sha'] else 0)+1
    try:
        release_url(row['url'], source)
        valid_cache = (cached and cached['sha'] == row['sha']
                       and cached['body'] and digest(cached['body']) == cached['body_sha'])
        validators = dict(cached) if valid_cache else {}
        response = request({**source, 'url': row['url'], 'format': 'document'}, validators)
        if response.get('not_modified'):
            if not valid_cache:
                raise ValueError('article-304-without-body')
            body, metadata, body_at = cached['body'], json.loads(cached['metadata']), cached['fetched_at']
            etag, modified = cached['etag'], cached['last_modified']
        else:
            body, metadata = extract(source, row, response['body'])
            body_at = reference.isoformat()
            etag, modified = response.get('etag'), response.get('last_modified')
        error, delay, attempts = None, 3600, 0
        try:
            projection(row, body, metadata)
            reason = 'ready'
        except ValueError as exc:
            reason = str(exc) if str(exc) in {'unsupported-facts','relevance-unverified','corrected-or-retracted-evidence'} else 'unsupported-facts'
    except Exception as exc:
        error = monitor.source_error_code(exc)
        reason = str(exc) if str(exc) in {'headline-only-or-incomplete-body','article-identity-mismatch','issuer-unverified','publication-mismatch'} else 'retrieval-failed'
        delay = max(min(3600, 120*2**min(attempts, 5)), monitor.source_retry_seconds(error, attempts, monitor.retry_after_seconds(exc, reference)))
    with db:
        # Network I/O was outside a write transaction. Never save against a
        # replaced source revision or manufacture a new discovery event/clock.
        current = db.execute('SELECT sha FROM signal_documents WHERE source_id=? AND url=?', (row['source_id'], row['url'])).fetchone()
        if not current or current['sha'] != row['sha']:
            return 'stale'
        db.execute('''INSERT INTO issuer_syndication_bodies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(event_id) DO UPDATE SET sha=excluded.sha,body_sha=excluded.body_sha,
          body=excluded.body,metadata=excluded.metadata,fetched_at=excluded.fetched_at,
          checked_at=excluded.checked_at,next_at=excluded.next_at,attempts=excluded.attempts,
          error=excluded.error,reason=excluded.reason,etag=excluded.etag,last_modified=excluded.last_modified''',
          (row['id'], row['sha'], digest(body), body, json.dumps(metadata), body_at, reference.isoformat(), reference.timestamp()+delay, attempts, error, reason, etag, modified))
    return 'retry' if error else reason


def publish_ready(db, reference):
    changed = False
    for row in candidates(db, reference):
        saved = db.execute('SELECT * FROM issuer_syndication_bodies WHERE event_id=? AND sha=? AND error IS NULL AND reason=?', (row['id'], row['sha'], 'ready')).fetchone()
        if not saved or digest(saved['body']) != saved['body_sha']:
            continue
        try:
            note, ticker = projection(row, saved['body'], json.loads(saved['metadata']))
        except (ValueError, TypeError, KeyError):
            continue
        payload = json.dumps({'note': note, 'ticker': ticker}, ensure_ascii=False, sort_keys=True)
        previous = db.execute('SELECT * FROM issuer_syndication_publications WHERE event_id=?', (row['id'],)).fetchone()
        if previous and (previous['sha'],previous['body_sha'],previous['policy'],previous['payload']) == (row['sha'],saved['body_sha'],POLICY,payload):
            continue
        with db:
            db.execute('''INSERT INTO issuer_syndication_publications VALUES(?,?,?,?,?,?)
              ON CONFLICT(event_id) DO UPDATE SET sha=excluded.sha,body_sha=excluded.body_sha,
              policy=excluded.policy,payload=excluded.payload,public_at=excluded.public_at''',
              (row['id'],row['sha'],saved['body_sha'],POLICY,payload,reference.isoformat()))
        changed = True
    return changed


def public_items(db, reference):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_syndication_publications'").fetchone():
        return []
    result = []
    for row in candidates(db, reference):
        saved = db.execute('''SELECT b.*,p.payload,p.policy FROM issuer_syndication_bodies b
          JOIN issuer_syndication_publications p ON p.event_id=b.event_id AND p.sha=b.sha AND p.body_sha=b.body_sha
          WHERE b.event_id=? AND b.sha=? AND b.error IS NULL AND b.reason='ready' ''', (row['id'],row['sha'])).fetchone()
        if not saved or saved['policy'] != POLICY or digest(saved['body']) != saved['body_sha']:
            continue
        try:
            source = next(s for s in signals.SOURCES if s['id'] == row['source_id'])
            release_url(row['url'], source)
            metadata = json.loads(saved['metadata'])
            note, ticker = projection(row, saved['body'], metadata)
            if json.loads(saved['payload']) != {'note':note,'ticker':ticker}:
                continue
        except (ValueError, TypeError, KeyError, StopIteration):
            continue
        result.append({'id':str(row['id']), 'title':row['title'], 'translationJa':note['title']['ja'],
          'url':row['url'], 'publisher':metadata['issuer']+' / '+metadata['distributor'],
          'tickers':[ticker], 'observedAt':row['observed_at'], 'publishedAt':row['published_at'],
          'bodyJa':'\n\n'.join([note['summary']['ja'],*[f['ja'] for f in note['facts']]]),
          'bodyEn':'\n\n'.join([note['summary']['en'],*[f['en'] for f in note['facts']]]),
          'syndication':{'policy':POLICY,'issuer':metadata['issuer'],'distributor':metadata['distributor']}})
    return result


def diagnostics(db, reference=None):
    schema(db)
    reference = reference or datetime.now(timezone.utc)
    counts = {}
    public = {item['id'] for item in public_items(db, reference)}
    for row in candidates(db, reference):
        cached = db.execute('SELECT reason FROM issuer_syndication_bodies WHERE event_id=? AND sha=?', (row['id'],row['sha'])).fetchone()
        reason = 'published' if str(row['id']) in public else cached['reason'] if cached else 'awaiting-body'
        counts[reason] = counts.get(reason, 0)+1
    return {'counts':counts, 'providerCalls':0, 'policy':POLICY, 'queueCapacity':QUEUE_CAPACITY}


def run_once(path, reference, request=None):
    with monitor.connect(path) as db:
        schema(db)
        outcome = prepare_one(db, reference, request)
        return 'done' if publish_ready(db, reference) else outcome
