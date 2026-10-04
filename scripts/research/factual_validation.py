"""Deterministic checks for literal numbers and explicit transaction status.

These checks reject known contradictions; they do not prove semantic accuracy.
"""
import re
from decimal import Decimal
from collections import Counter
from datetime import date

from amount_relations import validate_amount_relations
from token_pricing import token_denominators, validate_token_prices


QUANTITY_PATTERN = re.compile(
    r'(?<![\d.,])(?P<before>[+＋\-−]?)\s*(?:[$€£¥]\s*)?'
    r'(?P<after>[+＋\-−]?)\s*(?P<number>\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:[-‑]\s*)?'
    r'(?P<unit>thousand\b|million\b|billion\b|trillion\b|percent\b|パーセント|[KMBT](?![A-Za-z])|[%％]|千|万|億|兆)',
    re.I,
)
UNIT_SCALE = { 'k': 1000, 'thousand': 1000, '千': 1000,
    'm': 1000000, 'million': 1000000, '万': 10000,
    'b': 1000000000, 'billion': 1000000000, '億': 100000000,
    't': 1000000000000, 'trillion': 1000000000000, '兆': 1000000000000 }
MONTHS = {name: i for i, name in enumerate(('January','February','March','April','May','June','July','August','September','October','November','December'), 1)}
MONTH_ABBREVIATIONS = {'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Sept': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12}
MONTH_VALUES = {**MONTHS, **MONTH_ABBREVIATIONS}
# Short month tokens need an explicit following calendar number. This supports
# issuer dates such as "Oct. 1" without treating a bare name like "Mar" as 3.
MONTH_PATTERN = (r'\b(' + '|'.join(MONTHS) + r'|(?:'
                 + '|'.join(MONTH_ABBREVIATIONS) + r')(?=\.?\s+\d))\b\.?')
ORDINALS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4, '一': 1, '二': 2, '三': 3, '四': 4}
SMALL_NUMBERS = {word: i for i, word in enumerate(
    ('zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'))}
RANGE_ENDPOINT = r'(?:\d+(?:\.\d+)?|' + '|'.join(list(SMALL_NUMBERS)[:11]) + r')'
DURATION_RANGE = re.compile(
    r'(?<![A-Za-z0-9_.])(?P<first>' + RANGE_ENDPOINT + r')\s*(?:-to-|to|[–—−\-〜～])\s*'
    r'(?P<last>' + RANGE_ENDPOINT + r')\s*[- ]?\s*'
    r'(?P<unit>seconds?\b|minutes?\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|年間?|か月|ヶ月|日|時間|分|秒)', re.I)
MW_BASIS = re.compile(
    r'\b(?:per|each)\s+(?:(?P<en>[+\-−]?\d+(?:\.\d+)?|one)\s*)?'
    r'(?:megawatts?\b|MW(?![A-Za-z0-9])|メガワット)'
    r'|(?<![A-Za-z0-9_.])(?P<ja>[+\-−]?\d+(?:\.\d+)?)?\s*'
    r'(?:メガワット|MW(?![A-Za-z0-9]))\s*(?:当たり|あたり|につき|毎)', re.I)
MODEL = re.compile(r'(?<![A-Za-z0-9])(?:A100|H100|GB300\s+NVL72)(?![A-Za-z0-9])', re.I)
YEAR_INTERVAL = re.compile(
    r'(?<![A-Za-z0-9_.])(?P<first>' + RANGE_ENDPOINT + r'|eleven|twelve)'
    r'(?:\s*–\s*(?P<last>' + RANGE_ENDPOINT + r'))?\s*[- ]?\s*(?:years?\b|年間?)', re.I)
USEFUL_LIFE = re.compile(r'\b(?:useful|service)\s+life(?:span)?\b|有効寿命|耐用年数|寿命', re.I)
ESTIMATED_LIFE = re.compile(r'\b(?:estimat\w*|project\w*|expect\w*)\b|推定|見積|予測', re.I)
RESALE_ESTIMATE = re.compile(r'\bbased on\b[^.!?;]{0,80}\b(?:resale|resell)\b', re.I)
OBSERVED_SERVICE = re.compile(
    r'\b(?:commercial(?:ly)?\s+(?:service|use[ds]?|valuable|viable)|in\s+service|'
    r'(?:still|remains?|continued?|continues?)\s+(?:\w+\s+){0,3}(?:used|operat\w*)|'
    r'has\s+(?:been\s+)?operat\w*|lasted)\b|商用(?:サービス|利用)|稼働(?:して|し続け|年数)|使われて|利用されて', re.I)


def duration_ranges(text):
    """Normalize only explicit temporal ranges, never free-standing cardinals."""
    def endpoint(value):
        return str(SMALL_NUMBERS[value.lower()]) if value.lower() in SMALL_NUMBERS else value
    return DURATION_RANGE.sub(lambda m: endpoint(m['first']) + '–' + endpoint(m['last'])
                              + ' ' + m['unit'], text)


def duration_value(value):
    return Decimal(SMALL_NUMBERS.get(value.lower(), value))


def model_year_facts(text):
    """Extract a small set of explicit GPU lifetime/service-age relationships.

    A parallel 'five to six years for H100 and nine to 10 years for GB300
    NVL72' list may share a leading useful-life estimate qualifier. Other
    clauses do not supply a model or duration for one another.
    """
    facts = set()
    for sentence in re.split(r'[.!?。！？;；\n]', duration_ranges(text)):
        models, periods = list(MODEL.finditer(sentence)), list(YEAR_INTERVAL.finditer(sentence))
        if not models or not periods:
            continue
        leading = sentence[:min(models[0].start(), periods[0].start())]
        shared = leading if USEFUL_LIFE.search(leading) else ''
        # Keep explicit continued-service predicates with their subject. Split
        # independent coordinated claims, including the two parallel estimates.
        clauses = re.split(r'\s+(?:and|while|whereas|but)'
                           r'(?!\s+(?:still|remains?|continues?|is|are)\b)\s+'
                           r'|,(?!\s*(?:shipped|introduced|launched|released|first|now|still|remains?|'
                           r'continues?|is|are|was|were|has|have|which|whose)\b)\s*|一方|他方|別の|他の',
                           sentence, flags=re.I)
        for clause in clauses:
            models = list(MODEL.finditer(clause))
            periods = list(YEAR_INTERVAL.finditer(clause))
            for period in periods:
                first = duration_value(period['first'])
                last = duration_value(period['last'] or period['first'])
                if first >= 1000 or last >= 1000:
                    continue  # Calendar years are not service-age intervals.
                before = [m for m in models if m.end() <= period.start()]
                after = [m for m in models if m.start() >= period.end()]
                model = None
                parallel = False
                if after and re.fullmatch(
                        r'\s+(?:of\s+(?:useful|service)\s+life\s+)?for\s+'
                        r'(?:(?:an?|the)\s+)?(?:(?:eight|8)[- ]GPU\s+)?',
                        clause[period.end():after[0].start()], re.I):
                    model = after[0]
                    parallel = True
                elif before and period.start() - before[-1].end() <= 180:
                    model = before[-1]
                    # A second period elsewhere in this clause cannot inherit
                    # the model merely because its digits occur nearby.
                    if any(model.end() < p.start() < period.start() for p in periods
                           if duration_value(p['first']) < 1000):
                        model = None
                if model is None:
                    continue
                # Limit qualification to this relation and a leading list
                # qualifier. A neighboring model's assertion is not evidence.
                left = max((m.end() for m in models if m.end() <= min(model.start(), period.start())), default=0)
                right = min((m.start() for m in models if m.start() >= max(model.end(), period.end())), default=len(clause))
                context = (shared if parallel else '') + ' ' + clause[left:right]
                if USEFUL_LIFE.search(context):
                    estimated = ESTIMATED_LIFE.search(context) or (parallel and shared and RESALE_ESTIMATE.search(sentence))
                    basis = 'estimated-useful-life' if estimated else 'useful-life'
                elif OBSERVED_SERVICE.search(context):
                    basis = 'observed-service-age'
                else:
                    continue
                facts.add((' '.join(model[0].upper().split()), first, last, basis))
    return facts


def quarter_values(text):
    values = []
    values.extend(int(x) for x in re.findall(r'第([1-4])四半期', text))
    values.extend(int(x) for x in re.findall(r'(?<![A-Za-z0-9])Q([1-4])(?![A-Za-z0-9])', text, re.I))
    values.extend(ORDINALS[x.lower()] for x in re.findall(r'\b(first|second|third|fourth)[ -]+quarter\b', text, re.I))
    values.extend(ORDINALS[x] for x in re.findall(r'第([一二三四])四半期', text))
    return values


def dates(text):
    result = []
    for m in re.finditer(MONTH_PATTERN + r'\s+(\d{1,2})(?!\d)(?:,?\s+(\d{4}))?', text, re.I):
        month = MONTH_VALUES[m[1].capitalize()]
        result.append((int(m[3]) if m[3] else None, month, int(m[2])))
    for year, month, day in re.findall(r'(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日', text):
        result.append((int(year) if year else None, int(month), int(day)))
    for year, month, day in re.findall(r'(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)', text):
        result.append((int(year), int(month), int(day)))
    for year, month, day in result:
        try:
            date(year or 2000, month, day)
        except ValueError as exc:
            raise ValueError('unsupported-number') from exc
    return result


def numeric_values(text):
    """Canonical exact magnitudes, preserving signs and percent dimensions."""
    text = duration_ranges(text)
    text, values = token_denominators(text)
    def target_count(match):
        if re.search(r'[$€£¥]\s*$', text[:match.start()]):
            return match[0]  # A monetary value is not an experimental target count.
        token = match['en'] or match['ja']
        value = Decimal(SMALL_NUMBERS[token.lower()]) if token.lower() in SMALL_NUMBERS else Decimal(token.replace('−', '-').replace(',', ''))
        values.append((value, 'target-count'))
        return ' ' * len(match[0])
    # An explicit experimental target count has its own basis. It cannot
    # license a date, amount, model number, or a different object count.
    text = re.sub(r'(?<![\w.,\-\u2010-\u2015\u2212])(?P<en>[+\-−]?\d+(?:,\d{3})*|' + '|'.join(SMALL_NUMBERS) +
                  r')\s+(?:protein\s+)?targets?\b|(?<![\d.,])(?P<ja>[+\-−]?\d+(?:,\d{3})*)(?:つの|個の|の)(?:タンパク質)?ターゲット',
                  target_count, text, flags=re.I)
    def per_mw(match):
        denominator = match['en'] or match['ja'] or '1'
        value = Decimal(1) if denominator.lower() == 'one' else Decimal(denominator.replace('−', '-'))
        values.append((value, 'per-MW'))
        # An explicit denominator is represented once, with its basis; it must
        # never supply a generic 1 for an invented year, GPU, or GW quantity.
        return ' ' * len(match[0])
    text = MW_BASIS.sub(per_mw, text)
    # Japanese amounts can combine a scaled part and a remainder: 15万6,000.
    # Normalize only contiguous descending integer components, never separate
    # amounts, decimals, or ascending/repeated units.
    def compound(match):
        parts = re.findall(r'(\d+(?:,\d{3})*)([兆億万千]?)', match[0])
        scales = [UNIT_SCALE.get(unit, 1) for _, unit in parts]
        if len(parts) < 2 or any(a <= b for a, b in zip(scales, scales[1:])):
            return match[0]
        if any(Decimal(n.replace(',', '')) * scale >= previous
               for (n, _), scale, previous in zip(parts[1:], scales[1:], scales)):
            return match[0]
        return str(sum(Decimal(n.replace(',', '')) * scale
                       for (n, _), scale in zip(parts, scales)))
    text = re.sub(r'(?<![\d.,])\d+(?:,\d{3})*[兆億万千](?:\d+(?:,\d{3})*[兆億万千])*(?:\d+(?:,\d{3})*)?(?![\d.,])', compound, text)
    remaining = list(text)
    for m in QUANTITY_PATTERN.finditer(text):
        unit = m['unit'].lower()
        if unit in ('k', 'm', 'b', 't') and m.start('number') > 0 and text[m.start('number')-1].isascii() and text[m.start('number')-1].isalpha():
            continue  # Product identifiers such as GH100B are not monetary scales.
        value = Decimal(m['number'].replace(',', ''))
        if (m['after'] or m['before']) in ('-', '−') or (unit in UNIT_SCALE and (m['after'] or m['before']) not in ('+', '＋') and text[:m.start()].rstrip().endswith('(') and text[m.end():].lstrip().startswith(')')):
            value = -value
        unit = m['unit'].lower()
        values.append((value * UNIT_SCALE.get(unit, 1), 'number' if unit in UNIT_SCALE else 'percent'))
        remaining[m.start():m.end()] = ' ' * (m.end() - m.start())
    values.extend((v, 'number') for v in signed_numbers(''.join(remaining)))
    # Spelled calendar terms have numeric Japanese equivalents; no arbitrary
    # number is admitted, and date/quarter relationships are checked separately.
    values.extend((Decimal(MONTH_VALUES[m[1].capitalize()]), 'number') for m in re.finditer(MONTH_PATTERN, text, re.I))
    values.extend((Decimal(ORDINALS[x.lower()]), 'number') for x in re.findall(r'\b(first|second|third|fourth)[ -]+quarter\b', text, re.I))
    values.extend((Decimal(ORDINALS[x]), 'number') for x in re.findall(r'第([一二三四])四半期', text))
    # A spelled duration is still a factual number, not optional English prose.
    # Restrict this to explicit time units so articles/idioms such as "one of"
    # do not cause blanket rejections of otherwise equivalent translations.
    values.extend((Decimal(SMALL_NUMBERS[x.lower()]), 'number') for x in re.findall(
        r'\b(' + '|'.join(SMALL_NUMBERS) + r')[ -]+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b', text, re.I))
    # Explicit object/person counts may spell the number before a noun.
    # Exclude 'one of ...' idioms, which do not assert a standalone quantity.
    values.extend((Decimal(SMALL_NUMBERS[m[1].lower()]), 'number') for m in re.finditer(
        r'\b(' + '|'.join(SMALL_NUMBERS) + r')\s+(?!(?:of|another)\b)'
        r'(?:(?!(?:of|another)\b)[A-Za-z0-9.-]+\s+){0,4}'
        r'(?:units?|GPUs?|DPUs?|servers?|devices?|chips?|layers?|encoders?|speakers?|people|persons?|students?|participants?|employees?|halls?)\b', text, re.I))
    return values


def numbers(text):
    return re.findall(r'\d+(?:[.,]\d+)*', text)


def signed_numbers(text):
    values=[]
    pattern=r'(?P<before>[+＋\-−]?)\s*(?:[$€£¥]\s*)?(?P<after>[+＋\-−]?)\s*(?P<number>\d+(?:,\d{3})*(?:\.\d+)?)'
    for match in re.finditer(pattern,text):
        before, after=match['before'],match['after']
        if before and match.start()>0 and text[match.start()-1].isalnum():
            before=''  # A product identifier such as MI-450 is not a negative value.
        sign=after or before
        prefix=text[:match.start()].rstrip()
        suffix=text[match.end():].lstrip()
        accounting=prefix.endswith('(') and suffix.startswith(')')
        value=Decimal(match['number'].replace(',',''))
        if sign in ('-','−') or accounting:
            value=-value
        values.append(value)
    return values


def validate_numbers(text, evidence):
    # Compare exact quantities rather than numeric spelling: $150B equals
    # 1500億ドル; $15B, 1500万ドル and -1500億ドル do not.
    if not set(numeric_values(text)).issubset(set(numeric_values(evidence))):
        raise ValueError('unsupported-number')
    validate_token_prices(text, evidence)
    if not set(quarter_values(text)).issubset(set(quarter_values(evidence))):
        raise ValueError('unsupported-number')
    source_dates = dates(evidence)
    for year, month, day in dates(text):
        if not any(month == sm and day == sd and (year is None or year == sy) for sy, sm, sd in source_dates):
            raise ValueError('unsupported-number')
    if not model_year_facts(text).issubset(model_year_facts(evidence)):
        raise ValueError('unsupported-number')


def quantities(values):
    counts = Counter(values)
    ordered = sorted(counts, key=lambda item: (item[1], item[0]))
    return [{'value': str(value), 'dimension': unit, 'count': counts[(value, unit)]}
            for value, unit in ordered[:20]]


def number_checks(item):
    """Explain numeric failures using quantities/relationships, never prose."""
    if not all(isinstance(item.get(key), str) for key in ('ja', 'en', 'evidenceQuote')):
        return []
    result = []
    for language in ('ja', 'en'):
        text, evidence = item[language], item['evidenceQuote']
        unsupported = set(numeric_values(text)) - set(numeric_values(evidence))
        if unsupported:
            result.append({'check': language + '-evidence-quantity',
                           'unsupported': quantities(unsupported), 'truncated': len(unsupported) > 20})
        try:
            validate_token_prices(text, evidence)
        except ValueError:
            result.append({'check': language + '-evidence-token-price'})
        quarters = sorted(set(quarter_values(text)) - set(quarter_values(evidence)))
        if quarters:
            result.append({'check': language + '-evidence-quarter', 'unsupported': quarters})
        try:
            source_dates = dates(evidence)
            unsupported_dates = [list(value) for value in dates(text)
                                 if not any(value[1:] == source[1:] and (value[0] is None or value[0] == source[0])
                                            for source in source_dates)]
            if unsupported_dates:
                result.append({'check': language + '-evidence-date',
                               'unsupported': unsupported_dates[:20], 'truncated': len(unsupported_dates) > 20})
        except ValueError:
            result.append({'check': language + '-invalid-calendar-date'})
        unsupported_facts = sorted(model_year_facts(text) - model_year_facts(evidence))
        if unsupported_facts:
            result.append({'check': language + '-evidence-model-duration', 'unsupported': [
                {'model': model, 'minYears': str(first), 'maxYears': str(last), 'basis': basis}
                for model, first, last, basis in unsupported_facts[:20]],
                'truncated': len(unsupported_facts) > 20})
    ja, en = Counter(numeric_values(item['ja'])), Counter(numeric_values(item['en']))
    if ja != en:
        result.append({'check': 'bilingual-quantity-count', 'jaOnly': quantities((ja - en).elements()),
                       'enOnly': quantities((en - ja).elements()), 'truncated': len(ja - en) > 20 or len(en - ja) > 20})
    for language, other in [('ja', 'en'), ('en', 'ja')]:
        try:
            validate_numbers(item[language], item[other])
        except ValueError:
            result.append({'check': language + '-other-language-numbers'})
    return result


def planned_acquisition(text):
    return bool(re.search(r'\bto acquire\b|\b(?:planned|proposed|pending) acquisition\b|\bacquisition agreement\b', text, re.I))


def validate_acquisition(text, source, language, require_status=False):
    if not planned_acquisition(source):
        return
    completed = (r'買収(?:済み?|を完了|が完了|した|しました)|買収完了' if language == 'ja'
                 else r'\bacquired\b|\bcompleted\b.{0,50}\bacquisition\b|\bacquisition\b.{0,50}\bcompleted\b')
    if re.search(completed, text, re.I):
        raise ValueError('invalid-copy')
    planned = (r'計画|予定|契約|合意|買収へ|買収する方針' if language == 'ja'
               else r'\bto acquire\b|agreement|plans?|intends?|will acquire|proposed|pending')
    if require_status and not re.search(planned, text, re.I):
        raise ValueError('invalid-copy')


SEMANTIC_POLARITIES = (
    (r'\b(?:increas(?:e|ed|es|ing)|ris(?:e|es|ing)|rose|grew|growth|higher|surg(?:e|es|ed|ing))\b|増加|増収|増益|上昇|急騰',
     r'\b(?:decreas(?:e|ed|es|ing)|fall(?:s|ing)?|fell|declin(?:e|ed|es|ing)|lower|drop(?:s|ped|ping)?)\b|減少|減収|減益|下落|急落'),
    (r'\b(?:net income|net profit)\b|純利益', r'\bnet loss\b|純損失'),
)


# Only explicit, translatable comparator identities are recognized. These are
# baseline classes, not publisher/model/article keywords. Unknown comparators
# remain outside this deterministic check; recognized ones must not disappear
# or be replaced merely because the percentage still matches.
COMPARISON_BASELINES = {
    'human-experts': (
        r'(?:human\s+)?experts?\b',
        r'(?:人間の?|ヒトの?|人の)?専門家',
    ),
    'previously-known': (
        r'(?:previously|already)\s+(?:known|identified|detected|recorded)\b',
        r'既知|既存の検出(?:結果|数|量)?|従来知られていた(?:もの|排出)?',
    ),
}
COMPARISON_DIRECTIONS = {
    'more': (r'more|higher|greater|faster', r'多(?:い|く)|高(?:い|く)|大き(?:い|く)|速(?:い|く)'),
    'less': (r'less|fewer|lower|slower', r'少な(?:い|く)|低(?:い|く)|小さ(?:い|く)|遅(?:い|く)'),
}
COMPARISON_PERCENT = (r'(?<![\d.])(?P<amount>\d+(?:\.\d+)?)\s*'
                      r'(?:[%％]|percent\b|パーセント)')
COMPARISON_CLAUSE = r'[^.!?。！？;；\n]'


def percentage_comparisons(text):
    """Bind percent, direction, and an explicit bilingual comparison baseline.

    A baseline mentioned elsewhere cannot supply a missing comparator. Keep
    each match inside its own clause, with the baseline next to than/より/etc.
    This intentionally does not infer identities for arbitrary names or prose.
    """
    result = set()
    for baseline, (english, japanese) in COMPARISON_BASELINES.items():
        for direction, (en_direction, ja_direction) in COMPARISON_DIRECTIONS.items():
            patterns = (
                COMPARISON_PERCENT + r'\s+(?:' + en_direction + r')\b'
                + COMPARISON_CLAUSE + r'{0,90}?\b(?:than|compared (?:with|to)|versus|vs\.?)[ ]+'
                r'(?:the\s+)?(?:' + english + r')',
                r'\b(?:compared (?:with|to)|versus|vs\.?)[ ]+(?:the\s+)?(?:' + english + r')'
                + COMPARISON_CLAUSE + r'{0,90}?' + COMPARISON_PERCENT
                + r'\s+(?:' + en_direction + r')\b',
                r'(?:' + japanese + r')'
                r'(?:(?:の|による|が)(?:検出|測定)(?:する|した)?(?:結果|数|量)?)?'
                r'(?:より(?:も)?|と比べ(?:て)?|と比較して)'
                + COMPARISON_CLAUSE + r'{0,60}?' + COMPARISON_PERCENT
                + r'\s*(?:ほど|程度|約)?(?:' + ja_direction + r')',
            )
            for pattern in patterns:
                result.update((Decimal(match['amount']), direction, baseline)
                              for match in re.finditer(pattern, text, re.I))
    return result


def validate_comparison_baselines(text, evidence):
    source = percentage_comparisons(evidence)
    if not source:
        return
    percentages = {value for value, dimension in numeric_values(text) if dimension == 'percent'}
    required = {relation for relation in source if relation[0] in percentages}
    actual = percentage_comparisons(text)
    if required != {relation for relation in actual if relation[0] in {r[0] for r in required}}:
        raise ValueError('unsupported-comparison-baseline')




def validate_execution_and_capacity(text, evidence):
    """Keep a through-period distinct from a deadline, and ability from action.

    These are narrow relation checks on explicit fiscal periods and financial
    capabilities. Unrelated use of a year or operational capacity is unchanged.
    """
    periods = set(re.findall(r'\bthrough\s+(?:fiscal(?:\s+year)?\s+|FY\s*)(20\d{2})\b', evidence, re.I))
    for year in periods:
        if re.search(r'(?:' + year + r'(?:会計)?年度?|FY\s*' + year + r')[^。;；\n]{0,12}までに', text, re.I):
            raise ValueError('changed-execution-period')
        if re.search(r'\bby\s+(?:the\s+end\s+of\s+)?(?:fiscal(?:\s+year)?\s+|FY\s*)' + year + r'\b', text, re.I):
            raise ValueError('changed-execution-period')
    # Qualify the actual actions in the capacity clause, not another unrelated
    # "can" elsewhere in the announcement or an achieved cash-flow amount.
    topics = (r'\binvest(?:s|ed|ing|ments?)?\b|投資',
              r'\b(?:return(?:s|ed|ing)?\s+capital|capital\s+returns?)\b|株主[^。;；\n]{0,12}(?:還元|資本)|資本還元|株主還元')
    capacity = r'\b(?:capacity|ability)\s+to\b|\b(?:can|able\s+to)\b|能力|余力|可能|できる|行える'
    # Bare coordinated verbs can inherit a shared modal ('can invest and
    # return'). A separately tensed/modal predicate cannot borrow that modal
    # ('can invest and has returned'). Include past forms in the topic match.
    predicate = r'(?:(?:it|they|we|the\s+company)\s+)?(?:has|have|had|is|are|was|were|will|shall|must|can|invests|invested|investing|returns|returned|returning)\b'
    boundary = (r'(?<=[.!?])\s+|[。;；\n]|,\s*(?=' + predicate + r')'
                r'|\b(?:and|but|while|whereas)\s+(?=' + predicate + r')'
                r'|一方|しかし|だが|(?<=できる)が[、]?')
    source_clauses = re.split(boundary, evidence, flags=re.I)
    output_clauses = re.split(boundary, text, flags=re.I)
    for topic in topics:
        if not any(re.search(topic, clause, re.I) and re.search(capacity, clause, re.I) for clause in source_clauses):
            continue
        for clause in output_clauses:
            if re.search(topic, clause, re.I) and not re.search(capacity, clause, re.I):
                raise ValueError('changed-action-capacity')
            # Japanese coordination can retain a 読点 rather than a sentence
            # boundary. Bind an explicit action predicate to its preceding
            # topic; a neighboring investment's できる cannot qualify a capital
            # return already 実施した (or the reverse). Shared noun lists such
            # as 投資と株主還元を行える remain valid.
            starts = [match.start() for item in topics for match in re.finditer(item, clause, re.I)]
            for match in re.finditer(topic, clause, re.I):
                if not re.search(r'[一-龯ぁ-んァ-ン]', match[0]):
                    continue
                end = min((start for start in starts if start > match.start()), default=len(clause))
                predicate_text = clause[match.end():end]
                action = (r'^(?:を|も|は|に|が)?\s*(?:した|している|しており|する)'
                          r'|(?:実施|実行|完了|開始)(?:した|している|しており|する|し(?=[、，]))'
                          r'|行(?:った|っている|っており|う)')
                # 行う能力/することができる qualify this same action, unlike
                # an earlier unrelated investment's ability elsewhere.
                qualified = r'\s*(?:能力|余力|こと(?:が|は|の)(?:できる|可能))'
                if any(not re.match(qualified, predicate_text[action_match.end():])
                       for action_match in re.finditer(action, predicate_text)):
                    raise ValueError('changed-action-capacity')


def validate_semantics(text, evidence):
    validate_execution_and_capacity(text, evidence)
    validate_amount_relations(text, evidence)
    validate_comparison_baselines(text, evidence)
    if re.search(r'idle GPU tax', evidence, re.I) and re.search(r'課税|税金|税負担', text):
        raise ValueError('invalid-copy')  # Resource overhead metaphor, not taxation.
    future_integration = r'\bwill (?:integrate|work\b[^.!?]{0,240}\bintegration)\b'
    ongoing_integration = r'\b(?:is|are|now)\s+(?:\w+\s+){0,3}integrating\b|\b(?:has|have) integrated\b'
    if (re.search(future_integration, evidence, re.I)
            and not re.search(ongoing_integration, evidence, re.I)
            and re.search(ongoing_integration + r'|統合(?:を進めている|中|した|済み|を完了)', text, re.I)):
        raise ValueError('invalid-copy')
    for positive, negative in SEMANTIC_POLARITIES:
        if re.search(positive,text,re.I) and re.search(negative,evidence,re.I) and not re.search(positive,evidence,re.I):
            raise ValueError('invalid-copy')
        if re.search(negative,text,re.I) and re.search(positive,evidence,re.I) and not re.search(negative,evidence,re.I):
            raise ValueError('invalid-copy')


def validate_pair(ja, en):
    validate_execution_and_capacity(ja, en)
    validate_execution_and_capacity(en, ja)
    validate_amount_relations(ja, en)
    validate_amount_relations(en, ja)
    validate_comparison_baselines(ja, en)
    validate_comparison_baselines(en, ja)
    validate_numbers(ja, en)
    validate_numbers(en, ja)
    if Counter(numeric_values(ja))!=Counter(numeric_values(en)):
        raise ValueError('unsupported-number')
    # Match the outcome being qualified, not a blanket "aim" anywhere in the
    # sentence: a completed acquisition may legitimately have a future purpose.
    for english, japanese, past in (
        (r'improv\w*|enhanc\w*', r'改善|向上', r'improved|enhanced'),
        (r'reduc\w*|cut\w*', r'削減|短縮|低減', r'reduced'),
        (r'increas\w*', r'増加', r'increased'),
        (r'expand\w*', r'拡大|拡張', r'expanded'),
        (r'strengthen\w*', r'強化', r'strengthened'),
    ):
        en_goal = re.search(r'\b(?:to|will|would|could|may) (?:' + english + r')\b', en, re.I)
        ja_achieved = re.search(r'(?:' + japanese + r')(?:させた|した|しました|された|を実現した)', ja)
        ja_goal = re.search(r'(?:' + japanese + r')[^。、]{0,12}(?:目指|目的|狙|見込|予定|ため)', ja)
        en_achieved = re.search(r'\b(?:' + past + r')\b', en, re.I)
        if (en_goal and ja_achieved) or (ja_goal and en_achieved and not en_goal):
            raise ValueError('invalid-copy')
    for positive, negative in SEMANTIC_POLARITIES:
        if ((re.search(positive,ja,re.I) and re.search(negative,en,re.I))
                or (re.search(negative,ja,re.I) and re.search(positive,en,re.I))):
            raise ValueError('invalid-copy')
