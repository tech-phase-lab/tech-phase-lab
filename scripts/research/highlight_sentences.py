"""Results figures from the release's own highlight sentences, when no table parser reads it (owner, Nov 18).

For companies outside the deep-analysis roster a release the table parser cannot read showed only 「決算を発表しました」, although
the release states its revenue or EPS in plain sentences ("Q1 REVENUE OF $2.37B", "Revenue of $17.1 billion", "GAAP third quarter
2026 Net Income of $1,140 million", "$0.8B GAAP net income"). This reads only such sentences, with fixed patterns; no model.

- a figure is read only where its label, its number and its unit stand together at the start of one highlight sentence;
- GAAP and non-GAAP are kept apart (non-GAAP EPS becomes 調整後EPS; non-GAAP or adjusted revenue and net income are not read);
- a sentence about a full year, the year to date, a segment, or the outlook is not read;
- a figure stated twice with different values is ambiguous and left out;
- the release must name its quarter and say it is a results release in its first lines; otherwise nothing is read.
"""
import re
from decimal import Decimal

import issuer_result_flash as flash

METHOD = 'issuer-highlight-sentences'
HEAD = 4000  # the highlights come first; later text is tables, reconciliations and the outlook
RESULTS_HEAD = re.compile(r'(?i)\b(?:first|second|third|fourth|Q[1-4]|quarter(?:ly)?)\b.{0,120}\b(?:results|earnings|update)\b')
NOT_RESULTS_HEAD = re.compile(r'(?i)\bproduction,? deliveries\b|\bto combine\b|\bto acquire\b|\bmerger\b')


def results_head(head):
    """The first lines name a quarter's results, and no deliveries report or deal comes before or inside that headline
    (Constellation's highlights mention an acquisition after "THIRD QUARTER 2026 RESULTS"; Marvell's merger comes first)."""
    found = RESULTS_HEAD.search(head)
    other = NOT_RESULTS_HEAD.search(head)
    return bool(found) and not (other and other.start() < found.end())
QUARTER = r'(?:Q[1-4]|(?:first|second|third|fourth)[- ]quarter)'
START = r'(?:^|(?<=[•–;:])\s*|(?<=\.)\s+|(?<=Highlights)\s*)'
VALUE_FIRST = r'(?<![\w$.,])'  # a figure printed before its label ("$0.8B GAAP net income")
AMOUNT = r'\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(billion|million|B|M)\b'
NOT_QUARTER = re.compile(r'(?i)\bfull[- ]year\b|\byear[- ]to[- ]date\b|\b(?:six|nine|twelve) months\b|\bTTM\b')
OUTLOOK = re.compile(r'(?i)\b(?:expect|outlook|guidance|forecast|anticipat|project|target)')
PATTERNS = (
    # "Q1 REVENUE OF $2.37B", "Total quarterly revenue increased 66% sequentially to $228 million", "Revenue of $17.1 billion",
    # "Revenue for the first quarter of fiscal 2027 was $2.37 billion"
    ('revenue', re.compile(START + r'(?i:(?:total |quarterly |GAAP |' + QUARTER + r' (?:20\d\d )?)*revenues?'
                           r'(?: for the (?:first|second|third|fourth) quarter(?: of (?:fiscal )?(?:year )?20\d\d)?)?'
                           r'(?: of| was| were| totaled| reached)?:?'
                           r'(?: (?:increased|grew|rose|was up|up)[^$.;•]{0,40}? to)? )' + AMOUNT)),
    # "$X GAAP revenue" printed value first, as on Tesla's summary slide
    ('revenue', re.compile(VALUE_FIRST + AMOUNT + r' (?i:(?:GAAP )?(?:total )?revenues?)\b')),
    ('net-income', re.compile(START + r'(?i:(?:GAAP )?(?:' + QUARTER + r'(?: 20\d\d)? )?(?:GAAP )?net (income|loss)'
                              r'(?: attributable to [A-Za-z .,]{1,40}?)?(?: of| was|:)? )' + AMOUNT + r'(?! per)')),
    ('net-income', re.compile(VALUE_FIRST + AMOUNT + r' (?i:GAAP net (income|loss))\b')),
    ('operating-income', re.compile(VALUE_FIRST + AMOUNT + r' (?i:GAAP operating (income|loss))\b')),
    ('operating-income', re.compile(START + r'(?i:(?:GAAP )?(?:' + QUARTER + r'(?: 20\d\d)? )?(?:GAAP )?operating (income|loss)'
                                    r'(?: of| was|:)? )' + AMOUNT + r'(?! per)')),
    # "Q1 GAAP EPS OF $1.90", "Q1 NON-GAAP EPS OF $2.09", "diluted EPS of $0.57", "GAAP net income of $1.90 per diluted share"
    ('eps', re.compile(START + r'(?i:(?:' + QUARTER + r' )?(GAAP |non-GAAP )?(diluted )?(?:EPS|earnings per (?:diluted )?share)'
                       r'(?: \(EPS\))?(?: of| was|:)? )\$(\d+\.\d{2})\b')),
    ('eps', re.compile(START + r'(?i:(GAAP |non-GAAP )?()net income of )\$(\d+\.\d{2}) per (?:diluted )?share\b')),
    # Constellation: "GAAP Net Income of $5.19 per share and Adjusted (non-GAAP) Operating Earnings of $5.06 per share"
    ('eps', re.compile(r'(?:' + START + r'|(?<=per share and )|(?<=per diluted share and ))'
                       r'(?i:Adjusted \((non-GAAP)\)() Operating Earnings of )\$(\d+\.\d{2}) per (?:diluted )?share\b')),
)
LABELS = {
    'eps-diluted': flash.LABELS['eps'],
    'eps-gaap': ('EPS（GAAP）', 'GAAP EPS'),
    'adjusted-eps': ('調整後EPS（Non-GAAP）', 'Non-GAAP EPS'),
    'net-income': flash.LABELS['net-income'],
    'operating-income': flash.LABELS['operating-income'],
    'revenue': flash.LABELS['revenue'],
}


PERIOD_PATTERNS = (
    # "Q1 FY27" (IREN), "Q3 2026 Update" (Tesla)
    (re.compile(r'\bQ([1-4]) FY(\d\d)\b'), lambda m: f'Q{m[1]} FY20{m[2]}'),
    (re.compile(r'\bQ([1-4]) (20\d\d)\b'), lambda m: f'Q{m[1]} {m[2]}'),
    # "First Quarter Fiscal 2027" (Coherent), "Fourth Quarter and Fiscal 2026" (Qualcomm)
    (re.compile(r'(?i)\b(first|second|third|fourth)[- ]quarter (?:and )?fiscal (?:year )?(20\d\d)\b'),
     lambda m: f'Q{flash.QUARTERS[m[1].lower()]} FY{m[2]}'),
    # "third-quarter 2026" (IBM), "Third Quarter 2026" (Vistra), "third quarter ended September 30, 2026" (Constellation)
    (re.compile(r'(?i)\b(first|second|third|fourth)[- ]quarter (?:of )?(?:ended \w+ \d{1,2}, )?(20\d\d)\b'),
     lambda m: f'Q{flash.QUARTERS[m[1].lower()]} {m[2]}'),
)


def release_period(text):
    """The quarter a results filing names in its first lines (for a row without figures); '決算' when none is named."""
    head = flash.clean(text)[:4000]
    found = [(m.start(), label(m)) for pattern, label in PERIOD_PATTERNS for m in [pattern.search(head)] if m]
    return min(found)[1] if found else '決算'


def millions(number, unit):
    value = Decimal(number.replace(',', ''))
    return value * 1000 if unit.lower() in ('billion', 'b') else value


def segment_ok(head, match):
    """The sentence the figure starts: not a full year, not the outlook."""
    sentence = head[match.start():match.end() + 60]
    before = head[max(0, match.start() - 80):match.start()]
    span = match.group(0)
    if NOT_QUARTER.search(span) or OUTLOOK.search(sentence[:len(span)]) or OUTLOOK.search(before.split('•')[-1].split('.')[-1]):
        return False
    return not (re.search(r'(?i)\bfiscal (?:year )?20\d\d\b', span) and not re.search(r'(?i)quarter|\bQ[1-4]\b', span))


def parse(text, url=None):
    """{'period', 'facts'} in issuer_result_flash's shape, or ValueError(code)."""
    head = flash.clean(text)[:HEAD]
    if not results_head(head[:800]):
        raise ValueError('not-a-results-release')
    period = release_period(head[:800])
    if period == '決算':
        raise ValueError('period-unrecognized')
    found = {}
    for key, pattern in PATTERNS:
        for match in pattern.finditer(head):
            if not segment_ok(head, match):
                continue
            if key == 'eps':
                basis, diluted, number = match.group(1), match.group(2), match.group(3)
                if (basis or '').strip().lower() == 'non-gaap':
                    name, value = 'adjusted-eps', Decimal(number)
                else:
                    name, value = ('eps-diluted' if diluted or 'diluted' in match.group(0).lower() else 'eps-gaap'), Decimal(number)
            else:
                groups = [g for g in match.groups() if g is not None]
                loss = any(g.lower() == 'loss' for g in groups)
                number, unit = next((groups[i], groups[i + 1]) for i in range(len(groups) - 1)
                                    if re.fullmatch(r'[\d,.]+', groups[i]) and groups[i + 1].lower() in ('billion', 'million', 'b', 'm'))
                name, value = key, -millions(number, unit) if loss else millions(number, unit)
            found.setdefault(name, set()).add(value)
    if 'eps-diluted' in found and 'eps-gaap' in found and found['eps-diluted'] == found['eps-gaap']:
        del found['eps-gaap']  # "GAAP EPS of $1.90" and "... $1.90 per diluted share": one figure
    facts = []
    for name in ('revenue', 'eps-diluted', 'eps-gaap', 'adjusted-eps', 'net-income', 'operating-income'):
        values = found.get(name)
        if not values or len(values) != 1:
            continue  # missing, or stated twice with different values: ambiguous
        value = next(iter(values))
        if name == 'revenue' and value <= 0:
            continue
        key = 'eps' if name.startswith('eps-') else name
        shown = flash.per_share(value) if key in ('eps', 'adjusted-eps') else flash.money_millions(value)
        facts.append((key, shown, None, LABELS[name]))
    if len({f[0] for f in facts}) != len(facts):
        facts = [f for f in facts if f[0] != 'eps']  # two different GAAP EPS figures: neither
    if not any(f[0] in ('revenue', 'eps', 'adjusted-eps', 'net-income') for f in facts):
        raise ValueError('highlights-unreadable')
    return {'period': period, 'facts': facts}
