"""決算速報 straight from the issuer's own results table (owner, Nov 12).

CoreWeave's Nov 10 results (8-K at 21:05 UTC) never reached the site: the only route to the calendar's
released-earnings list was a model-written summary, and that summary kept failing the factual checks.
This is the first step of a two-step publication. Within seconds of the issuer's results release being read, the
headline numbers are copied out of its "financial highlights" table with fixed patterns and published as a result flash.
The model-written article can follow later and does not hold this back.

Nothing is guessed or written by a model:
- a figure is read only from the exact row of the table whose column header names the reported quarter and the quarter
  one year earlier; a row that is missing, wrapped differently, or ambiguous is simply left out;
- without a revenue figure nothing is published; with a layout the patterns do not know, nothing is published;
- the Japanese and English labels are fixed text and every value is the issuer's own number (unit and currency kept);
- a flash is replaced only when a later read of the same release gives different numbers (a correction).
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlsplit

import monitor

VERSION = 'issuer-flash-v1'
WINDOW = timedelta(days=7)
# While an unpublished results release is looking for its table (the PDF is linked a little after the page appears),
# retry quickly for the first half hour and slowly afterwards.
RETRY_FAST_SECONDS = 10
RETRY_SLOW_SECONDS = 600
FAST_PERIOD = timedelta(minutes=30)
MAX_PDF_CANDIDATES = 5

NUM = r'\(?-?\d[\d,]*(?:\.\d+)?\)?'
CHANGE = r'(?:-?\d[\d,]*%|n/m)'
MONTH = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'
QUARTERS = {'first': 1, 'second': 2, 'third': 3, 'fourth': 4}

# key, Japanese label, English label (fixed text; the values are the issuer's)
LABELS = {
    'revenue': ('売上高', 'Revenue'),
    'eps': ('EPS（希薄化後）', 'Diluted EPS'),
    'net-income': ('純損益', 'Net income / (loss)'),
    'operating-income': ('営業損益', 'Operating income / (loss)'),
    'adjusted-ebitda': ('調整後EBITDA', 'Adjusted EBITDA'),
    'adjusted-net-income': ('調整後純損益', 'Adjusted net income / (loss)'),
    'guidance-revenue': ('通期見通し 売上高', 'Full-year guidance Revenue'),
    'adjusted-eps': ('調整後EPS（希薄化後）', 'Adjusted diluted EPS'),
    'gross-margin': ('粗利益率', 'Gross margin'),
}
ORDER = ['revenue', 'gross-margin', 'eps', 'adjusted-eps', 'net-income', 'operating-income', 'adjusted-ebitda', 'adjusted-net-income', 'guidance-revenue']


def signed(text):
    """'(190.4)' -> -190.4; '3,661' -> 3661. Raises ValueError for anything else."""
    text = text.strip()
    if text == '\u2014':
        return Decimal(0)  # a dash in a statement column means nil
    negative = text.startswith('(') and text.endswith(')')
    text = text.strip('()').replace(',', '').replace('−', '-')
    try:
        value = Decimal(text)
    except InvalidOperation:
        raise ValueError('number')
    return -abs(value) if negative else value


def consistent(prior, current, change):
    """The table states the change in percent: it must agree with the two values (to the rounding of the printed figures).
    A digit garbled by PDF text extraction ("(3 7 .5)", "9 80.8") then cannot become a published figure."""
    if not change.endswith('%') or prior <= 0 or current < 0:
        return  # n/m or a sign change: nothing to check
    stated = Decimal(change[:-1].replace(',', ''))
    actual = (current / prior - 1) * 100
    if abs(actual - stated) > Decimal('1.5') + abs(actual) * Decimal('0.01'):
        raise ValueError('change-mismatch')


def money_millions(value):
    """Million-dollar figure -> '$582.3M' / '$3.661B' (exact; the value is never rounded)."""
    if abs(value) >= 1000:
        text, unit = format((value / 1000).normalize(), 'f'), 'B'
    else:
        text, unit = format(value.normalize(), 'f'), 'M'
    return '$' + text + unit


def per_share(value):
    text = format(value.normalize(), 'f')
    if '.' not in text:
        text += '.00'
    elif len(text.split('.')[1]) < 2:
        text += '0'  # cents are printed with two digits ($1.70, not $1.7)
    return '$' + text


def clean(text):
    return ' '.join((text or '').split())


# ---- issuer layouts ----------------------------------------------------------------------------------------

def loose(label):
    """A label as a pattern that tolerates the spaces some PDF text extractors insert inside words ("R e v enues")."""
    return r'\s*'.join(re.escape(ch) for ch in label if not ch.isspace())


def tidy_numbers(text):
    """Close the gaps an extractor leaves around the decimal point and thousands comma ("146 . 1" -> "146.1", "1 , 962" -> "1,962").
    Digits split from digits ("3 7 . 5") are NOT joined: that figure stays unreadable and its row is left out."""
    text = re.sub(r'(?<=\d)\s+([.,])\s*(?=\d)', r'\1', text)
    return re.sub(r'(?<=\d[.,])\s+(?=\d)', '', text)


def period_from_url(url):
    """'nebius-reports-third-quarter-2026-financial-results' -> (3, 2026); None when the slug says no quarter."""
    match = re.search(r'(first|second|third|fourth)-quarter-(20\d\d)', url or '')
    return (QUARTERS[match[1]], int(match[2])) if match else None


def parse_nebius(text, url=None):
    """Nebius' results release (PDF): 'Q3 2026 financial highlights', table columns prior-year, current, change.

    PDF text extraction can split words and digits ("F inancial H ighlights", "In SD millions"), so the heading is matched
    with its spaces removed, the quarter falls back to the one named in the page address, and the table is found by its own
    units line. Each figure still has to come from a clean row whose stated change agrees with its two values."""
    t = tidy_numbers(clean(text))
    if 'nebius' not in t.lower():
        raise ValueError('issuer-identity-missing')
    despaced = re.sub(r'\s+', '', t)
    head = re.search(r'Q([1-4])(20\d\d)financialhighlights', despaced, re.I)
    period = (int(head[1]), int(head[2])) if head else period_from_url(url)
    if not period:
        raise ValueError('highlights-heading-missing')
    quarter, year = period
    # The highlights table is the first "In USD $ millions" block that is followed by a Revenues row.
    units = next((m for m in re.finditer(r'In\s+U?SD\s*\$?\s*millions', t, re.I)
                  if re.search(r'\bRevenues?\b', t[m.end():m.end() + 900])), None)
    if units:
        window = t[units.start():units.start() + 5000]
    elif re.search(r'\bU?SD\b', t) and re.search(r'\bmillions?\b', t, re.I):
        window = t  # the extraction placed the units line away from the table: the year header below must still match
    else:
        raise ValueError('units-unrecognized')
    first = re.search(r'(?<!Change )\b(' + str(year - 1) + r') (' + str(year) + r') Change\b(?: 20\d\d 20\d\d Change\b)?.{0,40}?(?<![A-Za-z])' + loose('Revenue') + r's? ('
                      + NUM + ') (' + NUM + ') (' + CHANGE + ')', window)
    if not first:
        raise ValueError('revenue-row-unrecognized')
    metrics = {'revenue': (signed(first[4]), signed(first[3]))}
    consistent(metrics['revenue'][1], metrics['revenue'][0], first[5])
    block = window[first.start():first.start() + 1200]
    stop = block.find('Operating expenses')
    block = block[:stop] if stop > 0 else block
    income_loss = r'(?:\s*/\s*\(\s*' + loose('loss') + r'\s*\))?'
    rows = {
        'adjusted-ebitda': loose('AdjustedEBITDA') + income_loss,
        'net-income': loose('Net') + r'\s*(?:' + loose('income') + '|' + loose('loss') + r')(?:\s*/\s*\(\s*(?:' + loose('loss') + '|' + loose('income')
                      + r')\s*\))?\s*' + loose('fromcontinuingoperations'),
        'adjusted-net-income': loose('Adjustednet') + r'\s*(?:' + loose('income') + '|' + loose('loss') + r')(?:\s*/\s*\(\s*(?:' + loose('loss') + '|'
                               + loose('income') + r')\s*\))?',
    }
    for key, label in rows.items():
        found = re.findall(label + ' (' + NUM + ') (' + NUM + ') (' + CHANGE + ')', block)
        if len(found) == 1:  # a repeated or missing row is ambiguous: leave it out
            try:
                consistent(signed(found[0][0]), signed(found[0][1]), found[0][2])
            except ValueError:
                continue  # a garbled digit in this row: leave the row out rather than publish it
            metrics[key] = (signed(found[0][1]), signed(found[0][0]))
    if metrics['revenue'][0] <= 0:
        raise ValueError('revenue-not-positive')
    facts = [(key, money_millions(metrics[key][0]), money_millions(metrics[key][1])) for key in ORDER if key in metrics]
    return {'period': f'Q{quarter} {year}', 'facts': facts}


def parse_coreweave(text, url=None):
    """CoreWeave's results release (8-K EX-99.1): 'Third Quarter 2026 Financial Highlights', columns current, prior."""
    t = clean(text)
    if 'coreweave' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'\b(First|Second|Third|Fourth) Quarter (20\d\d) Financial Highlights\b', t)
    if not head:
        raise ValueError('highlights-heading-missing')
    quarter, year = QUARTERS[head[1].lower()], int(head[2])
    window = t[head.end():head.end() + 4000]
    if not re.search(r'\(In millions', window):
        raise ValueError('units-unrecognized')
    header = re.search(r'Three Months Ended ' + MONTH + r' \d{1,2}, ' + str(year) + ' ' + str(year - 1) + r'\b', window)
    if not header:
        raise ValueError('columns-unrecognized')
    gaap_end = window.find('Non-GAAP', header.end())
    gaap = window[header.end():gaap_end if gaap_end > 0 else header.end() + 1500]
    pair = '(' + NUM + r')\s*\$?\s*(' + NUM + ')'

    def row(label, block):
        found = re.findall(r'(?<![A-Za-z])' + label + r' \$ ' + pair + r'(?= |$)', block)
        return found[0] if len(found) == 1 else None
    metrics = {}
    revenue = row('Revenue', gaap)
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    metrics['revenue'] = (signed(revenue[0]), signed(revenue[1]))
    for key, label in (('operating-income', 'Operating income'), ('net-income', 'Net (?:loss|income)')):
        found = row(label, gaap)
        if found:
            metrics[key] = (signed(found[0]), signed(found[1]))
    eps = row('Diluted net (?:loss|income) per share', gaap)
    if eps:
        metrics['eps'] = (signed(eps[0]), signed(eps[1]))
    adjusted = window[gaap_end:gaap_end + 1500] if gaap_end > 0 else ''
    found = row('Adjusted EBITDA', adjusted)
    if found:
        metrics['adjusted-ebitda'] = (signed(found[0]), signed(found[1]))
    if metrics['revenue'][0] <= 0:
        raise ValueError('revenue-not-positive')
    fmt = lambda key, value: per_share(value) if key == 'eps' else money_millions(value)
    facts = [(key, fmt(key, metrics[key][0]), fmt(key, metrics[key][1])) for key in ORDER if key in metrics]
    guidance = re.findall(r'full year ' + str(year) + r' revenue guidance to a range of \$(\d+(?:\.\d+)?) billion to \$(\d+(?:\.\d+)?) billion', t)
    if len(guidance) == 1 and Decimal(guidance[0][0]) < Decimal(guidance[0][1]):
        facts.append(('guidance-revenue', f'${guidance[0][0]}B-${guidance[0][1]}B', None))
    return {'period': f'Q{quarter} {year}', 'facts': facts}


def parse_nvidia(text, url=None):
    """NVIDIA's results release (EX-99.1 or its newsroom page): "Q2 Fiscal 2027 Summary", GAAP and Non-GAAP tables whose columns are
    this quarter, the previous quarter and the same quarter a year earlier, each row ending in its Q/Q and Y/Y change.
    Every figure is checked against both stated changes, so a mis-read digit can never be published."""
    t = clean(text)
    if 'nvidia' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'Q([1-4]) Fiscal (20\d\d) Summary GAAP', t)
    if not head:
        raise ValueError('highlights-heading-missing')
    quarter, year = int(head[1]), int(head[2])
    cur, prev = f'Q{quarter} FY{year % 100:02d}', f'Q{quarter - 1 if quarter > 1 else 4} FY{(year if quarter > 1 else year - 1) % 100:02d}'
    ago = f'Q{quarter} FY{(year - 1) % 100:02d}'
    split = t.find('Non-GAAP', head.end())
    if split < 0:
        raise ValueError('non-gaap-table-missing')
    gaap, non = t[head.end():split], t[split:split + 1800]
    if not re.search(re.escape(f'{cur} {prev} {ago} Q/Q Y/Y'), gaap):
        raise ValueError('columns-unrecognized')
    amount = r'\$([\d,]+(?:\.\d+)?)'
    change = r'(-?\d+) % (-?\d+) %'

    def row(label, block, money=True):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + amount + ' ' + amount + ' ' + amount + ' ' + change, block)
        if len(found) != 1:
            return None
        a, b, c, qq, yy = found[0]
        values = [Decimal(x.replace(',', '')) for x in (a, b, c)]
        # the stated Q/Q and Y/Y changes must agree with the three values (to the rounding of the printed figures)
        for stated, ref in ((qq, values[1]), (yy, values[2])):
            if ref <= 0 or abs((values[0] / ref - 1) * 100 - Decimal(stated)) > Decimal('1.5'):
                return None
        return values
    revenue = row('Revenue', gaap)
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    facts = [('revenue', money_millions(revenue[0]), money_millions(revenue[2]))]
    margin = re.findall(r'Gross margin ([\d.]+) % ([\d.]+) % ([\d.]+) % (?:[\d.]+|—) (?:pts)? ?(?:[\d.]+|—) pts', gaap)
    if len(margin) == 1 and abs((Decimal(margin[0][0]) - Decimal(margin[0][2])) - Decimal(re.search(r'Gross margin [\d.]+ % [\d.]+ % [\d.]+ % \S+ (?:pts )?([\d.]+) pts', gaap)[1])) <= Decimal('0.15'):
        facts.append(('gross-margin', margin[0][0] + '%', margin[0][2] + '%'))
    for key, label, block in (('eps', 'Diluted earnings per share', gaap), ('adjusted-eps', 'Diluted earnings per share', non),
                              ('net-income', 'Net income', gaap), ('operating-income', 'Operating income', gaap)):
        values = row(label, block)
        if values:
            money = per_share if key.endswith('eps') else money_millions
            facts.append((key, money(values[0]), money(values[2])))
    guidance = re.findall(r'Revenue is expected to be \$(\d+(?:\.\d+)?) billion, plus or minus (\d+(?:\.\d+)?)%', t)
    if len(guidance) == 1:
        facts.append(('guidance-revenue', f'${guidance[0][0]}B \u00b1 {guidance[0][1]}%', None,
                      ('次四半期見通し 売上高', 'Next-quarter guidance Revenue')))
    order = {k: n for n, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} FY{year}', 'facts': facts}


AMT = r'(?:\(?[\d,]+(?:\.\d+)?\)?|\u2014)'
HEADLINE_PERIOD = re.compile(r'\b(First|Second|Third|Fourth) Quarter (?:of )?Fiscal (?:Year )?(20\d\d)(?!\d)', re.I)


def headline_period(text):
    """'... Second Quarter of Fiscal Year 2027 Financial Results' in the first lines of the release -> (2, 2027)."""
    match = HEADLINE_PERIOD.search(text[:400])  # the title: later mentions are next-quarter guidance
    if not match:
        raise ValueError('period-unrecognized')
    return QUARTERS[match[1].lower()], int(match[2])


def statement_row(block, label, columns):
    """One row of an income statement: label, then `columns` numbers (a '$' may precede each). Exactly one such row, or None."""
    found = re.findall(r'(?<![A-Za-z])' + label + r'(?: \$)? ' + ' '.join(['(?:\\$ )?(' + AMT + ')'] * columns) + r'(?= |$)', block)
    if len(found) != 1:
        return None
    return [signed(x) for x in found[0]]


def parse_statement(text, cfg):
    """Income-statement layout shared by Marvell, Credo and Broadcom: three or five numeric columns (this quarter, previous quarter,
    same quarter a year earlier [, year-to-date columns]). Nothing is published unless the statement agrees with itself and the headline:
    revenue against the stated year-over-year growth in the headline, gross profit = revenue - cost, operating income = gross profit -
    operating expenses, net income = pretax income - tax, EPS = net income / diluted shares."""
    t = clean(text)
    if cfg['identity'] not in t.lower():
        raise ValueError('issuer-identity-missing')
    if cfg.get('period-re'):
        found = re.findall(cfg['period-re'], t[:1500], re.I)
        if len(found) != 1:
            raise ValueError('period-unrecognized')
        quarter, year = QUARTERS[found[0][0].lower()], int(found[0][1])
    else:
        quarter, year = headline_period(t)
    start = t.find(cfg['heading'])
    if start < 0:
        raise ValueError('statement-heading-missing')
    block = t[start:start + 3200]
    later = re.search(r'(?i)consolidated (?:statements of (?:cash flows|financial position|comprehensive)|balance sheets)', block[60:])
    if later:  # the next statement is not part of this one (its rows repeat labels such as "Net income")
        block = block[:60 + later.start()]
    if cfg.get('end'):  # a later statement (comprehensive income...) repeats row labels such as "Net income"
        stop = block.find(cfg['end'], 60)
        if stop > 0:
            block = block[:stop]
    if cfg['units'] not in block[:400].lower():
        raise ValueError('units-unrecognized')
    if cfg.get('glue'):  # "$4.92" printed without a space after the dollar sign
        block = re.sub(r'\$(?=\d)', '$ ', block)
    n, ago, scale = cfg['columns'], cfg['year-ago'], cfg['scale']
    rows = {}
    for key, label in cfg['rows'].items():
        if isinstance(label, list):  # a subtotal the release does not print: the sum of its listed rows, every one of which must be read
            parts = [statement_row(block, one, n) for one in label]
            rows[key] = [sum(part[i] for part in parts) for i in range(n)] if all(parts) else None
        elif isinstance(label, tuple):  # (label, columns): a row the release prints with fewer columns than the rest
            rows[key] = statement_row(block, label[0], label[1])
        else:
            rows[key] = statement_row(block, label, n)
    if cfg.get('shares-divisor') and rows.get('shares'):  # share counts printed in single shares while the statement is in millions
        rows['shares'] = [x / cfg['shares-divisor'] for x in rows['shares']]
    if cfg.get('swap'):  # the release prints the year-earlier column first: put this quarter first, the year-ago column second
        rows = {k: ([v[1], v[0], *v[2:]] if v else v) for k, v in rows.items()}
    if not rows['revenue'] or rows['revenue'][0] <= 0 or not rows['revenue'][ago] > 0:
        raise ValueError('revenue-row-unrecognized')
    if cfg.get('growth'):
        growth = re.findall(cfg['growth'], t[:2500])
        if len(growth) != 1:
            raise ValueError('revenue-growth-missing')
        stated = Decimal(growth[0])  # the headline's own rounding: whole percent -> +-0.55, one decimal -> +-0.06
        actual = (rows['revenue'][0] / rows['revenue'][ago] - 1) * 100
        if abs(actual - stated) > (Decimal('0.06') if '.' in growth[0] else Decimal('0.55')):
            raise ValueError('change-mismatch')
    else:  # no stated growth: the headline's revenue (in billions, one decimal) must match this quarter's printed revenue
        said = re.findall(cfg['headline'], t[:2500])
        if len(said) != 1 or abs(Decimal(said[0]) * 1000 - rows['revenue'][0] * scale) > Decimal('55'):
            raise ValueError('change-mismatch')

    def col(key, i):
        return rows[key][i] if rows.get(key) else None

    def agrees(a, b, c, i):  # a - b == c in column i, to the rounding of the printed figures
        x, y, z = col(a, i), col(b, i), col(c, i)
        return None not in (x, y, z) and abs((x - y) - z) <= cfg['tol']
    # a column is trusted only when every identity holds in both the current and the year-earlier column
    gross_ok = all(agrees('revenue', 'cost', 'gross', i) for i in (0, ago)) if rows.get('cost') else False
    if cfg.get('op-direct'):  # no gross profit line: operating income = revenue - total operating costs
        op_ok = all(agrees('revenue', 'cost', 'operating', i) for i in (0, ago))
    else:
        op_ok = gross_ok and all(agrees('gross', 'opex', 'operating', i) for i in (0, ago))
    if cfg.get('net-chain') == 'continuing':  # income before tax - tax + equity income = continuing income; + discontinued = net income
        net_ok = all(None not in (col('pretax', i), col('tax', i), col('equity', i), col('cont', i), col('disc', i), col('net', i))
                     and abs(col('pretax', i) - col('tax', i) + col('equity', i) - col('cont', i)) <= cfg['tol']
                     and abs(col('cont', i) + col('disc', i) - col('net', i)) <= cfg['tol'] for i in (0, ago))
    elif cfg.get('net-chain') == 'additive':  # tax and equity-method activity are printed with their sign: pretax + tax + equity = net income
        net_ok = all(None not in (col('pretax', i), col('tax', i), col('equity', i), col('net', i))
                     and abs(col('pretax', i) + col('tax', i) + col('equity', i) - col('net', i)) <= cfg['tol'] for i in (0, ago))
    else:
        net_ok = all(agrees('pretax', 'tax', 'net', i) for i in (0, ago)) if rows.get('tax') is not None else False
    if net_ok and cfg['rows'].get('attrib'):  # net income attributable to common = net income - non-controlling interests
        net_ok = all(None not in (col('net', i), col('nci', i), col('attrib', i)) and abs(col('net', i) - col('nci', i) - col('attrib', i)) <= cfg['tol']
                     for i in (0, ago))
        if net_ok:
            rows['net'] = rows['attrib']
    metrics = {'revenue': (rows['revenue'][0], rows['revenue'][ago])}
    if op_ok:
        metrics['operating-income'] = (rows['operating'][0], rows['operating'][ago])
    if net_ok:
        metrics['net-income'] = (rows['net'][0], rows['net'][ago])
    facts = [(key, money_millions(v[0] * scale), money_millions(v[1] * scale)) for key, v in metrics.items()]
    eps, shares = rows.get('eps'), rows.get('shares')
    if net_ok and eps and shares and shares[0] > 0 and abs(rows['net'][0] / shares[0] - eps[0]) <= Decimal('0.015') + abs(eps[0]) * Decimal('0.02') \
            and shares[ago] > 0 and abs(rows['net'][ago] / shares[ago] - eps[ago]) <= Decimal('0.015') + abs(eps[ago]) * Decimal('0.02'):
        facts.append(('eps', per_share(eps[0]), per_share(eps[ago])))
    guidance = re.findall(cfg['guidance'], t[:3000]) if cfg.get('guidance') else []
    if len(guidance) == 1:
        facts.append(('guidance-revenue', '$' + guidance[0] + 'B', None, ('次四半期見通し 売上高', 'Next-quarter guidance Revenue')))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': cfg['period'](quarter, year), 'facts': facts}


STATEMENT = {
    'VRT': {'identity': 'vertiv', 'heading': 'STATEMENTS OF EARNINGS (LOSS)Vertiv Holdings Co(Dollars in millions', 'units': 'dollars in millions', 'scale': Decimal(1), 'tol': Decimal('0.15'),
            'end': 'BALANCE SHEETS', 'shares-divisor': Decimal(1000000), 'columns': 4, 'year-ago': 1, 'op-direct': True, 'growth': r'Net sales of \$[\d,]+ million, (\d+)% higher than',
            'period-re': r'Reports [A-Za-z ]*?(First|Second|Third|Fourth) Quarter (20\d\d) with', 'period': lambda q, y: f'Q{q} {y}',
            'rows': {'revenue': 'Net sales', 'cost': ['Cost of sales', 'Selling, general and administrative expenses', 'Amortization of intangibles', 'Restructuring costs',
                                                          r'Foreign currency \(gain\) loss, net', r'Other operating expense \(income\)'],
                     'operating': r'Operating profit \(loss\)', 'pretax': r'Income \(loss\) before income taxes', 'tax': r'Income tax expense \(benefit\)',
                     'net': r'Net income \(loss\)', 'eps': r'Earnings \(loss\) per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){3}Diluted',
                     'shares': r'Weighted-average shares outstanding: Basic [\d,]+ (?:[\d,]+ ){3}Diluted'}},
    'AMAT': {'identity': 'applied materials', 'heading': 'CONSOLIDATED CONDENSED STATEMENTS OF OPERATIONS', 'end': 'CONSOLIDATED CONDENSED BALANCE SHEETS',
             'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'growth': r'Record quarterly revenue \$[\d.]+ billion, up (\d+) percent',
             'period-re': r'ANNOUNCES (FIRST|SECOND|THIRD|FOURTH) QUARTER (?:AND FISCAL YEAR )?(20\d\d) RESULTS', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Cost of products sold', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Income from operations', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'eps': r'Earnings per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){3}Diluted',
                      'shares': (r'Weighted average number of shares: Basic \d+ \d+ \d+ \d+ Diluted', 3)}},
    'GOOGL': {'identity': 'alphabet', 'heading': 'CONSOLIDATED STATEMENTS OF INCOME(In millions', 'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1),
              'columns': 4, 'swap': True, 'year-ago': 1, 'op-direct': True, 'growth': r'Consolidated Alphabet revenues increased (\d+)% to',
              'period-re': r'Announces (First|Second|Third|Fourth) Quarter (20\d\d) Results', 'period': lambda q, y: f'Q{q} {y}',
              'rows': {'revenue': 'Revenues', 'cost': 'Total costs and expenses', 'operating': 'Income from operations',
                       'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                       'nci': 'Preferred stock dividends', 'attrib': 'Net income available to common stockholders',
                       'eps': 'Diluted net income per common share',
                       'shares': 'Number of shares used in diluted net income per common share calculation'}},
    'AMZN': {'identity': 'amazon', 'heading': 'Consolidated Statements of Operations(in millions', 'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1),
             'columns': 4, 'swap': True, 'year-ago': 1, 'op-direct': True, 'net-chain': 'additive', 'growth': r'\u2022Net sales increased (\d+)% to',
             'period-re': r'ANNOUNCES (FIRST|SECOND|THIRD|FOURTH) QUARTER RESULTS.{0,700}?quarter ended [A-Z][a-z]+ \d{1,2}, (20\d\d)', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Total net sales', 'cost': 'Total operating expenses', 'operating': 'Operating income',
                      'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'equity': r'Equity-method investment activity, net of tax', 'net': 'Net income', 'eps': 'Diluted earnings per share',
                      'shares': r'Weighted-average shares used in computation of earnings per share: Basic ' + AMT + ' ' + AMT + ' ' + AMT + ' ' + AMT + ' Diluted'}},
    'MSFT': {'identity': 'microsoft', 'heading': 'INCOME STATEMENTS (In millions', 'end': 'COMPREHENSIVE INCOME STATEMENTS', 'glue': True,
             'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1), 'columns': 2, 'year-ago': 1, 'growth': r'Revenue was \$[\d.]+ billion and increased (\d+)%',
             'period-re': r'Announces (First|Second|Third|Fourth) Quarter Results.{0,300}?quarter ended [A-Z][a-z]+ \d{1,2}, (20\d\d)',
             'period': lambda q, y: f'Q{q} FY{y + 1 if q <= 2 else y}',
             'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross margin',
                      'opex': ['Research and development', 'Sales and marketing', 'General and administrative'],
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'eps': r'Earnings per share: Basic (?:\$ [\d.]+ ){2}Diluted',
                      'shares': r'Weighted average shares outstanding: Basic ' + AMT + ' ' + AMT + ' Diluted'}},
    'MRVL': {'identity': 'marvell', 'heading': 'Condensed Consolidated Statements of Operations', 'units': 'in millions', 'scale': Decimal(1),
             'tol': Decimal('0.15'), 'columns': 5, 'year-ago': 2, 'growth': r'grew by (\d+)% year-on-year', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Net revenue', 'cost': 'Cost of goods sold', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'eps': 'Net income per share — diluted',
                      'shares': r'preferred stock assuming conversion: Basic ' + AMT + ' (?:' + AMT + ' ){4}Diluted'}},
    'CRDO': {'identity': 'credo', 'heading': 'Condensed Consolidated Statements of Operations', 'units': 'in thousands', 'scale': Decimal('0.001'),
             'tol': Decimal(1), 'columns': 3, 'year-ago': 2, 'growth': r'quarter over quarter and (\d+(?:\.\d+)?)% year over year', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': r'Provision \(benefit\) for income taxes',
                      'net': 'Net income', 'eps': r'Net income per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){2}Diluted',
                      'shares': r'computing net income per share: Basic ' + AMT + ' ' + AMT + ' ' + AMT + ' Diluted'}},
    'AVGO': {'identity': 'broadcom', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'units': 'in millions', 'scale': Decimal(1),
             'tol': Decimal(1), 'columns': 5, 'year-ago': 2, 'growth': r'up (\d+) percent from the prior year period', 'period': lambda q, y: f'Q{q} FY{y}',
             'guidance': r'revenue guidance of approximately \$(\d+(?:\.\d+)?) billion',
             'rows': {'revenue': 'Net revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross margin', 'opex': 'Total operating expenses',
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'eps': r'Net income per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){4}Diluted',
                      'shares': r'per share calculations: Basic ' + AMT + ' (?:' + AMT + ' ){4}Diluted'}},
    'ANET': {'identity': 'arista', 'heading': 'Condensed Consolidated Income Statements', 'units': 'in millions', 'scale': Decimal(1),
             'tol': Decimal('0.15'), 'columns': 4, 'year-ago': 1, 'growth': r'growing (\d+(?:\.\d+)?)%',
             'period-re': r'Reports (First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Income from operations', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'eps': r'Net income per share: Basic (?:\$ [\d.]+ ){4}Diluted',
                      'shares': r'computing net income per share: Basic ' + AMT + ' (?:' + AMT + ' ){3}Diluted'}},
    'PLTR': {'identity': 'palantir', 'heading': 'Condensed Consolidated Statements of Operations', 'units': 'in thousands', 'scale': Decimal('0.001'),
             'tol': Decimal(2), 'columns': 4, 'year-ago': 1, 'growth': r'and Revenue Growth of (\d+)% Y/Y',
             'period-re': r'results for the (first|second|third|fourth) quarter ended [A-Z][a-z]+ \d{1,2}, (20\d\d)', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Revenue', 'cost': r'Cost of revenue \(1\)', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Income from operations', 'pretax': 'Income before provision for income taxes', 'tax': 'Provision for income taxes',
                      'net': 'Net income', 'nci': 'Less: Net income attributable to noncontrolling interests',
                      'attrib': 'Net income attributable to common stockholders',
                      'eps': 'Earnings per share attributable to common stockholders, diluted',
                      'shares': r'common stock outstanding used in computing earnings per share attributable to common stockholders, diluted'}},
    'SNDK': {'identity': 'sandisk', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'units': 'in millions', 'scale': Decimal(1),
             'tol': Decimal(1), 'columns': 2, 'year-ago': 1, 'headline': r'quarter revenue was \$(\d+(?:\.\d+)?) billion',
             'period-re': r'Reports Fiscal (First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Revenue, net', 'cost': 'Cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Operating income', 'pretax': 'Income before taxes', 'tax': 'Income tax expense',
                      'net': 'Net income', 'eps': r'Net income per common share: Basic \$ [\d.]+ \$ [\d.]+ Diluted',
                      'shares': r'Weighted average shares outstanding: Basic \d+ Diluted'}},
    'AMD': {'identity': 'advanced micro devices', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'units': 'millions', 'scale': Decimal(1),
            'tol': Decimal(1), 'columns': 5, 'year-ago': 2, 'headline': r'quarter revenue was \$(\d+(?:\.\d+)?) billion', 'net-chain': 'continuing',
            'period-re': r'AMD Reports (First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
            'rows': {'revenue': 'Net revenue', 'cost': 'Total cost of sales', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                     'operating': 'Operating income', 'pretax': 'Income from continuing operations before income taxes and equity income',
                     'tax': r'Income tax provision \(benefit\)', 'equity': 'Equity income in investee',
                     'cont': 'Income from continuing operations, net of tax', 'disc': r'Income \(loss\) from discontinued operations, net of tax',
                     'net': 'Net income', 'eps': 'Diluted earnings per share', 'shares': r'Shares used in per share calculation Basic [\d,]+ (?:[\d,]+ ){4}Diluted'}},
}


ORACLE_QUARTER = {'august': (1, 1), 'november': (2, 1), 'february': (3, 0), 'may': (4, 0)}  # month -> (fiscal quarter, years after the calendar year)


def parse_oracle(text, url=None):
    """Oracle's results release (8-K EX-99.1): an income statement whose columns carry a '% of revenues' cell after each amount.
    Revenue against the headline's own 'Total Revenues up 30%', operating income = revenue - total operating expenses, net income =
    pretax income - tax, EPS = net income available to common / diluted shares. Rows that do not add up are dropped."""
    t = clean(text)
    if 'oracle' not in t.lower():
        raise ValueError('issuer-identity-missing')
    start = t.find('CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS')
    if start < 0:
        raise ValueError('statement-heading-missing')
    block = t[start:start + 3200]
    period = re.search(r'\(\$ in millions, except per share data\) Three Months Ended ([A-Z][a-z]+) \d{1,2}, % Increase', block[:300])
    month = period[1].lower() if period else None
    years = re.search(r'(20\d\d) % of Revenues (20\d\d) % of Revenues', block[:400])
    if month not in ORACLE_QUARTER or not years or int(years[1]) - 1 != int(years[2]):
        raise ValueError('period-unrecognized')
    quarter, ahead = ORACLE_QUARTER[month]
    fiscal_year = int(years[1]) + ahead
    amount = r'\(?([\d,]+(?:\.\d+)?)\s?\)?'
    pct = r'\(?\d+%\)?'

    def pair(label, with_percent=True):
        """(this year, last year) of a row printed '<label> [$] n [n%] [$] n [n%] ...'; exactly one such row."""
        cell = r'(?:\$ )?' + amount + ((' ' + pct) if with_percent else '')
        found = re.findall(r'(?<![A-Za-z])' + label + r' (?:\(\d\) )?' + cell + ' ' + cell + r'(?= |$)', block)
        if len(found) != 1:
            return None
        return Decimal(found[0][0].replace(',', '')), Decimal(found[0][1].replace(',', ''))
    revenue = pair('Total revenues')
    if not revenue or revenue[1] <= 0:
        raise ValueError('revenue-row-unrecognized')
    growth = re.findall(r'Total Revenues up (\d+)% in USD', t[:2500])
    if len(growth) != 1 or abs((revenue[0] / revenue[1] - 1) * 100 - Decimal(growth[0])) > Decimal('0.55'):
        raise ValueError('change-mismatch')
    expenses, operating = pair('Total operating expenses'), pair('OPERATING INCOME')
    pretax, tax, net = pair('INCOME BEFORE INCOME TAXES'), pair('Provision for income taxes'), pair('NET INCOME')
    metrics = {'revenue': revenue}
    if expenses and operating and all(abs(revenue[i] - expenses[i] - operating[i]) <= Decimal(1) for i in (0, 1)):
        metrics['operating-income'] = operating
    if pretax and tax and net and all(abs(pretax[i] - tax[i] - net[i]) <= Decimal(1) for i in (0, 1)):
        metrics['net-income'] = net
    facts = [(key, money_millions(v[0]), money_millions(v[1])) for key, v in metrics.items()]
    common = re.findall(r'NET INCOME AVAILABLE TO COMMON SHAREHOLDERS \$ ([\d,]+) \$ ([\d,]+)', block)
    preferred = re.findall(r'Preferred stock dividends ([\d,]+) (?:[\d,]+|\u2014)', block)
    eps = re.findall(r'EARNINGS PER SHARE ATTRIBUTABLE TO COMMON SHAREHOLDERS: Basic \$ [\d.]+ \$ [\d.]+ Diluted \$ ([\d.]+) \$ ([\d.]+)', block)
    shares = re.findall(r'WEIGHTED AVERAGE COMMON SHARES OUTSTANDING: Basic [\d,]+ [\d,]+ Diluted ([\d,]+) ([\d,]+)', block)
    if 'net-income' in metrics and len(common) == len(eps) == len(shares) == len(preferred) == 1:
        income = [Decimal(x.replace(',', '')) for x in common[0]]
        diluted = [Decimal(x.replace(',', '')) for x in shares[0]]
        reported = [Decimal(x) for x in eps[0]]
        if (abs(net[0] - Decimal(preferred[0].replace(',', '')) - income[0]) <= Decimal(1) and diluted[0] > 0 and diluted[1] > 0
                and all(abs(income[i] / diluted[i] - reported[i]) <= Decimal('0.015') + reported[i] * Decimal('0.02') for i in (0, 1))):
            facts.append(('eps', per_share(reported[0]), per_share(reported[1])))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} FY{fiscal_year}', 'facts': facts}
def parse_gev(text, url=None):
    """GE Vernova's results release (8-K EX-99): the 'Total Company Results' summary table (this quarter, a year earlier, change, then nine months).
    Revenue and diluted EPS against their stated Year-on-Year change, net income and adjusted EBITDA against the stated difference, and revenue against
    the headline's own '$12.6B, +27%'. The release carries no full income statement, so there is no operating income."""
    t = clean(text)
    if 'ge vernova' not in t.lower():
        raise ValueError('issuer-identity-missing')
    period = re.findall(r'reports [a-z ]*?(first|second|third|fourth) quarter (20\d\d) financial performance', t[:1500], re.I)
    if len(period) != 1:
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[period[0][0].lower()], int(period[0][1])
    start = t.find('Total Company Results')
    if start < 0:
        raise ValueError('summary-table-missing')
    block = t[start:start + 2200]
    if not re.search(r'\(Dollars in millions, except per share\) (20\d\d) (20\d\d) Year-on-Year', block[:300]):
        raise ValueError('columns-unrecognized')
    columns = re.search(r'\(Dollars in millions, except per share\) (20\d\d) (20\d\d) Year-on-Year', block)
    if int(columns[1]) != year or int(columns[2]) != year - 1:
        raise ValueError('columns-unrecognized')
    amount = r'\$([\d,]+(?:\.\d+)?)'
    pct = r'(-?\d+)%'

    def row(label, third):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + amount + ' ' + amount + ' ' + third + r'(?= )', block)
        if len(found) != 1:
            return None
        return [Decimal(x.replace(',', '')) for x in found[0]]

    def change_ok(values, stated):  # whole-percent change printed next to the two values
        return values[1] > 0 and abs((values[0] / values[1] - 1) * 100 - Decimal(stated)) <= Decimal('0.55')

    def with_pct(label):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + amount + ' ' + amount + ' ' + pct + r'(?= )', block)
        if len(found) != 1:
            return None
        values = [Decimal(found[0][0].replace(',', '')), Decimal(found[0][1].replace(',', ''))]
        return values if change_ok(values, found[0][2]) else None

    def with_diff(label):
        values = row(label, amount)
        return values[:2] if values and abs(values[0] - values[1] - values[2]) <= Decimal(1) else None
    revenue = with_pct('Total revenues')
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    headline = re.findall(r'Revenue of \$(\d+(?:\.\d+)?)B, \+(\d+)%', t[:3000])
    if len(headline) != 1 or abs(Decimal(headline[0][0]) * 1000 - revenue[0]) > Decimal(55) or not change_ok(revenue, headline[0][1]):
        raise ValueError('change-mismatch')
    facts = [('revenue', money_millions(revenue[0]), money_millions(revenue[1]))]
    eps = with_pct('Diluted EPS')
    if eps:
        facts.append(('eps', per_share(eps[0]), per_share(eps[1])))
    for key, label in (('net-income', r'Net income \(loss\)'), ('adjusted-ebitda', 'Adjusted EBITDA')):
        values = with_diff(label)
        if values:
            facts.append((key, money_millions(values[0]), money_millions(values[1])))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} {year}', 'facts': facts}


def parse_dell(text, url=None):
    """Dell's results release (8-K EX-99.1): 'Condensed Consolidated Statements of Income and Related Financial Highlights' with the
    columns this quarter, a year earlier, change (%), then six months. Every row is checked against its stated change."""
    t = clean(text)
    if 'dell technologies' not in t.lower():
        raise ValueError('issuer-identity-missing')
    quarter, year = headline_period(t)
    start = t.find('Statements of Income and Related Financial Highlights')
    if start < 0:
        raise ValueError('statement-heading-missing')
    block = t[start:start + 3600]
    if 'in millions' not in block[:200].lower():
        raise ValueError('units-unrecognized')
    pct = r'(\(?-?\d[\d,]*\)?%|—%)'

    def row(label):
        found = re.findall(r'(?<![A-Za-z])' + label + r' (?:\$ )?(' + AMT + r') (?:\$ )?(' + AMT + r') ' + pct, block)
        if len(found) != 1:
            return None
        current, prior, change = signed(found[0][0]), signed(found[0][1]), found[0][2]
        if change.startswith('('):
            change = '-' + change.strip('()')
        try:
            consistent(prior, current, change)
        except ValueError:
            return None
        return current, prior
    revenue = row('Total net revenue')
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    metrics = {'revenue': revenue}
    for key, label in (('operating-income', 'Operating income'), ('net-income', 'Net income')):
        found = row(label)
        if found:
            metrics[key] = found
    eps = re.findall(r'Earnings per share: Basic \$ [\d.]+ \$ [\d.]+ \d+% \$ [\d.]+ \$ [\d.]+ \d+% Diluted \$ ([\d.]+) \$ ([\d.]+) (\d+)%', block)
    facts = [(key, money_millions(v[0]), money_millions(v[1])) for key, v in metrics.items()]
    if len(eps) == 1:
        try:
            consistent(Decimal(eps[0][1]), Decimal(eps[0][0]), eps[0][2] + '%')
            facts.append(('eps', per_share(Decimal(eps[0][0])), per_share(Decimal(eps[0][1]))))
        except (ValueError, InvalidOperation):
            pass
    guidance = re.findall(r'Full-year FY\d\d revenue guidance of \$(\d+(?:\.\d+)?) billion', t[:3000])
    if len(guidance) == 1:
        facts.append(('guidance-revenue', f'${guidance[0]}B', None))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} FY{year}', 'facts': facts}


def parse_micron(text, url=None):
    """Micron's results release (8-K EX-99.1): 'Fiscal Q4 2026 Highlights' bullets in billions, then 'CONSOLIDATED STATEMENTS OF OPERATIONS'
    in millions with columns this quarter, previous quarter, same quarter a year earlier, then the fiscal year to date.
    Revenue and net income must agree with the highlights; operating income = gross margin - operating expenses; EPS = net income / diluted shares."""
    t = clean(text)
    if 'micron technology' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.findall(r'Fiscal Q([1-4]) (20\d\d) Highlights', t[:3000])
    if len(head) != 1:
        raise ValueError('highlights-heading-missing')
    quarter, year = int(head[0][0]), int(head[0][1])
    start = t.find('CONSOLIDATED STATEMENTS OF OPERATIONS')
    if start < 0:
        raise ValueError('statement-heading-missing')
    block = t[start:start + 2400]
    if 'in millions' not in block[:200].lower():
        raise ValueError('units-unrecognized')
    row = lambda label, n=5: statement_row(block, label, n)
    revenue, cost, gross, op, net = row('Revenue'), row('Cost of goods sold'), row('Gross margin'), row('Operating income'), row('Net income')
    if not revenue or revenue[0] <= 0 or revenue[2] <= 0:
        raise ValueError('revenue-row-unrecognized')
    bullet = re.findall(r'Revenue of \$(\d+(?:\.\d+)?) billion versus \$(\d+(?:\.\d+)?) billion for the prior quarter and \$(\d+(?:\.\d+)?) billion for the same period last year', t[:3000])
    if len(bullet) != 1:
        raise ValueError('highlights-revenue-missing')
    for stated, printed in zip(bullet[0], revenue[:3]):  # the highlights are rounded to $0.01B
        if abs(Decimal(stated) * 1000 - printed) > Decimal('5.5'):
            raise ValueError('change-mismatch')
    metrics = {'revenue': (revenue[0], revenue[2])}
    expenses = [row('Research and development'), row('Selling, general, and administrative'), row(r'Other operating \(income\) expense, net')]
    if gross and cost and all(abs(revenue[i] - cost[i] - gross[i]) <= 1 for i in (0, 2)) and op and all(expenses) \
            and all(abs(gross[i] - sum(e[i] for e in expenses) - op[i]) <= 1 for i in (0, 2)):
        metrics['operating-income'] = (op[0], op[2])
    eps = statement_row(block, r'Earnings per share Basic (?:\$ [\d.]+ ){5}Diluted', 5)
    shares = statement_row(block, r'Number of shares used in per share calculations Basic [\d,]+ (?:[\d,]+ ){4}Diluted', 5)
    facts = []
    net_ok = bool(net and eps and shares and all(shares[i] > 0 and abs(net[i] / shares[i] - eps[i]) <= Decimal('0.015') + abs(eps[i]) * Decimal('0.02') for i in (0, 2)))
    stated_net = re.findall(r'(?<![-\w])GAAP net income of \$(\d+(?:\.\d+)?) billion, or \$(\d+(?:\.\d+)?) per diluted share', t[:3000])
    if net_ok and stated_net and abs(Decimal(stated_net[0][0]) * 1000 - net[0]) <= Decimal('5.5') and Decimal(stated_net[0][1]) == eps[0]:
        metrics['net-income'] = (net[0], net[2])
    else:
        net_ok = False
    facts = [(key, money_millions(v[0]), money_millions(v[1])) for key, v in metrics.items()]
    if net_ok:
        facts.append(('eps', per_share(eps[0]), per_share(eps[2])))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} FY{year}', 'facts': facts}


def prefixed(prefix, value, unit):
    """'NT$' + 1494.243 + 'B' -> 'NT$1494.243B' (the printed figure, never rounded; the site's value format has no thousands comma)."""
    return prefix + format(value.normalize(), 'f') + unit


def parse_tsmc(text, url=None):
    """TSMC's results release (6-K EX-99.1): a table in NT$ million with this quarter, the same quarter a year earlier (+YoY %) and the
    previous quarter (+QoQ %). Every row is checked against both stated changes; gross margin against the table's own gross profit / net sales."""
    t = clean(text)
    if 'tsmc' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.findall(r'for the (first|second|third|fourth) quarter ended [A-Z][a-z]+ \d{1,2}, (20\d\d)', t[:1500])
    if len(head) != 1:
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[head[0][0]], int(head[0][1])
    start = t.find('(Unit: NT$ million, except for EPS)')
    if start < 0:
        raise ValueError('table-heading-missing')
    block = t[start:start + 1500]
    yy = year % 100
    prev = f'{quarter - 1}Q{yy:02d}' if quarter > 1 else f'4Q{(yy - 1) % 100:02d}'
    header = rf'{quarter}Q{yy:02d}Amount\w? {quarter}Q{(yy - 1) % 100:02d}Amount YoY ?Inc\. \(Dec\.\) % {prev}Amount QoQ ?Inc\. \(Dec\.\) %'
    if not re.search(header, block[:300]):
        raise ValueError('columns-unrecognized')
    num = r'([\d,]+(?:\.\d+)?)[a-z]?'

    def row(label):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + ' '.join([num] * 5) + r'(?= |$)', block)
        if len(found) != 1:
            return None
        cur, ago, yoy, prev, qoq = [Decimal(x.replace(',', '')) for x in found[0]]
        # the stated YoY and QoQ changes must agree with the values (to the rounding of the printed figures)
        for stated, ref in ((yoy, ago), (qoq, prev)):
            if ref <= 0 or abs((cur / ref - 1) * 100 - stated) > Decimal('0.15'):
                return None
        return cur, ago
    revenue = row('Net sales')
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    facts = {'revenue': (prefixed('NT$', revenue[0] / 1000, 'B'), prefixed('NT$', revenue[1] / 1000, 'B'))}
    gross = re.findall(r'Gross profit ([\d,]+) ', block)
    margin = re.findall(r'Gross margin for the quarter was (\d+\.\d)%', t[:2500])
    if len(gross) == 1 and len(margin) == 1 and row('Gross profit') and abs(Decimal(gross[0].replace(',', '')) / revenue[0] * 100 - Decimal(margin[0])) <= Decimal('0.06'):
        facts['gross-margin'] = (margin[0] + '%', None)
    for key, label in (('operating-income', 'Income from operations'), ('net-income', 'Net income')):
        found = row(label)
        if found:
            facts[key] = (prefixed('NT$', found[0] / 1000, 'B'), prefixed('NT$', found[1] / 1000, 'B'))
    eps = row(r'EPS \(NT\$\)')
    if eps:
        facts['eps'] = (prefixed('NT$', eps[0], ''), prefixed('NT$', eps[1], ''))
    out = [(k, v[0], v[1]) for k, v in facts.items()]
    guidance = re.findall(r'Revenue is expected to be between US\$(\d+(?:\.\d+)?) billion and US\$(\d+(?:\.\d+)?) billion', t[:3000])
    if len(guidance) == 1 and Decimal(guidance[0][0]) < Decimal(guidance[0][1]):
        out.append(('guidance-revenue', f'${guidance[0][0]}B-${guidance[0][1]}B', None, ('次四半期見通し 売上高', 'Next-quarter guidance Revenue')))
    order = {k: i for i, k in enumerate(ORDER)}
    out.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} {year}', 'facts': out}


def parse_asml(text, url=None):
    """ASML's results release (6-K EX-99.1): a small table in EUR million (previous quarter, this quarter) and the headline in billions.
    Net sales and net income must agree with the headline; gross margin with gross profit / net sales."""
    t = clean(text)
    if 'asml' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.findall(r'ASML reports \u20ac([\d.]+) billion total net sales and \u20ac([\d.]+) billion net income in Q([1-4]) (20\d\d)', t[:600])
    if len(head) != 1:
        raise ValueError('highlights-heading-missing')
    quarter, year = int(head[0][2]), int(head[0][3])
    pq = f'Q{quarter - 1 if quarter > 1 else 4} {year if quarter > 1 else year - 1}'
    start = t.find('(Figures in millions of euros unless otherwise indicated)')
    if start < 0:
        raise ValueError('table-heading-missing')
    block = t[start:start + 900]
    if f'{pq} Q{quarter} {year}' not in block[:200]:
        raise ValueError('columns-unrecognized')
    num = r'([\d,]+(?:\.\d+)?)'

    def row(label):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + num + ' ' + num + r'(?= |$)', block)
        return [Decimal(x.replace(',', '')) for x in found[0]] if len(found) == 1 else None
    sales, profit, net, eps = row('Total net sales'), row('Gross profit'), row('Net income'), row(r'EPS \(basic; in euros\)')
    if not sales or sales[1] <= 0 or abs(Decimal(head[0][0]) * 1000 - sales[1]) > Decimal(50):
        raise ValueError('revenue-row-unrecognized')
    facts = [('revenue', prefixed('\u20ac', sales[1] / 1000, 'B'), None)]
    margin = row(r'Gross margin \(%\)')
    if profit and margin and abs(profit[1] / sales[1] * 100 - margin[1]) <= Decimal('0.06') and abs(profit[0] / sales[0] * 100 - margin[0]) <= Decimal('0.06'):
        facts.append(('gross-margin', format(margin[1].normalize(), 'f') + '%', None))
    if net and abs(Decimal(head[0][1]) * 1000 - net[1]) <= Decimal(50):
        facts.append(('net-income', prefixed('\u20ac', net[1] / 1000, 'B'), None))
    if eps and net and eps[1] > 0:
        facts.append(('eps', prefixed('\u20ac', eps[1], ''), None, ('EPS（基本）', 'Basic EPS')))
    guidance = re.findall(r'We expect fourth-quarter \d{4} total net sales between \u20ac(\d+(?:\.\d+)?) billion and \u20ac(\d+(?:\.\d+)?) billion', t) if quarter == 3 else []
    if len(guidance) == 1 and Decimal(guidance[0][0]) < Decimal(guidance[0][1]):
        facts.append(('guidance-revenue', f'\u20ac{guidance[0][0]}B-\u20ac{guidance[0][1]}B', None, ('次四半期見通し 売上高', 'Next-quarter guidance Revenue')))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} {year}', 'facts': facts}


NEBIUS_RESULTS_PATH = re.compile(r'^/newsroom/(?=[a-z0-9-]*quarter)(?=[a-z0-9-]*financial-results)(?![a-z0-9-]*date)[a-z0-9-]+/?$')
PDF_LINK = re.compile(r'https://assets\.nebius\.com/assets/[0-9a-f-]{36}/[^"\\\s)<>]*?\.pdf', re.I)


PDF_MAX_BYTES = 20 * 1024 * 1024


class _SameHostRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != 'https' or target.hostname != 'assets.nebius.com':
            raise ValueError('redirect-off-host')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def direct_pdf(url, ticker=None):
    """Plain bounded download of a results PDF from the issuer's asset host. No conditional requests and no shared fetch
    cache: on Nov 12 the monitor's general fetch kept failing ('empty or oversized') for a PDF that downloads fine."""
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname != 'assets.nebius.com' or parts.username or parts.password:
        raise ValueError('host-not-allowed')
    request = urllib.request.Request(url, headers={'User-Agent': os.environ.get('RESEARCH_USER_AGENT', 'TechPhaseResearch-SourceCheck/0.1'),
                                                  'Accept': 'application/pdf'})
    with urllib.request.build_opener(_SameHostRedirect()).open(request, timeout=20) as response:
        content = response.read(PDF_MAX_BYTES + 1)
    if not content:
        raise ValueError('fetch-empty')
    if len(content) > PDF_MAX_BYTES:
        raise ValueError('fetch-too-large')
    if not content.startswith(b'%PDF-'):
        raise ValueError('fetch-not-pdf')
    return content, 'application/pdf'


def failure_code(exc):
    text = str(exc).lower()
    if isinstance(exc, ValueError) and re.fullmatch(r'(?:fetch|host|redirect)-[a-z-]{1,30}|host-not-allowed', str(exc)):
        return str(exc)
    if isinstance(exc, urllib.error.HTTPError):
        return 'fetch-http-%d' % exc.code
    if 'timed out' in text:
        return 'extract-timeout' if 'extraction' in text else 'fetch-timeout'
    if 'no extractable' in text:
        return 'extract-no-text'
    if 'oversized' in text:
        return 'fetch-oversized'
    return 'fetch-or-extract-error'


def nebius_pdf_text(page_url, fetch, fetch_pdf=None):
    """Text of the results release PDF linked from the newsroom page (the page itself carries no numbers)."""
    fetch_pdf = fetch_pdf or direct_pdf
    html, _ = fetch(page_url, 'NBIS')
    seen = []
    for link in PDF_LINK.findall(html.decode('utf-8', 'replace')):
        if link not in seen:
            seen.append(link)
    codes = []
    for link in seen[:MAX_PDF_CANDIDATES]:
        try:
            content, content_type = fetch_pdf(link, 'NBIS')
            if content_type != 'application/pdf':
                codes.append('not-pdf')
                continue
            # The headline table is on the first pages; reading all of an 8 MB release timed out on a busy monitor.
            text = monitor.extract_pdf_text(content, first_pages=3)
        except Exception as exc:
            codes.append(failure_code(exc))
            continue
        if 'financialhighlights' in re.sub(r'\s+', '', text).lower():
            return text
        codes.append('no-heading')
    if not seen:
        raise ValueError('results-pdf-not-linked-yet')
    # /health shows the outcome of the first PDF (the release itself); a later letter's failure must not hide it.
    raise ValueError(codes[0] if codes else 'results-table-not-in-pdf')


PROFILES = {
    'NBIS': {'publisher': 'Nebius IR', 'parse': parse_nebius},
    'CRWV': {'publisher': 'CoreWeave IR (SEC 8-K)', 'parse': parse_coreweave, 'marker': 'Financial Highlights'},
    'NVDA': {'publisher': 'NVIDIA IR', 'parse': parse_nvidia, 'marker': 'Summary GAAP'},
    'DELL': {'publisher': 'Dell Technologies IR (SEC 8-K)', 'parse': parse_dell, 'marker': 'Statements of Income and Related Financial Highlights'},
    'MU': {'publisher': 'Micron IR (SEC 8-K)', 'parse': parse_micron, 'marker': 'CONSOLIDATED STATEMENTS OF OPERATIONS'},
    'TSM': {'publisher': 'TSMC IR (SEC 6-K)', 'parse': parse_tsmc, 'marker': '(Unit: NT$ million, except for EPS)'},
    'ASML': {'publisher': 'ASML IR (SEC 6-K)', 'parse': parse_asml, 'marker': '(Figures in millions of euros unless otherwise indicated)'},
    'ANET': {'publisher': 'Arista IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['ANET']), 'marker': STATEMENT['ANET']['heading']},
    'PLTR': {'publisher': 'Palantir IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['PLTR']), 'marker': STATEMENT['PLTR']['heading']},
    'SNDK': {'publisher': 'Sandisk IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['SNDK']), 'marker': STATEMENT['SNDK']['heading']},
    'AMAT': {'publisher': 'Applied Materials IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AMAT']), 'marker': STATEMENT['AMAT']['heading']},
    'GOOGL': {'publisher': 'Alphabet IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['GOOGL']), 'marker': STATEMENT['GOOGL']['heading']},
    'AMZN': {'publisher': 'Amazon IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AMZN']), 'marker': STATEMENT['AMZN']['heading']},
    'GEV': {'publisher': 'GE Vernova IR (SEC 8-K)', 'parse': parse_gev, 'marker': 'Total Company Results'},
    'VRT': {'publisher': 'Vertiv IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['VRT']), 'marker': 'STATEMENTS OF EARNINGS (LOSS)'},
    'ORCL': {'publisher': 'Oracle IR (SEC 8-K)', 'parse': parse_oracle, 'marker': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS'},
    'MSFT': {'publisher': 'Microsoft IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['MSFT']), 'marker': STATEMENT['MSFT']['heading']},
    'AMD': {'publisher': 'AMD IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AMD']), 'marker': STATEMENT['AMD']['heading']},
    'MRVL': {'publisher': 'Marvell IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['MRVL']),
             'marker': STATEMENT['MRVL']['heading']},
    'CRDO': {'publisher': 'Credo IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['CRDO']),
             'marker': STATEMENT['CRDO']['heading']},
    'AVGO': {'publisher': 'Broadcom IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AVGO']),
             'marker': STATEMENT['AVGO']['heading']},
}
SOURCE_URL = {
    'NBIS': re.compile(r'^https://nebius\.com/newsroom/[a-z0-9-]+$'),
    'CRWV': re.compile(r'^https://www\.sec\.gov/Archives/edgar/data/\d+/\d+/[A-Za-z0-9_.-]+$'),
}


# ---- storage -----------------------------------------------------------------------------------------------

def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS issuer_result_publications(
      key TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL, period TEXT NOT NULL,
      payload TEXT NOT NULL, observed_at TEXT NOT NULL, published_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL, version TEXT NOT NULL)''')


def instant(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def stamp(value=None):
    return (value or datetime.now(timezone.utc)).isoformat(timespec='milliseconds')


def build(ticker, url, parsed, observed_at):
    key = hashlib.sha256('\0'.join([ticker, parsed['period'], url]).encode()).hexdigest()
    number = str(int(key[:12], 16))
    # comparisons.yearAgo is the same quarter one year earlier, read from the table's prior-year column (same format as value).
    facts = [{'key': f[0], 'ja': (f[3] if len(f) > 3 else LABELS[f[0]])[0], 'en': (f[3] if len(f) > 3 else LABELS[f[0]])[1], 'value': f[1],
              **({'comparisons': {'yearAgo': f[2]}} if f[2] else {})} for f in parsed['facts']]
    first = facts[:2]
    period = parsed['period']
    return key, {
        'id': number, 'researchId': 'ir-flash-' + number, 'kind': 'earnings', 'ticker': ticker, 'period': period,
        'titleJa': f'{ticker} {period}決算：' + '、'.join(f['ja'] + f['value'] for f in first),
        'titleEn': f'{ticker} {period} earnings: ' + ', '.join(f['en'] + ' ' + f['value'] for f in first),
        'facts': facts, 'url': url, 'publisher': PROFILES[ticker]['publisher'],
        'publishedAt': observed_at, 'observedAt': observed_at, 'method': 'deterministic-issuer-table',
    }


_attempts = {}
# Last outcome per release (short codes only), so /health shows why a results table was not published.
STATUS = {}


def due(url, detected, now):
    """Rate limit for sources that are still waiting for their table."""
    last = _attempts.get(url)
    wait = RETRY_FAST_SECONDS if now - detected <= FAST_PERIOD else RETRY_SLOW_SECONDS
    if last is not None and time.monotonic() - last < wait:
        return False
    _attempts[url] = time.monotonic()
    return True


def candidates(db, reference):
    cutoff = (reference - WINDOW).isoformat()
    for row in db.execute('''SELECT s.url,s.ticker,COALESCE(e.detected_at,s.discovered_at) AS detected
        FROM sources s LEFT JOIN release_events e ON e.url=s.url
        WHERE s.ticker='NBIS' AND s.status NOT IN ('held','rejected')
          AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)''', (cutoff,)):
        parts = urlsplit(row['url'])
        if (parts.scheme == 'https' and parts.hostname == 'nebius.com' and not parts.query
                and NEBIUS_RESULTS_PATH.match(parts.path) and SOURCE_URL['NBIS'].match(row['url'])):
            yield row['ticker'], row['url'], row['detected'], None
    # Companies whose release table is read from the page text the monitor already stored (SEC exhibit or the company's own page).
    # Never filter on the revision text in SQL: the planner then scans every stored revision (a whole database of page text)
    # every few seconds and starves the monitor (Nov 12). Pick the few recent sources of these companies first, then read only
    # their current revision.
    markers = {t: p['marker'] for t, p in PROFILES.items() if p.get('marker')}
    for row in db.execute('SELECT s.url,s.ticker,s.sha256,COALESCE(e.detected_at,s.discovered_at) AS detected '
                          'FROM sources s LEFT JOIN release_events e ON e.url=s.url '
                          "WHERE s.ticker IN (%s) AND s.status NOT IN ('held','rejected') "
                          'AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)' % ','.join('?' for _ in markers),
                          (*markers, cutoff)).fetchall():
        parts = urlsplit(row['url'])
        if (parts.scheme != 'https' or parts.query or parts.fragment or parts.username
                or parts.hostname not in monitor.HOSTS.get(row['ticker'], set()) or len(row['url']) > 240):
            continue
        revision = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?',
                              (row['url'], row['sha256'])).fetchone()
        if revision and markers[row['ticker']] in (revision['extracted_text'] or ''):
            yield row['ticker'], row['url'], row['detected'], revision['extracted_text']


def run_once(path, reference=None, fetch=None, fetch_pdf=None):
    """Publish every unpublished (or corrected) results table found. Returns the number of changes."""
    reference = reference or datetime.now(timezone.utc)
    fetch = fetch or monitor.fetch
    changed = 0
    with monitor.connect(path) as db:
        schema(db)
        for ticker, url, detected, body in list(candidates(db, reference)):
            observed = instant(detected)
            if observed is None or observed > reference:
                continue
            existing = {r['key']: r for r in db.execute(
                'SELECT key,payload FROM issuer_result_publications WHERE ticker=? AND url=?', (ticker, url))}
            if body is None:
                if existing or not due(url, observed, reference):
                    continue
            started = time.monotonic()
            try:
                text = body if body is not None else nebius_pdf_text(url, fetch, fetch_pdf or (fetch if fetch is not monitor.fetch else None))
                parsed = PROFILES[ticker]['parse'](text, url)
            except Exception as exc:
                code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z0-9-]{1,40}', str(exc)) else type(exc).__name__
                STATUS[url] = {'ticker': ticker, 'state': 'unreadable', 'reason': code, 'at': stamp()}
                continue
            STATUS[url] = {'ticker': ticker, 'state': 'published', 'reason': None, 'at': stamp()}
            key, payload = build(ticker, url, parsed, stamp(observed))
            old = existing.get(key)
            if old and json.loads(old['payload'])['facts'] == payload['facts']:
                continue
            with db:
                db.execute('''INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at,
                  processing_ms=excluded.processing_ms,version=excluded.version''',
                           (key, ticker, url, parsed['period'], json.dumps(payload, ensure_ascii=False),
                            stamp(observed), stamp(), round((time.monotonic() - started) * 1000), VERSION))
            changed += 1
    return changed


def public_feed(db, cutoff):
    """Stored flashes still inside the window, in the same shape as market_results items."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return []
    items = []
    for row in db.execute('SELECT payload,observed_at,published_at,processing_ms FROM issuer_result_publications '
                          'WHERE julianday(observed_at)>=julianday(?) ORDER BY julianday(observed_at) DESC', (cutoff,)):
        item = json.loads(row['payload'])
        item['publicAt'] = row['published_at']
        item['processingMs'] = row['processing_ms']
        item['sourceToDetectionMs'] = None
        item['detectionToPublicMs'] = monitor.stored_latency_ms(row['observed_at'], row['published_at'])
        items.append(item)
    return items


def diagnostics(db):
    """Read-only summary for /health: what was found, what is waiting, and why nothing was published."""
    stored = 0
    latest = []
    if db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        stored = db.execute('SELECT count(*) FROM issuer_result_publications').fetchone()[0]
        latest = [{'ticker': r['ticker'], 'period': r['period'], 'observedAt': r['observed_at'], 'publicAt': r['published_at'],
                   'detectionToPublicMs': monitor.stored_latency_ms(r['observed_at'], r['published_at'])}
                  for r in db.execute('SELECT ticker,period,observed_at,published_at FROM issuer_result_publications '
                                      'ORDER BY julianday(observed_at) DESC LIMIT 5')]
    return {'status': 'running', 'published': stored, 'latest': latest,
            'waiting': [{k: v[k] for k in ('ticker', 'state', 'reason', 'at')}
                        for v in sorted(STATUS.values(), key=lambda v: v['at'], reverse=True)[:10] if v['state'] != 'published']}
