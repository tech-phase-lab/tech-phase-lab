"""Buyback discovery and source-bound semantics; no network, models or quotas.

The discovery words never authorize publication. A named company action, amount
or share count, action stage and period/date must survive independent review.
"""
from datetime import datetime
import re

import factual_validation

CUE = re.compile(r'\b(?:buy[ -]?backs?|(?:share|stock) repurchases?|repurchased|repurchasing|bought back)\b|自社株買い|自己株式.{0,100}(?:取得|買付|買い戻)', re.I)
AUTH = re.compile(r'\b(?:authoriz(?:e[sd]?|ation)|approv(?:e[sd]?|al))\b|承認|決議|取得枠|買い枠', re.I)
EXECUTED = re.compile(r'\b(?:repurchased|bought back|completed (?:a |the )?(?:share |stock )?(?:repurchase|buyback))\b|(?:自社株|自己株式).{0,100}(?:取得した|取得済|買い戻した|実施した)|取得実績', re.I)
PLANNED = re.compile(r'\b(?:plans?|propos(?:es|ed)|intend(?:s|ed)?|consider(?:s|ing)|may|might|could|would)\b|計画|予定|検討|意向|可能性', re.I)
HISTORICAL = re.compile(r'\b(?:historical|history|last quarter|last year|in the past|over the past|since \d{4}|chart|recap|throwback|quarterly buybacks)\b|過去|推移|振り返|昨年|前四半期', re.I)
MONEY = r'(?:US\$|\$|€|£|¥|USD|EUR|GBP|JPY|円|ユーロ|ドル)\s*[0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?(?:\s*(?:billion|million|trillion|bn|[BMT]|億|兆|万))?'
QUANTITY = re.compile(MONEY+r'|(?<![A-Za-z0-9_.])[0-9]+(?:\.[0-9]+)?\s*(?:million|billion)?\s*(?:shares\b|株)|[0-9]+(?:\.[0-9]+)?(?:億|万)?株|[0-9]+(?:\.[0-9]+)?(?:億|兆|万)(?:円|ドル)', re.I)
FAILURE_CODES = frozenset({'changed-buyback-status','changed-buyback-amount-role','lost-buyback-period','buyback-historical-context','buyback-needs-bound-action','buyback-needs-amount-or-shares','buyback-ambiguous-event-date'})
POLICY = """Buyback evidence is an issuer capital-return action. Share repurchase authorization/approval is permission to buy, not shares already repurchased. Distinguish new/additional authorization, remaining authorization, actual purchases, purchase share count and market capitalization. Preserve amount, currency, magnitude, program/reporting period and event date with the correct role. A quarterly/historical chart is not a new authorization. A repost date is not a new event date. Do not calculate shares from dollars or amounts from market cap. Do not promote possible/planned purchases to authorized or executed action. Japanese must retain 自社株買い or 自己株式取得 and the explicit approval/authorization versus execution status. Keep each quantity in its own role and period; omit stock price commentary and marketing. If the original does not substantiate a company action, return review."""


def event_date(text):
    dates=set(re.findall(r'(?<!\d)(20\d{2}-\d{2}-\d{2})(?!\d)', text))
    for value in re.findall(r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2},? 20\d{2}\b',text,re.I):
        try: dates.add(datetime.strptime(value.replace(',',''),'%B %d %Y').date().isoformat())
        except ValueError: return None,'buyback-ambiguous-event-date'
    for value in dates:
        try: datetime.strptime(value,'%Y-%m-%d')
        except ValueError: return None,'buyback-ambiguous-event-date'
    return (next(iter(dates)),None) if len(dates)==1 else (None,'buyback-ambiguous-event-date' if dates else None)


def prepare(body,ticker,aliases):
    if not CUE.search(body): return None,'not-buyback'
    text=re.sub(r'https?://\S+','',body).strip()
    # A leading cashtag/name binds the action to the company, rather than a
    # neighboring chart label, speaker or unrelated company in another clause.
    names='|'.join(re.escape(a) for a in aliases) or r'(?!)'
    opening=r'^[^\w$]*(?:(?:'+names+r')(?:[’\']s)?\s*(?:\$'+re.escape(ticker)+r')?|\$'+re.escape(ticker)+r')(?![\w.])'
    if not re.match(opening,text,re.I): return None,'buyback-needs-bound-action'
    first=re.split(r'(?<=[.!?])\s+|\n',text,maxsplit=1)[0]
    if re.search(r'\b(?:says|said|reports?|reported|mentions?|mentioned|observes?)\b\s+(?!(?:that\s+)?(?:it|the company)\b)|によると|他社|別の会社',first,re.I):
        return None,'buyback-needs-bound-action'
    if HISTORICAL.search(first): return None,'buyback-historical-context'
    if re.search(r'\b(?:bonds?|debt|notes|Treasur(?:y|ies))\b|国債|社債',first,re.I):
        return None,'buyback-needs-bound-action'
    status='planned' if PLANNED.search(first) else 'authorization' if AUTH.search(first) else 'executed' if EXECUTED.search(first) else None
    if not status or not CUE.search(first): return None,'buyback-needs-bound-action'
    if not QUANTITY.search(first): return None,'buyback-needs-amount-or-shares'
    date,error=event_date(first)
    if error:return None,error
    parts=[s.strip() for s in re.split(r'\n\s*\n|(?<=[.!?])\s+(?=[A-Z$])',text) if s.strip()]
    if not 1<=len(parts)<=8 or any(not 16<=len(s)<=800 for s in parts): return None,'evidence-unit-limit'
    return [{'id':str(i),'quote':part,'actor':'report','ticker':ticker,
             'buyback':{'status':status if i==0 else None,'eventDate':date if i==0 else None}}
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
    if not CUE.search(quote):return
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
        original=roles(quote,'en');translated=roles(text,lang)
        for role,values in translated.items():
            if role not in original or sorted(values)!=sorted(original[role]):
                raise ValueError('changed-buyback-amount-role')
        if required and any(sorted(translated.get(role,[]))!=sorted(values) for role,values in original.items()):
            raise ValueError('changed-buyback-amount-role')
        if re.search(r'\b(?:fiscal|FY\s*\d)|会計年度|年度',quote,re.I) and not re.search(r'\b(?:fiscal|FY\s*\d)|会計年度|年度',text,re.I):
            raise ValueError('lost-buyback-period')
        if HISTORICAL.search(quote) and required and not HISTORICAL.search(text):
            raise ValueError('buyback-historical-context')


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
