"""Buyback discovery and source-bound semantics; no network, models or quotas.

The discovery words never authorize publication. A named company action, amount
or share count, action stage and period/date must survive independent review.
"""
from datetime import datetime
import re

import factual_validation

CUE = re.compile(r'\b(?:buy[ -]?backs?|(?:share|stock) repurchases?|repurchased|repurchasing|(?:bought|buying) back)\b|自社株買い|(?:自社株|自己株式).{0,100}(?:取得|買付|買い戻)', re.I)
AUTH = re.compile(r'\b(?:authoriz(?:e[sd]?|ation)|approv(?:e[sd]?|al))\b|承認|決議|取得枠|買い枠', re.I)
EXECUTED = re.compile(r'\b(?:repurchased|bought back|completed (?:a |the )?(?:share |stock )?(?:repurchase|buyback))\b|(?:自社株|自己株式).{0,100}(?:取得した|取得済|買い戻した|買い戻し(?=[、，,])|実施した)|取得実績', re.I)
PLANNED = re.compile(r'\b(?:plans?|propos(?:es|ed)|intend(?:s|ed)?|consider(?:s|ing)|may|might|could|would)\b|計画|予定|検討|意向|可能性', re.I)
HISTORICAL = re.compile(r'\b(?:historical|history|(?:last|prior|previous) quarter|(?:last|prior|previous) year|in the past|over the past|since \d{4}|chart|recap|throwback|quarterly buybacks)\b|過去|推移|振り返|昨年|前四半期', re.I)
MONEY = r'(?:US\$|\$|€|£|¥|USD|EUR|GBP|JPY|円|ユーロ|ドル)\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?:\s*(?:billion|million|trillion|bn|[BMT]|億|兆|万))?'
QUANTITY = re.compile(MONEY+r'|(?<![A-Za-z0-9_.])[0-9]+(?:\.[0-9]+)?\s*(?:million|billion)?\s*(?:shares\b|株)|[0-9]+(?:\.[0-9]+)?(?:億|万)?株|[0-9]+(?:\.[0-9]+)?(?:億|兆|万)(?:円|ドル)', re.I)
FAILURE_CODES = frozenset({'changed-buyback-status','changed-buyback-amount-role','lost-buyback-period','buyback-historical-context','buyback-needs-bound-action','buyback-needs-amount-or-shares','buyback-ambiguous-event-date','changed-buyback-qualifier','changed-buyback-cashflow-basis'})
POLICY = """Buyback evidence is an issuer capital-return action. Share repurchase authorization/approval is permission to buy, not shares already repurchased. Distinguish new/additional authorization, remaining authorization, actual purchases, purchase share count and market capitalization. Preserve amount, currency, magnitude, program/reporting period and event date with the correct role. A quarterly/historical chart is not a new authorization. A repost date is not a new event date. Do not calculate shares from dollars or amounts from market cap. Do not promote possible/planned purchases to authorized or executed action. Japanese must retain 自社株買い or 自己株式取得 and the explicit approval/authorization versus execution status. Keep each quantity in its own role and period; omit stock price commentary and marketing. A buyback context contains a literal sole-company header and exact claim spans; use that company only, without paraphrasing promotional header or trailing commentary. Historical/last-quarter facts are a recap, not a new authorization. Preserve nearly/just-under versus approximately/~ on each number, and the free-cash-flow basis of percentages. An authorization in a historical recap is background; never call it newly authorized on the post date. If the original does not substantiate a company action, return review."""


def event_date(text):
    dates=set(re.findall(r'(?<!\d)(20\d{2}-\d{2}-\d{2})(?!\d)', text))
    for value in re.findall(r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? 20\d{2}\b',text,re.I):
        try: dates.add(datetime.strptime(value.replace(',',''),'%B %d %Y').date().isoformat())
        except ValueError: return None,'buyback-ambiguous-event-date'
    for value in dates:
        try: datetime.strptime(value,'%Y-%m-%d')
        except ValueError: return None,'buyback-ambiguous-event-date'
    return (next(iter(dates)),None) if len(dates)==1 else (None,'buyback-ambiguous-event-date' if dates else None)


def _status(text):
    return ('planned' if PLANNED.search(text) else 'authorization' if AUTH.search(text)
            else 'executed' if EXECUTED.search(text) else None)


def _context_units(text,ticker,aliases):
    """Bind only adjacent literal claims under one explicit company header.

    No actor is inferred from a cashtag elsewhere. Quotation/reporting changes,
    competing cashtags and unknown named claim subjects stop this grammar.
    """
    spans=[(m.start(),m.end()) for m in re.finditer(r'[^\n]+(?:\n(?!\s*\n)[^\n]+)*',text) if m[0].strip()]
    if len(spans)==1:
        cuts=[m.end() for m in re.finditer(r'(?<![.!?])[.!?](?=\s+[A-Z$])',text)]
        bounds=[0,*cuts,len(text)]
        spans=[(left,right) for left,right in zip(bounds,bounds[1:]) if text[left:right].strip()]
    paragraphs=[]
    for start,end in spans:
        raw=text[start:end];start+=len(raw)-len(raw.lstrip());end-=len(raw)-len(raw.rstrip())
        quote=text[start:end]
        if (paragraphs and re.match(MONEY+r'\s+in\s+remaining\b',quote,re.I)
                and AUTH.search(paragraphs[-1][0])):
            prior=paragraphs[-1];paragraphs[-1]=(text[prior[1]:end],prior[1],end)
        else:paragraphs.append((quote,start,end))
    if not 2<=len(paragraphs)<=8:return None
    header=paragraphs[0][0]
    if len(header)>200 or QUANTITY.search(header) or _status(header):return None
    forbidden=re.compile(r'["“”「」]|\b(?:says?|said|reports?|reported|according|claims?|claimed|'
                         r'mentions?|observes?|quotes?|quoted|other|another company|competitor|'
                         r'supplier|customer|rival|unrelated|if|unless|not|never|denies?|denied|after|while|whereas|who|which|whose|they|their|he|she|and|but|or|however|from)\b|'
                         r'によると|他社|別の会社|否定',re.I)
    if forbidden.search(header):return None
    remainder=header
    for alias in sorted([ticker,*aliases],key=len,reverse=True):
        remainder=re.sub(r'(?<![A-Za-z0-9_])\$?'+re.escape(alias)+r'(?![A-Za-z0-9_])','',remainder,flags=re.I)
    if re.search(r'[A-Z]|[^\x00-\x7f]|\b(?:and|with|versus|vs|about|watching|including)\b|&',remainder):return None
    tags=set(re.findall(r'\$([A-Z][A-Z0-9.-]{0,9})(?![\w.])',text))
    if tags-{ticker}:return None
    names='|'.join(re.escape(a) for a in sorted(aliases,key=len,reverse=True))
    subject=r'(?:(?:'+names+r')(?:\s*\$'+re.escape(ticker)+r')?|\$'+re.escape(ticker)+r'|it|the company)(?![\w.])\s+'
    units=[];stopped=False
    for paragraph in paragraphs[1:]:
        quote=paragraph[0].strip()
        status=_status(quote)
        if not (status and QUANTITY.search(quote)):
            stopped=True
            continue
        # An intervening actor/comment cannot lend the earlier company header.
        if stopped or forbidden.search(quote) or re.search(r'\bby\s+(?!the company\b|itself\b)',quote,re.I):return None
        if re.search(r'\b(?:bonds?|debt|notes|Treasur(?:y|ies))\b|国債|社債',quote,re.I):return None
        # Explicit same-company/pronominal subject, or a quantified passive
        # clause such as "Nearly $20B repurchased" / "Another $150B authorized".
        passive=(r'(?:(?:nearly|almost|just under|about|approximately|roughly|another|additional)\s+|~\s*)?'+MONEY+
                 r'\s+(?:(?:(?:was|were|just)\s+)?repurchased|(?:just\s+)?(?:authorized|approved))\b')
        explicit=subject+r'(?:(?:has|had)\s+)?(?:(?:just|also)\s+)?(?:authorized|approved|repurchased|bought back|plans?\s+(?:to\s+)?(?:buy back|repurchase))\b'
        if not re.match(r'(?:'+explicit+r'|'+passive+r')',quote,re.I):return None
        residue=quote
        for alias in sorted([ticker,*aliases],key=len,reverse=True):
            residue=re.sub(r'(?<![A-Za-z0-9_])\$?'+re.escape(alias)+r'(?![A-Za-z0-9_])','',residue,flags=re.I)
        residue=QUANTITY.sub('',residue)
        residue=re.sub(r'\b(?:FY\s*\d{2,4}|Q[1-4]|FCF)\b','',residue)
        residue=re.sub(r'^(?:It|The|(?i:Nearly|Almost|Just under|About|Approximately|Roughly)|Another|Additional)\b','',residue)
        if re.search(r'\b[A-Z][A-Za-z]+\b',residue):return None
        # A new speaker or capitalized subject later in the paragraph is not
        # an implicit continuation. Permit the separate remaining-capacity sum.
        clauses=re.split(r'(?<=[.!?])\s+|[;；]',quote)
        for clause in clauses[1:]:
            if not (re.match(r'(?:(?:'+MONEY+r')\s+in\s+remaining\b|'+subject+r')',clause,re.I)
                    and not forbidden.search(clause)):
                return None
        date,error=event_date(quote)
        if error:return None
        units.append({'id':str(len(units)),'quote':quote,'actor':'report','ticker':ticker,
                      'buyback':{'status':status,'eventDate':date,'context':header,
                                 'sourceStart':paragraph[1],'sourceEnd':paragraph[2],
                                 'historical':bool(HISTORICAL.search(quote))}})
    if not units or any(not 16<=len(u['quote'])<=800 for u in units):return None
    if not any(CUE.search(u['quote']) for u in units):return None
    return units


def prepare(body,ticker,aliases):
    if not CUE.search(body): return None,'not-buyback'
    text=re.sub(r'https?://\S+','',body).strip()
    names='|'.join(re.escape(a) for a in aliases) or r'(?!)'
    opening=r'^[^\w$]*(?:(?:'+names+r')(?:[’\']s)?\s*(?:\$'+re.escape(ticker)+r')?|\$'+re.escape(ticker)+r')(?![\w.])'
    if not re.match(opening,text,re.I): return None,'buyback-needs-bound-action'
    first=re.split(r'(?<=[.!?])\s+|\n',text,maxsplit=1)[0]
    if re.search(r'\b(?:says|said|reports?|reported|mentions?|mentioned|observes?)\b\s+(?!(?:that\s+)?(?:it|the company)\b)|によると|他社|別の会社',first,re.I):
        return None,'buyback-needs-bound-action'
    if re.search(r'\b(?:bonds?|debt|notes|Treasur(?:y|ies))\b|国債|社債',first,re.I):
        return None,'buyback-needs-bound-action'
    status=_status(first)
    if not status or not CUE.search(first):
        units=_context_units(text,ticker,aliases)
        if units:
            for unit in units:
                if body.count(unit['quote'])!=1 or body.count(unit['buyback']['context'])!=1:
                    return None,'buyback-needs-bound-action'
                start=body.index(unit['quote'])
                unit['buyback'].update(sourceStart=start,sourceEnd=start+len(unit['quote']))
        return (units,'eligible-buyback-recap' if any(u['buyback']['historical'] for u in units) else 'eligible-buyback') if units else (None,'buyback-needs-bound-action')
    if not QUANTITY.search(first): return None,'buyback-needs-amount-or-shares'
    date,error=event_date(first)
    if error:return None,error
    parts=[s.strip() for s in re.split(r'\n\s*\n|(?<=[.!?])\s+(?=[A-Z$])',text) if s.strip()]
    if not 1<=len(parts)<=8 or any(not 16<=len(s)<=800 for s in parts): return None,'evidence-unit-limit'
    return [{'id':str(i),'quote':part,'actor':'report','ticker':ticker,
             'buyback':{'status':status if i==0 else None,'eventDate':date if i==0 else None,
                        'historical':bool(HISTORICAL.search(part))}}
            for i,part in enumerate(parts)],'eligible-buyback'


def roles(text,lang):
    # Every explicit role is tied to its clause. A number's mere presence in
    # another clause cannot justify swapping executed/remaining/authorized sums.
    result={}
    clauses=re.split(r'[。;；]|(?<=[.!?])\s+|,\s*(?=with |bringing |raising |increasing |leaving )|、(?=残り|残る|残存|残額|未使用)' ,text,flags=re.I)
    for clause in clauses:
        quantities=tuple(quantity_value(m[0]) for m in QUANTITY.finditer(clause))
        if not quantities:continue
        if re.search(r'\b(?:market cap(?:italization)?|valuation)\b|時価総額',clause,re.I): role='market-cap'
        elif re.search(r'\b(?:remaining|available|left|balance)\b|残り|残る|残存|未使用|残額',clause,re.I): role='remaining'
        elif EXECUTED.search(clause): role='executed'
        elif AUTH.search(clause): role='authorization'
        else:continue
        result.setdefault(role,[]).extend(quantities)
    return result


def validate(item,quote,*,required=False):
    if not CUE.search(quote) and not required:return
    source_auth=bool(AUTH.search(quote));source_exec=bool(EXECUTED.search(quote))
    source_plan=bool(PLANNED.search(quote))
    for lang in ('ja','en'):
        text=item.get(lang,'')
        if not isinstance(text,str):raise ValueError('invalid-copy')
        if required and not CUE.search(text):raise ValueError('changed-buyback-status')
        if CUE.search(text):
            if source_auth and not source_exec and (not AUTH.search(text) or EXECUTED.search(text)):
                raise ValueError('changed-buyback-status')
            if source_exec and not source_auth and not EXECUTED.search(text):
                raise ValueError('changed-buyback-status')
            if source_plan and not source_auth and not source_exec and (AUTH.search(text) or EXECUTED.search(text) or not PLANNED.search(text)):
                raise ValueError('changed-buyback-status')
        validate_qualifiers(text,quote)
        if re.search(r'free cash flow|FCF',quote,re.I) and not re.search(r'free cash flow|FCF|フリーキャッシュフロー',text,re.I):
            raise ValueError('changed-buyback-cashflow-basis')
        original=roles(quote,'en');translated=roles(text,lang)
        for role,values in translated.items():
            if role not in original or sorted(values)!=sorted(original[role]):
                raise ValueError('changed-buyback-amount-role')
        if required and any(sorted(translated.get(role,[]))!=sorted(values) for role,values in original.items()):
            raise ValueError('changed-buyback-amount-role')
        if re.search(r'\b(?:fiscal|FY\s*\d)|会計年度|年度',quote,re.I) and not re.search(r'\b(?:fiscal|FY\s*\d)|会計年度|年度',text,re.I):
            raise ValueError('lost-buyback-period')
        if required and relative_periods(quote)!=relative_periods(text):
            raise ValueError('lost-buyback-period')
        if HISTORICAL.search(quote) and required and not HISTORICAL.search(text):
            raise ValueError('buyback-historical-context')


def relative_periods(text):
    result=set()
    if re.search(r'\b(?:last|prior|previous) quarter\b|前(?:の)?四半期',text,re.I):result.add('prior-quarter')
    if re.search(r'\b(?:last|prior|previous) year\b|昨年|前年',text,re.I):result.add('prior-year')
    return result


def qualified_quantities(text):
    pattern=re.compile(QUANTITY.pattern+r'|[0-9]+(?:\.[0-9]+)?\s*[%％]',re.I)
    matches=list(pattern.finditer(text));result={}
    for i,match in enumerate(matches):
        before=text[max(matches[i-1].end() if i else 0,match.start()-30):match.start()]
        after=text[match.end():min(matches[i+1].start() if i+1<len(matches) else len(text),match.end()+8)]
        qualifier=('nearly' if re.search(r'(?:nearly|almost|just under)\s*$',before,re.I) or re.match(r'\s*(?:弱|近く)',after)
                   else 'about' if re.search(r'(?:about|approximately|roughly|[~〜～]|約|およそ)\s*$',before,re.I) else 'exact')
        key=quantity_value(match[0])
        result.setdefault(key,set()).add(qualifier)
    return result


def validate_qualifiers(text,quote):
    original=qualified_quantities(quote);actual=qualified_quantities(text)
    if any(actual.get(key)!=qualifiers for key,qualifiers in original.items() if key in actual):
        raise ValueError('changed-buyback-qualifier')


def quantity_value(text):
    currency=('USD' if re.search(r'\$|USD|ドル',text,re.I) else 'EUR' if re.search(r'EUR|€|ユーロ',text,re.I)
              else 'GBP' if re.search(r'GBP|£',text,re.I) else 'JPY' if re.search(r'JPY|¥|円',text,re.I) else 'shares')
    return currency+':'+str([(format(number.normalize(),'f'),unit) for number,unit in factual_validation.numeric_values(text)])


def event_key(row):
    binding=row['units'][0]['buyback']
    # Only explicit source event dates can deduplicate differently worded
    # reports. With no event date, retain the exact-body origin dedup behavior.
    if not binding['eventDate']:return None
    amounts=roles(row['body'],'en')
    return (row['ticker'],'share-buyback',binding['status'],binding['eventDate'],
            tuple((k,tuple(sorted(v))) for k,v in sorted(amounts.items())),
            tuple(factual_validation.numeric_values(row['body'])))
