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

CELL = re.compile(r'\(?-?\$?\s?\d[\d,]*(?:\.\d+)?\)?\s?%?|—')


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
    text = cell.strip().replace('$', '').replace('%', '').replace(',', '').replace(' ', '')
    if text == '—':
        return Decimal(0), '0'
    negative = text.startswith('(') and text.endswith(')')
    text = text.strip('()')
    value = Decimal(text)
    return (-value if negative else value), text


def row(text, label, columns, after=None, before=None, unit='million', thousands=False):
    """The `columns` numbers right after `label` (a whole label, once) inside the table that starts at `after`; None if not exactly so.
    `label` may be a tuple of the wordings a company uses in different quarters ("Net income" / "Net income (loss)"): the first that reads."""
    if isinstance(label, tuple):
        for one in label:
            found = row(text, one, columns, after, before, unit, thousands)
            if found:
                return found
        return None
    start = text.find(after) if after else 0
    if start < 0:
        return None
    end = text.find(before, start + len(after or '')) if before else -1
    area = text[start:end if end > 0 else len(text)]
    hits = [m for m in re.finditer(r'(?<![A-Za-z-])' + re.escape(label) + r'(?=\s*[$(\d—])', area)]
    if not hits:
        return None
    m = hits[0]
    rest = area[m.end():m.end() + 400]
    cells, at = [], 0
    for _ in range(columns):
        c = CELL.match(rest, at + (len(rest[at:]) - len(rest[at:].lstrip())))
        if not c:
            return None
        cells.append(c.group())
        at = c.end()
    try:
        parsed = [_number(c) for c in cells]
    except ArithmeticError:
        return None
    quote = (label + rest[:at]).strip()
    if unit == 'percent' and not all('%' in c or c.strip() == '—' for c in cells):
        return None
    scale = '/ 1000' if thousands and unit == 'million' else ''
    values = [v / 1000 if scale else v for v, _ in parsed]
    return Figure(values=values, quote=quote, raws=[r for _, r in parsed], scale=scale, unit=unit)


def sentence(text, pattern, groups, unit='million', multipliers=None):
    """Figures from one outlook sentence: the regex `pattern`'s groups as printed, times `multipliers` (1000 for billions, per group)."""
    m = re.search(pattern, text, re.I)
    if not m:
        return None
    raws = [m.group(g).replace(',', '') for g in groups]
    muls = list(multipliers or [None] * len(raws))
    values = list(raws) if unit == 'text' else [Decimal(r) * (k or 1) for r, k in zip(raws, muls)]
    return Figure(values=values, quote=text[m.start():m.end()].strip(), raws=raws, unit=unit, muls=muls)


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
        'revenue': row(t, 'Net revenue', 3, ops, 'Cost of goods sold'),
        # the year-end release (Q4) words these rows with "(loss)" (Feb 2026): both wordings are read
        'netIncome': row(t, ('Net income', 'Net income (loss)'), 3, 'Provision', ('Net income per share' if 'Net income per share' in t else 'Net income (loss) per share')),
        'epsGaap': row(t, ('GAAP diluted net income per share', 'GAAP diluted net income (loss) per share'), 3, 'Other income tax effects', '(a)', unit='per-share'),
        'eps': row(t, 'Non-GAAP diluted net income per share', 3, 'Other income tax effects', '(a)', unit='per-share'),
        'gmGaap': row(t, 'GAAP gross margin', 3, rec, 'Non-GAAP gross margin', unit='percent'),
        'gm': row(t, 'Non-GAAP gross margin', 3, rec, 'GAAP operating expenses', unit='percent'),
        'opMargin': row(t, 'Non-GAAP operating margin', 3, rec, 'GAAP interest', unit='percent'),
        'netIncomeNonGaap': row(t, 'Non-GAAP net income', 3, 'Other income tax effects', 'GAAP weighted-average'),
        'dataCenter': row(t, 'Data center', 3, end, share),
        'communications': row(t, 'Communications and other', 3, end, share),
        'dataCenterShare': row(t, 'Data center', 3, share, 'For further information', unit='percent'),
        'guidanceRevenue': sentence(t, r'Net revenue is expected to be \$([\d.]+) billion \+/- ([\d.]+)%', (1, 2), multipliers=[1000, None]),
        'guidanceGm': sentence(t, r'Non-GAAP gross margin is expected to be ([\d.]+)% to ([\d.]+)%', (1, 2), unit='percent'),
        'guidanceEps': sentence(t, r'Non-GAAP diluted net income per share is expected to be \$([\d.]+) \+/- \$([\d.]+)', (1, 2), unit='per-share'),
    }


def broadcom(t):
    hl, rec = 'Financial Highlights', 'Gross margin on GAAP basis'
    seg = 'Net revenue by segment'
    return {
        'revenue': row(t, 'Net revenue', 3, 'CONDENSED CONSOLIDATED STATEMENTS OF OPERATIONS', 'Cost of'),
        'grossProfitNonGaap': row(t, 'Gross margin on non-GAAP basis', 3, rec, 'Research and development on GAAP'),
        'opIncomeNonGaap': row(t, 'Operating income on non-GAAP basis', 3, rec, 'Interest expense on GAAP'),
        # the highlights table: GAAP this quarter, a year earlier, change, then non-GAAP the same (no previous-quarter column)
        'epsBoth': sentence(t, r'Earnings per common share - diluted \$ ([\d.]+) \$ ([\d.]+) [+-]?\d+ ?% \$ ([\d.]+) \$ ([\d.]+)', (1, 2, 3, 4), unit='per-share'),
        'fcf': row(t, 'Free cash flow', 3, 'Net cash provided by operating activities $', '(1)'),
        'semis': row(t, 'Semiconductor solutions', 4, seg, 'Infrastructure software'),
        'software': row(t, 'Infrastructure software', 4, seg, 'Total net revenue'),
        'ai': sentence(t, r'AI semiconductor revenue of \$([\d.]+) billion grew (\d+)% year-over-year, and (\d+)% quarter-over-quarter', (1, 2, 3),
                       multipliers=[1000, None, None]),
        'guidanceRevenue': sentence(t, r'quarter revenue guidance of approximately \$([\d.]+) billion', (1,), multipliers=[1000]),
        'guidanceAi': sentence(t, r'expect AI semiconductor revenue to accelerate to \$([\d.]+) billion', (1,), multipliers=[1000]),
        'guidanceOpMargin': sentence(t, r'non-GAAP operating income guidance of approximately (\d+) percent of projected revenue', (1,), unit='percent'),
        'fcfShare': sentence(t, r'\$([\d.]+) billion of free cash flow, or (\d+) percent of revenue', (1, 2), multipliers=[1000, None]),
    }


SPECS = {'CRDO': credo, 'MRVL': marvell, 'AVGO': broadcom}


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
        'nonOperating': row(t2, 'Non-Operating Items', 3, 'Selected Items', 'Net Income'),
        'netMargin': row(t2, 'Net Profit Margin', 3, 'Selected Items', 'EPS', unit='percent'),
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
        'customerB': row(t, 'Customer B', 2, 'Ended Revenue', '*', unit='percent'),
        'acquisition': sentence(t, r'On (' + MONTHS + r' \d{1,2}, 20\d\d), the Company acquired (?:100\s?% of the equity interest of )?([A-Z][A-Za-z]+).{0,250}?'
                                r'total purchase consideration of \$\s?([\d.]+) (billion|million)', (1, 2, 3, 4), unit='text'),
    }


def broadcom_report(t):
    semis = row(t, 'Semiconductor solutions: Net revenue', 2, '(In millions)', 'Infrastructure software:')
    soft = row(t, 'Infrastructure software: Net revenue', 2, '(In millions)', 'Total:')
    return {
        'semisReport': semis,
        'semisOpIncome': row(t, 'Operating income', 2, 'Semiconductor solutions: Net revenue', 'Infrastructure software:'),
        'softwareReport': soft,
        'softwareOpIncome': row(t, 'Operating income', 2, 'Infrastructure software: Net revenue', 'Total:'),
        'topFive': sentence(t, r'top five end customers, through all channels, accounted for approximately (\d+)\s?% and (\d+)\s?% of our net revenue for the fiscal quarter'
                               r'[^.]{0,120}?approximately (\d+)\s?%', (1, 2, 3), unit='percent'),
        'distributor': sentence(t, r'which is a distributor, accounted for (\d+)\s?% and (\d+)\s?% of our net revenue for the fiscal quarter and three fiscal quarters ended '
                                   + MONTHS + r' \d{1,2}, 20\d\d, respectively, and (\d+)\s?% and (\d+)\s?%', (1, 2, 3, 4), unit='percent'),
    }


REPORT_SPECS = {'CRDO': credo_report, 'AVGO': broadcom_report}


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
