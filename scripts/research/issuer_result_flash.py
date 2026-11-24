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
import release_freshness
import result_fallback

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
    # The HTML release (SEC 6-K EX-99.1, Nov 12, 2026) prints "571 %" and "(119.6 )": close those gaps as in the PDF.
    t = re.sub(r'\(([\d,.]+) \)', r'(\1)', re.sub(r'(?<=\d) %', '%', t))
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
    # Nov 17, 2026 (Q3 FY27): the tables moved from "$ in millions" to "$ in billions". Read the unit every time; never assume it.
    unit = re.match(r' ?\(\$ in (millions|billions), except earnings per share\)', gaap)
    if not unit:
        raise ValueError('units-unrecognized')
    scale = Decimal(1000) if unit[1] == 'billions' else Decimal(1)
    # Nov 17, 2026 (Q3 FY27): the change columns became "Q/Q* Y/Y*" (footnote: calculated on $ in millions).
    if not re.search(re.escape(f'{cur} {prev} {ago} ') + r'Q/Q\*? Y/Y\*?', gaap):
        raise ValueError('columns-unrecognized')
    amount = r'\$([\d,]+(?:\.\d+)?)'
    change = r'(\(?-?\d+\)?) % (\(?-?\d+\)?) %'  # a fall prints as "(5) %"

    def row(label, block, money=True):
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + amount + ' ' + amount + ' ' + amount + ' ' + change, block)
        if len(found) != 1:
            return None
        a, b, c, qq, yy = found[0]
        qq, yy = (('-' + x.strip('()')) if x.startswith('(') else x for x in (qq, yy))
        values = [Decimal(x.replace(',', '')) for x in (a, b, c)]
        # the stated Q/Q and Y/Y changes must agree with the three values (to the rounding of the printed figures)
        for stated, ref in ((qq, values[1]), (yy, values[2])):
            if ref <= 0 or abs((values[0] / ref - 1) * 100 - Decimal(stated)) > Decimal('1.5'):
                return None
        return values
    revenue = row('Revenue', gaap)
    if not revenue:
        raise ValueError('revenue-row-unrecognized')
    facts = [('revenue', money_millions(revenue[0] * scale), money_millions(revenue[2] * scale))]
    pts = r'(?:\(?[\d.]+\)?|—)'
    margin = re.findall(r'Gross margin ([\d.]+) % ([\d.]+) % ([\d.]+) % ' + pts + r' (?:pts)? ?(\(?[\d.]+\)?) pts', gaap)
    yoy_pts = margin and Decimal(margin[0][3].strip('()')) * (-1 if margin[0][3].startswith('(') else 1)
    if len(margin) == 1 and abs((Decimal(margin[0][0]) - Decimal(margin[0][2])) - yoy_pts) <= Decimal('0.15'):
        facts.append(('gross-margin', margin[0][0] + '%', margin[0][2] + '%'))
    for key, label, block in (('eps', 'Diluted earnings per share', gaap), ('adjusted-eps', 'Diluted earnings per share', non),
                              ('net-income', 'Net income', gaap), ('operating-income', 'Operating income', gaap)):
        values = row(label, block)
        if values:
            money = per_share if key.endswith('eps') else (lambda v: money_millions(v * scale))
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
    return [signed(x) for x in (found[0] if columns > 1 else (found[0],))]  # one group: findall gives the string itself


def parse_statement(text, cfg):
    """Income-statement layout shared by Marvell, Credo and Broadcom: three or five numeric columns (this quarter, previous quarter,
    same quarter a year earlier [, year-to-date columns]). Nothing is published unless the statement agrees with itself and the headline:
    revenue against the stated year-over-year growth in the headline, gross profit = revenue - cost, operating income = gross profit -
    operating expenses, net income = pretax income - tax, EPS = net income / diluted shares."""
    t = clean(text)
    if cfg['identity'] not in t.lower():
        raise ValueError('issuer-identity-missing')
    if cfg.get('period-re'):
        found = re.findall(cfg['period-re'], t[:cfg.get('window', 1500)], re.I)
        if len(found) != 1:
            raise ValueError('period-unrecognized')
        first, second = (found[0], None) if isinstance(found[0], str) else (found[0][0], found[0][1] if len(found[0]) > 1 else None)
        if cfg.get('year-first'):  # "fiscal 2026 fourth quarter": the year is printed before the quarter
            first, second = second, first
        if cfg.get('period-text'):  # a period named by its text (e.g. "quarter ended September 27, 2026"): the lambda gets the raw groups
            quarter, year = first, int(second)
        else:
            quarter, year = (int(first) if first.isdigit() else QUARTERS[first.lower()]), (int(second) if second else None)
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
    if cfg.get('year-re'):  # the quarter's year is read from the statement's own first column heading
        dated = re.findall(cfg['year-re'], block[:600])
        if len(dated) < 1 or year is not None and year != int(dated[0]):
            raise ValueError('period-unrecognized')
        year = int(dated[0])
    if cfg.get('paren-space'):  # "(1,442 )" with a space before the closing bracket, and an en dash for nil
        block = re.sub(r'\(([\d,.]+) \)', r'(\1)', block).replace(' \u2013 ', ' \u2014 ')
    if cfg.get('glue'):  # "$4.92" printed without a space after the dollar sign
        block = re.sub(r'\$(?=\d)', '$ ', block)
    n, ago, scale = cfg['columns'], cfg['year-ago'], cfg['scale']
    # A first fiscal quarter prints no year-to-date columns (PANW FQ1 2027, Nov 18, 2026: "Three Months Ended" only, two columns,
    # while the layout was configured from a later quarter with four). Drop the two year-to-date columns when the heading has none.
    head = block[:600]
    if (n, ago) in ((4, 1), (5, 2)) and re.search(r'(?i)three months ended', head) \
            and not re.search(r'(?i)\b(?:six|nine|twelve) months ended|\byears? ended|year[- ]to[- ]date|fiscal year', head):
        n -= 2
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
        growth = re.findall(cfg['growth'], t[:cfg.get('window', 2500)])
        if len(growth) != 1:
            raise ValueError('revenue-growth-missing')
        stated = Decimal(growth[0])  # the headline's own rounding: whole percent -> +-0.55, one decimal -> +-0.06
        actual = (rows['revenue'][0] / rows['revenue'][ago] - 1) * 100
        if abs(actual - stated) > (Decimal('0.06') if '.' in growth[0] else Decimal('0.55')):
            raise ValueError('change-mismatch')
    else:  # no stated growth: the headline's revenue (in billions, one decimal) must match this quarter's printed revenue
        said = re.findall(cfg['headline'], t[:2500])
        if len(said) != 1 or abs(Decimal(said[0]) * cfg.get('headline-multiplier', 1000) - rows['revenue'][0] * scale) > cfg.get('headline-tol', Decimal('55')):
            raise ValueError('change-mismatch')

    def col(key, i):
        return rows[key][i] if rows.get(key) else None

    def agrees(a, b, c, i):  # a - b == c in column i, to the rounding of the printed figures
        x, y, z = col(a, i), col(b, i), col(c, i)
        return None not in (x, y, z) and abs((x - y) - z) <= cfg['tol']
    # a column is trusted only when every identity holds in both the current and the year-earlier column
    gross_ok = all(agrees('revenue', 'cost', 'gross', i) for i in (0, ago)) if rows.get('cost') else False
    if cfg.get('op-signed'):  # costs are printed as negatives: operating income = revenue + costs
        op_ok = all(None not in (col('revenue', i), col('cost', i), col('operating', i)) and abs(col('revenue', i) + col('cost', i) - col('operating', i)) <= cfg['tol']
                    for i in (0, ago))
    elif cfg.get('op-direct'):  # no gross profit line: operating income = revenue - total operating costs
        op_ok = all(agrees('revenue', 'cost', 'operating', i) for i in (0, ago))
    else:
        op_ok = gross_ok and all(agrees('gross', 'opex', 'operating', i) for i in (0, ago))
    if cfg.get('net-chain') == 'continuing':  # income before tax - tax + equity income = continuing income; + discontinued = net income
        net_ok = all(None not in (col('pretax', i), col('tax', i), col('equity', i), col('cont', i), col('disc', i), col('net', i))
                     and abs(col('pretax', i) - col('tax', i) + col('equity', i) - col('cont', i)) <= cfg['tol']
                     and abs(col('cont', i) + col('disc', i) - col('net', i)) <= cfg['tol'] for i in (0, ago))
    elif cfg.get('net-chain') == 'additive':  # tax and equity-method activity are printed with their sign: pretax + tax + equity = net income
        optional_equity = 'equity' not in cfg['rows']   # Arm has no equity-method line in this chain
        net_ok = all(None not in (col('pretax', i), col('tax', i), col('net', i)) and (optional_equity or col('equity', i) is not None)
                     and abs(col('pretax', i) + col('tax', i) + (0 if optional_equity else col('equity', i)) - col('net', i)) <= cfg['tol'] for i in (0, ago))
    else:
        net_ok = all(agrees('pretax', 'tax', 'net', i) for i in (0, ago)) if rows.get('tax') is not None else False
    if net_ok and cfg['rows'].get('attrib'):  # net income attributable to common = net income - non-controlling interests
        sign = 1 if cfg.get('nci-signed') else -1  # nci-signed: the release prints the deduction as a negative number
        net_ok = all(None not in (col('net', i), col('nci', i), col('attrib', i)) and abs(col('net', i) + sign * col('nci', i) - col('attrib', i)) <= cfg['tol']
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
    'SOFI': {'identity': 'sofi', 'heading': 'Condensed Consolidated Statements of Operations and Comprehensive Income(Unaudited)(In Thousands', 'end': 'Non-GAAP Financial Measures', 'units': 'in thousands',
             'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'net-chain': 'additive', 'headline': r'Record Net Revenue of \$([\d.]+) Billion',
             'period-re': r'SoFi Reports (First|Second|Third|Fourth) Quarter (20\d\d) with', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Total net revenue', 'pretax': 'Income before income taxes', 'tax': 'Income tax expense', 'net': 'Net income',
                      'eps': r'Earnings per share – diluted', 'shares': r'Weighted average common stock outstanding – diluted'}},
    'IONQ': {'identity': 'ionq', 'heading': 'Condensed Consolidated Statements of Operations (unaudited) (in thousands', 'end': 'Condensed Consolidated Balance Sheets', 'units': 'in thousands', 'scale': Decimal('0.001'),
             'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'paren-space': True, 'op-direct': True, 'net-chain': 'additive', 'shares-divisor': Decimal(1000),
             'growth': r'Revenue of \$[\d.]+ Million, Up (\d+)% Year-over-Year',
             'period-re': r'IonQ Announces [A-Za-z ]*?([1-4])Q(\d\d) Revenues', 'period': lambda q, y: f'Q{q} 20{y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Total operating costs and expenses', 'operating': 'Loss from operations', 'pretax': r'Income \(loss\) before income tax benefit \(expense\)',
                      'tax': r'Income tax benefit \(expense\)', 'net': r'Net income \(loss\)', 'nci': r'Net income \(loss\) attributable to noncontrolling interests',
                      'attrib': r'Net income \(loss\) attributable to IonQ, Inc\.',
                      'eps': r'common stockholders Basic (?:\$ ' + AMT + r' ){4}Diluted', 'shares': r'common stockholders Basic ' + (AMT + ' ') * 4 + 'Diluted'}},
    'ALAB': {'identity': 'astera labs', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)(In thousands', 'end': 'CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS', 'units': 'in thousands',
             'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 5, 'year-ago': 2, 'net-chain': 'additive',
             'growth': r'Record quarterly revenue of \$[\d.]+ million, up \d+% QoQ and up (\d+)% year-over-year',
             'period-re': r'Astera Labs Reports (First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses', 'operating': 'Operating income',
                      'pretax': 'Income before income taxes', 'tax': r'Income tax \(provision\) benefit', 'net': 'Net income',
                      'eps': r'Net income per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){4}Diluted', 'shares': r'Weighted-average shares used in calculating net income per share: Basic [\d,]+ (?:[\d,]+ ){4}Diluted'}},
    'LITE': {'identity': 'lumentum', 'heading': 'CONSOLIDATED STATEMENTS OF OPERATIONS(in millions', 'end': 'CONDENSED CONSOLIDATED BALANCE SHEETS', 'units': 'in millions',
             'scale': Decimal(1), 'tol': Decimal('0.15'), 'columns': 2, 'year-ago': 1, 'headline': r'Net revenue of \$([\d.]+) billion',
             'period-re': r'ANNOUNCES (FIRST|SECOND|THIRD|FOURTH) QUARTER OF FISCAL YEAR (20\d\d) FINANCIAL RESULTS', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Net revenue', 'cost': ['Cost of sales', 'Amortization of acquired developed intangibles'], 'gross': 'Gross profit',
                      'opex': 'Total operating expenses', 'operating': 'Income from operations', 'pretax': 'Income before income taxes', 'tax': 'Income tax provision',
                      'net': 'Net income', 'eps': r'Net income per share: Basic \$ [\d.]+ \$ [\d.]+ Diluted',
                      'shares': r'Shares used to compute net income per share - common stock and preferred stock assuming conversion: Basic [\d.]+ [\d.]+ Diluted'}},
    'AAOI': {'identity': 'applied optoelectronics', 'heading': 'Condensed Consolidated Statements of Operations (In thousands', 'end': 'Reconciliation', 'units': 'in thousands', 'scale': Decimal('0.001'),
             'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'paren-space': True, 'net-chain': 'additive', 'headline': r'revenue was \$([\d.]+) million, compared with',
             'headline-multiplier': 1, 'headline-tol': Decimal('0.1'),
             'period-re': r'Applied Optoelectronics Reports (First|Second|Third|Fourth) Quarter (20\d\d) Results', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Total Revenue', 'cost': 'Total Cost of Goods Sold', 'gross': 'Total Gross Profit', 'opex': 'Total Operating Expenses', 'operating': 'Operating Loss',
                      'pretax': r'Net income \(loss\) before Income Taxes', 'tax': 'Income Tax Expense', 'net': r'Net income \(loss\)',
                      'eps': r'common stockholders basic (?:\$ ' + AMT + r' ){4}diluted', 'shares': r'common stockholders basic ' + (AMT + ' ') * 4 + 'diluted'}},
    'BE': {'identity': 'bloom energy', 'heading': 'Condensed Consolidated Statements of Operations* (in thousands', 'end': 'Condensed Consolidated Statement of Cash Flows', 'units': 'in thousands',
           'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 3, 'year-ago': 2,
           'growth': r'revenue of \$[\d,.]+ million, delivering (\d+\.\d)% year-over-year growth',
           'period-re': r'Bloom Energy Reports [A-Za-z ]*?(First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
           'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses', 'operating': 'Income from operations',
                    'pretax': r'Profit \(loss\) before income taxes', 'tax': 'Income tax provision', 'net': r'Net profit \(loss\)',
                    'nci': r'Less: Net \(loss\) income attributable to noncontrolling interest', 'attrib': r'Net income \(loss\) attributable to common stockholders',
                    'eps': r'Net earnings \(loss\) per share available to common stockholders: Basic (?:\$ ' + AMT + ' ){3}Diluted',
                    'shares': r'Weighted average shares used to compute net earnings \(loss\) per share available to common stockholders: Basic ' + (AMT + ' ') * 3 + 'Diluted'}},
    'KLAC': {'identity': 'kla corporation', 'heading': 'Unaudited Statements of Operations Three Months Ended (In thousands', 'end': 'Statements of Cash Flows', 'units': 'in thousands',
             'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 3, 'year-ago': 2, 'year-first': True, 'headline': r'Total revenues were \$([\d.]+) billion',
             'period-re': r'Reports Fiscal (20\d\d) (First|Second|Third|Fourth) Quarter Results', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Total revenues', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                      'eps': r'Net income per share\(1\) Basic \$ [\d.]+ (?:\$ [\d.]+ ){2}Diluted', 'shares': r'Weighted-average number of shares\(1\): Basic [\d,]+ (?:[\d,]+ ){2}Diluted'}},
    'LRCX': {'identity': 'lam research', 'heading': 'CONSOLIDATED STATEMENTS OF OPERATIONS(in thousands', 'end': 'CONDENSED CONSOLIDATED BALANCE SHEETS', 'units': 'in thousands',
             'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 3, 'year-ago': 2, 'net-chain': 'additive', 'headline': r'Revenue of \$([\d.]+) billion',
             'period-re': r'today announced financial results for the quarter ended (March|June|September|December) \d{1,2}, (20\d\d)', 'period-text': True, 'period': lambda m, y: f'{m[:3]} {y} quarter',
             'rows': {'revenue': 'Revenue', 'cost': 'Cost of goods sold', 'gross': 'Gross margin', 'opex': 'Total operating expenses', 'operating': 'Operating income',
                      'pretax': 'Income before income taxes', 'tax': 'Income tax expense', 'net': 'Net income',
                      'eps': r'Net income per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){2}Diluted', 'shares': r'Number of shares used in per share calculations: Basic [\d,]+ (?:[\d,]+ ){2}Diluted'}},
    'STX': {'identity': 'seagate', 'heading': 'CONSOLIDATED STATEMENTS OF OPERATIONS(In millions', 'end': 'STATEMENTS OF CASH FLOWS', 'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1),
            'columns': 2, 'year-ago': 1, 'op-direct': True, 'headline': r'Highlights▪Revenue of \$([\d.]+) billion',
            'period-re': r'REPORTS FISCAL (FIRST|SECOND|THIRD|FOURTH) QUARTER (20\d\d) FINANCIAL RESULTS', 'period': lambda q, y: f'Q{q} FY{y}',
            'rows': {'revenue': 'Revenue', 'cost': 'Total operating expenses', 'operating': 'Income from operations', 'pretax': 'Income before income taxes',
                     'tax': 'Provision for income taxes', 'net': 'Net income',
                     'eps': r'Net income per share: Basic \$ [\d.]+ \$ [\d.]+ Diluted', 'shares': r'Number of shares used in per share calculations: Basic [\d,]+ [\d,]+ Diluted'}},
    'APH': {'identity': 'amphenol', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF INCOME (Unaudited) (dollars and shares in millions', 'units': 'dollars and shares in millions', 'scale': Decimal(1),
            'tol': Decimal('0.15'), 'columns': 4, 'year-ago': 1, 'net-chain': 'additive', 'nci-signed': True,
            'growth': r'Sales of \$[\d.]+ billion, up (\d+)% in U\.S\. dollars',
            'period-re': r'AMPHENOL REPORTS [A-Z ]*?(FIRST|SECOND|THIRD|FOURTH) QUARTER (20\d\d) RESULTS', 'period': lambda q, y: f'Q{q} {y}',
            'rows': {'revenue': 'Net sales', 'cost': r'Cost of sales(?: \(\d\))?', 'gross': 'Gross profit', 'opex': ['Acquisition-related expenses', 'Selling, general and administrative expenses'],
                     'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': r'Provision for income taxes(?: \(\d\))?', 'net': 'Net income',
                     'nci': 'Less: Net income attributable to noncontrolling interests', 'attrib': r'Net income attributable to Amphenol Corporation',
                     'eps': r'Net income attributable to Amphenol Corporation per common share — Diluted(?: \(\d\))?', 'shares': r'Weighted average common shares outstanding — Diluted'}},
    'META': {'identity': 'meta platforms', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF INCOME (In millions', 'end': 'CONDENSED CONSOLIDATED BALANCE SHEETS', 'units': 'in millions',
             'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'op-direct': True, 'window': 6000,
             'growth': r'Revenue was \$[\d.]+ billion, an increase of (\d+)% year-over-year',
             'period-re': r'Meta Reports (First|Second|Third|Fourth) Quarter (20\d\d) Results', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Total costs and expenses', 'operating': 'Income from operations', 'pretax': 'Income before income taxes',
                      'tax': 'Provision for income taxes', 'net': 'Net income', 'eps': r'Earnings per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){3}Diluted',
                      'shares': r'Weighted-average shares used to compute earnings per share: Basic [\d,]+ (?:[\d,]+ ){3}Diluted'}},
    'NFLX': {'identity': 'netflix', 'heading': 'Consolidated Statements of Operations (unaudited) (in thousands', 'end': 'Consolidated Balance Sheets', 'units': 'in thousands',
             'scale': Decimal('0.001'), 'tol': Decimal(1), 'columns': 5, 'year-ago': 2, 'op-direct': True, 'net-chain': 'additive',
             'growth': r'Q[1-4] revenue grew (\d+)% year over year',
             'period-re': r'We delivered our Q([1-4]) forecast', 'year-re': r'Three Months Ended Nine Months Ended [A-Z][a-z]+ \d{1,2}, (20\d\d)', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Revenues', 'cost': ['Cost of revenues', 'Sales and marketing', 'Technology and development', 'General and administrative'],
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                      'eps': r'Earnings per share\*: Basic \$ [\d.]+ (?:\$ [\d.]+ ){4}Diluted', 'shares': r'Weighted-average shares of common stock outstanding\*: Basic [\d,]+ (?:[\d,]+ ){4}Diluted'}},
    'NOW': {'identity': 'servicenow', 'heading': 'Condensed Consolidated Statements of Operations(in millions', 'end': '(1)Includes stock-based', 'units': 'in millions', 'scale': Decimal(1),
            'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'growth': r'Total revenues of \$[\d,]+ million in Q[1-4] \d{4}, representing (\d+(?:\.\d)?)% year-over-year growth',
            'period-re': r'ServiceNow Reports (First|Second|Third|Fourth) Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
            'rows': {'revenue': 'Total revenues', 'cost': 'Total cost of revenues', 'gross': 'Gross profit', 'opex': 'Total operating expenses', 'operating': 'Income from operations',
                     'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                     'eps': r'Net income per share - diluted \(\d\)', 'shares': r'Weighted-average shares used to compute net income per share - diluted \(\d\)'}},
    'INTC': {'identity': 'intel corporation', 'heading': 'Consolidated Condensed Statements of Operations and Other Information Three Months Ended (In Millions', 'end': 'Other information', 'units': 'in millions',
             'scale': Decimal(1), 'tol': Decimal(1), 'columns': 2, 'year-ago': 1, 'growth': r'(?:First|Second|Third|Fourth)-quarter revenue was \$[\d.]+ billion, up (\d+)% year-over-year',
             'period-re': r'Intel Reports (First|Second|Third|Fourth)-Quarter (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} {y}',
             'rows': {'revenue': 'Net revenue', 'cost': 'Cost of sales', 'gross': 'Gross profit', 'opex': 'Operating expenses', 'operating': r'Operating income \(loss\)',
                      'pretax': r'Income \(loss\) before taxes', 'tax': r'Provision for \(benefit from\) taxes', 'net': r'Net income \(loss\)',
                      'nci': r'Less: net income \(loss\) attributable to non-controlling interests', 'attrib': r'Net income \(loss\) attributable to Intel',
                      'eps': r'Earnings \(loss\) per share attributable to Intel—diluted1', 'shares': r'Weighted average shares of common stock outstanding: Basic [\d,]+ [\d,]+ Diluted'}},
    'AAPL': {'identity': 'apple', 'heading': 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS (Unaudited)(In millions', 'end': '(1) Net sales by reportable segment', 'units': 'in millions',
             'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'shares-divisor': Decimal(1000), 'year-first': True,
             'growth': r'quarterly revenue of \$[\d.]+ billion, up (\d+) percent year over year',
             'period-re': r'fiscal (20\d\d) (first|second|third|fourth) quarter ended', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': r'Total net sales(?: \(1\))?', 'cost': 'Total cost of sales', 'gross': 'Gross margin', 'opex': 'Total operating expenses', 'operating': 'Operating income',
                      'pretax': 'Income before provision for income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                      'eps': r'Earnings per share: Basic \$ [\d.]+ (?:\$ [\d.]+ ){3}Diluted', 'shares': r'Shares used in computing earnings per share: Basic [\d,]+ (?:[\d,]+ ){3}Diluted'}},
    'CRWD': {'identity': 'crowdstrike', 'heading': 'Condensed Consolidated Statements of Operations(in thousands', 'end': '_____', 'units': 'in thousands', 'scale': Decimal('0.001'),
             # 'window': Q3 FY27 (Nov 23, 2026) opened with a long Zscaler acquisition paragraph, pushing the revenue sentence past 2,500 characters
             'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'window': 6000, 'growth': r'Total revenue was \$[\d.]+ billion, a (\d+)% increase',
             'period-re': r'Reports (First|Second|Third|Fourth) Quarter Fiscal Year (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Loss from operations', 'pretax': r'Income \(loss\) before provision for income taxes', 'tax': r'Provision (?:\(benefit\) )?for income taxes',  # Q3 FY27 dropped "(benefit)"
                      'net': r'Net income \(loss\)', 'nci': r'Net income \(loss\) attributable to non-controlling interest', 'attrib': r'Net income \(loss\) attributable to CrowdStrike',
                      'eps': r'common stockholders: Basic (?:\$ ' + AMT + r' ){4}Diluted', 'shares': r'common stockholders: Basic ' + (AMT + ' ') * 4 + 'Diluted'}},
    'SNOW': {'identity': 'snowflake', 'heading': 'Condensed Consolidated Statements of Operations(in thousands', 'units': 'in thousands', 'scale': Decimal('0.001'),
             'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'growth': r'Revenue of \$[\d.]+ billion in the (?:first|second|third|fourth) quarter, representing (\d+)% year-over-year growth',
             'period-re': r'Financial Results for the (First|Second|Third|Fourth) Quarter of Fiscal (20\d\d)', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Revenue', 'cost': 'Cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses', 'operating': 'Operating loss',
                      'pretax': 'Loss before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net loss',
                      'nci': 'Less: net income attributable to noncontrolling interest', 'attrib': r'Net loss attributable to Snowflake Inc\.',
                      'eps': r'Net loss per share attributable to Snowflake Inc\. common stockholders—basic and diluted',
                      'shares': r'Weighted-average shares used in computing net loss per share attributable to Snowflake Inc\. common stockholders—basic and diluted'}},
    'CRM': {'identity': 'salesforce', 'heading': 'Condensed Consolidated Statements of Operations(in millions', 'end': 'Amounts include amortization', 'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1),
            'columns': 4, 'year-ago': 1, 'net-chain': 'additive', 'growth': r'Revenue of \$[\d.]+ billion, up (\d+)% Y/Y',
            'period-re': r'Salesforce [A-Za-z ]*?(First|Second|Third|Fourth) Quarter Fiscal (20\d\d) Results', 'period': lambda q, y: f'Q{q} FY{y}',
            'rows': {'revenue': 'Total revenues', 'cost': 'Total cost of revenues', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                     'operating': 'Income from operations', 'pretax': 'Income before provision for income taxes', 'tax': 'Provision for income taxes',
                     'net': 'Net income', 'eps': r'Diluted net income per share(?: \(\d\))?', 'shares': 'Shares used in computing diluted net income per share'}},
    'ADBE': {'identity': 'adobe', 'heading': 'Condensed Consolidated Statements of Income (In millions', 'end': 'Condensed Consolidated Balance Sheets', 'units': 'in millions',
             'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1,
             'growth': r'record revenue of \$[\d.]+ billion in its (?:first|second|third|fourth) quarter of FY\d{4}, which represents (\d+)% year-over-year growth',
             'period-re': r'reported financial results for its (first|second|third|fourth) quarter FY(20\d\d)', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
                      'operating': 'Operating income', 'pretax': 'Income before income taxes', 'tax': 'Provision for income taxes', 'net': 'Net income',
                      'eps': 'Diluted net income per share', 'shares': 'Shares used to compute diluted net income per share'}},
    'PANW': {'identity': 'palo alto networks', 'heading': 'Preliminary Condensed Consolidated Statements of Operations (In millions', 'end': 'Reconciliation of GAAP',
             'units': 'in millions', 'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'window': 6000,
             'growth': r'Total revenue for the fiscal (?:first|second|third|fourth) quarter \d{4} grew (\d+)% year over year to \$[\d.]+ billion',
             'period-re': r'Reports Fiscal (First|Second|Third|Fourth) Quarter(?: and Fiscal Year)? (20\d\d) Financial Results', 'period': lambda q, y: f'Q{q} FY{y}',
             'rows': {'revenue': 'Total revenue', 'cost': 'Total cost of revenue', 'gross': 'Total gross profit', 'opex': 'Total operating expenses',
                      # FQ1 2027 dropped "(loss)" and printed "Provision for (benefit from) income taxes": both forms are read.
                      'operating': 'Operating income', 'pretax': r'Income (?:\(loss\) )?before income taxes', 'tax': r'Provision for (?:\(benefit from\) )?income taxes',
                      'net': r'Net income(?: \(loss\))?', 'eps': r'Net income(?: \(loss\))? per share, diluted',
                      'shares': r'Weighted-average shares used to compute net income(?: \(loss\))? per share, diluted'}},
    'ARM': {'identity': 'arm holdings', 'heading': 'Condensed Consolidated Income Statements(in millions', 'end': 'Condensed Consolidated Balance Sheets', 'units': 'in millions',
            'scale': Decimal(1), 'tol': Decimal(1), 'columns': 4, 'year-ago': 1, 'op-signed': True, 'net-chain': 'additive', 'window': 30000,
            'growth': r'Total revenue increased (\d+)% year-over-year to \$[\d,]+ million',
            'period-re': r'Q([1-4]) FYE(\d\d) Financial Overview', 'period': lambda q, y: f'Q{q} FYE{y:02d}',
            'rows': {'revenue': 'Total revenue', 'cost': ['Cost of sales', 'Total operating expenses'], 'operating': r'Operating income \(loss\)',
                     'pretax': r'Income \(loss\) before income taxes', 'tax': r'Income tax benefit \(expense\)', 'net': r'Net income \(loss\)',
                     'eps': r'Net income \(loss\) per share attributable to ordinary shareholders Basic (?:\$ [\d.]+ ){4}Diluted',
                     'shares': r'Weighted average ordinary shares outstanding Basic ' + AMT + ' ' + AMT + ' ' + AMT + ' ' + AMT + ' Diluted'}},
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


SKHYNIX_ROWS = (('revenue', 'Revenue'), ('operating-income', 'Operating Profit'),
                ('pretax', 'Profit from Continuing Operations Before Income Tax'), ('net-income', r'Profit \(Loss\) for the Period'))


def parse_skhynix(text, url=None):
    """SK hynix's 'Preliminary Results of Operations' (SEC Form 6-K, the same table it files with the Korean regulator), in millions of won:
    this quarter, the year to date, the previous quarter and the same quarter a year earlier, with the stated quarter-on-quarter and
    year-on-year changes. A row is published only when both stated changes agree with the values; the periods must be the quarter, the
    one before it and the same quarter a year earlier. Figures are preliminary and unaudited (the label says so). No EPS in the table."""
    t = clean(text)
    if 'sk hynix' not in t.lower():
        raise ValueError('issuer-identity-missing')
    start = t.find('Preliminary Results of Operations')
    if start < 0:
        raise ValueError('table-heading-missing')
    block = t[start:start + 3600]
    if 'in millions of Won' not in block[:600]:
        raise ValueError('units-unrecognized')
    periods = re.search(r'Current Period \((First|Second|Third|Fourth) quarter\(\d\) of (20\d\d)\) Previous Period \((First|Second|Third|Fourth) quarter\(\d\) of (20\d\d)\)'
                        r'.{0,60}?Year-to-Year Comparison \((First|Second|Third|Fourth) quarter\(\d\) of (20\d\d)\)', block[:900])
    if not periods:
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[periods[1].lower()], int(periods[2])
    before = (quarter - 1, year) if quarter > 1 else (4, year - 1)
    if (QUARTERS[periods[3].lower()], int(periods[4])) != before or (QUARTERS[periods[5].lower()], int(periods[6])) != (quarter, year - 1):
        raise ValueError('columns-unrecognized')
    # each metric is its own run of the block, from its label to the next metric's label
    starts = []
    for key, label in SKHYNIX_ROWS + (('controlling', 'Attributable To: Controlling Interests'),):
        found = list(re.finditer(label + r' Quarterly Results', block))
        if len(found) != 1:
            starts.append((key, None))
        else:
            starts.append((key, found[0].start()))
    ends = [position for _, position in starts if position is not None] + [len(block)]
    rows = {}
    for key, position in starts:
        if position is None:
            continue
        run = block[position:min([end for end in ends if end > position] or [len(block)])]
        amounts = re.findall(r'(?<![\d,.])(\(?)(\d{1,3}(?:,\d{3})+)', run)
        changes = re.findall(r'(?<![\d,])(\(?)(\d+\.\d)(?![\d,])', run)
        if len(amounts) != 5 or len(changes) != 3:  # this quarter, YTD, previous quarter, year-ago quarter, year-ago YTD / q-o-q, y-o-y, y-o-y YTD
            continue
        value = [Decimal(n.replace(',', '')) * (-1 if bracket else 1) for bracket, n in amounts]
        qoq, yoy = [Decimal(n) * (-1 if bracket else 1) for bracket, n in changes[:2]]
        current, previous, ago = value[0], value[2], value[3]
        if previous <= 0 or ago <= 0:
            continue
        if abs((current / previous - 1) * 100 - qoq) > Decimal('0.06') or abs((current / ago - 1) * 100 - yoy) > Decimal('0.06'):
            continue
        rows[key] = (current, ago)
    if 'revenue' not in rows:
        raise ValueError('revenue-row-unrecognized')

    def won(value):  # millions of won -> trillions, the printed figure exactly (104,615,483 -> 104.615483)
        return prefixed('\u20a9', value / 1000000, 'T')
    names = {'revenue': ('売上高（暫定・兆ウォン）', 'Revenue (preliminary, KRW trillion)'),
             'operating-income': ('営業利益（暫定・兆ウォン）', 'Operating profit (preliminary, KRW trillion)'),
             'net-income': ('当期利益（暫定・兆ウォン）', 'Profit for the period (preliminary, KRW trillion)')}
    facts = [(key, won(rows[key][0]), won(rows[key][1]), names[key]) for key in ('revenue', 'operating-income', 'net-income') if key in rows]
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    out = {'period': f'Q{quarter} {year}', 'facts': facts}
    # The 6-K is often filed weeks after the results were given out ("October 28, 2026 / 9:00 a.m. (Seoul time)", filed Nov 13).
    # The calendar shows the day the results were given out, not the filing day (owner, Nov 18).
    given = re.search(r'Date / Time of Provision (January|February|March|April|May|June|July|August|September|October|November|December) '
                      r'(\d{1,2}), (20\d\d) / (\d{1,2}):(\d\d) (a\.m\.|p\.m\.) \(Seoul time\)', t)
    if given:
        hour = int(given[4]) % 12 + (12 if given[6] == 'p.m.' else 0)
        month = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november',
                 'december'].index(given[1].lower()) + 1
        out['givenAt'] = datetime(int(given[3]), month, int(given[2]), hour, int(given[5]),
                                  tzinfo=timezone(timedelta(hours=9))).astimezone(timezone.utc)
    return out


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


QCOM_AMOUNT = r'(\(?\$[\d,]+(?:\.\d+)?\)?)'
QCOM_CHANGE = r'(\(\d+%\)|[+-]?\d+%|N/M)'


def qcom_amount(text):
    """'$10,322' -> 10322; '($3,117)' -> -3117 (the release prints a negative in brackets around the dollar sign)."""
    return signed(text.replace('$', ''))


def qcom_change_ok(current, prior, change):
    """Qualcomm's change column is (current - prior) / |prior|, rounded to a whole percent ("(8%)", "+140%")."""
    if change == 'N/M' or prior == 0:
        return change == 'N/M'
    stated = Decimal(change.strip('()+%')) * (-1 if change.startswith('(') or change.startswith('-') else 1)
    actual = (current - prior) / abs(prior) * 100
    return abs(actual - stated) <= Decimal('0.6')


def parse_qualcomm(text, url=None):
    """Qualcomm's "<Quarter> Quarter Results" table (SEC 8-K EX-99.1), in millions except per-share data: for GAAP and then non-GAAP,
    this quarter, the same quarter a year earlier and the stated change. A row is read only when it has exactly those six cells and both
    stated changes agree with the values; the column headings must name the quarter and the same quarter one fiscal year earlier.
    GAAP revenue, net income and diluted EPS are published; the non-GAAP EPS as adjusted EPS (non-GAAP revenue is not shown)."""
    t = clean(text)
    if 'qualcomm' not in t.lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'(First|Second|Third|Fourth) Quarter Results(?:\d(?:,\d)*)? GAAP Non-GAAP \(in millions, except per share data and percentages\) '
                     r'Q([1-4]) Fiscal (20\d\d) Q([1-4]) Fiscal (20\d\d) Change Q([1-4]) Fiscal (20\d\d) Q([1-4]) Fiscal (20\d\d) Change ', t)
    if not head:
        raise ValueError('table-heading-missing')
    quarter, year = QUARTERS[head[1].lower()], int(head[3])
    if (int(head[2]), int(head[4]), int(head[6]), int(head[8])) != (quarter,) * 4 or int(head[5]) != year - 1 \
            or (int(head[7]), int(head[9])) != (year, year - 1):
        raise ValueError('columns-unrecognized')
    block = t[head.end():head.end() + 900]
    # the table ends at its first footnote, the segment table or the fiscal year's table (each repeats "Revenues")
    stop = re.search(r' \(\d\) |Segment Results|Fiscal ' + str(year) + ' Results', block)
    block = block[:stop.start()] if stop else block
    cells = ' '.join([QCOM_AMOUNT, QCOM_AMOUNT, QCOM_CHANGE] * 2)
    labels = {'revenue': r'Revenues', 'net-income': r'Net income(?: \(loss\))?',
              'eps': r'Diluted earnings(?: \(loss\))? per share \(EPS\)'}
    rows = {}
    for key, label in labels.items():
        found = re.findall(r'(?<![A-Za-z])' + label + ' ' + cells + r'(?= |$)', block)
        if len(found) != 1:
            continue  # missing or repeated: ambiguous
        cur, ago, change, ncur, nago, nchange = found[0]
        values = [qcom_amount(cur), qcom_amount(ago), qcom_amount(ncur), qcom_amount(nago)]
        if not (qcom_change_ok(values[0], values[1], change) and qcom_change_ok(values[2], values[3], nchange)):
            continue
        rows[key] = values
    if 'revenue' not in rows or rows['revenue'][0] <= 0:
        raise ValueError('revenue-row-unrecognized')
    facts = [('revenue', money_millions(rows['revenue'][0]), money_millions(rows['revenue'][1]))]
    if 'eps' in rows:
        facts.append(('eps', per_share(rows['eps'][0]), per_share(rows['eps'][1])))
        facts.append(('adjusted-eps', per_share(rows['eps'][2]), per_share(rows['eps'][3])))
    if 'net-income' in rows:
        facts.append(('net-income', money_millions(rows['net-income'][0]), money_millions(rows['net-income'][1])))
    operating = qualcomm_operating_income(t, rows)
    if operating:
        facts.append(('operating-income', money_millions(operating[0]), money_millions(operating[1])))
    order = {k: i for i, k in enumerate(ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} FY{year}', 'facts': facts}


def qualcomm_operating_income(t, rows):
    """Operating income from Qualcomm's consolidated statement of operations (this quarter, the same quarter a year earlier), read only
    when the statement's total revenues (and net income, where read) are the summary table's own and total revenues - total costs and
    expenses = operating income in both columns. None otherwise."""
    start = t.find('CONSOLIDATED STATEMENTS OF OPERATIONS (In millions, except per share data)')
    if start < 0:
        return None
    block = t[start:start + 2500]
    stop = block.find('CONSOLIDATED STATEMENTS OF CASH FLOWS')
    block = block[:stop] if stop > 0 else block
    n = 4 if re.search(r'Three Months Ended (?:Six|Nine|Twelve) Months Ended', block[:300]) else 2
    revenue = statement_row(block, 'Total revenues', n)
    costs = statement_row(block, 'Total costs and expenses', n)
    operating = statement_row(block, r'Operating income(?: \(loss\))?', n)
    net = statement_row(block, r'Net income(?: \(loss\))?', n)
    if None in (revenue, costs, operating) or revenue[:2] != rows['revenue'][:2]:
        return None
    if 'net-income' in rows and (net is None or net[:2] != rows['net-income'][:2]):
        return None
    if any(abs(revenue[i] - costs[i] - operating[i]) > 1 for i in (0, 1)):
        return None
    return operating[0], operating[1]


CEG_ROWS = {'revenue': 'Operating revenues', 'opex': 'Total operating expenses', 'gain': r'Gain \(loss\) on sales of assets(?: and businesses)?',
            'operating': r'Operating income \(loss\)', 'pretax': r'Income \(loss\) before income taxes',
            'tax': r'Income tax \(benefit\) expense', 'equity': r'Equity in income \(losses\) of unconsolidated affiliates',
            'net': r'Net income \(loss\)', 'nci': r'Net income \(loss\) attributable to noncontrolling interests',
            'attrib': r'Net income \(loss\) attributable to common shareholders'}
CEG_OPTIONAL = ('gain', 'equity')  # a line the statement leaves out in a year without such items (2025: no gain on sales)
CEG_PER_SHARE = r'\$ (\(?\d+\.\d\d\)?)'


def constellation_quarter(block, n):
    """This quarter's column of one of Constellation's statements of operations (in millions), checked against itself:
    revenues - operating expenses + gains on sales = operating income; pretax income - tax + equity income = net income;
    net income - non-controlling interests = net income attributable to common shareholders. None when any identity fails."""
    rows = {}
    for key, label in CEG_ROWS.items():
        row = statement_row(block, label, n)
        if row is None and key in CEG_OPTIONAL and n > 1:
            # a small line printed for one column only ("Equity in income (losses) of unconsolidated affiliates (1)", Q4 2025):
            # taken as this quarter's only because the identities below must then hold with it
            row = statement_row(block, label, 1)
        if row is None and key not in CEG_OPTIONAL:
            return None
        rows[key] = row[0] if row else Decimal(0)
    if rows['revenue'] <= 0 or abs(rows['revenue'] - rows['opex'] + rows['gain'] - rows['operating']) > 1 \
            or abs(rows['pretax'] - rows['tax'] + rows['equity'] - rows['net']) > 1 or abs(rows['net'] - rows['nci'] - rows['attrib']) > 1:
        return None
    return rows


def parse_constellation(text, url=None):
    """Constellation Energy's results release (8-K EX-99.1, filed under its co-registrant's CIK): the consolidated statements of
    operations print this year's quarter and the same quarter a year earlier as two separate blocks (each with its year-to-date column).
    Revenue, operating income and net income attributable to common shareholders are read from both blocks, each checked against
    itself; GAAP diluted EPS and Adjusted (non-GAAP) Operating Earnings per share from the release's quarterly reconciliation, which must
    repeat the statement's net income, agree with the diluted share count and with the per-share figures the highlights state."""
    t = clean(text)
    if 'constellation' not in t[:3000].lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'(?i)CONSTELLATION REPORTS (FIRST|SECOND|THIRD|FOURTH) QUARTER (?:AND FULL[- ]YEAR )?(20\d\d) RESULTS', t[:1500])
    if not head:
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[head[1].lower()], int(head[2])
    heading = re.search(r'Consolidated Statements of Operations ?\(unaudited\) ?\(in millions\) Three Months Ended (' + MONTH
                        + r' \d{1,2}), ' + str(year) + r'( (?:Six|Nine|Twelve) Months Ended ' + MONTH + r' \d{1,2}, ' + str(year) + ')?', t)
    if not heading:
        raise ValueError('statement-heading-missing')
    n = 2 if heading[2] else 1
    earlier = re.compile(r'Three Months Ended ' + re.escape(heading[1]) + ', ' + str(year - 1)
                         + (r' (?:Six|Nine|Twelve) Months Ended ' + MONTH + r' \d{1,2}, ' + str(year - 1) if n == 2 else '') + ' ')
    ago_head = earlier.search(t, heading.end(), heading.end() + 2500)
    if not ago_head:
        raise ValueError('columns-unrecognized')
    current = constellation_quarter(t[heading.end():ago_head.start()], n)
    end = t.find('Change in Net income', ago_head.end(), ago_head.end() + 2500)
    prior = constellation_quarter(t[ago_head.end():end if end > 0 else ago_head.end() + 2000], n)
    if current is None or prior is None:
        raise ValueError('revenue-row-unrecognized')
    facts = [('revenue', money_millions(current['revenue']), money_millions(prior['revenue']))]
    eps = adjusted = None
    # the quarter's reconciliation is the one whose net income is the statement's (a fourth-quarter release also has the year's)
    gaap = next((m for m in re.finditer(r'GAAP Net Income \(Loss\) Attributable to Common Shareholders \$ (\(?[\d,]+\)?) ' + CEG_PER_SHARE
                                        + r' \$ (\(?[\d,]+\)?) ' + CEG_PER_SHARE, t)
                 if (signed(m[1]), signed(m[3])) == (current['attrib'], prior['attrib'])), None)
    adj = re.compile(r'Adjusted \(non-GAAP\) Operating Earnings \$ (\(?[\d,]+\)?) ' + CEG_PER_SHARE + r' \$ (\(?[\d,]+\)?) '
                     + CEG_PER_SHARE).search(t, gaap.end()) if gaap else None
    diluted = next((m for m in re.finditer(r'Earnings per average common share Basic \$ \(?\d+\.\d\d\)? \$ \(?\d+\.\d\d\)? Diluted '
                                           + CEG_PER_SHARE + ' ' + CEG_PER_SHARE + r' Average common shares outstanding Basic \d[\d,]* '
                                           r'\d[\d,]* Diluted (\d[\d,]*) (\d[\d,]*)', t)
                    if gaap and (m[1], m[2]) == (gaap[2], gaap[4])), None)
    if gaap and diluted:
        values = [signed(gaap[2]), signed(gaap[4])]
        shares = [signed(diluted[3]), signed(diluted[4])]
        said = re.search(r'GAAP Net Income of \$(\d+\.\d\d) per share', t[:1500])
        if values == [signed(diluted[1]), signed(diluted[2])] and all(s > 0 for s in shares) \
                and all(abs(net / s - v) <= Decimal('0.015') + abs(v) * Decimal('0.02')
                        for net, s, v in zip((current['attrib'], prior['attrib']), shares, values)) \
                and (said is None or Decimal(said[1]) == values[0]):
            eps = values
            if adj:
                totals, per = [signed(adj[1]), signed(adj[3])], [signed(adj[2]), signed(adj[4])]
                said = re.search(r'Adjusted \(non-GAAP\) Operating Earnings of \$(\d+\.\d\d) per share', t[:1500])
                if said and Decimal(said[1]) == per[0] and all(abs(x / s - v) <= Decimal('0.015') + abs(v) * Decimal('0.02')
                                                               for x, s, v in zip(totals, shares, per)):
                    adjusted = per
    if eps:
        facts.append(('eps', per_share(eps[0]), per_share(eps[1])))
    if adjusted:
        facts.append(('adjusted-eps', per_share(adjusted[0]), per_share(adjusted[1])))
    facts.append(('net-income', money_millions(current['attrib']), money_millions(prior['attrib'])))
    facts.append(('operating-income', money_millions(current['operating']), money_millions(prior['operating'])))
    return {'period': f'Q{quarter} {year}', 'facts': facts}


# ---- IBM, IREN, Vistra, Tesla (owner, Nov 19: the full set the release states, not only the figures of its highlight sentences) ----

ROW_VALUE = re.compile(r'\(-?[\d,]*\d(?:\.\d+)?\)|-?[\d,]*\d(?:\.\d+)?|[—–-]')
ROW_SKIP = {'$', '%', 'pts', 'Pts'}
FOOTNOTE = re.compile(r'\(\d\)')
MONTHS = {m: i + 1 for i, m in enumerate(('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
                                          'October', 'November', 'December'))}


def statement_rows(block):
    """[(label, [cells])] of a statement flattened to one line: each row is its label's words followed by its numbers. A dollar sign,
    a percent sign or "pts" is no cell; a dash is a cell (nil). "(2,370 )" is closed up first."""
    block = re.sub(r'\(([\d,.]+) \)', r'(\1)', block)
    rows, label, cells = [], [], []
    for token in block.split(' '):
        if token in ROW_SKIP or not token:
            continue
        if label and ROW_VALUE.fullmatch(token):
            cells.append(token)
            continue
        if cells:
            rows.append((' '.join(label), cells))
            label, cells = [], []
        label.append(token)
    if cells:
        rows.append((' '.join(label), cells))
    return rows


def cell(text):
    return Decimal(0) if text in ('-', '–') else signed(text)


def labelled(label, pattern):
    """The row label ends with the pattern, at a word start."""
    return re.search(r'(?:^|(?<= ))(?:' + pattern + r')$', label) is not None


def row_values(rows, pattern, n):
    """The `n` values of the one row whose label ends with `pattern` (footnote marks such as "(1)" before the values dropped).
    None when no row or more than one row matches, or the row has another number of values."""
    found = []
    for label, cells in rows:
        if labelled(label, pattern):
            extra = len(cells) - n
            if extra > 0 and all(FOOTNOTE.fullmatch(c) for c in cells[:extra]):
                cells = cells[extra:]
            found.append(cells)
    if len(found) != 1 or len(found[0]) != n:
        return None
    try:
        return [cell(c) for c in found[0]]
    except ValueError:
        return None


def row_after(rows, pattern, label, n):
    """The values of the row right after the one row whose label ends with `pattern`, when that next row is labelled `label`
    ("... per share ... Basic $ 0.43 ... Diluted $ 0.39": the diluted row has no label of its own)."""
    at = [i for i, (name, _cells) in enumerate(rows) if labelled(name, pattern)]
    if len(at) != 1 or at[0] + 1 >= len(rows) or rows[at[0] + 1][0] != label:
        return None
    return row_values([rows[at[0] + 1]], re.escape(label), n)


def near(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol


def per_share_ok(income, shares, eps):
    """Per-share figure against income / diluted shares, to the rounding of the printed figures (the rule of parse_statement)."""
    return shares > 0 and abs(income / shares - eps) <= Decimal('0.015') + abs(eps) * Decimal('0.02')


def ordered(facts):
    order = {k: i for i, k in enumerate(ORDER)}
    return sorted(facts, key=lambda f: order[f[0]])


IBM_ROWS = {'revenue': 'TOTAL REVENUE', 'gross': 'GROSS PROFIT', 'expense': 'TOTAL EXPENSE AND OTHER INCOME',
            'pretax': r'INCOME(?:/\(LOSS\))? FROM CONTINUING OPERATIONS BEFORE INCOME TAXES',
            'tax': r'(?i:Provision for/\(benefit from\) income taxes)', 'cont': r'INCOME(?:/\(LOSS\))? FROM CONTINUING OPERATIONS',
            'disc': r'(?i:Income(?:/ ?\(loss\))? from discontinued operations, net of taxes)', 'net': r'NET INCOME(?:/\(LOSS\))?',
            'eps': r'(?i:Assuming dilution Continuing operations)', 'shares': r'(?i:COMMON SHARES OUTSTANDING \(M’s\) Assuming dilution)'}


def ibm_operating_eps(t, start, month_day, year, income, eps, shares):
    """Operating (non-GAAP) diluted EPS of one quarter from IBM's "U.S. GAAP to Operating (Non-GAAP) Results Reconciliation": its GAAP
    column must be the statement's income and EPS from continuing operations, the adjustments must add up to the operating figure, and
    operating income / diluted shares must give the operating EPS. None otherwise."""
    heads = [m for m in re.finditer(r'Three Months Ended ' + re.escape(month_day) + ', ' + str(year) + ' Continuing Operations GAAP ', t)
             if m.start() > start]
    if len(heads) != 1:
        return None
    stop = re.search(r'(?:Three|Six|Nine|Twelve) Months Ended|Year Ended|\(1\) ?Includes', t[heads[0].end():])
    rows = statement_rows(t[heads[0].end():heads[0].end() + (stop.start() if stop else 2500)])
    found = {}
    for key, pattern in (('income', r'(?<![Pp]re-tax )(?i:Income from continuing operations)'),
                         ('eps', r'(?i:Diluted earnings per share: continuing operations)')):
        values = [cells for label, cells in rows if labelled(label, pattern)]
        if len(values) != 1 or not 3 <= len(values[0]) <= 7:
            return None
        try:
            found[key] = [cell(c) for c in values[0]]
        except ValueError:
            return None
    operating = found['eps'][-1]
    if found['income'][0] != income or found['eps'][0] != eps or not per_share_ok(found['income'][-1], shares, operating) \
            or abs(sum(found['eps'][:-1]) - operating) > Decimal('0.021') or abs(sum(found['income'][:-1]) - found['income'][-1]) > 2:
        return None
    return operating


def parse_ibm(text, url=None):
    """IBM's results release (8-K EX-99.1): the "Comparative Financial Results" statement (this quarter, the same quarter a year earlier
    [, the year to date]) and the GAAP-to-operating reconciliation. IBM prints no operating income line (its statement goes from gross
    profit to pre-tax income). Every column read must hold gross profit - expense and other income = pre-tax income, pre-tax income - tax
    = income from continuing operations, + discontinued operations = net income, and the diluted EPS from continuing operations (the
    figure IBM's own summary shows) = that income / diluted shares; the revenue must be the headline's. Operating (non-GAAP) EPS is shown
    as adjusted EPS when the reconciliation agrees with the statement."""
    t = clean(text)
    if 'international business machines' not in t.lower():
        raise ValueError('issuer-identity-missing')
    title = re.search(r'IBM RELEASES (FIRST|SECOND|THIRD|FOURTH)-QUARTER', t[:400])
    said = re.search(r'today announced (first|second|third|fourth)-quarter (20\d\d) earnings results', t[:1500])
    if not title or not said or title[1].lower() != said[1].lower():
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[said[1].lower()], int(said[2])
    head = re.search(r'COMPARATIVE FINANCIAL RESULTS ?\(Unaudited; (?:\$|Dollars) in millions except per share amounts\) Three Months Ended ('
                     + MONTH + r' \d{1,2}),( (?:(?:Six|Nine) Months|Year) Ended ' + MONTH + r' \d{1,2},)? (20\d\d) (20\d\d)(?: (20\d\d) (20\d\d))? ', t)
    if not head:
        raise ValueError('statement-heading-missing')
    n = 4 if head[2] else 2
    if (int(head[3]), int(head[4])) != (year, year - 1) or bool(head[5]) != (n == 4) or (n == 4 and (int(head[5]), int(head[6])) != (year, year - 1)):
        raise ValueError('columns-unrecognized')
    end = t.find('CONDENSED CONSOLIDATED BALANCE SHEET', head.end())
    end = end if end > 0 else head.end() + 4000
    rows = statement_rows(t[head.end():end])
    r = {key: row_values(rows, pattern, n) for key, pattern in IBM_ROWS.items()}
    if any(v is None for v in r.values()):
        raise ValueError('revenue-row-unrecognized')
    for i in (0, 1):
        if not (near(r['gross'][i] - r['expense'][i], r['pretax'][i], 1) and near(r['pretax'][i] - r['tax'][i], r['cont'][i], 1)
                and near(r['cont'][i] + r['disc'][i], r['net'][i], 1) and per_share_ok(r['cont'][i], r['shares'][i], r['eps'][i])):
            raise ValueError('statement-mismatch')
    # IBM's own "Income Statement Summary" (revenue in billions, one decimal; diluted EPS from continuing operations) must be this column's
    summary = re.findall(r'INCOME STATEMENT SUMMARY Revenue .{0,200}? GAAP from Continuing Operations \$ (\d+\.\d)B [^Y]{0,120}?\$ (\(?\d+\.\d\d\)?)'
                         r'(?: \(\d\))? Year/Year', t[:6000])
    # (the first one: a fourth-quarter release then summarizes the full year)
    if not summary or abs(Decimal(summary[0][0]) * 1000 - r['revenue'][0]) > 50 or signed(summary[0][1]) != r['eps'][0]:
        raise ValueError('change-mismatch')
    facts = [('revenue', money_millions(r['revenue'][0]), money_millions(r['revenue'][1])),
             ('eps', per_share(r['eps'][0]), per_share(r['eps'][1]))]
    adjusted = [ibm_operating_eps(t, end, head[1], y, r['cont'][i], r['eps'][i], r['shares'][i]) for i, y in ((0, year), (1, year - 1))]
    operating = re.findall(r'Year/Year .{0,120}? Operating \(Non-GAAP\) [^Y]{0,120}?\$ (\d+\.\d\d)(?: \(\d\))? Year/Year', t[:6000])
    if None not in adjusted and operating and Decimal(operating[0]) == adjusted[0]:
        facts.append(('adjusted-eps', per_share(adjusted[0]), per_share(adjusted[1])))
    facts.append(('net-income', money_millions(r['net'][0]), money_millions(r['net'][1])))
    return {'period': f'Q{quarter} {year}', 'facts': ordered(facts)}


IREN_ROWS = {'revenue': r'(?i:Total revenue)', 'cost': r'(?i:Total cost of revenue)', 'opex': r'Total operating \(expenses\) income',
             'operating': r'Operating \(loss\) income', 'other': r'Total other \(expense\) income', 'pretax': r'Income \(loss\) before taxes',
             'tax': r'Income tax \(expense\) benefit', 'net': r'Net income \(loss\)'}
IREN_QUARTER = {9: 1, 12: 2, 3: 3, 6: 4}  # quarter end month -> fiscal quarter (the fiscal year ends June 30)


def parse_iren(text, url=None):
    """IREN's results release (8-K EX-99.1): its "Consolidated Statement of Operations" shows this quarter and the previous quarter
    (not the same quarter a year earlier, so no year-ago comparison is given). Revenue, operating income and net income are read when
    both columns hold revenue - cost of revenue + operating (expenses) income = operating income, + other (expense) income = income
    before taxes, + tax = net income, and the quarter is the one the headline names. IREN prints no per-share figures in the release."""
    t = clean(text)
    if 'iren' not in t[:3000].lower():
        raise ValueError('issuer-identity-missing')
    head = re.search(r'Consolidated Statement of Operations US\$ ?(m|Million) Quarter ended Quarter ended (' + MONTH + r') (\d{1,2}), (20\d\d)\d? ('
                     + MONTH + r') (\d{1,2}), (20\d\d)\d? ', t)
    if not head:
        raise ValueError('statement-heading-missing')
    month, year, before = MONTHS[head[2]], int(head[4]), (MONTHS[head[5]], int(head[7]))
    if month not in IREN_QUARTER or before != ((month - 3, year) if month > 3 else (12, year - 1)):
        raise ValueError('columns-unrecognized')
    quarter, fiscal = IREN_QUARTER[month], year + 1 if month > 6 else year
    title = re.search(r'IREN (?:Reports|Business Update and) (?:Q([1-4]) )?FY(\d\d) Results', t[:600])
    if not title or 2000 + int(title[2]) != fiscal or (int(title[1]) if title[1] else 4) != quarter:
        raise ValueError('period-unrecognized')
    end = re.search(r'Consolidated (?:Balance Sheet|Statement of Cash ?flows)', t[head.end():])
    block = t[head.end():head.end() + (end.start() if end else 3000)]
    # the statement's last row runs into its footnote ("1) For further detail") or the page number ("(684.0) (247.8) 10")
    block = re.sub(r' (?:\d\) .*|\d{1,2})$', '', block.strip())
    rows = statement_rows(block)
    r = {key: row_values(rows, pattern, 2) for key, pattern in IREN_ROWS.items()}
    if any(v is None for v in r.values()) or r['revenue'][0] <= 0:
        raise ValueError('revenue-row-unrecognized')
    tol = Decimal(1) if head[1] == 'Million' else Decimal('0.15')
    for i in (0, 1):
        if not (near(r['revenue'][i] + r['cost'][i] + r['opex'][i], r['operating'][i], tol)
                and near(r['operating'][i] + r['other'][i], r['pretax'][i], tol) and near(r['pretax'][i] + r['tax'][i], r['net'][i], tol)):
            raise ValueError('statement-mismatch')
    return {'period': f'Q{quarter} FY{fiscal}', 'facts': [('revenue', money_millions(r['revenue'][0]), None),
                                                          ('net-income', money_millions(r['net'][0]), None),
                                                          ('operating-income', money_millions(r['operating'][0]), None)]}


def parse_vistra(text, url=None):
    """Vistra's results release (8-K EX-99.1): the condensed consolidated statement of operations (this quarter, the same quarter a year
    earlier [, the year to date]; a fourth-quarter release prints the full year only and is not read here). Revenue and operating
    income are read when operating revenues plus every expense line printed between them equal operating income in both columns; net
    income attributable to Vistra (the figure the highlights state) when income before taxes + tax [+ non-controlling interests] gives
    it in both columns and it is the highlights' own figure. Vistra's release prints no per-share figures."""
    t = clean(text)
    if 'vistra' not in t[:600].lower():
        raise ValueError('issuer-identity-missing')
    title = re.search(r'Vistra Reports (First|Second|Third) Quarter (20\d\d) Results', t[:400])
    if not title:
        raise ValueError('period-unrecognized')
    quarter, year = QUARTERS[title[1].lower()], int(title[2])
    head = re.search(r'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS \(Unaudited\) \(Millions of Dollars\) Three Months Ended ' + MONTH
                     + r' \d{1,2},( (?:Six|Nine) Months Ended ' + MONTH + r' \d{1,2},)? (20\d\d) (20\d\d)(?: (20\d\d) (20\d\d))? ', t)
    if not head:
        raise ValueError('statement-heading-missing')
    n = 4 if head[1] else 2
    if (int(head[2]), int(head[3])) != (year, year - 1) or bool(head[4]) != (n == 4) or (n == 4 and (int(head[4]), int(head[5])) != (year, year - 1)):
        raise ValueError('columns-unrecognized')
    end = re.search(r'STATEMENTS OF CASH FLOWS|Vistra – Press Release', t[head.end():])
    rows = statement_rows(t[head.end():head.end() + (end.start() if end else 2500)])
    labels = [label for label, _cells in rows]
    first = [i for i, label in enumerate(labels) if label == 'Operating revenues']
    last = [i for i, label in enumerate(labels) if re.fullmatch(r'Operating income(?: \(loss\))?', label)]
    if len(first) != 1 or len(last) != 1 or not first[0] < last[0]:
        raise ValueError('revenue-row-unrecognized')
    lines = [row_values([rows[i]], re.escape(labels[i]), n) for i in range(first[0], last[0] + 1)]
    if any(v is None for v in lines) or lines[0][0] <= 0 \
            or any(not near(sum(v[i] for v in lines[:-1]), lines[-1][i], 1) for i in (0, 1)):
        raise ValueError('statement-mismatch')
    revenue, operating = lines[0], lines[-1]
    facts = [('revenue', money_millions(revenue[0]), money_millions(revenue[1]))]
    pretax = row_values(rows, r'Net income(?: \(loss\))? before income taxes', n)
    tax = row_values(rows, r'Income tax (?:\(expense\) benefit|expense)', n)
    attrib = row_values(rows, r'Net income(?: \(loss\))? attributable to Vistra', n)
    total = row_values(rows, r'Net income(?: \(loss\))?', n)
    nci = row_values(rows, r'Net \(income\) loss attributable to noncontrolling interest', n)
    said = re.findall(r'(?i)(?:GAAP (?:first|second|third) quarter ' + str(year) + r'|(?:first|second|third) quarter ' + str(year)
                      + r' GAAP) Net Income(?: \(Loss\))? of \$(\(?[\d,]+\)?) million', t[:1500])
    if None not in (pretax, tax, attrib) and len(set(said)) == 1 and signed(said[0]) == attrib[0] \
            and all(near(pretax[i] + tax[i], total[i] if total else attrib[i], 1)
                    and (total is None or nci is not None and near(total[i] + nci[i], attrib[i], 1)) for i in (0, 1)):
        facts.append(('net-income', money_millions(attrib[0]), money_millions(attrib[1])))
    facts.append(('operating-income', money_millions(operating[0]), money_millions(operating[1])))
    return {'period': f'Q{quarter} {year}', 'facts': ordered(facts)}


TESLA_ROWS = {'revenue': 'Total revenues', 'cost': 'Total cost of revenues', 'gross': 'Gross profit', 'opex': 'Total operating expenses',
              'operating': 'INCOME FROM OPERATIONS', 'interest-income': 'Interest income', 'interest-expense': 'Interest expense',
              'other': r'Other (?:\(expense\) income|income \(expense\)), net', 'pretax': 'INCOME BEFORE INCOME TAXES',
              'tax': 'Provision for income taxes', 'net': 'NET INCOME',
              'nci': 'Net income attributable to noncontrolling interests and redeemable noncontrolling interests in subsidiaries',
              'attrib': 'NET INCOME ATTRIBUTABLE TO COMMON STOCKHOLDERS'}


def parse_tesla(text, url=None):
    """Tesla's quarterly update (8-K EX-99.1): the statement of operations prints the last five quarters (the same quarter a year earlier
    first, this quarter last). Every figure is read from this quarter's and the year-earlier column, each holding revenue - cost =
    gross profit, - operating expenses = income from operations, + interest and other income = income before taxes, - tax = net
    income, - non-controlling interests = net income attributable to common stockholders, and diluted EPS = net income used in the
    per-share figure / diluted shares. The non-GAAP diluted EPS comes from the release's reconciliation, whose GAAP EPS and diluted
    shares must be the statement's and whose non-GAAP net income / diluted shares must give it."""
    t = clean(text)
    if 'tesla' not in t.lower():
        raise ValueError('issuer-identity-missing')
    title = re.search(r'\bQ([1-4]) (?:and FY )?(20\d\d) Update\b', t[:300])
    if not title:
        raise ValueError('period-unrecognized')
    quarter, year = int(title[1]), int(title[2])
    head = re.search(r'In millions of USD or shares as applicable, except per share data ((?:Q[1-4]-20\d\d ){5})REVENUES ', t)
    if not head:
        raise ValueError('statement-heading-missing')
    columns = [(int(q), int(y)) for q, y in re.findall(r'Q([1-4])-(20\d\d)', head[1])]
    if columns[-1] != (quarter, year) or columns[0] != (quarter, year - 1) \
            or any((b[1] * 4 + b[0]) - (a[1] * 4 + a[0]) != 1 for a, b in zip(columns, columns[1:])):
        raise ValueError('columns-unrecognized')
    end = re.search(r'S T A T E M E N T|B A L A N C E', t[head.end():])
    stop = head.end() + (end.start() if end else 3000)
    rows = statement_rows(t[head.end():stop])
    r = {key: row_values(rows, pattern, 5) for key, pattern in TESLA_ROWS.items()}
    if any(v is None for v in r.values()):
        raise ValueError('revenue-row-unrecognized')
    used = row_values(rows, 'NET INCOME USED IN COMPUTING NET INCOME PER SHARE OF COMMON STOCK', 5) or r['attrib']
    eps = row_after(rows, 'Net income per share of common stock attributable to common stockholders Basic', 'Diluted', 5)
    shares = row_after(rows, 'Weighted average shares used in computing net income per share of common stock Basic', 'Diluted', 5)
    for i in (4, 0):
        if not (r['revenue'][i] > 0 and near(r['revenue'][i] - r['cost'][i], r['gross'][i], 1) and near(r['gross'][i] - r['opex'][i], r['operating'][i], 1)
                and near(r['operating'][i] + r['interest-income'][i] + r['interest-expense'][i] + r['other'][i], r['pretax'][i], 1)
                and near(r['pretax'][i] - r['tax'][i], r['net'][i], 1) and near(r['net'][i] - r['nci'][i], r['attrib'][i], 1)):
            raise ValueError('statement-mismatch')
    facts = [('revenue', money_millions(r['revenue'][4]), money_millions(r['revenue'][0]))]
    if eps and shares and all(per_share_ok(used[i], shares[i], eps[i]) for i in (4, 0)):
        facts.append(('eps', per_share(eps[4]), per_share(eps[0])))
        # each reconciliation ends with its diluted share count (a fourth-quarter update also reconciles the last five years)
        recon, start, found = statement_rows(t[stop:]), 0, []
        for k, (label, _cells) in enumerate(recon):
            if not labelled(label, r'Shares used in EPS calculation, diluted \(GAAP and non-GAAP\)'):
                continue
            part, start = recon[start:k + 1], k + 1
            gaap = row_values(part, r'EPS attributable to common stockholders, diluted \(GAAP\)', 5)
            non = row_values(part, r'EPS attributable to common stockholders, diluted \(non-GAAP\)', 5)
            income = row_values(part, r'Net income used in computing diluted EPS attributable to common stockholders \(non-GAAP\)', 5) \
                or row_values(part, r'Net income attributable to common stockholders \(non-GAAP\)', 5)
            if None not in (gaap, non, income) and gaap == eps and row_values(part[-1:], '.+', 5) == shares \
                    and all(per_share_ok(income[i], shares[i], non[i]) for i in (4, 0)):
                found.append(non)
        if len(found) == 1:
            facts.append(('adjusted-eps', per_share(found[0][4]), per_share(found[0][0])))
    facts.append(('net-income', money_millions(r['attrib'][4]), money_millions(r['attrib'][0])))
    facts.append(('operating-income', money_millions(r['operating'][4]), money_millions(r['operating'][0])))
    return {'period': f'Q{quarter} {year}', 'facts': ordered(facts)}


def lead_values(rows, pattern, n):
    """The first `n` values of the one row whose label ends with `pattern` (a summary table prints change columns after them)."""
    found = [cells for label, cells in rows if labelled(label, pattern)]
    if len(found) != 1 or len(found[0]) < n:
        return None
    try:
        return [cell(c) for c in found[0][:n]]
    except ValueError:
        return None


def exact_values(rows, pattern, n):
    """The `n` values of the one row whose whole label is `pattern` ("Income Taxes", not "Earnings Before Income Taxes")."""
    found = [cells for label, cells in rows if re.fullmatch(pattern, label)]
    if len(found) != 1 or len(found[0]) != n:
        return None
    try:
        return [cell(c) for c in found[0]]
    except ValueError:
        return None


def section(t, start, stop, size=4000):
    """The text after the one heading `start` up to `stop` (or `size` characters), footnote marks after a figure ("190.7 (1) 155.5") dropped."""
    at = [m.end() for m in re.finditer(start, t)]
    if len(at) != 1:
        return ''
    end = re.search(stop, t[at[0]:at[0] + size])
    block = t[at[0]:at[0] + (end.start() if end else size)]
    return re.sub(r'(?<=[\d)]) \(\d\)(?= |$)', '', block)


COHERENT_LOSS = r'(?: \(Loss\))?'


def parse_coherent(text, url=None):
    """Coherent's results release (8-K EX-99.1). Table 1 summarises the quarter (this quarter, the previous quarter and the same quarter a
    year earlier, GAAP and non-GAAP), Table 2 is the statement of earnings, Tables 7 and 8 work out GAAP and non-GAAP diluted EPS. The
    release is read only when the statement holds revenue - total costs = earnings before income taxes, - taxes = net earnings, - the
    non-controlling interests = net earnings attributable to Coherent, in this quarter's and the year-earlier column, and Table 1's revenue,
    net earnings and diluted EPS are the statement's (and its revenue the headline's). Operating income (Table 1) is read when it is
    earnings before income taxes + interest expense + other expense (income), net, as its footnote defines it; diluted EPS when Table 7's
    diluted earnings / diluted shares give it; non-GAAP diluted EPS when Table 8's do and it is Table 1's non-GAAP figure."""
    t = clean(text)
    if 'coherent corp' not in t[:600].lower():
        raise ValueError('issuer-identity-missing')
    title = re.search(r'(?i)Coherent Corp\. Reports (First|Second|Third|Fourth) Quarter (?:and Full Year )?Fiscal (20\d\d) Results', t[:600])
    if not title:
        raise ValueError('period-unrecognized')
    quarter, fiscal = QUARTERS[title[1].lower()], int(title[2])
    summary = re.search(r'Table 1 GAAP Financial Results \(unaudited\)(?:\(\d\))* Q([1-4]) FY(\d\d) Q[1-4] FY\d\d Q([1-4]) FY(\d\d) Q/Q Y/Y', t)
    if not summary or (int(summary[1]), int(summary[2]), int(summary[3]), int(summary[4])) != (quarter, fiscal % 100, quarter, fiscal % 100 - 1):
        raise ValueError('columns-unrecognized')
    loss = COHERENT_LOSS
    statement = statement_rows(section(t, r'Condensed Consolidated Statements of Earnings' + loss + r'\* THREE MONTHS ENDED', r'\* Amounts may not'))
    s = {key: exact_values(statement, pattern, 3) for key, pattern in {
        'revenue': 'Revenues', 'cost': r'Total Costs, Expenses, & Other Expense', 'pretax': 'Earnings' + loss + ' Before Income Taxes',
        'tax': 'Income Taxes', 'net': 'Net Earnings' + loss,
        'nci': r'Net (?:\(Loss\) Earnings|\(Earnings\) Loss|Earnings \(Loss\)|Loss \(Earnings\)|Loss|Earnings) Attributable to Noncontrolling Interests',
        'attrib': 'Net Earnings' + loss + r' Attributable to Coherent Corp\.', 'eps': 'Diluted Earnings' + loss + ' Per Share',
        'interest': 'Interest expense', 'other': r'Other expense \(income\), net'}.items()}
    if not statement:
        raise ValueError('statement-heading-missing')
    if any(s[k] is None for k in ('revenue', 'cost', 'pretax', 'tax', 'net', 'nci', 'attrib', 'eps')) or not s['revenue'][0] > 0:
        raise ValueError('revenue-row-unrecognized')
    tol = Decimal('0.15')
    for i in (0, 2):
        if not (near(s['revenue'][i] - s['cost'][i], s['pretax'][i], tol) and near(s['pretax'][i] - s['tax'][i], s['net'][i], tol)
                and near(s['net'][i] - s['nci'][i], s['attrib'][i], tol)):
            raise ValueError('statement-mismatch')
    # Table 1 rounds to whole millions; its revenue, net earnings and diluted EPS must be the statement's
    gaap = statement_rows(section(t, re.escape(summary[0]), r'Operating Income is defined|Table 1, continued', 2500))
    g = {key: lead_values(gaap, pattern, 3) for key, pattern in {
        'revenue': 'Revenues', 'operating': r'Operating Income(?:\(\d\))?', 'attrib': 'Net Earnings' + loss + r' Attributable to Coherent Corp\.',
        'eps': 'Diluted Earnings' + loss + ' Per Share'}.items()}
    if g['revenue'] is None or g['attrib'] is None or g['eps'] is None \
            or not all(near(g['revenue'][i], s['revenue'][i], Decimal('0.55')) for i in (0, 1, 2)) \
            or not all(near(g['attrib'][i], s['attrib'][i], Decimal('0.55')) and g['eps'][i] == s['eps'][i] for i in (0, 2)):
        raise ValueError('summary-mismatch')
    said = re.findall(r'Q' + str(quarter) + r' REVENUE OF \$([\d.]+)B', t[:600])
    if len(said) != 1 or abs(Decimal(said[0]) * 1000 - s['revenue'][0]) > 5:
        raise ValueError('change-mismatch')
    facts = [('revenue', money_millions(s['revenue'][0]), money_millions(s['revenue'][2]))]
    rows = statement_rows(section(t, r'Table 7 GAAP Earnings' + loss + r' Per Share Calculation\*', r'\* Amounts may not'))
    income = lead_values(rows, r'Diluted earnings(?: \(loss\))? available to common shareholders', 3)
    shares = lead_values(rows, r'Diluted weighted average common shares(?: outstanding)?', 3)
    eps = lead_values(rows, r'Diluted earnings(?: \(loss\))? per common share', 3)
    if None not in (income, shares, eps) and all(eps[i] == s['eps'][i] and per_share_ok(income[i], shares[i], eps[i]) for i in (0, 2)):
        facts.append(('eps', per_share(eps[0]), per_share(eps[2])))
    rows = statement_rows(section(t, r'Table 8 Non-GAAP Earnings Per Share Calculation\*', r'\* Amounts may not'))
    income = lead_values(rows, 'Diluted earnings available to common shareholders', 3)
    shares = lead_values(rows, r'Diluted weighted average common shares(?: outstanding)?', 3)
    non = lead_values(rows, 'Diluted earnings per common share(?: on non-GAAP basis)?', 3)
    stated = lead_values(statement_rows(section(t, r'Table 1, continued Non-GAAP Financial Results \(unaudited\)(?:\(\d\))*', r' \(\d\) [A-Z]', 2500)),
                         'Diluted Earnings Per Share', 3)
    if None not in (income, shares, non, stated) and all(non[i] == stated[i] and per_share_ok(income[i], shares[i], non[i]) for i in (0, 2)):
        facts.append(('adjusted-eps', per_share(non[0]), per_share(non[2])))
    facts.append(('net-income', money_millions(s['attrib'][0]), money_millions(s['attrib'][2])))
    if g['operating'] and s['interest'] and s['other'] \
            and all(near(s['pretax'][i] + s['interest'][i] + s['other'][i], g['operating'][i], Decimal('0.6')) for i in (0, 2)):
        facts.append(('operating-income', money_millions(g['operating'][0]), money_millions(g['operating'][2])))
    return {'period': f'Q{quarter} FY{fiscal}', 'facts': ordered(facts)}


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
    request = urllib.request.Request(url, headers={'User-Agent': monitor.request_user_agent(),
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
    'SKHY': {'publisher': 'SK hynix IR (SEC 6-K)', 'parse': parse_skhynix, 'marker': 'Preliminary Results of Operations'},
    'META': {'publisher': 'Meta Platforms IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['META']), 'marker': STATEMENT['META']['heading']},
    'NFLX': {'publisher': 'Netflix IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['NFLX']), 'marker': STATEMENT['NFLX']['heading']},
    'NOW': {'publisher': 'ServiceNow IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['NOW']), 'marker': STATEMENT['NOW']['heading']},
    'INTC': {'publisher': 'Intel IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['INTC']), 'marker': STATEMENT['INTC']['heading']},
    'AAPL': {'publisher': 'Apple IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AAPL']), 'marker': STATEMENT['AAPL']['heading']},
    'PANW': {'publisher': 'Palo Alto Networks IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['PANW']), 'marker': STATEMENT['PANW']['heading']},
    'CRWD': {'publisher': 'CrowdStrike IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['CRWD']), 'marker': STATEMENT['CRWD']['heading']},
    'SNOW': {'publisher': 'Snowflake IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['SNOW']), 'marker': STATEMENT['SNOW']['heading']},
    'CRM': {'publisher': 'Salesforce IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['CRM']), 'marker': STATEMENT['CRM']['heading']},
    'ADBE': {'publisher': 'Adobe IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['ADBE']), 'marker': STATEMENT['ADBE']['heading']},
    'KLAC': {'publisher': 'KLA IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['KLAC']), 'marker': STATEMENT['KLAC']['heading']},
    'LRCX': {'publisher': 'Lam Research IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['LRCX']), 'marker': STATEMENT['LRCX']['heading']},
    'STX': {'publisher': 'Seagate IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['STX']), 'marker': STATEMENT['STX']['heading']},
    'APH': {'publisher': 'Amphenol IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['APH']), 'marker': STATEMENT['APH']['heading']},
    'BE': {'publisher': 'Bloom Energy IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['BE']), 'marker': STATEMENT['BE']['heading']},
    'ALAB': {'publisher': 'Astera Labs IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['ALAB']), 'marker': STATEMENT['ALAB']['heading']},
    'LITE': {'publisher': 'Lumentum IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['LITE']), 'marker': STATEMENT['LITE']['heading']},
    'AAOI': {'publisher': 'Applied Optoelectronics IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AAOI']), 'marker': STATEMENT['AAOI']['heading']},
    'IONQ': {'publisher': 'IonQ IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['IONQ']), 'marker': STATEMENT['IONQ']['heading']},
    'SOFI': {'publisher': 'SoFi IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['SOFI']), 'marker': STATEMENT['SOFI']['heading']},
    'ARM': {'publisher': 'Arm IR (SEC 6-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['ARM']), 'marker': 'Condensed Consolidated Income Statements'},
    'MSFT': {'publisher': 'Microsoft IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['MSFT']), 'marker': STATEMENT['MSFT']['heading']},
    'AMD': {'publisher': 'AMD IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AMD']), 'marker': STATEMENT['AMD']['heading']},
    'MRVL': {'publisher': 'Marvell IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['MRVL']),
             'marker': STATEMENT['MRVL']['heading']},
    'CRDO': {'publisher': 'Credo IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['CRDO']),
             'marker': STATEMENT['CRDO']['heading']},
    'AVGO': {'publisher': 'Broadcom IR (SEC 8-K)', 'parse': lambda t, u=None: parse_statement(t, STATEMENT['AVGO']),
             'marker': STATEMENT['AVGO']['heading']},
    'QCOM': {'publisher': 'Qualcomm IR (SEC 8-K)', 'parse': parse_qualcomm,
             'marker': 'GAAP Non-GAAP (in millions, except per share data and percentages)'},
    'CEG': {'publisher': 'Constellation Energy IR (SEC 8-K)', 'parse': parse_constellation,
            'marker': 'Adjusted (non-GAAP) Operating Earnings'},
    # Read from their statements (owner, Nov 19: IBM and IREN showed revenue only, Vistra net income only, Tesla two rounded figures).
    # Picked up like the sentence-only companies (a stored release whose first lines name a quarter's results), so a release whose
    # tables the parser cannot read still gets its highlight sentences (parse_with_sentences).
    'IBM': {'publisher': 'IBM IR (SEC 8-K)', 'parse': parse_ibm, 'results-head': True},
    'IREN': {'publisher': 'IREN IR (SEC 8-K)', 'parse': parse_iren, 'results-head': True},
    'TSLA': {'publisher': 'Tesla IR (SEC 8-K)', 'parse': parse_tesla, 'results-head': True},
    'VST': {'publisher': 'Vistra IR (SEC 8-K)', 'parse': parse_vistra, 'results-head': True},
    # Coherent (owner, Nov 20: every calendar company read from its tables, not only from its highlight sentences)
    'COHR': {'publisher': 'Coherent IR (SEC 8-K)', 'parse': parse_coherent, 'results-head': True},
}
SOURCE_URL = {
    'NBIS': re.compile(r'^https://nebius\.com/newsroom/[a-z0-9-]+$'),
    'CRWV': re.compile(r'^https://www\.sec\.gov/Archives/edgar/data/\d+/\d+/[A-Za-z0-9_.-]+$'),
}



def sentences(text, url=None):
    import highlight_sentences  # imported here: it reads this module's labels and formats
    parsed = highlight_sentences.parse(text, url)
    return {**parsed, 'method': highlight_sentences.METHOD}


def sentence_candidate(flat):
    import highlight_sentences
    head = flat[:800]
    return highlight_sentences.results_head(head)


def outside_roster(ticker):
    """The 22 deep-analysis companies have their own verified fallback (result_fallback); the others get the sentence reading."""
    try:
        import deep_analysis
        return ticker not in deep_analysis.ROSTER
    except Exception:  # noqa: BLE001
        return False


def parse_with_sentences(ticker, text, url):
    """The company's table parser; when it cannot read the release (or the company has none), outside the deep-analysis roster,
    the figures its highlight sentences state (owner, Nov 18: never only 「決算を発表しました」 when the release states them)."""
    try:
        return PROFILES[ticker]['parse'](text, url)
    except Exception as table_error:
        if not outside_roster(ticker):
            raise
        try:
            return sentences(text, url)
        except ValueError:
            raise table_error


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


def build(ticker, url, parsed, observed_at, publisher=None):
    key = hashlib.sha256('\0'.join([ticker, parsed['period'], url]).encode()).hexdigest()
    number = str(int(key[:12], 16))
    # comparisons.yearAgo is the same quarter one year earlier, read from the table's prior-year column (same format as value).
    facts = [{'key': f[0], 'ja': (f[3] if len(f) > 3 else LABELS[f[0]])[0], 'en': (f[3] if len(f) > 3 else LABELS[f[0]])[1], 'value': f[1],
              **({'comparisons': {**({'yearAgo': f[2]} if f[2] else {}), **({'growth': f[4]} if len(f) > 4 and f[4] else {})}}
                 if f[2] or (len(f) > 4 and f[4]) else {})} for f in parsed['facts']]
    first = facts[:2]
    period = parsed['period']
    return key, {
        'id': number, 'researchId': 'ir-flash-' + number, 'kind': 'earnings', 'ticker': ticker, 'period': period,
        'titleJa': f'{ticker} {period}決算：' + '、'.join(f['ja'] + f['value'] for f in first),
        'titleEn': f'{ticker} {period} earnings: ' + ', '.join(f['en'] + ' ' + f['value'] for f in first),
        'facts': facts, 'url': url, 'publisher': publisher or PROFILES[ticker]['publisher'],
        'publishedAt': observed_at, 'observedAt': observed_at, 'method': parsed.get('method', 'deterministic-issuer-table'),
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


SEC_HOSTS = {'www.sec.gov', 'data.sec.gov'}


def new_release(row, reference):
    """Nov 23: a release found by a new source route's first fetch (baselined: no release event) or one whose own dates are more
    than 36 hours old is history, never a results flash. An SEC filing may go without an event; its acceptance time decides."""
    if row['event_at'] is None and urlsplit(row['url']).hostname not in SEC_HOSTS:
        return False
    if row['event_at'] is None and row['sec_acceptance_datetime'] is None:
        return False
    return not release_freshness.row_is_stale(row, reference)


def period_already_published(db, ticker, url, period, observed):
    """The same company and period was published from another address more than 36 hours earlier: an old release found again."""
    earlier = (observed - release_freshness.MAX_AGE).isoformat()
    return db.execute('SELECT 1 FROM issuer_result_publications WHERE ticker=? AND period=? AND url<>? '
                      'AND julianday(observed_at)<julianday(?) LIMIT 1', (ticker, period, url, earlier)).fetchone() is not None


def candidates(db, reference):
    cutoff = (reference - WINDOW).isoformat()
    for row in db.execute('''SELECT s.url,s.ticker,s.published_on,s.sec_acceptance_datetime,e.detected_at AS event_at,
          COALESCE(e.detected_at,s.discovered_at) AS detected
        FROM sources s LEFT JOIN release_events e ON e.url=s.url
        WHERE s.ticker='NBIS' AND s.status NOT IN ('held','rejected')
          AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)''', (cutoff,)):
        if not new_release(row, reference):
            continue
        parts = urlsplit(row['url'])
        if (parts.scheme == 'https' and parts.hostname == 'nebius.com' and not parts.query
                and NEBIUS_RESULTS_PATH.match(parts.path) and SOURCE_URL['NBIS'].match(row['url'])):
            yield row['ticker'], row['url'], row['detected'], None
    # Companies whose release table is read from the page text the monitor already stored (SEC exhibit or the company's own page).
    # Never filter on the revision text in SQL: the planner then scans every stored revision (a whole database of page text)
    # every few seconds and starves the monitor (Nov 12). Pick the few recent sources of these companies first, then read only
    # their current revision.
    markers = {t: p['marker'] for t, p in PROFILES.items() if p.get('marker')}
    # sentence-only companies (no table parser): any stored release whose first lines name a quarter's results
    markers.update({t: None for t, p in PROFILES.items() if p.get('sentences-only') or p.get('results-head')})
    for row in db.execute('SELECT s.url,s.ticker,s.sha256,s.published_on,s.sec_acceptance_datetime,e.detected_at AS event_at,'
                          'COALESCE(e.detected_at,s.discovered_at) AS detected '
                          'FROM sources s LEFT JOIN release_events e ON e.url=s.url '
                          "WHERE s.ticker IN (%s) AND s.status NOT IN ('held','rejected') "
                          'AND julianday(COALESCE(e.detected_at,s.discovered_at))>=julianday(?)' % ','.join('?' for _ in markers),
                          (*markers, cutoff)).fetchall():
        if not new_release(row, reference):
            continue
        parts = urlsplit(row['url'])
        if (parts.scheme != 'https' or parts.query or parts.fragment or parts.username
                or parts.hostname not in monitor.HOSTS.get(row['ticker'], set()) or len(row['url']) > 240):
            continue
        revision = db.execute('SELECT extracted_text FROM source_revisions WHERE url=? AND sha256=?',
                              (row['url'], row['sha256'])).fetchone()
        # The stored text keeps the page's line breaks ("Summary\nGAAP" in NVIDIA's Q3 FY27 release, Nov 17): compare on single spaces.
        flat = ' '.join((revision['extracted_text'] or '').split()) if revision else ''
        if revision and (markers[row['ticker']] in flat if markers[row['ticker']] else sentence_candidate(flat)):
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
                import release_extras  # imported here: it reads this module's formats
                parsed = release_extras.supplement(text, parse_with_sentences(ticker, text, url))
            except Exception as exc:
                code = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r'[a-z0-9-]{1,40}', str(exc)) else type(exc).__name__
                STATUS[url] = {'ticker': ticker, 'state': 'unreadable', 'reason': code, 'at': stamp()}
                remember(db, ticker, url, 'unreadable', code)
                continue
            STATUS[url] = {'ticker': ticker, 'state': 'published', 'reason': None, 'at': stamp()}
            remember(db, ticker, url, 'published', None, parsed['period'])
            given = parsed.get('givenAt')
            if given is not None and given < observed:
                observed = given  # a late filing of results given out earlier keeps their own date
            key, payload = build(ticker, url, parsed, stamp(observed))
            if key not in existing and period_already_published(db, ticker, url, parsed['period'], observed):
                continue
            old = existing.get(key)
            if old and json.loads(old['payload'])['facts'] == payload['facts'] \
                    and json.loads(old['payload']).get('publishedAt') == payload['publishedAt']:
                continue
            with db:
                db.execute('''INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at,published_at=excluded.published_at,
                  processing_ms=excluded.processing_ms,version=excluded.version''',
                           (key, ticker, url, parsed['period'], json.dumps(payload, ensure_ascii=False),
                            stamp(observed), stamp(), round((time.monotonic() - started) * 1000), VERSION))
            changed += 1
            try:
                result_fallback.replace_with_flash(db, ticker, observed)  # the parser's figures always win over the fallback
            except Exception:
                print('issuer-result-fallback-replace-unavailable', flush=True)
    return changed


def remember(db, ticker, url, state, reason, period=None):
    """Persist the reading state (codes only) so it survives a restart; never lets a storage error stop the flash."""
    try:
        result_fallback.record(db, ticker, url, state, reason, period)
    except Exception:
        print('issuer-result-state-unavailable', flush=True)


def public_feed(db, cutoff, until=None):
    """Stored flashes still inside the window (observed at or after `cutoff`, and before `until` when given: the calendar's
    results history asks for a month), in the same shape as market_results items."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='issuer_result_publications'").fetchone():
        return []
    items = []
    for row in db.execute('SELECT payload,observed_at,published_at,processing_ms FROM issuer_result_publications '
                          'WHERE julianday(observed_at)>=julianday(?) AND julianday(observed_at)<julianday(?) '
                          'ORDER BY julianday(observed_at) DESC', (cutoff, until or '9999-12-31T00:00:00+00:00')):
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
    persisted = result_fallback.diagnostics(db)
    waiting = [{k: v[k] for k in ('ticker', 'state', 'reason', 'at')}
               for v in sorted(STATUS.values(), key=lambda v: v['at'], reverse=True)[:10] if v['state'] != 'published']
    if not waiting:  # after a restart the in-memory outcome is gone; the stored one still says why
        waiting = [{'ticker': a['ticker'], 'state': a['state'], 'reason': a['reason'], 'at': a['changedAt']}
                   for a in persisted['attempts'] if a['state'] != 'published'][:10]
    return {'status': 'running', 'published': stored, 'latest': latest, 'waiting': waiting,
            'attempts': persisted['attempts'], 'fallbacks': persisted['fallbacks'], 'gaps': persisted.get('gaps', [])}
