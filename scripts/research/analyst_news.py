"""Source-bound analyst actions, rendered without network calls or inferred facts.

A publication is a reported broker action, not a company announcement or an
independent broker-note verification. Originals stay in private signal storage.
Every public read rechecks the complete current revision and deterministic copy.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import re

import monitor
import price_target_reconciliation as reconciliation
import signals

SOURCE_IDS = ('x-tipranks', 'x-wallstengine')
ACCOUNTS = {'tipranks', 'wallstengine'}
POLICY_VERSION = 1
MAX_BODY = 160_000
TICKER = r'[A-Z]{1,5}(?:[.-][A-Z])?'
CUE = re.compile(r'\b(?:initiat\w*|upgrad\w*|downgrad\w*|top[ -]pick|conviction|tactical|reiterat\w*|maintain\w*|keeps?|rating|price[ -]target)\b', re.I)
RETRACTION = re.compile(r'\b(?:hypothetical|fictional)\b|\b(?:not (?:true|accurate|real)|(?:did|does) not happen|didn[’\']t happen)\b|\b(?:retraction|correction)\s*:|\b(?:retract\w*|withdraw\w*|rescinded|cancelled|canceled|incorrect|erroneous|false report)\b', re.I)
FIRM = signals.PRICE_TARGET_FIRM.pattern.removeprefix(r'(?:at|by) ').removesuffix(r'\b')
# CLSA is an explicitly named broker, not a new source or acquisition route.
FIRM = '(?:' + FIRM.replace('B. Riley', r'B\. Riley') + '|CLSA)'
RATING = r'(?:Sector Perform|Sector Outperform|Market Perform|Market Outperform|Strong Buy|Outperform|Underperform|Overweight|Underweight|Equal[ -]Weight|Neutral|Hold|Buy|Sell)'
ACTION_LABELS = {
    'initiation': ('調査を開始', 'initiates coverage of'),
    'upgrade': ('投資判断を引き上げ', 'upgrades'),
    'downgrade': ('投資判断を引き下げ', 'downgrades'),
    'top-pick': ('Top Pickに指定', 'names as a Top Pick'),
    'conviction-list': ('Conviction Listに追加', 'adds to its Conviction List'),
    'tactical-list': ('Tactical Ideas Listに追加', 'adds to its Tactical Ideas List'),
}


def schema(db):
    db.executescript('''
      CREATE TABLE IF NOT EXISTS analyst_news_publications(
        source_id TEXT NOT NULL,url TEXT NOT NULL,sha TEXT NOT NULL,
        event_id INTEGER NOT NULL,policy_version INTEGER NOT NULL,payload TEXT NOT NULL,
        public_at TEXT NOT NULL,PRIMARY KEY(source_id,url,sha));
    ''')


def compact(value):
    return ' '.join(value.split())


def canonical_firm(value):
    value = signals.canonical_target_firm(compact(value))
    return next((name for name in ('BofA', 'CLSA', 'TD Cowen', 'Morgan Stanley', 'Goldman Sachs', 'Wells Fargo', 'Deutsche Bank', 'Citi', 'JPMorgan') if name.casefold() == value.casefold()), value)


def projection(text, tickers):
    """Parse the opening reported action, then bind any optional supporting facts.

    This is a factual summary, not a translation of every paragraph. Only an
    explicit company cashtag and grammatical broker actor establish identity.
    Unrecognized or competing clauses stay private with a visible reason code.
    """
    source = re.sub(r'https?://\S+', '', text).strip()
    source = re.sub(r'^[^A-Za-z0-9$]+', '', source)
    header = source.split('\n\n')[0]
    cashtags = set(re.findall(r'\$('+TICKER+r')(?![\w.])', source))
    if len(cashtags) != 1 or not cashtags.issubset(set(tickers)):
        return None, 'ambiguous-subject'
    ticker = next(iter(cashtags))
    company = r"(?P<company>[A-Za-z][A-Za-z0-9 .&'’()-]{0,79}?)?\s*\$(?P<ticker>"+TICKER+r')'
    broker = r'(?P<firm>'+FIRM+r')'
    grade = r'(?P<rating>'+RATING+r')'
    patterns = [
        ('initiation', r'^'+broker+r'\s+initiat(?:ed|es)\s+(?:coverage (?:of|on)\s+)?'+company+r'\s+(?:with an? |at )'+grade+r'(?: rating)?\b'),
        ('initiation', r'^'+company+r'\s+initiat(?:ed|es) with an? '+grade+r'(?: rating)? at '+broker+r'\b'),
        ('upgrade', r'^'+broker+r'\s+upgrad(?:ed|es)\s+'+company+r'\s+to '+grade+r' from (?P<previous>'+RATING+r')\b'),
        ('downgrade', r'^'+broker+r'\s+downgrad(?:ed|es)\s+'+company+r'\s+to '+grade+r' from (?P<previous>'+RATING+r')\b'),
        ('upgrade', r'^'+company+r'\s+upgrad(?:ed|es) to '+grade+r' from (?P<previous>'+RATING+r') at '+broker+r'\b'),
        ('downgrade', r'^'+company+r'\s+downgrad(?:ed|es) to '+grade+r' from (?P<previous>'+RATING+r') at '+broker+r'\b'),
        ('top-pick', r'^'+company+r'\s+(?P<selection>reinstated|restored|named|selected) as (?:a )?Top Pick(?P<sector> in semis| in semiconductors)? at '+broker+r'\b'),
        ('conviction-list', r'^'+company+r'\s+added to (?P<region>US )?Conviction List at '+broker+r'\b'),
        ('tactical-list', r'^'+company+r"\s+added to (?P<quarter>Q[1-4] )?['\"]?Tactical Ideas list['\"]? at "+broker+r'\b'),
    ]
    chosen = [(action, match) for action, pattern in patterns
              if (match := re.search(pattern, header, re.I))]
    if RETRACTION.search(source):
        return None, 'retracted-or-corrected-evidence'
    if re.search(r"\b(?:not|never|no longer|untrue)\b|n[’']t\b",source,re.I):
        return None, 'ambiguous-action'
    if len(chosen) != 1:
        if re.search(r'\b(?:reiterat\w*|maintain\w*|keeps?|has)\b', header, re.I) and not re.search(r'\b(?:initiat\w*|upgrad\w*|downgrad\w*|Top Pick|Conviction|Tactical)\b', header, re.I):
            return None, 'no-new-analyst-action'
        return None, 'unsupported-analyst-syntax'
    action, match = chosen[0]
    parts = match.groupdict()
    if parts['ticker'].upper() != ticker:
        return None, 'ambiguous-subject'
    firm = canonical_firm(parts['firm'])
    mentioned_firms = {canonical_firm(m[0]).casefold() for m in re.finditer(r'\b'+FIRM+r'\b', source, re.I)}
    if mentioned_firms != {firm.casefold()}:
        return None, 'ambiguous-firms'
    # Do not turn negated/hypothetical or mixed actions into affirmative news.
    remainder = source[match.end():]
    if re.search(r"\b(?:not|never|denies?|denied|might|may|could|would|if)\b[^.!?\n]{0,70}\b(?:initiat\w*|upgrad\w*|downgrad\w*|top[ -]pick|conviction|tactical)\b", source, re.I):
        return None, 'ambiguous-action'
    verbs = set(re.findall(r'\b(upgrad\w*|downgrad\w*|initiat\w*)\b', remainder, re.I))
    if any(not verb.lower().startswith({'initiation':'initiat','upgrade':'upgrad','downgrade':'downgrad'}.get(action,'~')) for verb in verbs):
        return None, 'ambiguous-action'
    # A repeated body action must retain the same subject name, not silently
    # attach the headline ticker to another company in a second paragraph.
    subject = compact(parts.get('company') or '').casefold()
    for echo in re.finditer(r'\b'+FIRM+r'\s+initiat(?:ed|es) coverage (?:of|on) (?P<name>[^$\n]{1,80}?) with an? '+RATING+r'\b', remainder, re.I):
        if not subject or compact(echo.group('name')).casefold() != subject:
            return None, 'ambiguous-subject'
    facts = {'ticker':ticker,'firm':firm,'action':action}
    if parts.get('selection'):
        facts['restored'] = parts['selection'].lower() in {'reinstated','restored'}
    if parts.get('sector'):
        facts['sector'] = 'semiconductors'
    if parts.get('region'):
        facts['region'] = 'US'
    if parts.get('quarter'):
        facts['quarter'] = parts['quarter'].strip().upper()
    # Supporting ratings/targets must occur in a controlled clause tied to
    # this action. A free-floating dollar amount elsewhere is not attribution.
    amount = r'([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?![0-9]|,[0-9]|\.[0-9])'
    money_target = r'\$'+amount+r'\s+(?:price target|target price)\b'
    target_suffix = r'(?:\s+(?:and|with)\s+(?:an?\s+)?'+money_target+r')?'
    clause_start = r'(?:^|(?<=[.!?\n])\s*)'
    clause_end = r'(?: on (?:the )?shares)?[ \t]*(?=[.!?\n]|$|,\s+(?:which|saying|expecting|citing)\b)'
    evidence = [source[:match.end()]]
    suffix = re.match(target_suffix, source[match.end():], re.I)
    if suffix:
        evidence[0] += suffix[0]
    primary_end = re.match(clause_end,source[len(evidence[0]):],re.I)
    if not primary_end:
        return None, 'ambiguous-action'
    evidence[0] += primary_end[0]
    subject_pattern = re.escape(compact(parts.get('company') or ''))
    grade_clause = r'(?:an? )?'+RATING+r' rating(?: on (?:the )?shares)?'
    support_patterns = []
    if subject_pattern:
        support_patterns += [
            clause_start+re.escape(firm)+r' initiat(?:ed|es) coverage (?:of|on) '+subject_pattern+r' with an? '+RATING+r' rating'+target_suffix+clause_end,
            clause_start+re.escape(firm)+r"(?: analyst [A-Za-z .’'-]{2,80})? added "+subject_pattern+r" to (?:its|the firm's) [^.!?\n]{1,100}? while keeping "+grade_clause+target_suffix+clause_end,
        ]
    evidence += [m[0] for pattern in support_patterns for m in re.finditer(pattern, source, re.I)]
    supported = '\n'.join(evidence)
    # Only controlled explicit broker+subject clauses can supplement the
    # headline. Pronouns in later commentary are insufficient evidence: omit
    # those optional facts rather than assigning another company's values.
    spans = [(0, len(evidence[0]))]
    spans += [m.span() for pattern in support_patterns for m in re.finditer(pattern,source,re.I)]
    ratings = [m[1] for m in re.finditer(r'\b('+RATING+r') rating\b', source, re.I)
               if any(a <= m.start() and m.end() <= b for a,b in spans)]
    if parts.get('rating'):
        ratings.append(parts['rating'])
    normalized_ratings = {compact(r).title().replace('Equal Weight','Equal-Weight') for r in ratings}
    if len(normalized_ratings) > 1:
        return None, 'ambiguous-rating'
    if normalized_ratings:
        facts['rating'] = next(iter(normalized_ratings))
        facts['ratingUnchanged'] = bool(re.search(r'\b(?:keeping|keeps?|maintain(?:s|ed|ing)?|reiterat(?:es|ed|ing)) (?:an? |its )?'+re.escape(facts['rating'])+r' rating\b', supported,re.I))
    if parts.get('previous'):
        facts['previousRating'] = compact(parts['previous']).title().replace('Equal Weight','Equal-Weight')
        if facts.get('rating') == facts['previousRating']:
            return None, 'ambiguous-rating'
    for label in signals.PRICE_TARGET_LABEL.finditer(header):
        if not any(a <= label.start() and label.end() <= b for a,b in spans):
            return None, 'ambiguous-target'
    targets = []
    for pattern in (money_target,r'\b(?:price target|target price|PT)\s+(?:(?:of|at|to)\s*)?\$'+amount):
        for m in re.finditer(pattern,source,re.I):
            if any(a <= m.start() and m.end() <= b for a,b in spans):
                targets.append(m[1])
    values = {Decimal(v.replace(',','')) for v in targets}
    if len(values) > 1 or any(not 0 < v <= 100000 for v in values):
        return None, 'ambiguous-target'
    if values:
        value = next(iter(values))
        facts['target'] = format(value.normalize(),'f')
        facts['targetUnchanged'] = bool(re.search(r'\b(?:keeps?|keeping|maintain(?:s|ed|ing)?|reiterat(?:es|ed|ing)) (?:its |an? )?\$'+amount+r' (?:price target|target price)\b',supported,re.I))
    return facts, 'eligible'


def evidence_rows(db, now):
    return db.execute('''SELECT e.*, d.sha AS current_sha,d.title AS document_title,
      d.text AS body FROM signal_events e LEFT JOIN signal_documents d
      ON e.source_id=d.source_id AND e.url=d.url
      WHERE e.source_id IN (?,?) AND julianday(e.published_at)
      BETWEEN julianday(?) AND julianday(?)
      ORDER BY julianday(e.published_at) DESC,julianday(e.observed_at),e.id''',
      (*SOURCE_IDS, (now-timedelta(days=7)).isoformat(), now.isoformat()))


def assess(row, source, now):
    if not source or source.get('format') != 'x-api':
        return None, 'source-not-approved'
    url = reconciliation.safe_reference(row['url'], source)
    if not url or url.split('/')[3].lower() not in ACCOUNTS:
        return None, 'source-not-approved'
    if row['event_kind'] not in {'new', 'changed', 'baseline'}:
        return None, 'event-kind-not-published'
    if not row['current_sha'] or row['current_sha'] != row['sha']:
        return None, 'superseded-or-missing-revision'
    body = row['body']
    if not isinstance(body, str) or not 1 <= len(body) <= MAX_BODY or row['truncated']:
        return None, 'truncated-or-missing-evidence'
    if (row['title'] != row['document_title'] or '\0' in body
            or hashlib.sha256((row['document_title']+'\n'+body).encode()).hexdigest() != row['sha']):
        return None, 'evidence-integrity-mismatch'
    clock_pattern = r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})'
    if any(not isinstance(row[key],str) or not re.fullmatch(clock_pattern,row[key]) for key in ('published_at','observed_at')):
        return None, 'invalid-source-clock'
    published = reconciliation.instant(row['published_at'])
    observed = reconciliation.instant(row['observed_at'])
    if not published or not observed or not now-timedelta(days=7) <= published <= observed <= now:
        return None, 'invalid-source-clock'
    try:
        tickers = json.loads(row['tickers_json'])
        if (not isinstance(tickers, list) or not tickers
                or any(not isinstance(t, str) or not re.fullmatch(TICKER, t) for t in tickers)):
            return None, 'invalid-subject-evidence'
    except (TypeError, ValueError):
        return None, 'invalid-subject-evidence'
    if RETRACTION.search(body):
        return None, 'retracted-or-corrected-evidence'
    facts, reason = projection(body, tickers)
    if not facts:
        return None, reason
    return {**facts, 'id': str(row['id']), 'publishedAt': row['published_at'],
            'observedAt': row['observed_at']}, 'eligible'


def public_copy(facts):
    action = facts['action']
    ja, en = ACTION_LABELS[action]
    firm, ticker = facts['firm'], facts['ticker']
    if facts.get('restored'):
        ja, en = 'Top Pickに再指定', 'restores as a Top Pick'
    title_ja = f'{firm}、{ticker}の{ja}と報道' if action in {'initiation','upgrade','downgrade'} else f'{firm}、{ticker}を{ja}と報道'
    title_en = f'Reported: {firm} {en} {ticker}' if action in {'initiation','upgrade','downgrade'} else f'Reported: {firm} {en.replace(" as a Top Pick", "").replace(" to its Conviction List", "").replace(" to its Tactical Ideas List", "")} {ticker}'
    if action == 'top-pick':
        title_en = f'Reported: {firm} {"restores" if facts.get("restored") else "names"} {ticker} as a Top Pick'
    elif action in {'conviction-list','tactical-list'}:
        title_en = f'Reported: {firm} adds {ticker} to its {"Conviction List" if action == "conviction-list" else "Tactical Ideas List"}'
    ja_parts, en_parts = [title_ja+'。'], [title_en+'.']
    if facts.get('sector'):
        ja_parts.append('半導体分野のTop Pick。')
        en_parts.append('Top Pick in semiconductors.')
    if facts.get('region'):
        ja_parts.append('米国株のConviction List。')
        en_parts.append('US Conviction List.')
    if facts.get('quarter'):
        ja_parts.append(f'{facts["quarter"]}のTactical Ideas List。')
        en_parts.append(f'{facts["quarter"]} Tactical Ideas List.')
    if facts.get('rating'):
        rating, old = facts['rating'], facts.get('previousRating')
        ja_parts.append(f'投資判断：{old}から{rating}に変更。' if old else f'投資判断：{rating}{"を維持" if facts.get("ratingUnchanged") else ""}。')
        en_parts.append(f'Rating: {old} to {rating}.' if old else f'Rating: {rating}{" (unchanged)" if facts.get("ratingUnchanged") else ""}.')
    if facts.get('target'):
        target = facts['target']
        ja_parts.append(f'目標株価：${target}{"を維持" if facts.get("targetUnchanged") else ""}。')
        en_parts.append(f'Price target: ${target}{" (unchanged)" if facts.get("targetUnchanged") else ""}.')
    return {key:facts[key] for key in ('id','ticker','firm','action','publishedAt','observedAt')} | {
        'titleJa': title_ja, 'titleEn': title_en, 'bodyJa': ''.join(ja_parts), 'bodyEn': ' '.join(en_parts)}


def action_key(facts):
    # Optional rating/target context does not create a second list addition.
    # Scope and period remain identity; different explicit context is checked
    # separately below rather than being silently merged.
    return (facts['ticker'], facts['firm'].casefold(), facts['action'], bool(facts.get('restored')),
            facts.get('sector'), facts.get('region'), facts.get('quarter'),
            reconciliation.instant(facts['publishedAt']).date().isoformat())


def observation_order(facts):
    return (reconciliation.instant(facts['publishedAt']),
            reconciliation.instant(facts['observedAt']),int(facts['id']))


def publication_groups(records):
    """Merge only identical facts or one unambiguous optional-fact subset.

    A partial report must never bridge contradictory fully explicit reports.
    Groups retain source rows; public copy/clocks come from one actual report,
    never a composite of facts inferred across sources.
    """
    optional = ('rating','previousRating','target')
    groups = {}
    for record in sorted((r for r in records if r[1]),
                         key=lambda r:(-sum(r[1].get(k) is not None for k in optional),
                                       observation_order(r[1]))):
        facts = record[1]
        attributes = {key:facts[key] for key in optional if facts.get(key) is not None}
        candidates = groups.setdefault(action_key(facts),[])
        exact = [group for group in candidates if group['attributes']==attributes]
        compatible = exact or [group for group in candidates
                               if all(group['attributes'].get(key)==value for key,value in attributes.items())]
        if len(compatible)==1:
            compatible[0]['records'].append(record)
        else:
            # Zero matches means new information. Multiple matches means the
            # partial evidence cannot identify which conflicting report it is.
            candidates.append({'attributes':attributes,'records':[record]})
    return [group['records'] for candidates in groups.values() for group in candidates]


def origin_heads(db, sources, now):
    """One external post has one head across migrated/grouped source routes.

    Older deployments retained unselected corrections without updating the
    document table. Resolve both stores so those corrections still revoke an
    old publication. Conflicting equally recent evidence fails closed.
    """
    approved = {s['id']:s for s in sources if s['id'] in SOURCE_IDS}
    heads = {}
    rows = list(db.execute('SELECT source_id,url,sha,last_seen_at FROM signal_documents WHERE source_id IN (?,?)',SOURCE_IDS))
    rows += list(db.execute('SELECT source_id,url,sha,last_seen_at FROM signal_x_acquisition WHERE source_id IN (?,?)',SOURCE_IDS))
    for row in rows:
        url = reconciliation.safe_reference(row['url'],approved.get(row['source_id']))
        if not url or url.split('/')[3].lower() not in ACCOUNTS:
            continue
        key = url.casefold()
        seen = reconciliation.instant(row['last_seen_at'])
        # Invalid/future heads are evidence of a conflicting clock, never a
        # reason to fall back to an old action whose currency is unestablished.
        order = seen or datetime.max.replace(tzinfo=timezone.utc)
        digest = row['sha'] if seen and seen <= now else None
        previous = heads.get(key)
        if not previous or order > previous[0]:
            heads[key] = order, digest
        elif order == previous[0] and digest != previous[1]:
            heads[key] = order, None
    return {url:value[1] for url,value in heads.items()}


def assessments(db, sources, now):
    approved = {s['id']:s for s in sources if s['id'] in SOURCE_IDS}
    seen = set()
    heads = origin_heads(db,sources,now)
    for row in evidence_rows(db, now):
        identity = row['source_id'], row['url'], row['sha']
        if identity in seen:
            continue
        seen.add(identity)
        # Unrelated earnings posts do not inflate analyst rejection counts.
        if not CUE.search((row['body'] or '')+' '+(row['title'] or '')):
            continue
        if heads.get(row['url'].casefold()) != row['sha']:
            yield row, None, 'superseded-or-missing-revision'
            continue
        facts, reason = assess(row, approved.get(row['source_id']), now)
        yield row, facts, reason


def run_once(path, sources=signals.SOURCES, now=None):
    now = now or datetime.now(timezone.utc)
    with monitor.connect(path) as db:
        schema(db)
        db.commit()
        count = 0
        with db:
            db.execute('BEGIN IMMEDIATE')
            for row, facts, _ in assessments(db, sources, now):
                if not facts:
                    continue
                payload = json.dumps(public_copy(facts), ensure_ascii=False, sort_keys=True)
                identity = row['source_id'], row['url'], row['sha']
                prior = db.execute('SELECT payload,policy_version FROM analyst_news_publications WHERE source_id=? AND url=? AND sha=?', identity).fetchone()
                if prior and prior['payload'] == payload and prior['policy_version'] == POLICY_VERSION:
                    continue
                db.execute('''INSERT INTO analyst_news_publications VALUES(?,?,?,?,?,?,?)
                  ON CONFLICT(source_id,url,sha) DO UPDATE SET event_id=excluded.event_id,
                  policy_version=excluded.policy_version,payload=excluded.payload,public_at=excluded.public_at''',
                  (*identity, row['id'], POLICY_VERSION, payload, now.isoformat()))
                count += 1
        return {'state':'done' if count else 'idle','published':count}


def active_publications(db, sources, now):
    for row, facts, reason in assessments(db, sources, now):
        saved = None
        if facts:
            saved = db.execute('SELECT payload,public_at FROM analyst_news_publications WHERE source_id=? AND url=? AND sha=? AND policy_version=?',
              (row['source_id'],row['url'],row['sha'],POLICY_VERSION)).fetchone()
            public_at = reconciliation.instant(saved['public_at']) if saved else None
            if (not saved or not public_at or not reconciliation.instant(facts['observedAt']) <= public_at <= now
                    or saved['payload'] != json.dumps(public_copy(facts), ensure_ascii=False, sort_keys=True)):
                saved = None
        yield row, facts, reason, saved


def public_feed(db, sources=signals.SOURCES, now=None, limit=30):
    now = now or datetime.now(timezone.utc)
    schema(db)
    items = []
    for group in publication_groups(list(active_publications(db,sources,now))):
        saved = [record[1] for record in group if record[3]]
        if saved:
            # Preserve the earliest actual report and its acquisition clock.
            # Later/partial copies must never make the same action look new.
            facts = min(saved,key=observation_order)
            items.append((observation_order(facts),public_copy(facts)))
    return [record[1] for record in sorted(items,key=lambda record:record[0],reverse=True)][:limit]


def diagnostics(db, sources=signals.SOURCES, now=None):
    now = now or datetime.now(timezone.utc)
    schema(db)
    records = list(active_publications(db,sources,now))
    rejected = Counter(reason for _,facts,reason,_ in records if not facts)
    groups = publication_groups(records)
    published = sum(any(record[3] for record in group) for group in groups)
    return {'eligible':len(groups),'published':published,
            'pending':len(groups)-published,'excluded':sum(rejected.values()),
            'rejectionReasons':dict(sorted(rejected.items()))}
