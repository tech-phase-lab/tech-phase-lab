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
    # "Per share" is written 1株当たり in Japanese; the 1 is not a quantity.
    text = re.sub(r'(?:1|１|一)株(?=当たり|あたり)', '株', text)
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


def validate_numbers(text, evidence, check_dates=True):
    # Compare exact quantities rather than numeric spelling: $150B equals
    # 1500億ドル; $15B, 1500万ドル and -1500億ドル do not.
    if not set(numeric_values(text)).issubset(set(numeric_values(evidence))):
        raise ValueError('unsupported-number')
    validate_token_prices(text, evidence)
    if not set(quarter_values(text)).issubset(set(quarter_values(evidence))):
        raise ValueError('unsupported-number')
    source_dates = dates(evidence)
    for year, month, day in (dates(text) if check_dates else ()):
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


# Failure codes for the meaning checks below. Every publication lane treats
# them like any other deterministic validation failure: the copy is held and
# the original source remains the only published evidence.
MEANING_FAILURES = frozenset({
    'changed-direction', 'changed-metric-direction', 'changed-negation', 'changed-names',
})

# Shared prompt text, so every model lane is told the same rules that the
# validators below enforce after generation.
MEANING_POLICY = (' Never reverse a direction: rise/increase/raise/beat/upgrade/profit/win/approve must stay '
                  '上昇・増加・引き上げ・上回る・格上げ・黒字・獲得・承認 (and fall/decrease/cut/miss/downgrade/loss/lose/reject '
                  'must stay 下落・減少・引き下げ・下回る・格下げ・赤字・失う・却下), and keep each direction attached to its own '
                  'metric (revenue, margin, EPS, guidance, shares). Keep every negation (not, no, never, fails to, denies) '
                  'as a negation. Keep company names, tickers and person names exactly as written in the source.')

# Each family is (up English, up Japanese, down English, down Japanese). A
# family only rejects copy that introduces a direction the source contradicts;
# copy that omits a direction is left to the other completeness checks.
DIRECTION_FAMILIES = (
    ('level',
     r"\b(?:ris(?:e|es|ing|en)|rose|increas(?:e|ed|es|ing)|gr(?:ow|ows|ew|own|owing|owth)|gain(?:s|ed|ing)?"
     r"|jump(?:s|ed|ing)?|surg(?:e|es|ed|ing)|soar(?:s|ed|ing)?|climb(?:s|ed|ing)?|rall(?:y|ies|ied|ying)"
     r"|rebound(?:s|ed|ing)?|spik(?:e|es|ed|ing)|higher|rais(?:e|es|ed|ing)|lift(?:s|ed|ing)?|boost(?:s|ed|ing)?"
     r"|hik(?:e|es|ed|ing)|expand(?:s|ed|ing)?|expansion|widen(?:s|ed|ing)?|wider|up\s+[$€£¥]?\d)",
     r'増加|増収|増益|増額|増配|上昇|急騰|高騰|反発|伸び|伸長|引き上げ|上方修正|値上げ|利上げ|拡大|(?:[%％]|ポイント|倍)\s*増(?![資])',
     r"\b(?:fall(?:s|ing|en)?|fell|decreas(?:e|ed|es|ing)|declin(?:e|ed|es|ing)|drop(?:s|ped|ping)?|dip(?:s|ped|ping)?"
     r"|slip(?:s|ped|ping)?|slid(?:e|es|ing)?|plung(?:e|es|ed|ing)|plummet(?:s|ed|ing)?|sink(?:s|ing)?|sank|sunk"
     r"|tumbl(?:e|es|ed|ing)|slump(?:s|ed|ing)?|lower(?:s|ed|ing)?|cut(?:s|ting)?|reduc(?:e|es|ed|ing|tion)"
     r"|trim(?:s|med|ming)?|slash(?:es|ed|ing)?|shrink(?:s|ing)?|shrank|narrow(?:s|ed|ing|er)?|slow(?:s|ed|ing|er|down)?"
     r"|down\s+[$€£¥]?\d)",
     r'減少|減収|減益|(?<!軽)減額|減配|下落|急落|反落|低下|落ち込|引き下げ|下方修正|値下げ|利下げ|削減|縮小|減速|(?:[%％]|ポイント)\s*減(?![資損])'),
    ('quality',
     r'\b(?:improv(?:e|es|ed|ing|ement)|strengthen(?:s|ed|ing)?|better)\b', r'改善|好転|強化',
     r'\b(?:worsen(?:s|ed|ing)?|deteriorat\w*|weaken(?:s|ed|ing)?|worse)\b', r'悪化|弱含|弱体化'),
    ('expectation',
     r'\b(?:beat(?:s|ing)?|exceed(?:s|ed|ing)?|top(?:s|ped)?\s+(?:estimates|expectations|forecasts|consensus)'
     r'|above\s+(?:estimates|expectations|forecasts|consensus))\b',
     r'上回',
     r'\b(?:miss(?:es|ed|ing)?|below\s+(?:estimates|expectations|forecasts|consensus)|f(?:a|e)ll(?:s|ing)?\s+short|shy\s+of)\b',
     r'下回|届かず|届かなかった|未達'),
    ('rating',
     r'\bupgrad(?:e|es|ed|ing)\b', r'格上げ',
     r'\bdowngrad(?:e|es|ed|ing)\b', r'格下げ'),
    ('recommendation',
     r'\b(?:buy|outperform|overweight)\b', r'買い(?:推奨|評価)?|アウトパフォーム|オーバーウェイト',
     r'\b(?:sell|underperform|underweight)\b', r'売り(?!上)|アンダーパフォーム|アンダーウェイト'),
    ('result',
     r'\b(?:net (?:income|profit)|profitab\w*|(?:swung|swings|turned|turns) to (?:a )?profit)\b', r'純利益|黒字',
     r'\b(?:net loss|loss(?:es)?|(?:swung|swings|turned|turns) to (?:a )?loss)\b', r'純損失|赤字|損失'),
    ('award',
     r'\b(?:win(?:s|ning)?|won|awarded)\b', r'獲得|受注|勝ち取|落札',
     r'\b(?:los(?:e|es|ing))\b', r'失う|失った|失注|喪失|逃し|逃す'),
    ('decision',
     r'\b(?:approv(?:e|es|ed|al))\b', r'承認|可決|認可',
     r'\b(?:reject(?:s|ed|ion)?|block(?:s|ed)?)\b', r'却下|否決|阻止'),
)

# Metrics whose direction must not be swapped with another metric's direction
# in a mixed headline ("revenue rose while margin declined"). Order matters:
# more specific labels are matched first and claim their characters.
DIRECTION_METRICS = (
    ('margin', r'\bmargins?\b', r'利益率|マージン'),
    ('eps', r'\bEPS\b|\bearnings per share\b', r'EPS|1株(?:当たり)?利益|一株当たり利益'),
    ('target', r'\bprice targets?\b|\btarget prices?\b', r'目標株価'),
    ('revenue', r'\brevenues?\b|\bsales\b', r'売上高?|売り上げ|増収|減収'),
    ('profit', r'\b(?:net income|operating income|profits?|earnings)\b', r'利益|増益|減益'),
    ('guidance', r'\bguidance\b|\boutlook\b', r'見通し|ガイダンス|業績予想'),
    ('shares', r'\bshares\b|\bstock\b', r'株価'),
)
CLAUSE_BOUNDARY = (r'[.;!?。；！？\n、,]|\b(?:while|whereas|but|and|as|although|though|despite|after)\b'
                   r'|一方|ものの|にもかかわらず')

NEGATION_EN = (r"\b(?:not(?!\s+only)|never|no\s+longer|cannot|fails?\s+to|failed\s+to|unable\s+to|den(?:y|ies|ied)"
               r"|no\s+(?:plans?|intention|change|deal|agreement|evidence|decision))\b|n['’]t\b")
NEGATION_EN_BROAD = NEGATION_EN + (r"|\b(?:no|none|nor|without|delay(?:s|ed)?|postpone(?:s|d)?|halt(?:s|ed)?"
                                   r"|suspend(?:s|ed)?|cancel(?:s|ed|led)?|withdr[ae]w\w*|scrap(?:s|ped)?|shelve[sd]?"
                                   r"|reject(?:s|ed)?|block(?:s|ed)?)\b")
NEGATION_JA = r'しない|しなかった|ではない|でない|せず|否定|見送|ません|なかった|できない'
NEGATION_JA_BROAD = NEGATION_JA + r'|ない|ず|なし|無し|なく|未|不|非|拒否|撤回|中止|断念|停止|失敗|延期'
WHETHER_OR_NOT = r'\b(?:whether\s+or\s+not|or\s+not)\b'


def _has(pattern, text):
    return bool(re.search(pattern, text, re.I))


def directions(text, family):
    _name, up_en, up_ja, down_en, down_ja = family
    return ({'up'} if _has(up_en, text) or _has(up_ja, text) else set()) | (
        {'down'} if _has(down_en, text) or _has(down_ja, text) else set())


def validate_directions(text, evidence):
    """Reject copy that states a direction the source only states the other way."""
    for family in DIRECTION_FAMILIES:
        stated, source = directions(text, family), directions(evidence, family)
        for direction in stated - source:
            if ({'up', 'down'} - {direction}) & source:
                raise ValueError('changed-direction')


def metric_directions(text):
    """Return metric -> direction for clauses with exactly one metric and one direction."""
    level = DIRECTION_FAMILIES[0]
    found = {}
    for clause in re.split(CLAUSE_BOUNDARY, text, flags=re.I):
        remaining, metrics = clause, set()
        for metric, english, japanese in DIRECTION_METRICS:
            pattern = '(?:' + english + ')|(?:' + japanese + ')'
            if _has(pattern, remaining):
                metrics.add(metric)
                remaining = re.sub(pattern, ' ', remaining, flags=re.I)
        stated = directions(clause, level)
        if len(metrics) == 1 and len(stated) == 1:
            found.setdefault(metrics.pop(), set()).update(stated)
    return {metric: values.pop() for metric, values in found.items() if len(values) == 1}


def validate_metric_directions(text, evidence):
    stated, source = metric_directions(text), metric_directions(evidence)
    if any(source.get(metric) not in (None, direction) for metric, direction in stated.items()):
        raise ValueError('changed-metric-direction')


def negated(text, broad=False):
    text = re.sub(WHETHER_OR_NOT, ' ', text, flags=re.I)
    return _has((NEGATION_EN_BROAD + '|' + NEGATION_JA_BROAD) if broad else (NEGATION_EN + '|' + NEGATION_JA), text)


CONTENT_WORD = re.compile(r"[a-z][a-z0-9+&'’-]*[a-z0-9+]|[0-9][0-9.,%]*")
FUNCTION_WORDS = frozenset({
    'the', 'a', 'an', 'it', 'its', 'is', 'are', 'was', 'were', 'be', 'been', 'will', 'would', 'to', 'of', 'in',
    'on', 'at', 'for', 'by', 'with', 'from', 'that', 'this', 'has', 'have', 'had', 'do', 'does', 'did', 'not',
    'never', 'no', 'longer', 'cannot', 'can', 'yet', 'so', 'than', 'they', 'we', 'he', 'she', 'his', 'her',
    'their', 'our', 'us', 'also', 'any', 'into', 'over',
})
NEGATED_CLAUSE_COVERAGE = 0.5
JAPANESE_CHARACTER = re.compile(r'[぀-ヿ一-鿿]')
# One Japanese character carries roughly as much as two English characters.
# Japanese copy whose weighted length is well under the source's is a summary.
TRANSLATION_LENGTH_RATIO = 2.0


def _weighted_length(text):
    return len(text) + len(JAPANESE_CHARACTER.findall(text))


def _content_words(text):
    return {word for word in CONTENT_WORD.findall(text.lower()) if word not in FUNCTION_WORDS}


def _covers_negated_source(text, evidence):
    """Whether the copy restates a negated part of the source (so it must keep the negation).

    A one-line summary may leave out a negated side clause entirely ("Brent rises
    2% as OPEC+ says it will not raise output" -> "Brent rises 2%"). Leaving it
    out is not a reversal; restating it without the negation is.
    """
    if JAPANESE_CHARACTER.search(text) and not JAPANESE_CHARACTER.search(evidence):
        # Cross-language: compare only translation-length copy. Summary-length
        # Japanese is checked against its English counterpart in validate_pair.
        return _weighted_length(evidence) <= TRANSLATION_LENGTH_RATIO * _weighted_length(text)
    if JAPANESE_CHARACTER.search(text) or JAPANESE_CHARACTER.search(evidence):
        return True
    copy = _content_words(text)
    for clause in re.split(CLAUSE_BOUNDARY, re.sub(WHETHER_OR_NOT, ' ', evidence, flags=re.I), flags=re.I):
        if not clause or not negated(clause):
            continue
        words = _content_words(clause)
        if len(words) <= 1 or len(words & copy) >= max(2, NEGATED_CLAUSE_COVERAGE * len(words)):
            return True
    return False


def validate_negation(text, evidence):
    """A negated source keeps a negation; an affirmative source gains none."""
    if negated(evidence) and not negated(text, broad=True) and _covers_negated_source(text, evidence):
        raise ValueError('changed-negation')
    if negated(text) and not negated(evidence, broad=True):
        raise ValueError('changed-negation')


NAME_TOKEN = re.compile(r'[A-Za-z][A-Za-z0-9&.\'’-]*[A-Za-z0-9]|[A-Za-z]')
# Abbreviations a correct translation may introduce for spelled-out English.
NAME_ALLOWANCE = frozenset({
    'q1', 'q2', 'q3', 'q4', 'h1', 'h2', 'fy', 'eps', 'yoy', 'qoq', 'ceo', 'cfo', 'coo', 'cto', 'ai', 'ipo',
    'etf', 'usd', 'us', 'u.s', 'uk', 'eu', 'vs', 'pt', 'sec', 'ir', 'gpu', 'cpu', 'hbm', 'dram', 'nand',
    'k', 'm', 'b', 'bn', 'mn', 'tn', 'x', 'q', 'pce', 'cpi', 'gdp', 'fomc', 'fed', 'frb', 'boj', 'ecb',
    # Units are spelled out in English but abbreviated in Japanese (2MW = 2 megawatts).
    'w', 'kw', 'mw', 'gw', 'kwh', 'mwh', 'gwh', 'twh', 'kb', 'mb', 'gb', 'tb', 'pb', 'nm', 'mhz', 'ghz',
    'gbps', 'tbps', 'kg', 'km', 'mm', 'cm',
})


def _provider_name_groups():
    """Ticker, registered name and common long forms for each monitored company."""
    import json
    from pathlib import Path
    groups = []
    try:
        providers = json.loads((Path(__file__).resolve().parents[2] / 'lib/research/providers.json').read_text())
    except (OSError, ValueError):
        providers = []
    for provider in providers:
        names = {provider.get('ticker', ''), *str(provider.get('name', '')).split(' / ')}
        groups.append({name.lower() for name in names if name})
    groups += [{'tsmc', 'tsm', 'taiwan semiconductor', 'taiwan semiconductor manufacturing'},
               {'amd', 'advanced micro devices'}, {'googl', 'goog', 'google', 'alphabet'},
               {'aws', 'amazon web services', 'amazon'}, {'meta', 'facebook', 'meta platforms'},
               {'openai', 'open ai'}, {'fed', 'frb', 'federal reserve'}, {'boj', 'bank of japan'},
               {'ecb', 'european central bank'}, {'sk hynix', 'skhy', 'hynix'}]
    return groups


NAME_GROUPS = _provider_name_groups()


def _compact(text):
    return re.sub(r'[^a-z0-9&+]', '', text)


def _mentioned(word, english):
    if re.search(r'(?<![a-z])' + re.escape(word) + r'(?![a-z0-9])', english):
        return True
    # The same name spaced or hyphenated differently (S&P500 / S&P 500, Wi-Fi / WiFi).
    # Only for names with digits or symbols, so a short word never matches
    # inside an unrelated longer one.
    compact = _compact(word)
    return len(compact) >= 3 and not word.isalpha() and compact in _compact(english)


# The last unmatched name (one token, for diagnostics; never article text).
LAST_NAME_REJECTION = ['']


def validate_names(ja, en):
    """Tickers must match exactly; Latin-script names in Japanese must appear in English.

    A company may be written differently in each language (Taiwan Semiconductor
    in English, TSMC in Japanese); such known aliases count as the same name.
    """
    if set(re.findall(r'\$[A-Z]{1,6}\b', ja)) != set(re.findall(r'\$[A-Z]{1,6}\b', en)):
        raise ValueError('changed-names')
    english = en.lower()
    for token in NAME_TOKEN.findall(ja):
        word = token.lower().rstrip('.')
        if word in NAME_ALLOWANCE or re.fullmatch(r'(?:fy|q[1-4]|h[12])\d*', word):
            continue
        # A unit or abbreviation written against its number (GPU5万基, AI2社).
        if re.fullmatch(r'[a-z]{2,}\d+', word) and re.sub(r'\d+$', '', word) in NAME_ALLOWANCE:
            continue
        if _mentioned(word, english):
            continue
        if any(word in group and any(_mentioned(alias, english) for alias in group) for group in NAME_GROUPS):
            continue
        LAST_NAME_REJECTION[0] = word[:40]
        raise ValueError('changed-names')


def validate_meaning(text, evidence):
    validate_directions(text, evidence)
    validate_metric_directions(text, evidence)
    validate_negation(text, evidence)


def validate_semantics(text, evidence):
    validate_execution_and_capacity(text, evidence)
    validate_amount_relations(text, evidence)
    validate_comparison_baselines(text, evidence)
    validate_meaning(text, evidence)
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


def validate_pair(ja, en, exact_counts=True):
    """Bilingual agreement. exact_counts=False is for multi-sentence detail,
    where one language may repeat a year or figure the other states once;
    every number must still appear on both sides."""
    validate_execution_and_capacity(ja, en)
    validate_execution_and_capacity(en, ja)
    validate_amount_relations(ja, en)
    validate_amount_relations(en, ja)
    validate_comparison_baselines(ja, en)
    validate_comparison_baselines(en, ja)
    # Multi-sentence detail is checked against its source date by date on each
    # side; between languages a year may be stated on one side only.
    validate_numbers(ja, en, check_dates=exact_counts)
    validate_numbers(en, ja, check_dates=exact_counts)
    if exact_counts and Counter(numeric_values(ja))!=Counter(numeric_values(en)):
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
    validate_meaning(ja, en)
    validate_meaning(en, ja)
    validate_names(ja, en)


def _cache_checks(*names):
    """Cache the outcome of pure text checks run on every public read.

    The public feed re-validates every stored translation on each request;
    the same strings are checked again and again. Only calls whose arguments
    are plain strings/bools/None are cached; the outcome is either success or
    the ValueError code, which is re-raised unchanged. Other exceptions are
    never cached.
    """
    import functools
    simple = (str, bool, type(None))
    for name in names:
        original = globals()[name]

        @functools.lru_cache(maxsize=16384)
        def outcome(args, kwargs, _original=original):
            try:
                _original(*args, **dict(kwargs))
            except ValueError as exc:
                return str(exc)
            return None

        @functools.wraps(original)
        def checked(*args, _original=original, _outcome=outcome, **kwargs):
            if not all(isinstance(value, simple) for value in (*args, *kwargs.values())):
                return _original(*args, **kwargs)
            code = _outcome(args, tuple(sorted(kwargs.items())))
            if code is not None:
                raise ValueError(code)
        globals()[name] = checked


_cache_checks('validate_meaning', 'validate_names')
