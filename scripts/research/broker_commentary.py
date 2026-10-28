"""Literal, bounded claim scopes for broker-led business commentary.

This adapter neither acquires evidence nor decides materiality. The existing
assessment and numerical/topic validators still apply. Its conservative guards
cover known scope/status contradictions; they are not a semantic proof.
"""
import re

import analyst_news
import signals

MAX_INPUT = 3600
MAX_UNITS = 8
MAX_UNIT = 800
FAILURE_CODES = frozenset({
    'changed-broker-claim-scope', 'changed-broker-metric',
    'changed-broker-claim-status', 'lost-calendar-basis',
    'lost-inequality', 'lost-period-relation', 'invented-broker-action',
    'changed-broker-actor', 'lost-forecast-modality', 'reversed-supply-demand',
})
# Broker abbreviations are identities, never company subjects or new sources.
BROKER_ALIASES = {'JPM': 'JPMorgan'}
FIRM = re.compile(r'(?<![A-Za-z0-9_])(?:' + analyst_news.FIRM + '|'
                  + '|'.join(BROKER_ALIASES) + r')(?![A-Za-z0-9_])', re.I)
REPORT = r'(?:sees?|says?|said|believes?|expects?|estimates?|forecasts?|projects?|notes?|reports?|views?|warns?|anticipates?|predicts?)'
FORECAST = re.compile(r'\b(?:sees?|believes?|expect(?:s|ed|ing)?|estimat\w*|forecast(?:s|ed|ing)?|project(?:s|ed|ing)?|outlook|anticipat\w*|predict\w*|may|might|could|would|will|plans?|intends?)\b', re.I)
MODAL = (FORECAST.pattern, r'見込|見通|予想|予測|推計|試算|想定|期待|可能性|かもしれ|だろう|とみ|と見|と考|との見方')
POSSIBLE = (r'\b(?:could|may|might|possibly|potentially)\b', r'可能性|かもしれ|あり得|ありうる|なり得|なりうる')
NEGATION = (r"\b(?:not|never|no longer|without|cannot|can[’']t|won[’']t|isn[’']t|aren[’']t|doesn[’']t|don[’']t)\b",
            r'ない|なく|せず|されず|ならず|至らず|伴わず|否定')
PEER = (r'\b(?:peers?|competitors?|rivals?|other (?:companies|suppliers|manufacturers|producers))\b',
        r'同業|競合|他社|他の(?:企業|会社|メーカー|供給業者)|ピア')
# Product prices and business targets are allowed. Only explicit securities
# terminology or unambiguous broker actions send this fallback to review.
FINANCIAL_ACTION = re.compile(
    r'\b(?:price[ -](?:target|objective)|target[ -]price|PT\s*(?:to|of|at|[:=]|\$)|'
    r'(?:stock|share)\s+(?:price\s+)?(?:target|objective)|ratings?|rated|'
    r'upgrad\w*|downgrad\w*|overweight|underweight|outperform|underperform|'
    r'top[ -]pick|conviction (?:list|buy))\b|'
    r'\b(?:initiat\w*|resum\w*|reiterat\w*|maintain\w*)\b[^.!?\n]{0,60}'
    r'\b(?:coverage|buy|sell|hold|neutral)\b|'
    r'\b(?:buy|sell|hold|neutral)\s+(?:recommendation|rating)\b|'
    r'目標株価|投資判断|格付け|買い推奨|売り推奨', re.I)
# Cut only structural separators, retaining each clause verb and subject. A
# comma within a quantity, or an ordinary noun list, is not a clause boundary.
CLAUSE_BREAK = re.compile(
    r';\s*|,\s*(?=(?:with|noting|whereas|while|but|compared (?:with|to))\b)', re.I)
BULLET = re.compile(r'^(?:[•●▪◦*\-]\s+|\d+[.)]\s+)')
HEADER = re.compile(r'^(?:(?:its|their|the (?:bank|broker|firm)(?:[’\']s)?)\s+)?'
                    r'(?:estimates?|forecasts?|projections?|outlook)(?:\s+[^\n:]{0,70})?:$', re.I)
METRICS = {
    'non-hbm': (r'\bnon[ -]HBM\b', r'非\s*HBM|HBM\s*以外|\bnon[ -]HBM\b'),
    'hbm': (r'\bHBM\b', r'HBM|広帯域メモリ'),
    'dram': (r'\bDRAM\b', r'DRAM'),
    'server': (r'\bservers?\b', r'サーバー?|servers?'),
    'bit': (r'\bbits?\b', r'ビット|\bbits?\b'),
    'demand': (r'\bdemand\b', r'需要'),
    'growth': (r'\b(?:growth|grow\w*|expand\w*|increas\w*|rise|rises|rising|rose|higher)\b', r'成長|伸び|増加|増大|増|拡大|上昇|高ま'),
    'asp': (r'\bASP\b|\baverage selling prices?\b', r'ASP|平均販売(?:価格|単価)|平均売価'),
    'blended': (r'\bblended\b', r'ブレンド|混合|総合|全体平均'),
    'weighted': (r'\bweighted\b', r'加重|重み付け'),
    'yoy': (r'\bYoY\b|\byear[ -](?:over|on)[ -]year\b', r'YoY|前年比|前年同期比|対前年'),
    'revenue': (r'\brevenues?\b', r'売上|収入'),
    'capacity': (r'\bcapacity\b', r'生産能力|供給能力|製造能力|容量|キャパシティ'),
    'lta': (r'\bLTAs?\b|\blong[ -]term (?:supply )?(?:agreements?|contracts?)\b', r'LTA|長期(?:供給)?契約|長期(?:の)?(?:供給)?合意'),
}


def _firm(value):
    return BROKER_ALIASES.get(value.upper(), analyst_news.canonical_firm(value))


def _companies(text):
    return {ticker for ticker, aliases in signals.ALIASES.items()
            if any(re.search(r'(?<![A-Za-z0-9_])' + re.escape(alias)
                             + r'(?![A-Za-z0-9_])', text, re.I) for alias in aliases)}


def _subject(text, ticker):
    names = [ticker, *signals.ALIASES.get(ticker, [])]
    return any(re.search(r'(?<![A-Za-z0-9_])\$?' + re.escape(name)
                         + r'(?![A-Za-z0-9_])', text, re.I) for name in names)


def _spans(body):
    """Yield trimmed literal line/structural-clause spans, with bullet markers."""
    for line in re.finditer(r'[^\r\n]+', body):
        left, right = line.span()
        while left < right and body[left].isspace():
            left += 1
        while right > left and body[right - 1].isspace():
            right -= 1
        if left == right:
            continue
        marker = BULLET.match(body[left:right])
        if marker:
            left += marker.end()
            yield left, right, True
            continue
        # Sentence boundaries require whitespace and a following capital; this
        # does not split decimal values or dotted broker names.
        firm_spans = [match.span() for match in FIRM.finditer(body, left, right)]
        breaks = [match for match in re.finditer(r'(?<=[.!?])\s+(?=[A-Z])', body[left:right])
                  if not any(start < left + match.start() < end for start, end in firm_spans)]
        start = left
        for boundary in [*breaks, None]:
            end = left + boundary.start() if boundary else right
            clause_start = start
            for separator in CLAUSE_BREAK.finditer(body, start, end):
                yield clause_start, separator.start(), False
                clause_start = separator.end()
            if clause_start < end:
                yield clause_start, end, False
            if boundary:
                start = left + boundary.end()


def _ambiguous_price(body, ticker):
    names = '(?:' + '|'.join(re.escape(name) for name in [ticker, *signals.ALIASES.get(ticker, [])]) + ')'
    # A company followed immediately by an unlabelled price remains financial
    # review even if an unrelated business clause follows it.
    if re.search(r'(?<![A-Za-z0-9_])\$?' + names + r'(?![A-Za-z0-9_])'
                 r'(?:\s+\$' + re.escape(ticker) + r')?\s+'
                 r'(?:at|to|from|was|now)\s*\$?\d', body, re.I):
        return True
    for money in re.finditer(r'\$\s*\d', body):
        # Dollar business metrics are accepted only with a local explicit label,
        # not merely a mention of memory/products elsewhere in the paragraph.
        before = body[max(0, money.start() - 70):money.start()]
        if not re.search(r'\b(?:ASP|average selling price|revenue|sales|earnings|profit|capex|capital expenditure)'
                         r'\s*(?:(?:is|are|was|were|at|of|to|from|now|will be|could be)\s+)*$', before, re.I):
            return True
    return False


def prepare(body, ticker):
    """Return private evidence units and a reason; never authorize publication."""
    if not isinstance(body, str):
        return None, 'not-broker-led-commentary'
    opening = re.match(r'^\s*', body).end()
    leader = FIRM.match(body, opening)
    if not leader:
        return None, 'not-broker-led-commentary'
    if not 40 <= len(body) <= MAX_INPUT or '\0' in body:
        return None, 'broker-evidence-unit-limit'
    if FINANCIAL_ACTION.search(body) or _ambiguous_price(body, ticker):
        return None, 'broker-financial-action-needs-review'
    firm = _firm(leader[0])
    if {_firm(m[0]).casefold() for m in FIRM.finditer(body)} != {firm.casefold()}:
        return None, 'broker-attribution-needs-review'
    if not re.match(r'\s*(?::\s*)?(?:also\s+)?' + REPORT + r'\b', body[leader.end():], re.I):
        return None, 'broker-attribution-needs-review'
    if not _subject(body, ticker) or _companies(body) - {ticker}:
        return None, 'broker-subject-needs-review'
    tags = set(re.findall(r'\$(' + analyst_news.TICKER + r')(?![\w.])', body))
    if tags - {ticker}:
        return None, 'broker-subject-needs-review'
    units, context, context_used = [], None, False
    for start, end, bullet in _spans(body):
        quote = body[start:end].strip()
        start += len(body[start:end]) - len(body[start:end].lstrip())
        end = start + len(quote)
        if HEADER.fullmatch(quote):
            if (context and not context_used) or re.search(r'\d', quote) or _companies(quote) or re.search(PEER[0], quote, re.I):
                return None, 'broker-claim-scope-needs-review'
            context_used = False
            context = {'quote': quote, 'sourceStart': start, 'sourceEnd': end}
            continue
        if not bullet:
            if context and not context_used:
                return None, 'broker-claim-scope-needs-review'
            context = None
        company, peer = _subject(quote, ticker), bool(re.search(PEER[0], quote, re.I))
        if company and peer:
            return None, 'broker-claim-scope-needs-review'
        # A company/broker pronoun after a split has no dependable antecedent.
        # Explicit list headers are the one intentionally bound exception.
        if re.match(r'^(?:it|its|they|their|the company|the firm)\b', quote, re.I):
            return None, 'broker-claim-scope-needs-review'
        scope = 'company' if company else 'peer' if peer else 'sector'
        binding = {'scope': scope, 'forecast': bool(FORECAST.search(quote) or context),
                   'sourceStart': start, 'sourceEnd': end}
        if context:
            context_used = True
            binding['context'] = dict(context)
        units.append({'id': str(len(units)), 'quote': quote, 'actor': firm,
                      'ticker': ticker, 'brokerCommentary': binding})
    if (context and not context_used) or not 1 <= len(units) <= MAX_UNITS or any(
            not 16 <= len(unit['quote']) <= MAX_UNIT or unit['quote'] not in body for unit in units):
        return None, 'broker-evidence-unit-limit'
    if not any(unit['brokerCommentary']['scope'] == 'company' for unit in units):
        return None, 'broker-subject-needs-review'
    return units, 'eligible-broker-commentary'


def _regions(text, language):
    regions = {
        'asia': (r'\bAsia(?:n)?\b', r'アジア'),
        'europe': (r'\bEurop(?:e|ean)\b', r'欧州|ヨーロッパ'),
        'us': (r'\b(?:U\.?S\.?|United States|American)\b', r'米国|アメリカ'),
        'china': (r'\bChin(?:a|ese)\b', r'中国'),
        'japan': (r'\bJapan(?:ese)?\b', r'日本'),
        'korea': (r'\b(?:South )?Korea(?:n)?\b', r'韓国'),
        'taiwan': (r'\bTaiwan(?:ese)?\b', r'台湾'),
    }
    return {key for key, patterns in regions.items() if re.search(patterns[language == 'ja'], text, re.I)}


def _metrics(text, language):
    result = set()
    # Non-HBM is a distinct product universe, not evidence of HBM demand.
    non_hbm = METRICS['non-hbm'][language == 'ja']
    if re.search(non_hbm, text, re.I):
        result.add('non-hbm')
        text = re.sub(non_hbm, '', text, flags=re.I)
    for name, patterns in METRICS.items():
        if name != 'non-hbm' and re.search(patterns[language == 'ja'], text, re.I):
            result.add(name)
    return result


def _inequalities(text):
    """Bind strict/inclusive bounds to their literal percent, in either language."""
    result = set()
    for match in re.finditer(r'(?<![\d.])\d+(?:\.\d+)?\s*[%％]', text):
        value = re.sub(r'\s|％', lambda m: '%' if m[0] == '％' else '', match[0])
        left, right = text[:match.start()].rstrip(), text[match.end():].lstrip()
        relation = None
        if re.search(r'(?:>=|≥|\b(?:at least|no less than))\s*$', left, re.I) or re.match(r'\+|以上', right):
            relation = 'ge'
        elif re.search(r'(?:<=|≤|\b(?:at most|no more than|up to))\s*$', left, re.I) or re.match(r'以下', right):
            relation = 'le'
        elif re.search(r'(?:>|\b(?:more than|over|greater than|in excess of))\s*$', left, re.I) or re.match(r'超|を超', right):
            relation = 'gt'
        elif re.search(r'(?:<|\b(?:less than|under|below))\s*$', left, re.I) or re.match(r'未満', right):
            relation = 'lt'
        if relation:
            result.add((value, relation))
    return result


def validate_periods(text,quote,language):
    """Keep an explicit year horizon distinct from a completion deadline."""
    pattern=re.compile(r'\b(through|until|into|up\s+to|by)\s+(?:(?:the )?end of\s+)?'
                       r'((?:(?:FY|CY|fiscal(?: year)?|calendar(?: year)?)\s*\d{2,4}|(?:19|20|21)\d{2}))'
                       r'(?!\d|\.\d|[%％])',re.I)
    def relations(value):
        result=[]
        for match in pattern.finditer(value):
            tail=value[match.end():]
            word=re.match(r'\s*([A-Za-z]+)',tail)
            # Do not turn a percentage, monetary amount or item count into a
            # year just because it follows "by" (for example grow by 20%).
            if re.match(r'\s*[%％$€£¥]',tail):continue
            if word and word[1].lower() not in {'and','or','but','under','with','while','as','when','if','because',
                                                'in','on','at','for','from','to','after','before','could','would',
                                                'may','might','will','can','should','is','are'}:continue
            result.append((match[1],re.search(r'\d+',match[2])[0]))
        return result
    source=relations(quote)
    for year in dict.fromkeys(year for _,year in source):
        expected=[relation.lower()!='by' for relation,value in source if value==year]
        if language=='en':
            actual=[kind.lower()!='by' for kind,value in relations(text) if value==year]
            if actual!=expected:
                raise ValueError('lost-period-relation')
        else:
            actual=[]
            for match in re.finditer(re.escape(year)+r'(?!\d)',text):
                tail=re.split(r'[。；;\n]|\d',text[match.end():],maxsplit=1)[0][:20]
                before=text[max(0,match.start()-16):match.start()]
                deadline=bool(re.search(r'までに|を期限|をめど|を目処|を目途',tail) or '遅くとも' in before)
                duration=bool(re.search(r'まで(?!に)|にかけ|に(?:も|及|まで)|を通(?:じ|し)',tail))
                if deadline:actual.append(False)
                elif duration:actual.append(True)
            if actual!=expected:
                raise ValueError('lost-period-relation')


def validate(item, unit):
    """Reject known scope/metric/status mutations; retain the parent validators."""
    binding, quote = unit.get('brokerCommentary'), unit.get('quote')
    if not isinstance(binding, dict) or binding.get('scope') not in {'company', 'sector', 'peer'} or not isinstance(quote, str):
        raise ValueError('changed-broker-claim-scope')
    source_metrics = _metrics(quote, 'en')
    source_bounds = _inequalities(quote)
    for language in ('ja', 'en'):
        text = item.get(language) if isinstance(item, dict) else None
        if not isinstance(text, str):
            raise ValueError('changed-broker-claim-scope')
        # Each unit is atomic: retaining a modal does not excuse negating its
        # forecast (or erasing an explicit source negation).
        if bool(re.search(NEGATION[0], quote, re.I)) != bool(re.search(NEGATION[language == 'ja'], text, re.I)):
            raise ValueError('changed-broker-claim-status')
        company = _subject(text, unit['ticker'])
        peer = bool(re.search(PEER[language == 'ja'], text, re.I))
        generic_company = bool(re.search(r'同社|当社|同企業' if language == 'ja'
                                        else r'\b(?:the company|the business|its)\b', text, re.I))
        if (_companies(text) - {unit['ticker']} or
                (binding['scope'] == 'company' and (not company or peer)) or
                (binding['scope'] == 'peer' and (not peer or company or generic_company)) or
                (binding['scope'] == 'sector' and (company or peer or generic_company))):
            raise ValueError('changed-broker-claim-scope')
        if binding['scope'] == 'peer' and _regions(text, language) != _regions(quote, 'en'):
            raise ValueError('changed-broker-claim-scope')
        if any(_firm(match[0]).casefold() != unit['actor'].casefold() for match in FIRM.finditer(text)):
            raise ValueError('changed-broker-actor')
        if FINANCIAL_ACTION.search(text) or _ambiguous_price(text, unit['ticker']):
            raise ValueError('invented-broker-action')
        if binding.get('forecast') and not re.search(MODAL[language == 'ja'], text, re.I):
            raise ValueError('lost-forecast-modality')
        if re.search(POSSIBLE[0], quote, re.I) and not re.search(POSSIBLE[language == 'ja'], text, re.I):
            raise ValueError('changed-broker-claim-status')
        if not binding.get('forecast') and re.search(MODAL[language == 'ja'], text, re.I):
            raise ValueError('changed-broker-claim-status')
        guarantee = r'保証|確約|確実' if language == 'ja' else r'\b(?:guarantee\w*|certain|assured)\b'
        if re.search(guarantee, text, re.I) and not re.search(r'\b(?:guarantee\w*|certain|assured)\b', quote, re.I):
            raise ValueError('changed-broker-claim-status')
        if re.search(r'\bconservative\b', quote, re.I) and not re.search(
                r'控えめ|保守的|慎重|過小|低め' if language == 'ja' else r'\b(?:conservative|cautious|understat\w*)\b', text, re.I):
            raise ValueError('changed-broker-claim-status')
        if re.search(r'\b(?:discussions?|talks|negotiations?)\b', quote, re.I):
            talks = r'協議|交渉|話し合' if language == 'ja' else r'\b(?:discussions?|talks|negotiat\w*)\b'
            completed = r'締結|確保|確定|受注済|契約済' if language == 'ja' else r'\b(?:signed|secured|completed|finali[sz]ed|guaranteed)\b'
            if not re.search(talks, text, re.I) or re.search(completed, text, re.I):
                raise ValueError('changed-broker-claim-status')
        if re.search(r'\balready\b', quote, re.I) and not re.search(r'既に|すでに|もう' if language == 'ja' else r'\balready\b', text, re.I):
            raise ValueError('changed-broker-claim-status')
        if re.search(r'\btight\w*\b', quote, re.I):
            tight = r'逼迫|ひっ迫|タイト|厳し|引き締' if language == 'ja' else r'\btight\w*\b|\bconstrained\b'
            loose = r'緩和|緩む|緩み|潤沢' if language == 'ja' else r'\b(?:loos\w*|eas\w*|abundant)\b'
            if not re.search(tight, text, re.I) or re.search(loose, text, re.I):
                raise ValueError('reversed-supply-demand')
        # The caller checks all exact numbers and their order. Here each atomic
        # unit also keeps the product/metric and explicit temporal relationships.
        output_metrics = _metrics(text, language)
        positive = re.findall(r'[+＋]\s*(\d+(?:\.\d+)?)\s*[%％]', quote)
        # A leading plus does not identify what an unlabelled product figure
        # measures. Do not silently supply growth/demand for that list item.
        explicit_measure = source_metrics & {'bit','demand','growth','asp','revenue','capacity'}
        permitted_metrics = source_metrics | ({'growth'} if positive and explicit_measure else set())
        if source_metrics - output_metrics or output_metrics - permitted_metrics:
            raise ValueError('changed-broker-metric')
        if positive and 'growth' not in output_metrics and any(
                not re.search(r'[+＋]\s*' + re.escape(value) + r'\s*[%％]', text) for value in positive):
            raise ValueError('changed-broker-metric')
        if _inequalities(text) != source_bounds:
            raise ValueError('lost-inequality')
        calendar_years = re.findall(r'(?<![A-Za-z0-9_])CY\s*(\d{2,4})(?![A-Za-z0-9_])', quote, re.I)
        if calendar_years and (re.findall(r'(?<![A-Za-z0-9_])CY\s*(\d{2,4})(?![A-Za-z0-9_])', text, re.I) != calendar_years
                or re.search(r'年度|会計|\bFY\s*\d|\bfiscal\b', text, re.I)):
            raise ValueError('lost-calendar-basis')
        validate_periods(text,quote,language)
