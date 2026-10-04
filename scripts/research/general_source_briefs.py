"""Source-validated brief delivery from one saved assessment, with no new call."""
from datetime import datetime,timezone
import json
import re

import general_source_news as news

POLICY='source-validated-brief-v1'
TITLE_SUFFIXES={'en':' (brief; details awaiting review)','ja':'（短報・詳細確認中）'}
CONNECTOR=re.compile(r'^(?:with|noting|whereas|while|but|compared\s+(?:with|to)|although|however|unless|if|except)\b',re.I)
ANAPHOR=re.compile(r'^(?:it|its|they|their|this|that|these|those|such|the former|the latter)\b|\b(?:respectively|aforementioned)\b',re.I)
CONDITION=re.compile(r'\b(?:if|unless|provided|providing|assuming|assum\w*|depend\w*|conditional\w*|contingent\w*|'
                     r'subject\s+to|requires?|reli(?:es|ant)|rely|hinges?|presuppos\w*|except|exclud\w*)\b',re.I)
REFERENCE=re.compile(r'\b(?:the|this|that|these|those|its|their)\s+(?:[a-z]+\s+){0,2}'
                     r'(?:forecast|estimate|projection|outlook|assumption|scenario|guidance|thesis|premise|outcome|view)s?\b|'
                     r'[’\']s[^.!?;\n]{0,60}\b(?:forecast|estimate|projection|outlook|assumption|scenario|guidance|thesis|premise|outcome|view)s?\b',re.I)


def independent_metric_entry(quote,ticker):
    """Recognize a closed metric/product/period label, with no residual prose."""
    match=re.fullmatch(r'([^:\n]{1,120}):\s*[+−-]?\d+(?:\.\d+)?[%％](?:\s+YoY)?\.?',quote,re.I)
    if not match:return False
    label=match[1]
    for alias in sorted([ticker,*news.signals.ALIASES.get(ticker,[])],key=len,reverse=True):
        label=re.sub(r'(?<![A-Za-z0-9_])\$?'+re.escape(alias)+r'(?![A-Za-z0-9_])',' ',label,flags=re.I)
    label=re.sub(r'\b(?:FY|CY)\s*\d{2,4}\b|\b(?:19|20|21)\d{2}\b',' ',label,flags=re.I)
    for name,patterns in news.broker_commentary.METRICS.items():
        label=re.sub(patterns[0],' ',label,flags=re.I)
    return not re.sub(r'[\s()\[\],/&-]','',label)


def source_dependencies(row):
    """Use source paragraph spans, never model prose, as inseparable blocks.

    Unknown context/conditions disable the subset fallback. They still reach
    the normal full assessment and remain visible for review if that fails.
    """
    body=row['body'];units=row['units']
    if CONDITION.search(body):return None
    contextless=body
    for unit in units:
        context=unit.get('brokerCommentary',{}).get('context')
        if context:contextless=contextless.replace(context['quote'],'')
    if REFERENCE.search(contextless):return None
    ends=[(m.start(),m.end()) for m in re.finditer(r'\n\s*\n',body)]
    starts=[0]+[end for _,end in ends]
    bounds=list(zip(starts,[start for start,_ in ends]+[len(body)]))
    groups={}
    for unit in units:
        if body.count(unit['quote'])!=1:return None
        start=unit.get('brokerCommentary',{}).get('sourceStart',body.find(unit['quote']))
        end=start+len(unit['quote'])
        if body[start:end]!=unit['quote']:return None
        group=next((i for i,(left,right) in enumerate(bounds) if left<=start<end<=right),None)
        if group is None:return None
        groups.setdefault(group,[]).append(unit)
    dependencies={unit['id']:set() for unit in units}
    omittable=set()
    for members in groups.values():
        first=members[0]
        if first.get('brokerCommentary',{}).get('context'):
            # One forecast-list block travels together. Extra prose or an
            # unknown qualification is not a self-contained numeric list.
            if any(not independent_metric_entry(u['quote'],row['ticker']) for u in members):return None
            omittable.update(unit['id'] for unit in members)
        else:
            leader=news.broker_commentary.FIRM.match(first['quote'])
            broker_statement=bool(leader and re.match(r'\s*(?:also\s+)?'+news.broker_commentary.REPORT+r'\b',first['quote'][leader.end():],re.I))
            aliases=[row['ticker'],*news.signals.ALIASES.get(row['ticker'],[])]
            company_statement=any(re.match(r'\$?'+re.escape(alias)+r'(?![A-Za-z0-9_]|[’\']s)',first['quote'],re.I) for alias in aliases)
            actor_statement=first.get('actorGrounding',{}).get('supported') is True
            if not (broker_statement or company_statement or actor_statement):return None
        ids={u['id'] for u in members}
        for unit in members:dependencies[unit['id']]=ids-{unit['id']}
    return dependencies,omittable


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS general_source_briefs(
      event_id INTEGER NOT NULL,sha TEXT NOT NULL,body_sha TEXT NOT NULL,lease TEXT NOT NULL,
      policy TEXT NOT NULL,payload TEXT,checked_at TEXT NOT NULL,started_at TEXT NOT NULL,
      public_at TEXT,generation_ms INTEGER NOT NULL,
      PRIMARY KEY(event_id,sha,body_sha,lease,policy))''')


def build(value,row):
    """Select complete valid claims only; invalid claims never become evidence."""
    if (not row.get('general_source') or not row.get('semantic_assessment')
        or not re.fullmatch(r'https://x\.com/(?:wallstengine|tipranks)/status/\d+',row['url'],re.I)
        or not isinstance(value,dict) or set(value)!={'disposition','reason','facts'}
        or value['disposition']!='publish' or value['reason']!='material-company-development'
        or not isinstance(value['facts'],list) or len(value['facts'])!=len(row['units'])):
        return None
    units=row['units']
    if not 2<=len(units)<=8 or len({unit['quote'] for unit in units})!=len(units):return None
    valid={}
    grouping=source_dependencies(row)
    if grouping is None:return None
    dependencies,omittable=grouping
    for index,(raw,unit) in enumerate(zip(value['facts'],units)):
        if (not isinstance(raw,dict) or set(raw)!={'ja','en','evidenceId'}
            or raw['evidenceId']!=unit['id'] or unit['quote'] not in row['body']):
            return None
        try:
            news.validate_pair(raw,unit)
            quote=unit.get('actorGrounding',{}).get('claimScope',unit['quote'])
            for language in ('ja','en'):
                news.broker_commentary.validate_periods(raw[language],quote,language)
        except (ValueError,TypeError,KeyError):continue
        valid[unit['id']]={'evidenceId':unit['id'],'ja':raw['ja'].strip(),'en':raw['en'].strip()}
    if len(valid)==len(units) or not valid:return None
    def closure(ids):
        ids=set(ids)
        while True:
            remaining={key for key in ids if dependencies[key]<=ids}
            if remaining==ids:return ids
            ids=remaining
    selected=closure(valid)
    # A later narrative may qualify an earlier assertion even when it repeats
    # the company name. Never omit a narrative block based on wording guesses.
    if {unit['id'] for unit in units}-selected-omittable:return None
    def company_core(unit):
        if unit['id'] not in selected:return False
        binding=unit.get('brokerCommentary')
        if binding:return binding.get('scope')=='company' and not ANAPHOR.search(unit['quote'])
        grounding=unit.get('actorGrounding')
        if grounding:return grounding.get('supported') is True
        return (news.broker_commentary._subject(unit['quote'],row['ticker'])
                and not ANAPHOR.search(unit['quote']))
    scope='company'
    if not any(company_core(unit) for unit in units):
        scope='sector'
        selected=closure({unit['id'] for unit in units if unit['id'] in valid
                          and unit.get('brokerCommentary',{}).get('scope')=='sector'})
        # Untickered industry framing requires a complete independent sector
        # assertion, not a list fragment or a missing company's dependent view.
        if not any(unit['id'] in selected and not dependencies[unit['id']]-selected
                   and not CONNECTOR.search(unit['quote']) and not ANAPHOR.search(unit['quote'])
                   and ('context' not in unit['brokerCommentary'] or
                        news.broker_commentary._metrics(unit['quote'],'en')&{'bit','demand','growth','asp','revenue','capacity'})
                   for unit in units):return None
    if not selected or {unit['id'] for unit in units}-selected-omittable:return None
    return {'policy':POLICY,'scope':scope,'facts':[valid[u['id']] for u in units if u['id'] in selected],
            'pendingEvidenceIds':[u['id'] for u in units if u['id'] not in selected]}


def failure_proof(db,row,reference):
    review=news.semantic_review(db,row,reference)
    job=db.execute('SELECT * FROM official_research_jobs WHERE event_id=?',(row['id'],)).fetchone()
    if (not review or review['reason']!='unsubstantiated-model-output' or not job
        or job['state']!='review' or job['sha']!=row['sha'] or job['lease']!=review['lease']):return None
    failure=db.execute('SELECT * FROM official_research_attempt_failures WHERE event_id=? ORDER BY julianday(failed_at) DESC,rowid DESC LIMIT 1',(row['id'],)).fetchone()
    proof=db.execute('SELECT * FROM official_research_attempt_body_proofs WHERE lease=?',(job['lease'],)).fetchone()
    call=db.execute('SELECT * FROM signal_headline_translation_calls WHERE lease=?',(job['lease'],)).fetchone()
    if (not failure or failure['lease']!=job['lease'] or failure['sha']!=row['sha']
        or not proof or proof['source_sha']!=row['sha'] or proof['body_sha']!=row['body_sha']
        or not call or call['state']!='failed' or call['sha']!=row['sha']
        or call['source_id']!='research:'+row['source_id']):return None
    started=datetime.fromtimestamp(call['at'],timezone.utc)
    failed=news.reconciliation.instant(failure['failed_at'])
    if not failed or not news.reconciliation.instant(row['body_at'])<=started<=failed<=reference:return None
    raw=failure['payload']
    if not isinstance(raw,str) or len(raw.encode())>131072:return None
    try:value=json.loads(raw)
    except (ValueError,TypeError):return None
    return failure,value,started,failed


def save_current(db,row,reference):
    """Caller holds the normal worker transaction; original evidence is immutable."""
    proof=failure_proof(db,row,reference)
    if not proof or not news.current_revision(db,row):return False
    failure,value,started,failed=proof
    if db.execute('SELECT 1 FROM general_source_briefs WHERE event_id=? AND sha=? AND body_sha=? AND lease=? AND policy=?',
                  (row['id'],row['sha'],row['body_sha'],failure['lease'],POLICY)).fetchone():return False
    note=build(value,row)
    db.execute('INSERT INTO general_source_briefs VALUES(?,?,?,?,?,?,?,?,?,?)',
               (row['id'],row['sha'],row['body_sha'],failure['lease'],POLICY,
                json.dumps(note,ensure_ascii=False) if note else None,reference.isoformat(),started.isoformat(),
                reference.isoformat() if note else None,round((failed-started).total_seconds()*1000)))
    return note is not None


def revalidate_one(db,reference):
    # Assess at most one unprocessed current failed output per worker pass.
    # An unavailable core claim is recorded once; it never triggers another call.
    rows=news.candidates(db,reference,include_review=True)
    db.commit()
    with db:
        db.execute('BEGIN IMMEDIATE')
        for row in rows:
            proof=failure_proof(db,row,reference)
            if not proof:continue
            failure=proof[0]
            if db.execute('SELECT 1 FROM general_source_briefs WHERE event_id=? AND sha=? AND body_sha=? AND lease=? AND policy=?',
                          (row['id'],row['sha'],row['body_sha'],failure['lease'],POLICY)).fetchone():continue
            return save_current(db,row,reference)
    return False


def publications(db,reference,exclude=()):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='general_source_briefs'").fetchone():return []
    result=[]
    for row in news.candidates(db,reference,include_review=True):
        if row['id'] in exclude:continue
        proof=failure_proof(db,row,reference)
        if not proof:continue
        failure,value,started,failed=proof
        saved=db.execute('SELECT * FROM general_source_briefs WHERE event_id=? AND sha=? AND body_sha=? AND lease=? AND policy=?',
                         (row['id'],row['sha'],row['body_sha'],failure['lease'],POLICY)).fetchone()
        if not saved or not saved['payload'] or saved['started_at']!=started.isoformat():continue
        public=news.reconciliation.instant(saved['public_at'])
        if not public or not failed<=public<=reference:continue
        note=build(value,row)
        try:
            if note is None or json.loads(saved['payload'])!=note:continue
        except (TypeError,ValueError):continue
        result.append((row,saved,note))
    return result


def public_item(row,note):
    by_id={unit['id']:unit for unit in row['units']}
    selected=[by_id[fact['evidenceId']] for fact in note['facts']]
    item=news.public_item({**row,'units':selected},
                         {'facts':[{'ja':fact['ja'],'en':fact['en'],'evidenceQuote':unit['quote']}
                                   for fact,unit in zip(note['facts'],selected)]})
    if note['scope']=='sector':
        item.update(tickers=[],title='Broker industry outlook',translationJa='証券会社による業界見通し',publisher='Reported industry news')
    # Old clients may not understand the brief marker. Keep the incomplete
    # state in core titles too; newer displays remove only this exact suffix.
    item['title']+=TITLE_SUFFIXES['en']
    item['translationJa']+=TITLE_SUFFIXES['ja']
    item['brief']={'version':1,'scope':note['scope'],'validFacts':len(note['facts']),
                   'pendingFacts':len(note['pendingEvidenceIds'])}
    return item
