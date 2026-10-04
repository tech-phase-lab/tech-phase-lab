"""Closed-grammar buyback facts and bilingual rendering; no I/O or provider.

Every selected claim and the surrounding source envelope must be recognized.
This is deliberately smaller than discovery: an unknown clause is review data.
"""
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, localcontext
import hashlib
import json
import re

import buyback_news
import signals

VERSION = 1
FAILURE = 'unsupported-buyback-structure'
MARKER = 'sourceStructuredBuyback'
NUMBER = r'(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?'
QUALIFIER = r'nearly|almost|just under|about|approximately|roughly|~'
SCALES = {'': 1, 'k': 1000, 'thousand': 1000, 'm': 10**6, 'million': 10**6,
          'b': 10**9, 'bn': 10**9, 'billion': 10**9, 't': 10**12, 'trillion': 10**12}
SCALE_NAMES = {1: '', 1000: 'thousand', 10**6: 'million', 10**9: 'billion', 10**12: 'trillion'}
CURRENCIES = {'$': 'USD', 'US$': 'USD', 'USD': 'USD', '€': 'EUR', 'EUR': 'EUR',
              '£': 'GBP', 'GBP': 'GBP', '¥': 'JPY', 'JPY': 'JPY'}
SYMBOLS = {'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥'}
PERIOD = r'(?:(?:last|prior|previous) (?:quarter|year)|in Q[1-4] FY20\d{2}|on 20\d{2}-\d{2}-\d{2})'


class Unrecognized(ValueError):
    def __init__(self, reason=FAILURE):
        super().__init__(reason)


@dataclass(frozen=True)
class Money:
    currency: str
    coefficient: str
    scale: int
    qualifier: str

    @property
    def amount(self):
        with localcontext() as context:
            context.prec=max(28,len(self.coefficient)+20)
            return Decimal(self.coefficient) * self.scale


@dataclass(frozen=True)
class Claim:
    evidence_id: str
    actor: str
    ticker: str
    status: str
    amount: Money
    relation: str
    period: str | None = None
    cashflow_percent: str | None = None
    cashflow_qualifier: str | None = None
    remaining: Money | None = None
    action_date: str | None = None


def money_pattern(prefix):
    return (rf'(?:(?P<{prefix}q>{QUALIFIER})\s*)?'
            rf'(?P<{prefix}c>US\$|USD|EUR|GBP|JPY|[$€£¥])\s*'
            rf'(?P<{prefix}n>{NUMBER})\s*(?P<{prefix}s>thousand|million|billion|trillion|bn|[KMBT])?')


def qualifier(value):
    return ('nearly' if (value or '').lower() in {'nearly', 'almost', 'just under'}
            else 'about' if value else 'exact')


def money(match, prefix):
    coefficient=match[prefix+'n'].replace(',', '')
    if Decimal(coefficient) <= 0:
        raise Unrecognized()
    currency=CURRENCIES[match[prefix+'c'].upper() if match[prefix+'c'].isascii() else match[prefix+'c']]
    return Money(currency, coefficient, SCALES[(match[prefix+'s'] or '').lower()], qualifier(match[prefix+'q']))


def issuer_pattern(ticker):
    aliases=signals.ALIASES.get(ticker, [])
    if not aliases:
        raise Unrecognized()
    names='|'.join(re.escape(value) for value in sorted(aliases, key=len, reverse=True))
    return r'(?:(?:'+names+r')(?:\s+\$'+re.escape(ticker)+r')?|\$'+re.escape(ticker)+r')'


def source_units(row):
    """Re-derive binding, then consume all source text outside exact claims."""
    body=row.get('body');ticker=row.get('ticker')
    if (row.get('category')!='share-buyback' or not isinstance(body,str)
            or not 1<=len(body)<=3600 or not isinstance(ticker,str)
            or hashlib.sha256(body.encode()).hexdigest()!=row.get('body_sha')):
        raise Unrecognized()
    units,_=buyback_news.prepare(body,ticker,signals.ALIASES.get(ticker,[]))
    if not units or canonical(units)!=canonical(row.get('units')):
        raise Unrecognized()
    clean=re.sub(r'(?:\s+https?://\S+)+\s*$','',body).strip()
    context=units[0]['buyback'].get('context')
    cursor=0
    if context:
        header=(issuer_pattern(ticker)+r'\s+(?:(?:buyback|share repurchase|stock repurchase|capital return) update\.?'
                r'|is betting big\.{3}\s+on itself\.)')
        if (not re.fullmatch(header,context,re.I) or not clean.startswith(context)
                or any(unit['buyback'].get('context')!=context for unit in units)):
            raise Unrecognized()
        cursor=len(context)
    for unit in units:
        quote=unit['quote']
        start=clean.find(quote,cursor)
        if start<0 or clean[cursor:start].strip() or body.count(quote)!=1:
            raise Unrecognized()
        cursor=start+len(quote)
    tail=clean[cursor:].strip()
    # This bounded editorial idiom asserts no financial action. Other prose,
    # including later denials/conditions, is never silently discarded.
    if tail:
        editorial=re.fullmatch(r'([A-Z][a-z]{1,30}) is not playing around\.',tail)
        if (not context or not editorial or editorial[1].lower() in
                {'this','that','never','rumor','rumour','hypothetical','example','alleged',
                 'unconfirmed','expected','denied','false','fake','fiction','correction'}):
            raise Unrecognized()
    return units, bool(context)


def parse_claim(unit,ticker,context):
    quote=unit['quote'];actor=signals.ALIASES[ticker][0]
    subject=issuer_pattern(ticker)+(r'|it|the company' if context else '')
    subject=r'(?:'+subject+r')'
    executed=(rf'(?:{subject}\s+(?:repurchased|bought back)\s+{money_pattern("a")}'
              rf'(?:\s+of its (?:own )?shares)?\s+(?P<period>{PERIOD})'
              rf'|(?P<passive>{money_pattern("p")})\s+repurchased\s+(?P<passive_period>{PERIOD}))'
              rf'(?:,\s*(?:equivalent to|equal to|representing)\s*(?:(?P<pctq>{QUALIFIER})\s*)?'
              rf'(?P<pct>{NUMBER})%\s+of (?:its )?(?:free cash flow|FCF))?\.?')
    match=re.fullmatch(executed,quote,re.I)
    if match:
        passive=match['passive'] is not None
        if passive and not context:
            raise Unrecognized()
        period=match['passive_period'] if passive else match['period']
        period=period.lower() if not period.startswith('in ') else period
        action_date=period[3:] if period.lower().startswith('on ') else None
        if action_date:date.fromisoformat(action_date)
        pct=match['pct'].replace(',','') if match['pct'] else None
        if pct is not None and Decimal(pct)<0:raise Unrecognized()
        return Claim(unit['id'],actor,ticker,'executed',money(match,'p' if passive else 'a'),
                     'executed',period,pct,qualifier(match['pctq']) if pct else None,
                     action_date=action_date)
    authorization=(rf'(?:{subject}\s+(?:authorized|approved)\s+'
                   rf'(?P<relation>an additional|another|a new|additional)?\s*{money_pattern("a")}\s+'
                   rf'(?P<object>for share repurchases|in share repurchases|for stock repurchases|share repurchase program|stock repurchase program)'
                   rf'|(?P<passive_relation>another|an additional|additional)\s+{money_pattern("p")}\s+(?:just\s+)?(?:authorized|approved))'
                   rf'(?:\s+on (?P<date>20\d{{2}}-\d{{2}}-\d{{2}}))?'
                   rf'(?:(?:\.\s*|,\s*with\s+){money_pattern("r")}\s+'
                   rf'(?:in remaining capacity|in remaining authorization|of remaining authorization|of authorization remaining))?\.?')
    match=re.fullmatch(authorization,quote,re.I)
    if not match:raise Unrecognized()
    passive=match['passive_relation'] is not None
    if passive and not context:raise Unrecognized()
    relation=(match['passive_relation'] or match['relation'] or '').lower()
    if relation=='a new' and not (match['object'] or '').lower().endswith('program'):
        raise Unrecognized()
    relation='additional' if relation in {'another','an additional','additional'} else 'new-program' if relation=='a new' else 'authorization'
    action_date=match['date']
    if action_date:date.fromisoformat(action_date)
    remaining=money(match,'r') if match['rn'] else None
    amount=money(match,'p' if passive else 'a')
    # Existing related-authorization matching is exact-amount matching. Do not
    # suppress an approximate authorization as if it were an exact prior one.
    if (amount.qualifier!='exact' or remaining and
            (remaining.currency!=amount.currency or remaining.qualifier!='exact')):
        raise Unrecognized()
    return Claim(unit['id'],actor,ticker,'authorization',amount,relation,remaining=remaining,action_date=action_date)


def parse(row):
    units,context=source_units(row)
    published=datetime.fromisoformat(row['published_at'].replace('Z','+00:00'))
    if published.tzinfo is None:raise Unrecognized()
    claims=tuple(parse_claim(unit,row['ticker'],context) for unit in units)
    for unit,claim in zip(units,claims):
        if (unit['buyback'].get('eventDate')!=claim.action_date
                or claim.action_date and claim.action_date>published.date().isoformat()):
            raise Unrecognized()
    return claims


def amount_text(value):
    scale=SCALE_NAMES[value.scale]
    return SYMBOLS[value.currency]+value.coefficient+(' '+scale if scale else '')


def japanese_amount(value):
    # Do not extend the existing currency/quantity guards merely to widen this
    # grammar. Natural yen/dollar suffixes are already supported end to end.
    suffix={'USD':'ドル','JPY':'円'}.get(value.currency)
    if suffix is None:raise Unrecognized()
    amount=value.amount
    for denominator,label in ((10**12,'兆'),(10**8,'億'),(10**4,'万')):
        if amount>=denominator:
            with localcontext() as context:
                context.prec=max(28,len(value.coefficient)+20)
                digits=format(amount/denominator,'f')
            if '.' in digits:digits=digits.rstrip('0').rstrip('.')
            return digits+label+suffix
    raise Unrecognized()


def qualified_amount(value,language):
    if language=='ja':
        return ('約' if value.qualifier=='about' else '')+japanese_amount(value)+('弱' if value.qualifier=='nearly' else '')
    text=amount_text(value)
    return ('nearly ' if value.qualifier=='nearly' else 'about ' if value.qualifier=='about' else '')+text


def render(claim):
    ja_amount=qualified_amount(claim.amount,'ja');en_amount=qualified_amount(claim.amount,'en')
    if claim.status=='executed':
        period=claim.period or ''
        if re.fullmatch(r'(?:last|prior|previous) quarter',period,re.I):ja_period,en_period='前四半期','the previous quarter'
        elif re.fullmatch(r'(?:last|prior|previous) year',period,re.I):ja_period,en_period='昨年','the previous year'
        elif re.fullmatch(r'in Q[1-4] FY20\d{2}',period,re.I):ja_period,en_period=period[3:].upper(),period[3:].upper()
        elif claim.action_date:ja_period=en_period=claim.action_date
        else:raise Unrecognized()
        # Monetary numbers precede numbered fiscal/calendar periods in source.
        if re.search(r'\d',ja_period):
            ja=f'{claim.actor}は{ja_amount}の自社株を買い戻し、'+('実施日は' if claim.action_date else '対象期間は')+f'{ja_period}だった。'
            en=f'{claim.actor} bought back its own shares for {en_amount} '+('on ' if claim.action_date else 'in ')+f'{en_period}.'
        else:
            ja=f'{claim.actor}は{ja_period}に{ja_amount}の自社株を買い戻した。'
            en=f'{claim.actor} bought back its own shares for {en_amount} during {en_period}.'
        if claim.cashflow_percent is not None:
            prefix='約' if claim.cashflow_qualifier=='about' else ''
            suffix='弱' if claim.cashflow_qualifier=='nearly' else ''
            en_prefix='about ' if claim.cashflow_qualifier=='about' else 'nearly ' if claim.cashflow_qualifier=='nearly' else ''
            ja+=f'金額はフリーキャッシュフローの{prefix}{claim.cashflow_percent}%{suffix}に相当した。'
            en+=f' The amount was equivalent to {en_prefix}{claim.cashflow_percent}% of free cash flow.'
    else:
        if claim.relation=='additional':
            ja=f'{claim.actor}は自社株買い枠を{ja_amount}追加で承認した'
            en=f'{claim.actor} approved {en_amount} in additional share buyback authority'
        elif claim.relation=='new-program':
            ja=f'{claim.actor}は{ja_amount}の新たな自社株買いプログラムを承認した'
            en=f'{claim.actor} authorized a new share buyback program of {en_amount}'
        else:
            ja=f'{claim.actor}は{ja_amount}の自社株買い枠を承認した'
            en=f'{claim.actor} gave approval for {en_amount} in share repurchases'
        if claim.action_date:
            ja+=f'。承認日は{claim.action_date}だった'
            en+=f' on {claim.action_date}'
        ja+='。';en+='.'
        if claim.remaining:
            ja+=f'残る承認枠は{qualified_amount(claim.remaining,"ja")}だった。'
            en+=f' Remaining authorization is {qualified_amount(claim.remaining,"en")}.'
    return {'evidenceId':claim.evidence_id,'ja':ja,'en':en}


def prepare(row):
    try:
        claims=parse(row)
        facts=[render(claim) for claim in claims]
        return {'version':VERSION,'source':{key:row[key] for key in
                ('id','source_id','url','sha','body_sha','published_at','observed_at')},
                'claims':[asdict(claim) for claim in claims],'facts':facts},None
    except (Unrecognized,ValueError,TypeError,KeyError,AttributeError):
        return None,FAILURE


def marker(prepared):
    return {key:value for key,value in prepared.items() if key!='facts'}


def validated_note(row):
    """Render, bind literal evidence, then apply all current shared guards."""
    import general_source_news as news
    prepared,reason=prepare(row)
    if prepared is None:return None,reason
    try:
        # Construct the complete closed-grammar note once. The same public
        # validator checks every field and re-derives the typed proof below;
        # routing through model-response binding would repeat those guards.
        note={'generalSourceVersion':news.VERSION,MARKER:marker(prepared),
              'semanticAssessment':{'version':news.ASSESSMENT_VERSION,'disposition':'publish',
                                    'reason':'material-company-development'},
              'facts':[{'ja':fact['ja'],'en':fact['en'],'evidenceQuote':unit['quote']}
                       for fact,unit in zip(prepared['facts'],row['units'])]}
        news.validate_note(note,row)
        return note,None
    except (ValueError,TypeError,KeyError):
        return None,FAILURE


def validate_rendered(note,row):
    """A marker never grants publication: recompute every typed/rendered field."""
    import general_source_news as news
    prepared,reason=prepare(row)
    if prepared is None or canonical(note.get(MARKER))!=canonical(marker(prepared)):
        raise Unrecognized(reason or FAILURE)
    facts=[{'ja':fact['ja'],'en':fact['en'],'evidenceQuote':unit['quote']}
           for fact,unit in zip(prepared['facts'],row['units'])]
    expected={'generalSourceVersion':news.VERSION,'facts':facts,MARKER:marker(prepared),
              'semanticAssessment':{'version':news.ASSESSMENT_VERSION,'disposition':'publish',
                                    'reason':'material-company-development'}}
    if canonical(note)!=canonical(expected):
        raise Unrecognized()


def canonical(value):
    try:return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'),allow_nan=False)
    except (TypeError,ValueError,OverflowError):raise Unrecognized()
