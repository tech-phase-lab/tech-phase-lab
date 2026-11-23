"""More figures from the company's own results release (owner, Nov 23: the results card showed revenue and EPS only and was "unusable").

The table parsers (issuer_result_flash) stay the source of the headline figures. This adds, from the same release text, only what the
release states in fixed wording: non-GAAP (adjusted) EPS and net income, free cash flow, operating cash flow, ending ARR, Data Center
revenue, the GAAP gross margin, and the company's own guidance (next quarter and full year: revenue and adjusted EPS).

Rules (no model, no estimate):
- a figure is read only where its label, its number and its unit stand together in one sentence or one guidance-table row;
- a figure the release states twice with different values is ambiguous and left out;
- a key the table parser already gave is never replaced;
- the prior-year figure is kept only when the same sentence states it ("compared to $283.6 million");
- a stated growth rate ("grew 25% year-over-year") is kept as the release states it.
"""
import re
from decimal import Decimal

import issuer_result_flash as flash

AMOUNT = r'\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?(billion|million)\b'
PER_SHARE = r'\$(\d+\.\d{2})\b'
PRIOR_AMOUNT = r'(?:,? compared to (a (?:net )?loss of )?' + AMOUNT + r')?'
PRIOR_SHARE = r'(?:,? compared to (a (?:net )?loss of )?' + PER_SHARE + r')?'
GAP = r'[^$.;•]{0,120}?'

LABELS = {
    'adjusted-eps': ('調整後EPS', 'Adjusted EPS'),
    'adjusted-net-income': ('調整後純利益', 'Adjusted net income'),
    'free-cash-flow': ('フリーキャッシュフロー', 'Free cash flow'),
    'operating-cash-flow': ('営業キャッシュフロー', 'Operating cash flow'),
    'arr': ('ARR', 'ARR'),
    'data-center-revenue': ('データセンター売上高', 'Data Center revenue'),
    'gross-margin': ('粗利益率', 'Gross margin'),
}

# key, pattern, kind ('amount' | 'share' | 'percent'). Groups: value [+ unit], then optional prior (loss flag, value [, unit]).
SENTENCES = (
    ('adjusted-eps', re.compile(r'(?i:non-GAAP (?:diluted )?(?:net income|earnings) per (?:diluted )?share)' + GAP + r' (?:was|of) '
                                + PER_SHARE + PRIOR_SHARE), 'share'),
    ('adjusted-net-income', re.compile(r'(?i:non-GAAP net income)(?: attributable to [A-Za-z .,]{1,40}?)? (?:was|of) ' + AMOUNT
                                       + PRIOR_AMOUNT), 'amount'),
    ('free-cash-flow', re.compile(r'(?i:free cash flow) (?:was|totaled) ' + AMOUNT + PRIOR_AMOUNT), 'amount'),
    ('operating-cash-flow', re.compile(r'(?i:net cash (?:generated|provided) (?:from|by) operat(?:ions|ing activities)|cash flow from operations)'
                                       r' (?:was|totaled) ' + AMOUNT + PRIOR_AMOUNT), 'amount'),
    ('data-center-revenue', re.compile(r'(?<![A-Za-z])Data Center revenue (?:of|was) ' + AMOUNT + r'(?:, up (\d+)% from a year ago)?'), 'amount'),
    ('gross-margin', re.compile(r'(?<![A-Za-z-])GAAP gross margin (?:was|of) (\d+(?:\.\d+)?)%(?:, compared to (\d+(?:\.\d+)?)%)?'), 'percent'),
)
ARR = re.compile(r'(?i:(?:ending )?(?:annual recurring revenue(?: \(ARR\))?|ARR)) (?:grew|increased|rose) (\d+(?:\.\d+)?)%'
                 r' (?:year[- ]over[- ]year )?to ' + AMOUNT)

# Guidance table: "Q3 FY27 Guidance Full Year FY27 Guidance  Total revenue $1,523.2 - $1,529.2 million $5,991.1 - $6,011.1 million ..."
TABLE_HEAD = re.compile(r'\b(Q[1-4] FY\s?\d{2,4}) Guidance(?: (Full Year FY\s?\d{2,4}) Guidance)?\b')
CELL = r'\$\s?([\d,]+(?:\.\d+)?)(?: ?[-–] ?\$\s?([\d,]+(?:\.\d+)?))?(?: (million|billion))?'
TABLE_ROWS = (('revenue', r'Total revenue'), ('adjusted-eps', r'Non-GAAP net income per share[^$]{0,120}?diluted(?: \(\d\))*'))
# Sentence guidance: "Revenue is expected to be $108.0 billion, plus or minus 2%" / "revenue in the range of $1.52 billion to $1.53 billion"
OUTLOOK_PLUS_MINUS = re.compile(r'(?<![A-Za-z])Revenue is expected to be ' + AMOUNT + r', plus or minus (\d+(?:\.\d+)?)%')
OUTLOOK_RANGE = re.compile(r'(?i:(?:total )?revenue) (?:is expected to be |expected to be |of )?(?:in the range of|between) '
                           + AMOUNT.replace(r'\s?(billion|million)\b', r'\s?(billion|million)?') + r' (?:and|to|-) ' + AMOUNT)


OUTLOOK_HEADING = re.compile(r'(?:Financial|Business) Outlook\b|\bOutlook(?=[A-Z•:])')


def millions(number, unit):
    value = Decimal(number.replace(',', ''))
    return value * 1000 if unit and unit.lower() == 'billion' else value


def short(year_label):
    """'FY27' / 'FY 2027' -> 'FY27'."""
    digits = re.sub(r'\D', '', year_label)
    return 'FY' + digits[-2:]


def one(matches):
    """The single value the release states (several identical statements count once); None when it states different values."""
    values = {m for m in matches}
    return next(iter(values)) if len(values) == 1 else None


def sentence_facts(head):
    found = []
    for key, pattern, kind in SENTENCES:
        rows = []
        for m in pattern.finditer(head):
            g = m.groups()
            if kind == 'share':
                value = flash.per_share(Decimal(g[0]))
                prior = None if g[2] is None else flash.per_share(-Decimal(g[2]) if g[1] else Decimal(g[2]))
                rows.append((value, prior, None))
            elif kind == 'amount' and key == 'data-center-revenue':
                rows.append((flash.money_millions(millions(g[0], g[1])), None, ('+' + g[2] + '%') if g[2] else None))
            elif kind == 'amount':
                value = flash.money_millions(millions(g[0], g[1]))
                prior = None
                if g[3] is not None:
                    amount = millions(g[3], g[4])
                    prior = flash.money_millions(-amount if g[2] else amount)
                rows.append((value, prior, None))
            else:
                rows.append((g[0] + '%', (g[1] + '%') if g[1] else None, None))
        picked = one(rows) if rows else None
        if picked is None and rows and len({r[0] for r in rows}) == 1:
            picked = (rows[0][0], None, None)  # the same figure, once with its comparison and once without: keep the figure only
        if picked:
            found.append((key, *picked))
    arr = {(flash.money_millions(millions(m[2], m[3])), '+' + m[1] + '%') for m in ARR.finditer(head)}
    if len(arr) == 1:
        value, growth = next(iter(arr))
        found.append(('arr', value, None, growth))
    return found


def table_guidance(text):
    heads = list(TABLE_HEAD.finditer(text))
    if len(heads) != 1:
        return []
    head = heads[0]
    columns = [head[1]] + ([head[2]] if head[2] else [])
    block = text[head.end():head.end() + 2500]
    out = []
    for key, label in TABLE_ROWS:
        rows = re.findall(r'(?<![A-Za-z])' + label + r' ' + ' '.join([CELL] * len(columns)) + r'(?= |$)', block)
        if len(rows) != 1:
            continue
        cells = [rows[0][i * 3:(i + 1) * 3] for i in range(len(columns))]
        for index, (low, high, unit) in enumerate(cells):
            if key == 'revenue':
                if not unit:
                    break
                lo, hi = millions(low, unit), millions(high or low, unit)
                if lo <= 0 or hi < lo:
                    break
                value = flash.money_millions(lo) if lo == hi else flash.money_millions(lo) + '-' + flash.money_millions(hi)
            else:
                if unit or '.' not in low or (high and '.' not in high):
                    break
                lo, hi = Decimal(low), Decimal(high or low)
                if hi < lo:
                    break
                value = flash.per_share(lo) if lo == hi else flash.per_share(lo) + '-' + flash.per_share(hi)
            quarter = index == 0
            span = columns[index].split()[0] + ' ' + short(columns[index]) if quarter else short(columns[index])
            name = {'revenue': ('売上高', 'revenue'), 'adjusted-eps': ('調整後EPS', 'adjusted EPS')}[key]
            ja = f'会社予想 {name[0]}（{span}）' if quarter else f'会社予想 通期{name[0]}（{span}）'
            en = f'Guidance {name[1]} ({span})' if quarter else f'Full-year guidance {name[1]} ({span})'
            out.append(('guidance-' + ('' if quarter else 'fy-') + key, value, None, None, (ja, en)))
    return out


def sentence_guidance(text):
    plus_minus = {(flash.money_millions(millions(m[1], m[2])), m[3]) for m in OUTLOOK_PLUS_MINUS.finditer(text)}
    if len(plus_minus) == 1:
        value, band = next(iter(plus_minus))
        return [('guidance-revenue', f'{value} ± {band}%', None, None, ('会社予想 売上高（次四半期）', 'Guidance revenue (next quarter)'))]
    ranges = set()
    for m in OUTLOOK_RANGE.finditer(text):
        sentence = text[max(0, m.start() - 200):m.start()]
        sentence = sentence[sentence.rfind('.') + 1:]
        if re.search(r'(?i)full[- ]year|fiscal (?:year )?20\d\d\b(?! (?:first|second|third|fourth) quarter)', sentence):
            continue
        unit = m[4]
        lo, hi = millions(m[1], m[2] or unit), millions(m[3], unit)
        if 0 < lo < hi:
            ranges.add(flash.money_millions(lo) + '-' + flash.money_millions(hi))
    if len(ranges) == 1:
        return [('guidance-revenue', ranges.pop(), None, None, ('会社予想 売上高（次四半期）', 'Guidance revenue (next quarter)'))]
    return []


def supplement(text, parsed):
    """`parsed` with the extra figures appended (keys it already has are kept as they are). Never raises: on any error the
    table parser's result is returned unchanged."""
    try:
        flat = ' '.join((text or '').split())
        outlook = OUTLOOK_HEADING.search(flat)
        head = flat[:outlook.start()] if outlook else flat[:12000]
        have = {f[0] for f in parsed['facts']}
        extra = []
        for fact in sentence_facts(head) + table_guidance(flat) + ([] if 'guidance-revenue' in have else sentence_guidance(flat)):
            if fact[0] in have or fact[0] in {e[0] for e in extra}:
                continue
            if fact[0] == 'guidance-revenue' and 'guidance-revenue' in have:
                continue
            extra.append(fact)
        if not extra:
            return parsed
        facts = list(parsed['facts'])
        # results figures go before the outlook, the outlook stays last
        at = next((i for i, f in enumerate(facts) if f[0].startswith('guidance-') or f[0] == 'capex-guidance'), len(facts))
        for key, value, prior, growth, *labels in extra:
            ja, en = labels[0] if labels else LABELS[key]
            fact = (key, value, prior, (ja, en), growth) if growth else (key, value, prior, (ja, en))
            if key.startswith('guidance-'):
                facts.append(fact)
            else:
                facts.insert(at, fact)
                at += 1
        return {**parsed, 'facts': facts[:16]}
    except Exception:  # noqa: BLE001 - the extra figures never take the headline figures down
        return parsed
