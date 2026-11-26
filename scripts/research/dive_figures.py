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
    """The `columns` numbers right after `label` (a whole label, once) inside the table that starts at `after`; None if not exactly so."""
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
    values = [Decimal(r) * (k or 1) for r, k in zip(raws, muls)]
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
        'netIncome': row(t, 'Net income', 3, 'Provision for income taxes', 'Net income per share'),
        'epsGaap': row(t, 'GAAP diluted net income per share', 3, 'Other income tax effects', '(a)', unit='per-share'),
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


SPECS = {'CRDO': credo, 'MRVL': marvell}


def read(ticker, text):
    """{name: Figure} read from the release text (whitespace-collapsed), only the figures that were read exactly."""
    spec = SPECS.get(ticker)
    if not spec:
        return {}
    flat = ' '.join((text or '').split())
    return {k: v for k, v in spec(flat).items() if v is not None}
