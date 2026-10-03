"""Deterministic checks for literal numbers and explicit transaction status.

These checks reject known contradictions; they do not prove semantic accuracy.
"""
import re
from decimal import Decimal
from collections import Counter
from datetime import date


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
    values = []
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
        r'(?:units?|GPUs?|DPUs?|servers?|devices?|chips?|layers?|encoders?|speakers?|people|persons?|students?|participants?|employees?)\b', text, re.I))
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
    if not set(quarter_values(text)).issubset(set(quarter_values(evidence))):
        raise ValueError('unsupported-number')
    source_dates = dates(evidence)
    for year, month, day in dates(text):
        if not any(month == sm and day == sd and (year is None or year == sy) for sy, sm, sd in source_dates):
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


def validate_semantics(text, evidence):
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
