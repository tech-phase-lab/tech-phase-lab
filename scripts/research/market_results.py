"""Automatic bilingual factual flashes. Never copy a publisher's prose.

Only recognized result fields are published; previews, missing units, stale
revisions and unsupported formats remain private. Consensus is not blended.
"""
import json
import re
from datetime import datetime, timezone, timedelta
import time
from urllib.parse import urlsplit
import monitor

ACCOUNTS = {'tipranks', 'wallstengine', 'fabymetal4', 'trade_the_news'}
NAMES = {'tipranks': 'TipRanks',
         'wallstengine': 'Wall St Engine', 'fabymetal4': 'FabyΔ', 'trade_the_news': 'Trade The News'}
VALUE = r'([-+−]?\d[\d,]*(?:\.\d+)?)\s*(B|M|K|T(?![a-z])|billion|million|thousand|trillion|%)?'
# Oct 11: ASML reports in euros, TSMC in NT dollars, SK hynix in won. The
# currency is kept exactly as written; nothing is converted or assumed.
CURRENCY = r'(NT\$|US\$|\$|€|₩|EUR\b|TWD\b|KRW\b|USD\b)'
CURRENCY_SYMBOLS = {'nt$': 'NT$', 'twd': 'NT$', '€': '€', 'eur': '€', '₩': '₩', 'krw': '₩',
                    '$': '$', 'us$': '$', 'usd': '$'}


def currency_symbol(text):
    return CURRENCY_SYMBOLS.get((text or '').strip().lower(), '')
METRICS = [
    ('revenue', '売上高', 'Revenue', r'(?:revenue|sales|売上高?)', True),
    ('eps', 'EPS', 'EPS', r'(?:(?:adjusted|adj\.?|non[- ]?GAAP|GAAP|調整後)\s*)?EPS', False),
    ('gross-margin', '粗利益率', 'Gross margin', r'(?:(?:adjusted|adj\.?|non[- ]?GAAP|GAAP|調整後)\s*)?(?:gross margin|粗利(?:益)?率)', False),
    ('operating-cash-flow', '営業キャッシュフロー', 'Operating cash flow', r'(?:operating cash flow|営業キャッシュフロー)', True),
]
MACRO = re.compile(r'\b(?:ADP|CPI|PPI|PCE|FOMC|NFP|non[- ]?farm payrolls|GDP|unemployment rate|(?:average|avg\.?) hourly earnings)\b', re.I)
PREVIEW = re.compile(r'earnings preview|upcoming|ahead of|will report|scheduled to|expected to report', re.I)


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS market_result_publications(
      event_id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
      sha TEXT NOT NULL, payload TEXT NOT NULL, published_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL)''')


def economic_comparisons(segment, actual_end, actual_unit):
    """Admit only a complete contiguous list of explicit comparison fields.

    Unknown prose, period qualifiers, malformed values or ambiguous grammar
    omit optional detail. They must never prevent publication of the actual.
    """
    tail = segment[actual_end:]
    unit = lambda value: {'billion': 'B', 'million': 'M', 'thousand': 'K'}.get(value.lower(), value.upper())
    expected_unit = unit(actual_unit or '')
    amount = VALUE.replace(r'\s*', r'[ \t]*')
    field = re.compile(r'(\()?[ \t]*(est\.?|estimate|forecast|consensus|expected|予想|prev\.?|previous|prior|前回)'
                       r'[ \t]*[:=]?[ \t]*' + amount
                       + r'(?:[ \t]*\(revised from[ \t]*' + amount + r'[ \t]*\))?'
                       r'[ \t]*(\))?', re.I)

    def value(number, suffix):
        if (not re.fullmatch(r'[-+−]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?', number)
                or unit(suffix or '') != expected_unit):
            return None
        return number.replace(',', '').replace('−', '-') + unit(suffix or '')

    pairs = {'forecast': set(), 'previous': set()}
    while tail.strip(' \t\r\n,;|'):
        # Consume separators only between complete fields. Never search past
        # an unknown clause such as "October outlook" for a later number.
        tail = tail.lstrip(' \t\r\n,;|')
        match = field.match(tail)
        if not match or bool(match[1]) != bool(match[7]):
            return {}
        key = 'previous' if re.fullmatch(r'prev\.?|previous|prior|前回', match[2], re.I) else 'forecast'
        actual = value(match[3], match[4])
        revised_from = value(match[5], match[6]) if match[5] else None
        if actual is None or (match[5] and (key != 'previous' or revised_from is None)):
            return {}
        pairs[key].add((actual, revised_from))
        tail = tail[match.end():]
        if tail and not re.match(r'[,;|\r\n]', tail):
            return {}  # Includes trailing period/basis qualifiers and ranges.

    out = {}
    for key, values in pairs.items():
        if len(values) == 1:
            actual, revised_from = next(iter(values))
            out[key] = actual
            if revised_from is not None:
                out['previousRevisedFrom'] = revised_from
    return out



def economic_metric(text):
    label = MACRO.search(text)
    if not label:
        return None
    tail = text[label.end():]
    # Do not associate the first result with another metric later in a post.
    next_label = MACRO.search(tail)
    segment = tail[:next_label.start()] if next_label else tail
    actual = re.search(r'(?:actual|実績|結果)\s*[:=]?\s*' + VALUE, segment, re.I)
    if not actual:
        # Employment result labels can omit Actual and separators. Other
        # indicators retain the explicit separator requirement.
        prefix = re.split(r'[\n;|]', text[:label.start()])[-1]
        if re.search(r'\best\b|forecast|expected|estimate|consensus|previous|prior|予想|前回', prefix, re.I):
            return None
        employment = re.fullmatch(r'NFP|non[- ]?farm payrolls|unemployment rate|(?:average|avg\.?) hourly earnings', label[0], re.I)
        if not employment and not re.match(r'\s*(?:\([^\n()]{1,30}\)\s*)*[:=]',segment):
            return None
        actual = re.match(r'\s*(?:(?:\([^\n()]{1,30}\)|MoM|YoY|M/M|Y/Y)\s*)*(?:[:=]\s*|(?=[-+−\d]))' + VALUE, segment, re.I)
    if not actual or re.match(r'\s*(?:est\b|expected|forecast|estimate|consensus|previous|prior|予想|前回)', segment[actual.end():], re.I):
        return None
    if not re.fullmatch(r'[-+−]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?',actual[1]):
        return None
    # A schedule's 08:30 or a date must never become an actual result.
    if re.match(r'\s*[:/]|[\d.]',segment[actual.end():]):
        return None
    number = actual[1].replace(',', '').replace('−', '-') + (actual[2] or '')
    period = label[0].upper()
    ja, en = period, period
    if re.fullmatch(r'NFP|non[- ]?farm payrolls',label[0],re.I):
        if actual[2] == '%':
            return None
        if not actual[2] and not re.search(r'actual|実績|結果', segment[:actual.start()+8], re.I):
            return None
        ja, en = '非農業部門雇用者数', 'Nonfarm payrolls'
    elif label[0].lower() == 'unemployment rate':
        if actual[2] != '%':
            return None
        ja, en = '失業率', 'Unemployment rate'
    elif re.fullmatch(r'(?:average|avg\.?) hourly earnings', label[0], re.I):
        if actual[2] != '%':
            return None
        basis = re.search(r'\b(MoM|YoY)\b|M/M|Y/Y|month.over.month|year.over.year',segment[:actual.end()],re.I)
        if not basis:
            return None
        monthly = bool(re.fullmatch(r'MoM|M/M|month.over.month',basis[0],re.I))
        suffix = 'MoM' if monthly else 'YoY'
        period += ' ('+suffix+')'
        ja, en = '平均時給（'+('前月比' if monthly else '前年比')+'）', 'Average hourly earnings ('+suffix+')'
    comparisons = economic_comparisons(segment, actual.end(), actual[2])
    return {'kind': 'economic', 'ticker': 'ECON', 'period': period,
            'facts': [{'key':'actual', 'ja':'結果', 'en':'Actual', 'value':number,
                       **({'comparisons': comparisons} if comparisons else {})}],
            'titleJa': ja + '：結果 ' + number,
            'titleEn': en + ': actual ' + number}


INFLATION_LABEL = re.compile(r'\b(?:CPI|PPI|PCE)\b', re.I)
MONTH_NAMES = ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
               'September', 'October', 'November', 'December')
INFLATION_LINE = re.compile(
    r'^\s*(?:(?:the\s+)?U\.?S\.?\s+)?(?:(?:' + '|'.join(MONTH_NAMES) + r')\s+)?(?P<core>core\s+)?(?P<ind>CPI|PPI|PCE)'
    r'(?:\s+(?:price\s+)?index)?(?:\s*\((?P<mon>(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*)\.?\))?\s*(?P<b1>\((?:MoM|YoY|M/M|Y/Y)\)|MoM|YoY|M/M|Y/Y)?\s*'
    r'(?:(?:actual|[:=])\s*[:=]?\s*)?(?P<val>[-+−]?\d+(?:\.\d+)?)\s*%'
    r'(?:\s*(?P<b2>\((?:MoM|YoY|M/M|Y/Y)\)|MoM|YoY|M/M|Y/Y))?(?P<rest>.*)$', re.I)


def inflation_projection(text):
    """Oct 11: U.S. CPI, PPI and PCE flashes keep headline/core and MoM/YoY.

    One line per figure, as Wall St Engine posts them ("CORE CPI YoY 3.1%,
    (Est. 3.0%)"). Every figure needs its monthly or annual basis; a line that
    names an index with a number but cannot be read this way withholds the
    whole post, since a wrong basis would misstate inflation.
    """
    facts, seen = [], {}
    # Wall St Engine joins two figures on one line with a middle dot (Oct 14: the CPI flash was
    # dropped because "(Sept)" and "·" were not read).
    month_short = last_index = None
    for line in re.split(r'[\n|·•]', text):
        # "CPI m/m: +0.6% · Core m/m: +0.3%": the second figure names no index; it is the same one.
        if last_index and not INFLATION_LABEL.search(line) and re.match(r'\s*core\s+(?:MoM|YoY|M/M|Y/Y)\b', line, re.I):
            line = re.sub(r'^(\s*core)', lambda m: m[1] + ' ' + last_index, line, count=1, flags=re.I)
        if not INFLATION_LABEL.search(line) or not re.search(r'\d', line):
            continue
        match = INFLATION_LINE.match(line)
        if not match:
            if re.search(r'\d+(?:\.\d+)?\s*%', line):
                return None
            continue  # A heading such as "U.S. SEPTEMBER CPI 👇".
        month_short = month_short or match['mon']
        last_index = match['ind'].upper()
        bases = [b for b in (match['b1'], match['b2']) if b]
        if len(bases) != 1 or re.match(r'\s*(?:est\b|expected|forecast|estimate|consensus|previous|prior|予想|前回)',
                                       match['rest'], re.I):
            return None
        monthly = bool(re.fullmatch(r'\(?(?:MoM|M/M)\)?', bases[0], re.I))
        index = match['ind'].upper()
        core = bool(match['core'])
        key = ('core-' if core else '') + index.lower() + ('-mom' if monthly else '-yoy')
        value = match['val'].replace('−', '-') + '%'
        if seen.get(key, value) != value:
            return None  # Two different figures for one measure.
        if key in seen:
            continue
        seen[key] = value
        basis_ja, basis_en = ('前月比', 'MoM') if monthly else ('前年比', 'YoY')
        comparisons = economic_comparisons(line, match.start('rest'), '%')
        facts.append({'key': key, 'ja': ('コア' if core else '') + index + '（' + basis_ja + '）',
                      'en': ('Core ' if core else '') + index + ' (' + basis_en + ')', 'value': value,
                      **({'comparisons': comparisons} if comparisons else {})})
    if not facts or len(facts) > 8:
        return None
    indices = list(dict.fromkeys(f['key'].replace('core-', '').split('-')[0].upper() for f in facts))
    # Only a month written as the report's own period ("SEPTEMBER U.S. CPI").
    month = re.search(r'\b(' + '|'.join(MONTH_NAMES) + r')\s+(?:U\.?S\.?\s+)?(?:core\s+)?(?:CPI|PPI|PCE)\b', text, re.I)
    if not month and month_short:
        full = next(name for name in MONTH_NAMES if name[:3].lower() == month_short[:3].lower())
        month = re.match(r'(.*)', full)
    period = ((month[1].upper() + ' ') if month else '') + 'U.S. ' + '/'.join(indices)
    month_ja = ('（' + str(MONTH_NAMES.index(month[1].capitalize()) + 1) + '月）') if month else ''
    single = len(indices) == 1
    short_ja = lambda f: f['ja'].replace(indices[0], '').replace('（', '').replace('）', '') if single else f['ja']
    short_en = lambda f: f['en'].replace(indices[0] + ' ', '').replace('(', '').replace(')', '') if single else f['en']
    return {'kind': 'economic', 'ticker': 'ECON', 'period': period, 'facts': facts,
            'titleJa': '米国' + '・'.join(indices) + month_ja + '：' + '、'.join(short_ja(f) + ' ' + f['value'] for f in facts),
            'titleEn': 'U.S. ' + ((month[1].capitalize() + ' ') if month else '') + '/'.join(indices) + ': '
                       + '; '.join(short_en(f) + ' ' + f['value'] for f in facts)}


def economic_projection(text):
    # This flash channel covers U.S. indicators, not a generic international CPI.
    if re.search(r'\b(?:Eurozone|Euro area|United Kingdom|UK|Japan|Germany|France|China|Canada)\b', text, re.I):
        return None
    if INFLATION_LABEL.search(text):
        return inflation_projection(text)
    labels = list(MACRO.finditer(text))
    parts = []
    for index, label in enumerate(labels):
        # Preserve a same-line forecast prefix and bound values to one metric.
        start = max(text.rfind('\n', 0, label.start()), text.rfind(';', 0, label.start()), text.rfind('|', 0, label.start())) + 1
        prefix = text[start:label.start()]
        if re.search(r'\best\b|forecast|expected|estimate|consensus|previous|prior|予想|前回', prefix, re.I):
            continue
        end = labels[index + 1].start() if index + 1 < len(labels) else len(text)
        item = economic_metric(text[label.start():end])
        if item:
            parts.append(item)
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    facts = []
    for item in parts:
        ja = item['titleJa'].split('：結果')[0]
        en = item['titleEn'].split(': actual')[0]
        key = {'Nonfarm payrolls':'nonfarm-payrolls', 'Unemployment rate':'unemployment-rate',
               'Average hourly earnings (MoM)':'hourly-earnings-mom', 'Average hourly earnings (YoY)':'hourly-earnings-yoy'}.get(en)
        if key:
            fact = {**item['facts'][0], 'key':key, 'ja':ja, 'en':en}
            if fact not in facts:
                facts.append(fact)
    if not facts:
        return parts[0]
    month = re.search(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\b.*?\b(?:U\.S\. )?JOBS REPORT\b', text, re.I)
    period = (month[1].upper() + ' JOBS REPORT') if month else 'EMPLOYMENT RESULTS'
    return {'kind':'economic', 'ticker':'ECON', 'period':period, 'facts':facts,
            'titleJa':'／'.join(f['ja']+' '+f['value'] for f in facts),
            'titleEn':'; '.join(f['en']+' '+f['value'] for f in facts)}

# Oct 15: Trade The News posts a company's result as one fixed line, e.g.
# "$TSM Reports Q3 (NT$) Net 763.1B v 746.3Be (v 452.3B y/y), Op 876.5B v ...".
TTN_HEADER = re.compile(r'\s*\$([A-Z]{1,5}(?:\.[A-Z])?)\s+Reports\s+(?:(?:FY)?\s*(20\d{2})\s+)?Q([1-4])(?:\s+(?:FY)?\s*(20\d{2}))?\s*(?:\((' + CURRENCY[1:-1] + r')\))?')
TTN_FIELDS = [('net-income', '純利益', 'Net income', r'Net'), ('operating-income', '営業利益', 'Operating income', r'Op'),
              ('revenue', '売上高', 'Revenue', r'Rev'), ('eps', 'EPS', 'EPS', r'EPS')]
TTN_UNITS = {'b': 'B', 'm': 'M', 'k': 'K', 't': 'T'}


def trade_the_news_projection(text, tickers):
    """One company result from a Trade The News line; anything unclear is left out.

    The currency must be stated in the post, a figure whose unit differs from
    the unit of its own comparison ("Rev 1.49B v 1.49T") is ambiguous and is not
    published, and estimates ("...e") are never used as the result.
    """
    header = TTN_HEADER.match(text) if isinstance(text, str) else None
    if not header or len(tickers) != 1 or header[1] != tickers[0]:
        return None
    if re.findall(r'(?<![\w$])\$([A-Z]{1,5}(?:\.[A-Z])?)(?![\w.])', text) != [tickers[0]]:
        return None
    lines = text.split('\n')
    first = lines[0][header.end():]
    head_symbol = currency_symbol(header[5])
    facts = []
    for key, ja, en, label in TTN_FIELDS:
        m = re.search(r'(?:^|[\s,])' + label + r'\s+' + CURRENCY + r'?\s*(\d[\d,]*(?:\.\d+)?)([BMKT])?(?![\w%])'
                      r'(?:\s+v\s+' + CURRENCY + r'?\s*(\d[\d,]*(?:\.\d+)?)([BMKT])?)?', first)
        if not m:
            continue
        symbol = currency_symbol(m[1]) or head_symbol
        unit = TTN_UNITS.get((m[3] or '').lower(), '')
        if not symbol or (key != 'eps' and not unit) or (key == 'eps' and unit):
            continue
        if m[5] and TTN_UNITS.get((m[6] or '').lower(), '') != unit:
            continue  # the post's own comparison disagrees about the unit
        facts.append({'key': key, 'ja': ja, 'en': en, 'value': symbol + m[2].replace(',', '') + unit})
    for line in lines[1:]:
        for key, ja, en, label, symbolic in (('operating-margin', '営業利益率', 'Operating margin', r'Op margin', False),
                                            ('gross-margin', '粗利益率', 'Gross margin', r'Gross margin', False),
                                            ('capex', '設備投資', 'Capex', r'Capex', True)):
            m = re.match(r'\s*-?\s*' + label + r'\s*:\s*' + (CURRENCY if symbolic else '()') + r'\s*(\d[\d,]*(?:\.\d+)?)\s*(%|[BMT])(?![\w%])', line)
            if not m or (symbolic and (not currency_symbol(m[1]) or m[3] == '%')) or (not symbolic and m[3] != '%'):
                continue
            if not any(f['key'] == key for f in facts):
                facts.append({'key': key, 'ja': ja, 'en': en, 'value': (currency_symbol(m[1]) if symbolic else '') + m[2].replace(',', '') + m[3]})
    if not any(f['key'] in {'revenue', 'eps', 'net-income', 'operating-income'} for f in facts):
        return None
    quarter = 'Q' + header[3] + (' ' + (header[2] or header[4]) if header[2] or header[4] else '')
    lead = facts[:2]
    return {'kind': 'earnings', 'ticker': tickers[0], 'period': quarter, 'facts': facts,
            'titleJa': tickers[0] + ' ' + quarter + '決算：' + '、'.join(f['ja'] + f['value'] for f in lead),
            'titleEn': tickers[0] + ' ' + quarter + ' earnings: ' + ', '.join(f['en'] + ' ' + f['value'] for f in lead)}


def ttn_result(text):
    """True for a Trade The News result line whose figures can actually be read."""
    header = TTN_HEADER.match(text) if isinstance(text, str) else None
    return bool(header and trade_the_news_projection(text, [header[1]]))

# Oct 15: Wall St Engine posts a company's next-quarter outlook as "TSMC $TSM Q4'26 GUIDE"
# followed by range lines (revenue, gross margin, operating margin).
GUIDE_HEADER = re.compile(r"\s*(?:[A-Za-z][A-Za-z.&-]*\s+){0,3}\$([A-Z]{1,5}(?:\.[A-Z])?)\s+Q([1-4])\s*['’]?\s*(20\d{2}|\d{2})\s+GUIDE(?:LINE|S)?\b", re.I)
GUIDE_FIELDS = [('guidance-revenue', '会社見通し 売上高', 'Guidance revenue', r'(?:revenue|rev)', True),
                ('guidance-gross-margin', '会社見通し 粗利益率', 'Guidance gross margin', r'(?:gross margin|gm)', False),
                ('guidance-operating-margin', '会社見通し 営業利益率', 'Guidance operating margin', r'(?:operating margin|op(?:erating)? margin|op\.? margin|om)', False)]
GUIDE_UNITS = {'b': 'B', 'm': 'M', 'k': 'K', 't': 'T'}
GUIDE_NUMBER = r'(\d[\d,]*(?:\.\d+)?)'


def guidance_projection(text, tickers):
    """The next-quarter outlook from a "GUIDE" post, kept as the range the post states.

    Only explicit ranges with a stated currency (revenue) or percent sign
    (margins) are read; an estimate ("...e"), a unit mismatch or an unclear line is
    left out, and a post without a readable revenue range is not published.
    """
    header = GUIDE_HEADER.match(text) if isinstance(text, str) else None
    if not header or len(tickers) != 1 or header[1] != tickers[0]:
        return None
    if re.findall(r'(?<![\w$])\$([A-Z]{1,5}(?:\.[A-Z])?)(?![\w.])', text) != [tickers[0]]:
        return None
    facts = []
    for line in text[header.end():].split('\n'):
        line = re.split(r'\s+v\s+|\(', line, maxsplit=1)[0]
        for key, ja, en, label, money in GUIDE_FIELDS:
            if any(f['key'] == key for f in facts):
                continue
            if money:
                m = re.match(r'\s*[-•*]?\s*' + label + r'\s*[:=]?\s*' + CURRENCY + r'\s*' + GUIDE_NUMBER + r'\s*([BMKT])?\s*(?:-|–|—|to|~)\s*' + CURRENCY + r'?\s*' + GUIDE_NUMBER + r'\s*([BMKT])?\s*$', line, re.I)
                if not m:
                    continue
                symbol = currency_symbol(m[1])
                if currency_symbol(m[4]) not in ('', symbol) or not symbol:
                    continue
                low_unit, high_unit = GUIDE_UNITS.get((m[3] or '').lower(), ''), GUIDE_UNITS.get((m[6] or '').lower(), '')
                if low_unit and high_unit and low_unit != high_unit:
                    continue
                unit = low_unit or high_unit
                if not unit:
                    continue
                low, high = m[2].replace(',', ''), m[5].replace(',', '')
                value = symbol + low + unit + '-' + symbol + high + unit
            else:
                m = re.match(r'\s*[-•*]?\s*' + label + r'\s*[:=]?\s*' + GUIDE_NUMBER + r'\s*(%)?\s*(?:-|–|—|to|~)\s*' + GUIDE_NUMBER + r'\s*(%)\s*$', line, re.I)
                if not m:
                    continue
                value = m[1] + '%-' + m[3] + '%'
            low_value = float(re.sub(r'[^\d.]', '', value.split('-')[0]))
            high_value = float(re.sub(r'[^\d.]', '', value.split('-')[1]))
            if not 0 < low_value <= high_value or (not money and high_value > 100):
                continue
            facts.append({'key': key, 'ja': ja, 'en': en, 'value': value})
    if not any(f['key'] == 'guidance-revenue' for f in facts):
        return None
    year = header[3] if len(header[3]) == 4 else '20' + header[3]
    quarter = 'Q' + header[2] + ' ' + year
    lead = facts[:2]
    return {'kind': 'earnings', 'ticker': tickers[0], 'period': quarter, 'facts': facts,
            'titleJa': tickers[0] + ' ' + quarter + ' 会社見通し：' + '、'.join(f['ja'].replace('会社見通し ', '') + f['value'] for f in lead),
            'titleEn': tickers[0] + ' ' + quarter + ' guidance: ' + ', '.join(f['en'].replace('Guidance ', '') + ' ' + f['value'] for f in lead)}


def guidance_result(text):
    """True for a GUIDE post whose outlook can actually be read."""
    header = GUIDE_HEADER.match(text) if isinstance(text, str) else None
    return bool(header and guidance_projection(text, [header[1]]))


def projection(text, tickers):
    if not isinstance(text, str) or len(text) > 160000 or PREVIEW.search(text):
        return None
    if 'ECON' in tickers:
        return economic_projection(text)
    if TTN_HEADER.match(text):
        return trade_the_news_projection(text, tickers)
    if GUIDE_HEADER.match(text):
        return guidance_projection(text, tickers)
    if len(tickers) != 1 or not re.search(r'earnings|results|highlights|決算', text, re.I):
        return None
    # The post must be about this company: its first cashtag is the ticker.
    # A partner's or customer's results that only name NVIDIA must never become
    # an NVDA earnings flash ("NVDA Q1 2027: revenue $116.29M", Oct 8).
    cashtags = re.findall(r'(?<![\w$])\$([A-Z]{1,5}(?:\.[A-Z])?)(?![\w.])', text)
    if not cashtags or cashtags[0] != tickers[0]:
        return None
    # Any other company's cashtag makes the subject ambiguous ("$NVDA supplier
    # $ACME Q1 revenue $116M"); missing a flash is safer than misattributing one.
    if any(tag != tickers[0] for tag in cashtags):
        return None
    # The ticker must be named before the results wording and the first figure.
    first_tag = re.search(r'(?<![\w$])\$' + re.escape(tickers[0]) + r'(?![\w.])', text).start()
    topic = re.search(r'earnings|results|highlights|決算', text, re.I)
    if topic.start() < first_tag or re.search(r'\$\s*\d', text[:first_tag]):
        return None
    period = re.search(r'(?:(?:FY)?\s*(20\d{2})\s*)?Q([1-4])(?:\s*(?:FY)?\s*(20\d{2}))?', text, re.I)
    if not period:
        return None
    guidance = re.split(r'\b(?:guidance|outlook)\b|ガイダンス|見通し', text, maxsplit=1, flags=re.I)
    facts = []
    for section, part in enumerate(guidance):
        for key, ja, en, pattern, money in METRICS:
            if section and key not in {'revenue', 'eps'}:
                continue
            m = None
            for candidate in re.finditer(r'(?<!\w)(' + pattern + r')\s*[:=]?\s*' + CURRENCY + r'?\s*' + VALUE, part, re.I):
                prefix = re.split(r'[\n;|]', part[:candidate.start()])[-1]
                if re.search(r'(?:est(?:imate[ds]?)?|expected|consensus|forecast|prior(?: quarter| year)?|previous(?: quarter| year)?)\s*[:=]?\s*$', prefix, re.I):
                    continue
                m = candidate
                break
            if not m:
                continue
            number, unit = m[3].replace(',', '').replace('−', '-'), m[4] or ''
            symbol = currency_symbol(m[2])
            if key!='gross-margin' and not symbol:
                continue  # Never assume a currency for a currency-free value.
            if money and unit.lower() not in {'b','m','k','t','billion','million','thousand','trillion'}:
                continue
            if key == 'gross-margin' and unit != '%':
                continue
            if key == 'eps' and unit:
                continue
            unit = {'billion':'B','million':'M','thousand':'K','trillion':'T'}.get(unit.lower(),unit.upper() if unit != '%' else '%')
            value = (symbol if key != 'gross-margin' else '') + number + unit
            if re.search(r'adjusted|adj\.?|non[- ]?GAAP|調整後', m[1], re.I):
                ja, en = '調整後' + ja, 'Adjusted ' + en
            elif re.search(r'\bGAAP\b', m[1], re.I):
                ja, en = 'GAAP ' + ja, 'GAAP ' + en
            if section:
                annual = bool(re.search(r'(?:full[- ]year|annual|通期|FY\s*20\d{2})\s*$', guidance[0].strip(), re.I) or re.search(r'full[- ]year|annual|通期', part[:m.start()], re.I))
                ja, en = ('通期 ' + ja, 'Full-year ' + en) if annual else ('会社見通し ' + ja, 'Guidance ' + en)
            # Ranges are preserved only when explicitly present next to the value.
            tail = part[m.end():m.end()+35]
            spread = re.match(r'\s*(?:±|\+/-)\s*' + CURRENCY + r'?\s*' + VALUE, tail, re.I)
            if spread and currency_symbol(spread[1]) in ('', symbol):
                spread_unit = {'billion':'B','million':'M','thousand':'K','trillion':'T'}.get((spread[3] or '').lower(), (spread[3] or '').upper()) or unit
                value += ' ± ' + (symbol if key != 'gross-margin' else '') + spread[2] + spread_unit
            facts.append({'key':('guidance-' if section else '')+key, 'ja':ja, 'en':en, 'value':value})
    if not any(f['key'] in {'revenue','eps'} for f in facts):
        return None
    quarter = 'Q' + period[2] + (' ' + (period[1] or period[3]) if period[1] or period[3] else '')
    first = [f for f in facts if not f['key'].startswith('guidance-')][:2]
    return {'kind':'earnings', 'ticker':tickers[0], 'period':quarter, 'facts':facts,
            'titleJa':tickers[0]+' '+quarter+'決算：'+ '、'.join(f['ja']+f['value'] for f in first),
            'titleEn':tickers[0]+' '+quarter+' earnings: '+', '.join(f['en']+' '+f['value'] for f in first)}


# Earnings flashes stay on the calendar for seven days, so they may be published that late.
EARNINGS_WINDOW = timedelta(days=7)


def run_once(path, sources, reference=None):
    reference = reference or datetime.now(timezone.utc)
    allowed = {s['id']:s for s in sources if s.get('format') == 'x-api'}
    with monitor.connect(path) as db:
        schema(db)
        import macro_source_publication
        import attributed_policy_publication
        macro_source_publication.route_schema(db)
        attributed_policy_publication.route_schema(db)
        if not allowed:
            return
        # Read every unpublished, current revision in the bounded source window.
        # An arbitrary newest-event page can otherwise permanently hide a valid
        # result behind unrelated posts, even after every newer row is examined.
        rows = db.execute('''SELECT e.*,d.text AS body,d.sha AS current_sha,d.title AS document_title
          FROM signal_events e JOIN signal_documents d
            ON d.source_id=e.source_id AND d.url=e.url AND d.sha=e.sha
          LEFT JOIN market_result_publications p ON p.event_id=e.id
          WHERE e.source_id IN (''' + ','.join('?' for _ in allowed) + ''')
            AND e.truncated=0 AND p.event_id IS NULL
            AND julianday(e.observed_at) BETWEEN julianday(?) AND julianday(?)
          ORDER BY julianday(e.observed_at),e.id''',
          (*allowed, (reference-EARNINGS_WINDOW).isoformat(), reference.isoformat())).fetchall()
        for row in rows:
            if row['source_id'] not in allowed or row['truncated'] or row['sha'] != row['current_sha']:
                continue
            url = urlsplit(row['url'])
            match = re.fullmatch(r'/([A-Za-z0-9_]+)/status/(\d+)',url.path)
            if url.scheme != 'https' or url.hostname != 'x.com' or not match or match[1].lower() not in ACCOUNTS:
                continue
            if match[1].lower() not in {a.lower() for a in allowed[row['source_id']].get('accounts',[])}:
                continue
            try:
                release = datetime.fromisoformat(row['published_at'].replace('Z','+00:00'))
                if release.tzinfo is None or not reference-EARNINGS_WINDOW <= release <= reference:
                    continue
                observed_at = datetime.fromisoformat(row['observed_at'].replace('Z','+00:00'))
                fresh = reference-timedelta(hours=24) <= release and reference-timedelta(hours=24) <= observed_at
            except (TypeError,ValueError,AttributeError):
                continue
            started = time.monotonic()
            try:
                tickers = json.loads(row['tickers_json'])
            except (TypeError, ValueError):
                continue
            if not isinstance(tickers, list) or not all(isinstance(ticker, str) for ticker in tickers):
                continue
            # Complete source-bound reports have one detailed-news owner before
            # either worker runs; a partial flash must not strand that route.
            # This does not alter any already stored result or approve copy.
            if fresh and any(adapter.reserve_fresh_result_route(db, dict(row), reference)
                             for adapter in (macro_source_publication, attributed_policy_publication)):
                continue
            result = projection(row['body'], tickers)
            if not result:
                continue
            # Only earnings flashes may be published late (owner, Oct 23: a company's results from
            # two days earlier were never listed because the intake had been down); everything else
            # keeps the 24-hour rule.
            if not fresh and result.get('kind') != 'earnings':
                continue
            result.update({'id':str(row['id']), 'url':row['url'], 'publisher':NAMES[match[1].lower()],
                           'publishedAt':row['published_at'], 'observedAt':row['observed_at'],
                           'researchId':'x-result-'+str(row['id'])})
            with db:
                db.execute('BEGIN IMMEDIATE')
                current = db.execute('SELECT e.*,d.text AS body,d.sha AS current_sha,d.title AS document_title '
                    'FROM signal_events e JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url '
                    'WHERE e.id=?', (row['id'],)).fetchone()
                if not current or dict(current) != dict(row):
                    continue
                # A prior False route decision is not permission to race a
                # newly committed detailed owner or newly available raw proof.
                if any(adapter.record_route_owner(db, dict(current), reference)
                       for adapter in (macro_source_publication, attributed_policy_publication)):
                    continue
                db.execute('''INSERT OR IGNORE INTO market_result_publications VALUES(?,?,?,?,?,?,?)''',
                           (row['id'],row['source_id'],row['url'],row['sha'],json.dumps(result,ensure_ascii=False),
                            datetime.now(timezone.utc).isoformat(timespec='milliseconds'),round((time.monotonic()-started)*1000)))


def latest_source_posts(items):
    """Keep separately attributed posts, including a publisher's follow-up facts.

    An EPS-only update at a different URL does not retract the earlier revenue
    post. Current-SHA checks above handle same-URL corrections/withdrawals; only
    repeated copies of that exact source post are collapsed here.
    """
    latest={}
    def identity(item):
        return item.get('url') or id(item), item['publisher']
    def observed(item):
        return datetime.fromisoformat(item.get('observedAt') or item['publishedAt'])
    for item in items:
        key=identity(item)
        if key not in latest or observed(item)>observed(latest[key]):
            latest[key]=item
    return [item for item in items if latest[identity(item)] is item]


def julianday_before(value, cutoff):
    try:
        return datetime.fromisoformat(value) < datetime.fromisoformat(cutoff)
    except (TypeError, ValueError):
        return False


def public_feed(db, reference=None, earnings_hours=24):
    """Result flashes of the last 24 hours; earnings flashes stay for earnings_hours so the
    calendar's released-earnings list does not lose a company a day after it reported (owner, Oct 17)."""
    schema(db)
    now = reference or datetime.now(timezone.utc)
    cutoff = (now-timedelta(hours=max(24, earnings_hours))).isoformat()
    recent = (now-timedelta(hours=24)).isoformat()
    rows = db.execute('''SELECT p.payload,p.published_at,p.processing_ms,e.observed_at,e.published_at AS source_at,d.text AS body,e.tickers_json
      FROM market_result_publications p JOIN signal_documents d
      ON d.source_id=p.source_id AND d.url=p.url AND d.sha=p.sha
      JOIN signal_events e ON e.id=p.event_id
      WHERE julianday(e.published_at)>=julianday(?) ORDER BY julianday(e.published_at) DESC LIMIT ?''',(cutoff,20 if earnings_hours <= 24 else 60))
    items = []
    for row in rows:
        item = json.loads(row['payload'])
        account = re.fullmatch(r'/([A-Za-z0-9_]+)/status/\d+', urlsplit(item['url']).path)
        if not account or account[1].lower() not in ACCOUNTS:
            continue
        # Re-project stored flashes with the current parser, so earlier parsing
        # mistakes are not kept public merely because the source SHA is unchanged.
        current=projection(row['body'],json.loads(row['tickers_json']))
        if current is None:
            continue
        item.update(current)
        if earnings_hours > 24 and item.get('kind') != 'earnings' and julianday_before(row['source_at'], recent):
            continue
        item['publicAt'] = row['published_at']
        item['processingMs'] = row['processing_ms']
        item['sourceToDetectionMs'] = monitor.stored_latency_ms(row['source_at'],row['observed_at'])
        item['detectionToPublicMs'] = monitor.stored_latency_ms(row['observed_at'],row['published_at'])
        items.append(item)
    return latest_source_posts(items)[:20]


def diagnostics(db):
    items = public_feed(db)
    return {"status":"running", "publishedLast24Hours":len(items),
            "latest":[{k:item[k] for k in ("researchId","ticker","kind","publishedAt","observedAt","publicAt","processingMs","sourceToDetectionMs","detectionToPublicMs")} for item in items[:5]],
            "unsupportedFormats":"held-private", "numericTranslation":"bilingual-field-labels"}
