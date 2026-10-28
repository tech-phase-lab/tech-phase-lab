"""Small, source-bound related-company claim grammar.

Relevance is optional enrichment, never an actor substitution. This offline adapter does not
fetch, spend, or publish. It consumes every non-link clause before admitting a
candidate. Anything outside the explicitly typed grammar remains review-only.
Names are literal source data; neither post IDs nor company allowlists decide
admission. Publication uses source-derived bilingual copy, not model actor maps.
"""
import re

VERSION = 1
FAILURE = 'changed-related-company-claim'
POLICY = """For relatedSubject contexts, the identified ticker is a related company, not necessarily the actor. relatedSubject.subject is the literal actor and relations describe only source-explicit backing or historical signed agreements. Evaluate the whole source's material business relevance using these relationships. Never turn an investor/backer/customer/counterparty into the actor. Every clause has source-derived structured claims. After your materiality decision, the application renders those claims and preserves your original response privately. Preserve planned release, expected competition, backing, and prior agreement status. Do not add or remove facts. If the source does not substantiate material business relevance or its typed context is unsupported, return review with facts=[]."""
NAME = r"[A-Z][A-Za-z0-9]*(?:[ .&'’\-][A-Z][A-Za-z0-9]*){0,4}"
PRODUCTS = {
    'AI model': ('AIモデル', 'AI models'),
    'model': ('モデル', 'models'),
    'chip': ('チップ', 'chips'),
    'processor': ('プロセッサー', 'processors'),
    'software platform': ('ソフトウェア基盤', 'software platforms'),
    'cloud service': ('クラウドサービス', 'cloud services'),
}
MARKETS = {'Chinese': '中国', 'American': '米国', 'European': '欧州',
           'Japanese': '日本', 'South Korean': '韓国'}
ACTIONS = {
    'is preparing to release': ('preparing-release', 'is preparing for the release of', 'の公開に向けて準備している'),
    'plans to release': ('planned-release', 'plans the release of', 'を公開する計画だ'),
    'intends to release': ('intended-release', 'intends to make available', 'を公開する意向だ'),
    'has released': ('released', 'has made available', 'を公開した'),
    'released': ('released', 'has made available', 'を公開した'),
}
FEATURES = {'': ('', ''), 'open-weight ': ('open-weight ', 'オープンウェイトの'),
            'open-source ': ('open-source ', 'オープンソースの')}
AGREEMENT_KINDS = {'compute': '計算資源', 'supply': '供給', 'licensing': 'ライセンス'}
_PRODUCT = '|'.join(map(re.escape, sorted(PRODUCTS, key=len, reverse=True)))
_RIVALS = '|'.join(map(re.escape, sorted({pair[1] for pair in PRODUCTS.values()}, key=len, reverse=True)))
_ACTION = '|'.join(map(re.escape, sorted(ACTIONS, key=len, reverse=True)))
_MARKET = '|'.join(map(re.escape, sorted(MARKETS, key=len, reverse=True)))
# This is whole-claim recognition: do not strip punctuation, qualifiers, or
# unknown tails to make a partial match look supported.
PRODUCT = re.compile(
    r'(?P<backer>'+NAME+r')-backed (?P<subject>'+NAME+r') '
    r'(?P<action>'+_ACTION+r') a (?P<new>new )?'
    r'(?P<feature>open-weight |open-source )?(?P<product>'+_PRODUCT+r')'
    r'(?: expected to compete with (?P<rank>top|leading) (?P<market>'+_MARKET+r')'
    r'(?: (?P<flag>[\U0001F1E6-\U0001F1FF]{2}))? (?P<rivals>'+_RIVALS+r'))?\.')
AGREEMENT = re.compile(
    r'(?:Note: )?(?P<subject>'+NAME+r') has signed (?P<scale>major|significant) '
    r'(?P<kind>compute|supply|licensing) (?P<noun>deals|agreements|contracts)'
    r'(?P<recent> recently)? with (?P<parties>'+NAME+r'(?: and '+NAME+r')?)\.')
FLAGS = {'Chinese': '🇨🇳', 'American': '🇺🇸', 'European': '🇪🇺', 'Japanese': '🇯🇵', 'South Korean': '🇰🇷'}


def _ticker(name, aliases):
    matches = [ticker for ticker, names in aliases.items()
               if name.casefold() in {alias.casefold() for alias in names}]
    return matches[0] if len(matches) == 1 else None


def _context(subject, kind, relations, claim, copy):
    return {'version': VERSION, 'subject': subject, 'claimKind': kind,
            'relations': relations, 'claim': claim, 'safeParaphrase': copy}


def prepare(body, approved, retained_tickers, aliases):
    """Bind the entire supported source to one actor and explicit relevance.

    Link-only suffixes are non-claim source transport; the original body and SHA
    stay intact, and each evidence quote is an exact original substring.
    """
    if not isinstance(body, str):
        return None
    text = body.strip()
    text = re.sub(r'(?:\s+https?://[^\s]+)+$', '', text)
    parts = re.split(r'\n\s*\n', text)
    if not 1 <= len(parts) <= 2 or any(not 16 <= len(part) <= 800 for part in parts):
        return None
    product = PRODUCT.fullmatch(parts[0])
    if not product:
        return None
    data = product.groupdict()
    subject, backer = data['subject'], data['backer']
    if subject.casefold() == backer.casefold():
        return None
    if data['rivals'] and data['rivals'] not in ({'models', 'AI models'} if data['product'] == 'AI model' else {PRODUCTS[data['product']][1]}):
        return None
    if data['flag'] and FLAGS[data['market']] != data['flag']:
        return None
    if data['feature'] and data['product'] not in {'AI model', 'model', 'software platform'}:
        return None
    backer_ticker = _ticker(backer, aliases)
    relations = [{'kind': 'backer', 'entity': backer, 'ticker': backer_ticker, 'subject': subject}]
    status, action_en, action_ja = ACTIONS[data['action']]
    feature_en, feature_ja = FEATURES[data['feature'] or '']
    object_en = ('new ' if data['new'] else '') + feature_en + data['product']
    object_ja = ('新しい' if data['new'] else '') + feature_ja + PRODUCTS[data['product']][0]
    en = f'{subject}, with backing from {backer}, {action_en} a {object_en}.'
    ja = f'{backer}の支援を受ける{subject}は、{object_ja}{action_ja}。'
    if data['market']:
        en += f" The {data['product']} is expected to rival leading {data['market']} {data['rivals']}."
        ja += f" この{PRODUCTS[data['product']][0]}は{MARKETS[data['market']]}の主要な{('モデル' if data['rivals']=='models' else PRODUCTS[data['product']][0])}と競合すると見込まれている。"
    claim = {'action': 'release', 'status': status, 'product': data['product'],
             'new': bool(data['new']), 'feature': (data['feature'] or '').strip(),
             'competition': {'status': 'expected', 'rank': 'leading', 'market': data['market']} if data['market'] else None}
    units = [{'quote': parts[0], 'actor': 'report',
              'relatedSubject': _context(subject, 'product-development', relations[:], claim, {'en': en, 'ja': ja})}]
    if len(parts) == 2:
        agreement = AGREEMENT.fullmatch(parts[1])
        if not agreement or agreement['subject'] != subject:
            return None
        counterparties = agreement['parties'].split(' and ')
        if len({name.casefold() for name in counterparties + [subject]}) != len(counterparties) + 1:
            return None
        contract_relations = [{'kind': 'signed-agreement-counterparty', 'entity': name,
                               'ticker': _ticker(name, aliases), 'subject': subject}
                              for name in counterparties]
        relations += contract_relations
        recently_en = 'recently ' if agreement['recent'] else ''
        recently_ja = '最近、' if agreement['recent'] else ''
        en = (f'{subject} has {recently_en}signed significant agreements for '
              f"{agreement['kind']} with {agreement['parties']}.")
        ja = (f'{subject}は{recently_ja}' + 'と'.join(counterparties)
              + f"との{AGREEMENT_KINDS[agreement['kind']]}に関する大型契約を締結している。")
        units.append({'quote': parts[1], 'actor': 'report',
                      'relatedSubject': _context(subject, 'historical-agreement', contract_relations,
                                                {'action': 'agreement', 'status': 'signed',
                                                 'kind': agreement['kind'], 'scale': 'significant',
                                                 'recent': bool(agreement['recent'])}, {'en': en, 'ja': ja})})
    relevant = []
    for relation in relations:
        ticker = relation['ticker']
        if ticker and ticker in approved and ticker in retained_tickers and ticker not in relevant:
            relevant.append(ticker)
    for index, unit in enumerate(units):
        unit.update(id=str(index), ticker=None)
    return {'ticker': None, 'related_tickers': sorted(relevant),
            'related_subject': subject, 'units': units}


def validate(item, unit):
    """The caller re-derives contexts from current proven source at every read.

    Exact source-derived copy is deliberate here: open-ended paraphrase of an
    untracked actor plus multiple relations is outside this adapter's grammar.
    Do not trust a model-supplied graph, role, relationship, or status field.
    """
    context = unit.get('relatedSubject')
    if not isinstance(context, dict) or context.get('version') != VERSION:
        raise ValueError(FAILURE)
    expected = context.get('safeParaphrase')
    if not isinstance(expected, dict) or any(item.get(lang) != expected.get(lang) for lang in ('en', 'ja')):
        raise ValueError(FAILURE)


MARKER = 'sourceClaimDerivation'
AUDIT_TABLE = 'source_news_claim_derivations'


def structured(row):
    return bool(row.get('source_news') and row.get('units')
                and all('relatedSubject' in unit for unit in row['units']))


def preparation_title(row):
    """An informative title only for the fully proven preparation claim."""
    if not structured(row):return None
    context=row['units'][0]['relatedSubject']
    claim=context.get('claim',{})
    if (context.get('claimKind')!='product-development'
            or claim.get('status')!='preparing-release' or claim.get('action')!='release'
            or claim.get('product') not in PRODUCTS):
        return None
    subject=context['subject'];product=claim['product']
    return {'en':subject+' prepares '+('new ' if claim['new'] else '')+product+' release',
            'ja':subject+'、'+('新' if claim['new'] else '')+PRODUCTS[product][0]+'の公開を準備'}


def encoded(value):
    import json
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def hashed(value):
    import hashlib
    return hashlib.sha256(value.encode()).hexdigest()


def render(value, row):
    """Source-corrected rendering after a bounded materiality decision.

    Retain the model's original response in the transaction audit. A faithful
    variation is not an error; none of its wording supplies source facts.
    """
    if (not structured(row) or value.get('disposition') != 'publish'
            or value.get('reason') != 'material-company-development'
            or not isinstance(value.get('facts'), list) or len(value['facts']) != len(row['units'])):
        raise ValueError(FAILURE)
    for item, unit in zip(value['facts'], row['units']):
        if (not isinstance(item, dict) or set(item) != {'ja', 'en', 'evidenceId'}
                or item['evidenceId'] != unit['id']
                or any(not isinstance(item[lang], str) or not 1 <= len(item[lang]) <= 600 for lang in ('ja', 'en'))):
            raise ValueError(FAILURE)
    return {**value, 'facts': [{**unit['relatedSubject']['safeParaphrase'], 'evidenceId': unit['id']}
                              for unit in row['units']]}


def source_snapshot(row):
    return {key: row.get(key) for key in ('id', 'source_id', 'url', 'sha', 'body_sha', 'body',
            'published_at', 'observed_at', 'ticker', 'source_news', 'related_tickers', 'related_subject', 'units')}


def record(db, row, original_raw, note, lease, started, public):
    db.execute('INSERT OR IGNORE INTO official_research_attempt_body_proofs VALUES(?,?,?)',
               (lease,row['sha'],row['body_sha']))
    db.execute('''CREATE TABLE IF NOT EXISTS source_news_claim_derivations(
      event_id INTEGER NOT NULL, sha TEXT NOT NULL, body_sha TEXT NOT NULL,
      lease TEXT NOT NULL, policy_version INTEGER NOT NULL, source_snapshot TEXT NOT NULL,
      original_response TEXT NOT NULL, validated_payload_sha TEXT NOT NULL,
      started_at TEXT NOT NULL, public_at TEXT NOT NULL,
      PRIMARY KEY(event_id,sha,body_sha,lease))''')
    db.execute('INSERT INTO source_news_claim_derivations VALUES(?,?,?,?,?,?,?,?,?,?)',
               (row['id'], row['sha'], row['body_sha'], lease, VERSION, encoded(source_snapshot(row)),
                original_raw, hashed(encoded(note)), started, public))


def closed_attempt(db, row):
    """Damage to derived copy/audit never authorizes another paid attempt.

    Source SHA is re-proven by normal candidate validation. A genuinely new
    source revision has a different SHA and may use the normal path.
    """
    if not structured(row):return False
    job=db.execute('SELECT * FROM official_research_jobs WHERE event_id=?',(row['id'],)).fetchone()
    if not job or job['sha']!=row['sha'] or job['state']!='done':return False
    call=db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?',(job['lease'],)).fetchone()
    return bool(call and call['state']=='done' and call['sha']==row['sha']
                and call['source_id']=='research:'+row['source_id'])


def recorded(db, row):
    if not structured(row) or not db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (AUDIT_TABLE,)).fetchone():
        return False
    return bool(db.execute('SELECT 1 FROM source_news_claim_derivations WHERE event_id=? AND sha=? AND body_sha=?',
                           (row['id'], row['sha'], row['body_sha'])).fetchone())


def publication_valid(db, row, publication, note):
    if not recorded(db, row):
        return False
    import json
    for audit in db.execute('SELECT * FROM source_news_claim_derivations WHERE event_id=? AND sha=? AND body_sha=?',
                            (row['id'], row['sha'], row['body_sha'])):
        try:
            original = json.loads(audit['original_response'])
            rendered = render(original, row)
            call = db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?', (audit['lease'],)).fetchone()
            if (audit['policy_version'] == VERSION and audit['source_snapshot'] == encoded(source_snapshot(row))
                    and audit['validated_payload_sha'] == hashed(encoded(note))
                    and audit['started_at'] == publication['started_at'] and audit['public_at'] == publication['public_at']
                    and call and call['source_id'] == 'research:' + row['source_id']
                    and call['sha'] == row['sha'] and call['state'] == 'done'
                    and all(item[lang] == fact[lang] for item, fact in zip(note['facts'], rendered['facts']) for lang in ('ja', 'en'))):
                return True
        except (ValueError, KeyError, TypeError):
            continue
    return False
