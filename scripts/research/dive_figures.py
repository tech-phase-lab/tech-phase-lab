"""The figures a 決算の深掘り needs, read from the company's own results release tables (owner, Nov 26: as deep as the hand-made dives).

Each company has a spec: which table rows (statements of operations, balance sheet, GAAP to non-GAAP reconciliation, revenue by
end market) and which outlook sentences to read. A row is read only when its label appears once after the table's own heading and is
followed by exactly the expected number of cells; anything else leaves that figure out (never guessed). Every figure keeps the
release passage it was read from, so the dive's evidence quotes it, and the unit the table declares (thousands are turned into
millions with a calc the checker re-computes).

    figures = dive_figures.read('CRDO', release_text)   # {'revenue': Figure, ...}; a figure missing from the release is absent
"""
from dataclasses import dataclass, field
from decimal import Decimal
import re

CELL = re.compile(r'(?:\$\s?)?\(?[+-]?\$?\s?\d[\d,]*(?:\.\d+)?\)?(?:\s?%|\s(?:ppts?|bps)\b)?|—')


@dataclass
class Figure:
    values: list            # Decimals, in the figure's unit (millions, percent or per share), columns in table order
    quote: str              # the release passage: the row label and its cells
    raws: list = field(default_factory=list)  # the printed cells (commas removed), for the evidence calc
    scale: str = ''         # '/ 1000' when the table is in thousands and values are in millions
    unit: str = 'million'   # 'million', 'percent' or 'per-share'
    muls: list = field(default_factory=list)  # per value: the multiplier from the printed figure (an outlook "$3.150 billion")

    def calc(self, index):
        """The evidence calc for value `index` (None when the printed figure is the value itself)."""
        if self.muls and self.muls[index]:
            return f'{self.raws[index]} * {self.muls[index]}'
        return f'{self.raws[index]} {self.scale}'.strip() if self.scale else None


def _number(cell):
    text = cell.strip().replace('$', '').replace('%', '').replace('ppts', '').replace('ppt', '').replace('bps', '').replace(',', '').replace(' ', '').lstrip('+')
    if text == '—':
        return Decimal(0), '0'
    negative = text.startswith('(') and text.endswith(')')
    text = text.strip('()')
    value = Decimal(text)
    return (-value if negative else value), text


def row(text, label, columns, after=None, before=None, unit='million', thousands=False, width=None, exact=True):
    """The first `columns` numbers right after `label` (a whole label, once) inside the table that starts at `after`; None if not exactly so.
    The row must have exactly `width` cells (default `columns`: the table's column count) and no more (`exact=False` only where the
    filing prints a page number right after the table).
    `label` may be a tuple of the wordings a company uses in different quarters ("Net income" / "Net income (loss)"): the first that reads."""
    if isinstance(label, tuple):
        for one in label:
            found = row(text, one, columns, after, before, unit, thousands, width, exact)
            if found:
                return found
        return None
    start = text.find(after) if after else 0
    if start < 0:
        return None
    end = text.find(before, start + len(after or '')) if before else -1
    area = text[start:end if end > 0 else len(text)]
    hits = [m for m in re.finditer(r'(?<![A-Za-z-])' + re.escape(label) + r'(?=\s*[$(\d—])', area)]
    if len(hits) != 1:  # the label must appear exactly once in its table
        return None
    m = hits[0]
    rest = area[m.end():m.end() + 400]
    cells, at = [], 0
    for _ in range(width or columns):
        c = CELL.match(rest, at + (len(rest[at:]) - len(rest[at:].lstrip())))
        if not c:
            return None
        cells.append(c.group())
        at = c.end()
    if exact and CELL.match(rest, at + (len(rest[at:]) - len(rest[at:].lstrip()))):
        return None  # more cells than the table's columns: not the row we expect
    try:
        parsed = [_number(c) for c in cells][:columns]
        cells = cells[:columns]
    except ArithmeticError:
        return None
    quote = (label + rest[:at]).strip()
    if unit == 'percent' and not all('%' in c or c.strip() == '—' for c in cells[:columns]):
        return None
    scale = '/ 1000' if thousands and unit == 'million' else ''
    values = [v / 1000 if scale else v for v, _ in parsed]
    return Figure(values=values, quote=quote, raws=[r for _, r in parsed], scale=scale, unit=unit)


def sentence(text, pattern, groups, unit='million', multipliers=None):
    """Figures from one outlook sentence: the regex `pattern`'s groups as printed, times `multipliers` (1000 for billions, per group)."""
    found = list(re.finditer(pattern, text, re.I))
    # stated once, or restated (a summary and the outlook section) with exactly the same figures; differing statements are not read
    if not found or len({tuple(x.group(g) for g in groups) for x in found}) != 1:
        return None
    m = found[0]
    raws = [m.group(g).replace(',', '') for g in groups]
    muls = list(multipliers or [None] * len(raws))
    values = list(raws) if unit == 'text' else [Decimal(r) * (k or 1) for r, k in zip(raws, muls)]
    return Figure(values=values, quote=text[m.start():m.end()].strip(), raws=raws, unit=unit, muls=muls)


def between(text, after, before=None):
    """The part of `text` from the first `after` to the next `before` ('' when `after` is absent)."""
    start = text.find(after)
    if start < 0:
        return ''
    end = text.find(before, start + len(after)) if before else -1
    return text[start:end if end > 0 else len(text)]


CHANGE = r'(?:(?:Up|Down) [\d.]+ ?(?:%|ppts?)|Flat)'


def highlight(text, label, after, before=None, unit='million'):
    """A row of a highlights table that prints each comparison as words ("$7,483 $4,992 Up 50% $6,488 Up 15%"): the three figures
    (this quarter, a year earlier, the previous quarter), once in the table, with both comparisons in their places."""
    area = between(text, after, before)
    cell = r'(\$?\(?-?[\d,]+(?:\.\d+)?\)? ?%?)'
    pattern = r'(?<![A-Za-z-])' + re.escape(label) + r' ' + cell + r' ' + cell + r' ' + CHANGE + r' ' + cell + r' ' + CHANGE
    found = list(re.finditer(pattern, area))
    if len(found) != 1 or len(re.findall(r'(?<![A-Za-z-])' + re.escape(label) + r' [$\d(]', area)) != 1:
        return None
    m = found[0]
    if unit == 'percent' and not all('%' in m.group(i) for i in (1, 2, 3)):
        return None
    parsed = [_number(m.group(i)) for i in (1, 2, 3)]
    return Figure(values=[v for v, _ in parsed], quote=m.group(0), raws=[r for _, r in parsed], unit=unit)


# ---- the companies ----------------------------------------------------------------------------------------------------------

def credo(t):
    ops, bs = 'Condensed Consolidated Statements of Operations', 'Condensed Consolidated Balance Sheets'
    rec, out = 'Reconciliations from GAAP to Non-GAAP', 'Reconciliation of GAAP Forward-Looking Estimates'
    f = {
        'revenue': row(t, 'Revenue', 3, ops, bs, thousands=True),
        'opex': row(t, 'Total operating expenses', 3, ops, bs, thousands=True),
        'operatingIncome': row(t, 'Operating income', 3, ops, bs, thousands=True),
        'epsGaap': row(t, 'Diluted', 3, ops, 'Weighted-average shares', unit='per-share'),
        'cash': row(t, 'Cash and cash equivalents', 2, bs, rec, thousands=True),
        'shortTerm': row(t, 'Short-term investments', 2, bs, rec, thousands=True),
        'goodwill': row(t, 'Goodwill', 2, bs, rec, thousands=True),
        'gmGaap': row(t, 'GAAP gross margin', 3, rec, out, unit='percent'),
        'gm': row(t, 'Non-GAAP gross margin', 3, rec, out, unit='percent'),
        'opexNonGaap': row(t, 'Total Non-GAAP operating expenses (B)', 3, rec, out, thousands=True),
        'opMarginGaap': row(t, 'GAAP operating income margin', 3, rec, out, unit='percent'),
        'netIncomeNonGaap': row(t, 'Non-GAAP net income', 3, rec, out, thousands=True),
        'netMarginNonGaap': row(t, 'Non-GAAP net income margin', 3, rec, out, unit='percent'),
        'netMarginGaap': row(t, 'GAAP net income margin', 3, rec, out, unit='percent'),
        'eps': row(t, 'Non-GAAP diluted net income per share', 3, rec, out, unit='per-share'),
        'sbc': row(t, 'Share-based compensation', 3, 'GAAP net income $', 'Non-GAAP net income', thousands=True),
        'guidanceRevenue': sentence(t, r'Revenue is expected to be between \$([\d,.]+) million and \$([\d,.]+) million', (1, 2)),
        'guidanceGm': sentence(t, r'non-GAAP gross margin is expected to be between ([\d.]+)% and ([\d.]+)%', (1, 2), unit='percent'),
        'guidanceOpex': sentence(t, r'non-GAAP operating expenses are expected to be between \$([\d,.]+) million and \$([\d,.]+) million', (1, 2)),
    }
    f['netIncome'] = row(t, 'Net income', 3, 'Provision', bs, thousands=True)
    return f


def marvell(t):
    ops, rec = 'Condensed Consolidated Statements of Operations', 'Reconciliations from GAAP to Non-GAAP'
    end = 'Revenue by End Market (In millions)'
    share = 'Revenue by End Market % of Total'
    return {
        'revenue': row(t, 'Net revenue', 3, ops, 'Cost of goods sold', width=5),
        # the year-end release (Q4) words these rows with "(loss)" (Feb 2026): both wordings are read
        'netIncome': row(t, ('Net income', 'Net income (loss)'), 3, 'Provision', ('Net income per share' if 'Net income per share' in t else 'Net income (loss) per share'), width=5),
        'epsGaap': row(t, ('GAAP diluted net income per share', 'GAAP diluted net income (loss) per share'), 3, 'Other income tax effects', '(a)', unit='per-share', width=5),
        'eps': row(t, 'Non-GAAP diluted net income per share', 3, 'Other income tax effects', '(a)', unit='per-share', width=5),
        'gmGaap': row(t, 'GAAP gross margin', 3, rec, 'Non-GAAP gross margin', unit='percent', width=5),
        'gm': row(t, 'Non-GAAP gross margin', 3, rec, 'GAAP operating expenses', unit='percent', width=5),
        'opMargin': row(t, 'Non-GAAP operating margin', 3, rec, 'GAAP interest', unit='percent', width=5),
        'netIncomeNonGaap': row(t, 'Non-GAAP net income', 3, 'Other income tax effects', 'GAAP weighted-average', width=5),
        'dataCenter': row(t, 'Data center', 3, end, share, width=5),
        'communications': row(t, 'Communications and other', 3, end, share, width=5),
        'dataCenterShare': row(t, 'Data center', 3, share, 'For further information', unit='percent'),
        'guidanceRevenue': sentence(t, r'Net revenue is expected to be \$([\d.]+) billion \+/- ([\d.]+)%', (1, 2), multipliers=[1000, None]),
        'guidanceGm': sentence(t, r'Non-GAAP gross margin is expected to be ([\d.]+)% to ([\d.]+)%', (1, 2), unit='percent'),
        'guidanceEps': sentence(t, r'Non-GAAP diluted net income per share is expected to be \$([\d.]+) \+/- \$([\d.]+)', (1, 2), unit='per-share'),
    }


def broadcom(t):
    hl, rec = 'Financial Highlights', 'Gross margin on GAAP basis'
    seg = 'Net revenue by segment'
    return {
        'revenue': row(t, 'Net revenue', 3, 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'Cost of', width=5),
        'grossProfitNonGaap': row(t, 'Gross margin on non-GAAP basis', 3, rec, 'Research and development on GAAP', width=5),
        'opIncomeNonGaap': row(t, 'Operating income on non-GAAP basis', 3, rec, 'Interest expense on GAAP', width=5),
        # the highlights table: GAAP this quarter, a year earlier, change, then non-GAAP the same (no previous-quarter column)
        'epsBoth': sentence(t, r'Earnings per common share - diluted \$ ([\d.]+) \$ ([\d.]+) [+-]?\d+ ?% \$ ([\d.]+) \$ ([\d.]+)', (1, 2, 3, 4), unit='per-share'),
        'fcf': row(t, 'Free cash flow', 3, 'Net cash provided by operating activities $', '(1)', width=5),
        'semis': row(t, 'Semiconductor solutions', 4, seg, 'Infrastructure software', width=5),
        'software': row(t, 'Infrastructure software', 4, seg, 'Total net revenue', width=5),
        'ai': sentence(t, r'AI semiconductor revenue of \$([\d.]+) billion grew (\d+)% year-over-year, and (\d+)% quarter-over-quarter', (1, 2, 3),
                       multipliers=[1000, None, None]),
        'guidanceRevenue': sentence(t, r'quarter revenue guidance of approximately \$([\d.]+) billion', (1,), multipliers=[1000]),
        'guidanceAi': sentence(t, r'expect AI semiconductor revenue to accelerate to \$([\d.]+) billion', (1,), multipliers=[1000]),
        'guidanceOpMargin': sentence(t, r'non-GAAP operating income guidance of approximately (\d+) percent of projected revenue', (1,), unit='percent'),
        'fcfShare': sentence(t, r'\$([\d.]+) billion of free cash flow, or (\d+) percent of revenue', (1, 2), multipliers=[1000, None]),
    }


def amd(t):
    ops, data = 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'SELECTED CORPORATE DATA'
    hl_g, hl_n, seg = 'GAAP Quarterly Financial Results', 'Non-GAAP(*) Quarterly Financial Results', 'Segment Summary'
    net, opi = 'Net Revenue:', 'Operating Income (Loss):'
    flows = 'Changes in operating assets and liabilities:'
    return {
        'revenue': row(t, 'Net revenue', 3, ops, 'Cost of sales', width=5),          # this quarter, previous quarter, a year earlier, 9 months x2
        'gm': highlight(t, 'Gross margin', hl_n, seg, unit='percent'),               # this quarter, a year earlier, previous quarter
        'opIncomeNonGaap': highlight(t, 'Operating income ($M)', hl_n, seg),
        'eps': highlight(t, 'Diluted earnings per share', hl_n, seg, unit='per-share'),
        'epsGaap': highlight(t, 'Diluted earnings per share', hl_g, hl_n, unit='per-share'),
        'warrant': row(t, 'Change in fair value of warrant liability (3)', 2, 'GAAP net income / earnings per share', 'Non-GAAP net income / earnings per share', width=3),
        'dataCenter': row(t, 'Data Center Segment', 3, net, 'Client and Gaming Segment', width=5),
        'clientGaming': row(t, 'Total Client and Gaming', 3, net, 'Embedded Segment', width=5),
        'gaming': row(t, 'Gaming', 3, 'Client and Gaming Segment Client', 'Total Client and Gaming', width=5),
        'embedded': row(t, 'Embedded Segment', 3, net, 'Total net revenue', width=5),
        'dataCenterOp': row(t, 'Data Center Segment', 3, opi, 'Client and Gaming Segment', width=5),
        'clientGamingOp': row(t, 'Client and Gaming Segment', 3, opi, 'Embedded Segment', width=5),
        'embeddedOp': row(t, 'Embedded Segment', 3, opi, 'All other', width=5),
        'gamingYoy': sentence(t, r'Gaming business revenue was \$([\d,]+) million, (up|down) (\d+)% year-over-year', (1, 2, 3), unit='text'),
        'fcf': row(t, 'Free cash flow (3)', 3, data, 'Total assets', width=5),
        'fcfMargin': row(t, 'Free cash flow margin %', 3, 'Reconciliation of GAAP Net Cash Provided by Operating Activities', 'The Company also presents', unit='percent', width=5),
        'debt': row(t, 'Total debt', 3, data, '(1) The Company operates as', width=5),
        'receivables': row(t, 'Accounts receivable, net', 2, flows, 'Net cash provided by operating activities', width=4),   # three months, a year earlier, 9 months x2
        'inventories': row(t, 'Inventories', 2, flows, 'Net cash provided by operating activities', width=4),
        'guidanceRevenue': sentence(t, r'AMD expects revenue to be approximately \$([\d.]+) billion, plus or minus (\d+)%', (1, 2), multipliers=[1000, None]),
        'guidanceGm': sentence(t, r'Non-GAAP gross margin is expected to be approximately (\d+)%', (1,), unit='percent'),
        'guidanceGrowth': sentence(t, r'The mid-point of the revenue range represents year-over-year growth of approximately (\d+)% and a sequential increase of approximately (\d+)%',
                                   (1, 2), unit='percent'),
    }


def arista(t):
    inc, rec = 'Condensed Consolidated Income Statements', 'Reconciliation of Selected GAAP to Non-GAAP Financial Measures'
    bs, cf = 'Condensed Consolidated Balance Sheets', 'Condensed Consolidated Statements of Cash Flows'
    eps = ('Non-GAAP diluted net income per share(1)', 'Non-GAAP diluted net income per share (1)', 'Non-GAAP diluted net income per share')
    return {   # three months this year and last, then nine months: Arista prints no previous-quarter column (the previous file has it)
        'revenue': row(t, 'Total revenue', 2, inc, 'Cost of revenue', width=4),
        'product': row(t, 'Product', 2, inc, 'Service', width=4),
        'service': row(t, 'Service', 2, inc, 'Total revenue', width=4),
        'nineMonths': row(t, 'Total revenue', 4, inc, 'Cost of revenue'),
        'gm': row(t, 'Non-GAAP gross margin', 2, rec, 'GAAP income from operations', unit='percent', width=4),
        'opMargin': row(t, 'Non-GAAP operating margin', 2, rec, 'GAAP net income', unit='percent', width=4),
        'eps': row(t, eps, 2, rec, 'Weighted-average shares used', unit='per-share', width=4),
        'epsGaap': row(t, 'GAAP diluted net income per share', 2, rec, 'Non-GAAP adjustments to net income per share', unit='per-share', width=4),
        'gains': row(t, '(Gains)/losses on strategic investments', 2, rec, 'Non-GAAP net income', width=4),
        'inventories': row(t, 'Inventories', 2, bs, 'Prepaid expenses'),
        'deferred': row(t, 'Deferred revenue', 2, bs, 'Other current liabilities'),
        'deferredLong': row(t, 'Deferred revenue, non-current', 2, bs, 'Other long-term liabilities'),
        'record': sentence(t, r'exceeding guidance of \$([\d.]+) billion while growing ([\d.]+)%, the highest year-over-year revenue growth since our IPO', (1, 2), unit='text'),
        'guidanceRevenue': sentence(t, r'Revenue of \$([\d.]+) - \$([\d.]+) billion;', (1, 2), multipliers=[1000, 1000]),
        'guidanceOpMargin': sentence(t, r'Non-GAAP operating margin of ([\d.]+) - ([\d.]+)%', (1, 2), unit='percent'),
        'guidanceEps': sentence(t, r'Non-GAAP diluted net income per share of \$([\d.]+) - \$([\d.]+)\.', (1, 2), unit='per-share'),
    }


AMOUNT = r'\$([\d.,]+) (billion|million)'


def palantir(t):
    ops = 'Condensed Consolidated Statements of Operations'
    grew = r' grew (\d+)% year-over-year and (\d+)% quarter-over-quarter to ' + AMOUNT
    return {   # three months this year and last, then nine months (in thousands); the previous quarter is in the previous file
        'revenue': row(t, 'Revenue', 2, ops, 'Cost of revenue', thousands=True, width=4),
        'grossProfit': row(t, 'Gross profit', 2, ops, 'Operating expenses', thousands=True, width=4),
        'sbc': row(t, 'Total stock-based compensation', 2, ops, 'Condensed Consolidated Balance Sheets', thousands=True, width=4),
        'eps': sentence(t, r'Adjusted EPS, Diluted \$ ([\d.]+)', (1,), unit='per-share'),
        'total': sentence(t, r'•Revenue' + grew, (1, 2, 3, 4), unit='text'),
        'us': sentence(t, r'•U\.S\. revenue' + grew, (1, 2, 3, 4), unit='text'),
        'usCommercial': sentence(t, r'U\.S\. commercial revenue' + grew, (1, 2, 3, 4), unit='text'),
        'usGovernment': sentence(t, r'U\.S\. government revenue' + grew, (1, 2, 3, 4), unit='text'),
        'deals': sentence(t, r'Closed (\d+) deals of at least \$1 million, (\d+) deals of at least \$5 million, and (\d+) deals of at least \$10 million', (1, 2, 3), unit='text'),
        'tcv': sentence(t, r'Closed total contract value \(.TCV.\) of ' + AMOUNT + r', (up|down) (\d+)% year-over-year', (1, 2, 3, 4), unit='text'),
        'rdv': sentence(t, r'U\.S\. commercial remaining deal value \(.RDV.\) of ' + AMOUNT + r', (up|down) (\d+)% year-over-year and (?:up )?(\d+)% quarter-over-quarter',
                        (1, 2, 3, 4, 5), unit='text'),
        'gaapOp': sentence(t, r'GAAP income from operations of ' + AMOUNT + r', representing a (\d+)% margin', (1, 2, 3), unit='text'),
        'adjOp': sentence(t, r'Adjusted income from operations of ' + AMOUNT + r', representing a (\d+)% margin', (1, 2, 3), unit='text'),
        'cfo': sentence(t, r'Cash from operations of ' + AMOUNT + r', representing a (\d+)% margin', (1, 2, 3), unit='text'),
        'fcf': sentence(t, r'Adjusted free cash flow of ' + AMOUNT + r', representing a (\d+)% margin', (1, 2, 3), unit='text'),
        'cash': sentence(t, r'Cash, cash equivalents, and U\.S\. Treasury securities of ' + AMOUNT, (1, 2), unit='text'),
        'firstTime': sentence(t, r'U\.S\. commercial revenue surpassed U\.S\. government revenue for the (first) time', (1,), unit='text'),
        'guidanceRevenue': sentence(t, r'For Q[1-4] 20\d\d, we expect: ?•Revenue of between \$([\d.]+) - \$([\d.]+) billion', (1, 2), multipliers=[1000, 1000]),
        'guidanceAdjOp': sentence(t, r'•Adjusted income from operations of between \$([\d.]+) - \$([\d.]+) billion\.?•?For full year', (1, 2), multipliers=[1000, 1000]),
    }


def astera(t):
    ops, cf = 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'CONDENSED CONSOLIDATED STATEMENTS OF CASH FLOWS'
    bs, rec = 'CONDENSED CONSOLIDATED BALANCE SHEETS', 'RECONCILIATION OF GAAP TO NON-GAAP FINANCIAL MEASURES'
    sbc = 'SUPPLEMENTAL FINANCIAL INFORMATION STOCK-BASED COMPENSATION EXPENSE'
    return {   # this quarter, the previous quarter, a year earlier, then nine months x2 (in thousands)
        'revenue': row(t, 'Revenue', 3, ops, 'Cost of revenue', thousands=True, width=5),
        'opIncome': row(t, 'Operating income', 3, ops, 'Interest and other income', thousands=True, width=5),
        'netIncome': row(t, 'Net income', 3, ops, 'Net income per share', thousands=True, width=5),
        'gm': row(t, ('Non-GAAP gross margin(1)', 'Non-GAAP gross margin (1)', 'Non-GAAP gross margin'), 3, rec, 'GAAP operating income', unit='percent', width=5),
        'opIncomeNonGaap': row(t, 'Non-GAAP operating income', 3, rec, 'GAAP operating margin', thousands=True, width=5),
        'opMarginGaap': row(t, 'GAAP operating margin', 3, rec, 'Non-GAAP operating margin', unit='percent', width=5),
        'opMargin': row(t, 'Non-GAAP operating margin', 3, rec, 'GAAP net income', unit='percent', width=5),
        'epsGaap': row(t, 'GAAP - diluted', 3, rec, 'Non-GAAP - diluted', unit='per-share', width=5),
        'eps': row(t, 'Non-GAAP - diluted', 3, rec, 'Weighted average shares', unit='per-share', width=5),
        'sbc': row(t, 'Total stock-based compensation expense', 3, sbc, None, thousands=True, width=5),
        'receivables': row(t, 'Accounts receivable, net', 2, bs, 'Inventory', thousands=True),
        'inventory': row(t, 'Inventory', 2, bs, 'Prepaid expenses', thousands=True),
        'cfo': row(t, 'Net cash provided by operating activities', 2, cf, 'Cash flows from investing', thousands=True),
        'leader': sentence(t, r'(Scorpio)\S* fabric switches became the company.s largest product family', (1,), unit='text'),
        'ariesSampling': sentence(t, r'Aries 7 products are expected to begin sampling in (Q[1-4] 20\d\d)', (1,), unit='text'),
        'orion': sentence(t, r'on track for availability through .{0,60}? beginning in (Q[1-4] 20\d\d)', (1,), unit='text'),
        'guidanceRevenue': sentence(t, r'Revenue within a range of \$([\d,.]+) million to \$([\d,.]+) million', (1, 2)),
        'guidanceGm': sentence(t, r'Non-GAAP gross margin of approximately ([\d.]+)%', (1,), unit='percent'),
        'guidanceEps': sentence(t, r'Non-GAAP diluted net income per share of approximately \$([\d.]+) to \$([\d.]+)', (1, 2), unit='per-share'),
    }


def lumentum(t):
    gaap, non, mix = 'GAAP Results', 'Non-GAAP Results', 'Net Revenue by Product Type'
    bs, rec = 'CONDENSED CONSOLIDATED BALANCE SHEETS', 'RECONCILIATION OF GAAP MEASURES TO NON-GAAP MEASURES'
    return {   # this quarter, the previous quarter, a year earlier, then the two changes
        'revenue': row(t, 'Net revenue', 3, gaap, non, width=5),
        'gmGaap': row(t, 'GAAP gross margin', 3, gaap, non, unit='percent', width=5),
        'opMarginGaap': row(t, 'GAAP operating margin', 3, gaap, non, unit='percent', width=5),
        'gm': row(t, 'Non-GAAP gross margin', 3, non, mix, unit='percent', width=5),
        'opMargin': row(t, 'Non-GAAP operating margin', 3, non, mix, unit='percent', width=5),
        'components': row(t, 'Components', 6, mix, 'Systems'),       # this quarter, % of revenue, previous quarter, a year earlier, changes
        'systems': row(t, 'Systems', 6, mix, 'Total'),
        'eps': row(t, 'Net income per share on non-GAAP basis', 3, rec, 'Shares used in per share calculation', unit='per-share'),
        'netIncome': row(t, 'Net income (loss) on GAAP basis', 3, rec, 'Net income on non-GAAP basis'),
        'debtLoss': row(t, 'Loss on debt extinguishment', 3, 'Total other income (expense), net on GAAP basis', 'Inducement expense'),
        'cashChange': sentence(t, r'held \$([\d.]+) billion in total cash, cash equivalents, and short-term investments at the end of the [^,]{0,80}, a (decrease|increase) of \$([\d.,]+) million',
                               (1, 2, 3), unit='text'),
        'ppe': row(t, 'Property, plant and equipment, net', 2, bs, 'Operating lease'),
        'inventories': row(t, 'Inventories', 2, bs, 'Prepayments'),
        'receivables': row(t, 'Accounts receivable, net', 2, bs, 'Accrued accounts receivable'),
        'debtCurrent': row(t, 'Current portion of long-term debt', 2, bs, 'Operating lease liabilities, current'),
        'leaders': sentence(t, r'with ([a-z ]+?) and ([a-z ]+?) \((OCS)\) being the leading contributors', (1, 2, 3), unit='text'),
        'win': sentence(t, r'secured our (first|second|third|fourth) major (NPO/CPO) win, backed by purchase commitments exceeding \$([\d.]+) billion', (1, 2, 3), unit='text'),
        'sequential': sentence(t, r'we anticipate adding approximately \$([\d,]+) million in sequential growth', (1,), unit='text'),
        'guidanceRevenue': sentence(t, r'Net revenue in the range of \$([\d.]+) billion to \$([\d.]+) billion', (1, 2), multipliers=[1000, 1000]),
        'guidanceOpMargin': sentence(t, r'Non-GAAP operating margin of ([\d.]+)% to ([\d.]+)%', (1, 2), unit='percent'),
        'guidanceEps': sentence(t, r'Non-GAAP diluted earnings per share of \$([\d.]+) to \$([\d.]+)', (1, 2), unit='per-share'),
    }


SPECS = {'CRDO': credo, 'MRVL': marvell, 'AVGO': broadcom, 'AMD': amd, 'ANET': arista, 'PLTR': palantir, 'ALAB': astera, 'LITE': lumentum}


# ---- foreign issuers whose results come as several exhibits of one 6-K (release, presentation, financial statements) ---------

def pick(docs, marker):
    """(url, flat text) of the first exhibit that contains `marker`; (None, '') when none does."""
    for url, text in docs:
        if marker in text:
            return url, text
    return None, ''


def located(url, figures):
    for fig in figures.values():
        if fig is not None:
            fig.url = url
    return figures


QUARTER = r'(?:first|second|third|fourth)'


def tsmc(docs):
    u1, t1 = pick(docs, 'consolidated results')
    u2, t2 = pick(docs, 'Selected Items from Statements of Comprehensive Income')
    out = located(u1, {
        'revenue': row(t1, 'Net sales', 5, 'consolidated results', 'Gross profit'),   # this quarter, a year earlier, YoY %, previous quarter, QoQ %
        'netIncome': row(t1, 'Net income', 5, 'Income before tax', 'EPS'),
        'eps': sentence(t1, r'EPS \(NT\$\) ([\d.]+)', (1,), unit='per-share'),
        'usd': sentence(t1, r'In US dollars, ' + QUARTER + r' quarter revenue was \$([\d.]+) billion, which increased ([\d.]+)% year-over-year and increased ([\d.]+)% from the previous quarter',
                        (1, 2, 3), multipliers=[1000, None, None]),
        'yoy': sentence(t1, r'Year-over-year, ' + QUARTER + r' quarter revenue increased ([\d.]+)%', (1,), unit='percent'),
        'nodes': sentence(t1, r'shipments of 2-nanometer accounted for (\d+)% of total wafer revenue; 3-nanometer accounted for (\d+)%; 5-nanometer accounted for (\d+)%; and 7-nanometer accounted for (\d+)%',
                          (1, 2, 3, 4), unit='percent'),
        'advanced': sentence(t1, r'Advanced technologies, defined as 7-nanometer and more advanced technologies, accounted for (\d+)% of total wafer revenue', (1,), unit='percent'),
        'guidance': sentence(t1, r'Revenue is expected to be between US\$([\d.]+) billion and US\$([\d.]+) billion; And, based on the exchange rate assumption of 1 US dollar to ([\d.]+) NT dollars,',
                             (1, 2, 3), unit='text'),
        'guidanceMargins': sentence(t1, r'Gross profit margin is expected to be between (\d+)% and (\d+)%; .?Operating profit margin is expected to be between ([\d.]+)% and ([\d.]+)%',
                                    (1, 2, 3, 4), unit='percent'),
    })
    out.update(located(u2, {
        'gm': sentence(t2, r'Gross Margin ([\d.]+)% ([\d.]+)%-([\d.]+)% ([\d.]+)% ([\d.]+)%', (1, 2, 3, 4, 5), unit='percent'),   # this, guidance low-high, previous, year ago
        'om': sentence(t2, r'Operating Margin ([\d.]+)% ([\d.]+)%-([\d.]+)% ([\d.]+)% ([\d.]+)%', (1, 2, 3, 4, 5), unit='percent'),
        'nonOperating': row(t2, 'Non-Operating Items', 3, 'Selected Items', 'Net Income', width=5),
        'netMargin': row(t2, 'Net Profit Margin', 3, 'Selected Items', 'EPS', unit='percent', width=5),
        'shipments': sentence(t2, r'Shipment \(Kpcs, 12"-equiv\. Wafer\) ([\d,]+) ([\d,]+) ([\d,]+) \+?(-?[\d.]+)%', (1, 2, 3, 4), unit='text'),
        'ocf': row(t2, 'Cash from operating activities', 3, 'Beginning Balance', 'Ending Balance'),
        'capex': row(t2, 'Capital expenditures', 3, 'Beginning Balance', 'Ending Balance'),
        'fcf': row(t2, 'Free Cash Flow *', 3, 'Cash Flows', '4Q'),
        'fullYear': sentence(t2, r'(20\d\d) revenue to increase by around (\d+)% in US dollar terms', (1, 2), unit='text'),
    }))
    return out


def asml(docs):
    u1, t1 = pick(docs, '(Figures in millions of euros')
    u2, t2 = pick(docs, 'results Veldhoven')
    u3, t3 = pick(docs, 'Quarterly Summary US GAAP Consolidated Statements of Operations Three months ended')
    head = '(Figures in millions of euros'
    out = located(u1, {
        'revenue': row(t1, 'Total net sales', 2, head, 'Numbers have been rounded'),           # previous quarter, this quarter
        'ibm': row(t1, 'Installed Base Management sales1', 2, head, 'Numbers have been rounded'),
        'systems': row(t1, 'New lithography systems sold (units)', 2, head, 'Numbers have been rounded'),
        'gm': row(t1, 'Gross margin (%)', 2, head, 'Numbers have been rounded', unit='million'),
        'netIncome': row(t1, 'Net income', 2, head, 'Numbers have been rounded'),
        'eps': row(t1, 'EPS (basic; in euros)', 2, head, 'Numbers have been rounded', unit='per-share'),
        'guidance': sentence(t1, r'We expect ' + QUARTER + r'-quarter (20\d\d) total net sales between €([\d.]+) billion and €([\d.]+) billion, with a gross margin around (\d+)%',
                             (1, 2, 3, 4), unit='text'),
        'fullYear': sentence(t1, r'We expect total net sales for (20\d\d) to be between €(\d+) billion and €(\d+) billion, with a gross margin around (\d+)%', (1, 2, 3, 4), unit='text'),
        'supply': sentence(t1, r'our supply as currently planned for both (20\d\d) and (20\d\d) will not fully meet the demand of our customers', (1, 2), unit='text'),
        'capacity': sentence(t1, r'investigating ways to increase capacity for (20\d\d) beyond the (\d+)% increase we previously communicated', (1, 2), unit='text'),
        'orders': sentence(t1, r'placing orders with us for (20\d\d) and even (20\d\d)', (1, 2), unit='text'),
    })
    out.update(located(u2, {'history': row(t2, 'Total net sales', 5, 'Total net sales', None)}))
    out.update(located(u3, {
        'om': row(t3, 'Income from operations as a percentage of net sales', 5, 'Quarterly Summary US GAAP Consolidated Statements of Operations Three months ended', 'Net income as a percentage', unit='percent'),
        'equityGain': row(t3, 'Gain (loss) on equity investments', 4, 'Income from operations', 'Interest and other'),
        'contractLiabilities': row(t3, 'Contract liabilities', 2, 'Summary US GAAP Consolidated Balance Sheets', 'Accrued and other liabilities'),
    }))
    return out


DOC_SPECS = {'TSM': tsmc, 'ASML': asml}


def read_docs(ticker, docs):
    """Figures from all the exhibits of a results filing: [(url, text), ...]."""
    spec = DOC_SPECS.get(ticker)
    if not spec:
        return {}
    flat = [(u, ' '.join((t or '').split())) for u, t in docs]
    return {k: v for k, v in spec(flat).items() if v is not None}


# ---- the quarterly report (10-Q): figures only it carries, read when it is filed -------------------------------------------

MONTHS = r'(?:January|February|March|April|May|June|July|August|September|October|November|December)'


def credo_report(t):
    return {
        'customerA': row(t, 'Customer A', 2, 'Ended Revenue', 'Customer B', unit='percent'),
        'customerB': row(t, 'Customer B', 2, 'Ended Revenue', '*', unit='percent', exact=False),  # the 10-Q's page number follows
        'acquisition': latest(t, r'On (' + MONTHS + r' \d{1,2}, 20\d\d), the Company acquired (?:100\s?% of the equity interest of )?([A-Z][A-Za-z]+).{0,250}?'
                                 r'total purchase consideration of \$\s?([\d.]+) (billion|million)', (1, 2, 3, 4)),
    }


def latest(t, pattern, groups):
    """Of the dated statements `pattern` matches (a 10-Q note lists this quarter's acquisition and earlier ones), the one with the latest
    date (group 1), read as text; None when two statements share that date."""
    from datetime import datetime
    found = [(datetime.strptime(m.group(1).replace(',', ''), '%B %d %Y'), m) for m in re.finditer(pattern, t, re.I)]
    if not found:
        return None
    top = max(d for d, _ in found)
    picked = [m for d, m in found if d == top]
    if len(picked) != 1:
        return None
    return sentence(picked[0].group(0), pattern, groups, unit='text')


def broadcom_report(t):
    semis = row(t, 'Semiconductor solutions: Net revenue', 2, '(In millions)', 'Infrastructure software:', width=4)
    soft = row(t, 'Infrastructure software: Net revenue', 2, '(In millions)', 'Total:', width=4)
    return {
        'semisReport': semis,
        'semisOpIncome': row(t, 'Operating income', 2, 'Semiconductor solutions: Net revenue', 'Infrastructure software:', width=4),
        'softwareReport': soft,
        'softwareOpIncome': row(t, 'Operating income', 2, 'Infrastructure software: Net revenue', 'Total:', width=4),
        'topFive': sentence(t, r'top five end customers, through all channels, accounted for approximately (\d+)\s?% and (\d+)\s?% of our net revenue for the fiscal quarter'
                               r'[^.]{0,120}?approximately (\d+)\s?%', (1, 2, 3), unit='percent'),
        'distributor': sentence(t, r'which is a distributor, accounted for (\d+)\s?% and (\d+)\s?% of our net revenue for the fiscal quarter and three fiscal quarters ended '
                                   + MONTHS + r' \d{1,2}, 20\d\d, respectively, and (\d+)\s?% and (\d+)\s?%', (1, 2, 3, 4), unit='percent'),
    }


def arista_report(t):
    return {
        'commitments': sentence(t, r'As of (' + MONTHS + r' \d{1,2}, 20\d\d), we had non-cancellable purchase commitments not recorded on our balance sheet of \$ ?([\d.]+) billion, '
                                   r'of which \$ ?([\d.]+) billion have expected receipt dates within 12 months', (1, 2, 3), unit='text'),
        'customers': sentence(t, r'Sales to one end customer represented (\d+)%, (\d+)%, and (\d+)% of our total revenue, and sales to the other end customer represented '
                                 r'(\d+)%, (\d+)%, and (\d+)% of our total revenue for the years ended December 31, (20\d\d)', (1, 4, 7), unit='text'),
        'inventoryRisk': sentence(t, r'we expect inventory and purchase commitments to remain (elevated) and subject to volatility as a result of', (1,), unit='text'),
    }


REPORT_SPECS = {'CRDO': credo_report, 'AVGO': broadcom_report, 'ANET': arista_report}


def read_report(ticker, text):
    spec = REPORT_SPECS.get(ticker)
    if not spec:
        return {}
    flat = ' '.join((text or '').split())
    return {k: v for k, v in spec(flat).items() if v is not None}


# ---- other filings of the quarter: a deal (8-K Item 1.01 / 2.01) and a preliminary result (Item 2.02 without the tables) ------

def deal(text):
    """The terms a merger or acquisition release states, each with its own sentence; {} when it states none of them."""
    flat = ' '.join((text or '').split())
    out = {
        'exchangeRatio': sentence(flat, r'fixed exchange ratio of ([\d.]+) shares of ([A-Z][A-Za-z]+) common stock for each share of ([A-Z][A-Za-z]+) common stock',
                                  (1, 2, 3), unit='text'),
        'ownership': sentence(flat, r'current ([A-Z][A-Za-z]+) stockholders will own approximately (\d+)% of the combined company[^.]{0,80}?while ([A-Z][A-Za-z]+) stockholders will own approximately (\d+)%',
                              (1, 2, 3, 4), unit='text'),
        'close': sentence(flat, r'expected to close in the (first|second) half of calendar year (20\d\d)', (1, 2), unit='text'),
        'accretive': sentence(flat, r'expected to be accretive to ([A-Z][A-Za-z]+) non-GAAP earnings per share in year one', (1,), unit='text'),
        'allStock': sentence(flat, r'in an (all-stock) transaction', (1,), unit='text'),
        'preliminary': sentence(flat, r'reported preliminary revenue for the (first|second|third|fourth) quarter of fiscal (20\d\d) consistent with previously provided guidance, '
                                      r'maintaining the midpoint of its prior guidance while narrowing the expected range to plus or minus (\d+)%', (1, 2, 3), unit='text'),
    }
    return {k: v for k, v in out.items() if v is not None}


def read(ticker, text):
    """{name: Figure} read from the release text (whitespace-collapsed), only the figures that were read exactly."""
    spec = SPECS.get(ticker)
    if not spec:
        return {}
    flat = ' '.join((text or '').split())
    return {k: v for k, v in spec(flat).items() if v is not None}
