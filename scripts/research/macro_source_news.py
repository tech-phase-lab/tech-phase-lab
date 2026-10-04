"""Closed, source-only macro data grammars and deterministic bilingual copy.

No database, provider, ticker lookup, clock or publication behavior lives here.
Every non-formatting source character must belong to a recognized report.
A comparison may inherit its own cell’s explicit actual unit, with provenance.
No units, periods or values are ever borrowed across metric cells.
This route does not validate model prose: rendered copy is rederived exactly.
"""
from dataclasses import dataclass, fields, is_dataclass
from decimal import Decimal
import hashlib
import re

VERSION = 1
MAX_INPUT = 3600
FAILURES = frozenset({
    'unsupported-macro-format', 'unsupported-macro-tail', 'incomplete-macro-report',
    'duplicate-macro-metric', 'invalid-macro-value', 'missing-macro-unit',
    'changed-macro-unit', 'missing-macro-sign', 'changed-macro-role',
    'invalid-macro-binding', 'changed-macro-copy',
})
MONTHS = ('January', 'February', 'March', 'April', 'May', 'June', 'July',
          'August', 'September', 'October', 'November', 'December')
MONTH = '(?:' + '|'.join(MONTHS) + ')'
NUMBER = r'[+\-−]?\d+(?:\.\d+)?'
SPACE = r'[ \t]*'


class MacroSourceError(ValueError):
    """A closed reason suitable for a private diagnostic, never approval."""


def fail(reason):
    raise MacroSourceError(reason)


@dataclass(frozen=True)
class Evidence:
    start: int
    end: int
    quote: str


@dataclass(frozen=True)
class Quantity:
    number: str
    unit: str
    literal: str
    evidence: Evidence
    unit_evidence: Evidence
    unit_provenance: str


@dataclass(frozen=True)
class Period:
    month: int | None = None
    year: int | None = None
    basis: str | None = None
    evidence: tuple[Evidence, ...] = ()


@dataclass(frozen=True)
class Metric:
    key: str
    actual: Quantity
    estimate: Quantity | None
    prior: Quantity | None
    period: Period
    evidence: Evidence


@dataclass(frozen=True)
class HistoricalHigh:
    metric: str
    month: int
    year: int
    evidence: Evidence


@dataclass(frozen=True)
class Report:
    kind: str
    region: str
    month: int
    metrics: tuple[Metric, ...]
    historical_high: HistoricalHigh | None
    header: Evidence
    body: str
    body_sha: str
    trailing_url: Evidence | None = None


# Labels define metric identities, not entity names or generic earnings topics.
JOBS = (
    ('nonfarm-payrolls', r'NONFARM PAYROLLS', '非農業部門雇用者数', 'Nonfarm payrolls', 'K', 'estimate', None),
    ('unemployment-rate', r'UNEMPLOYMENT RATE', '失業率', 'Unemployment rate', '%', 'estimate', None),
    ('hourly-earnings-yoy', r'AVG\. HOURLY EARNINGS YoY', '平均時給（前年比）', 'Average hourly earnings (YoY)', '%', 'estimate', 'YoY'),
    ('participation-rate', r'PARTICIPATION RATE', '労働参加率', 'Labor force participation rate', '%', 'estimate', None),
    ('private-payrolls', r'PRIVATE PAYROLLS', '民間雇用者数', 'Private payrolls', 'K', 'estimate', None),
    ('average-workweek', r'AVG\. WORKWEEK', '平均週間労働時間', 'Average workweek', 'HOURS', 'estimate', None),
    ('government-payrolls', r'GOVERNMENT PAYROLLS', '政府部門雇用者数', 'Government payrolls', 'K', 'prior', None),
)
LABELS = {row[0]: (row[2], row[3]) for row in JOBS}
LABELS.update({'cpi': ('CPI', 'CPI'), 'core-cpi': ('コアCPI', 'Core CPI'),
               'services-inflation': ('サービスのインフレ率', 'Services inflation')})


def evidence(body, start, end):
    return Evidence(start, end, body[start:end])


def month_number(value):
    return next(i for i, name in enumerate(MONTHS, 1) if name.casefold() == value.casefold())


def lines(body):
    """Return exact nonblank spans; permit only layout whitespace and one URL."""
    if (not isinstance(body, str) or not 1 <= len(body) <= MAX_INPUT
            or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', body)):
        fail('unsupported-macro-format')
    limit = len(body)
    url = re.search(r'[ \t\r\n]+(https://t\.co/[A-Za-z0-9]+)[ \t\r\n]*\Z', body)
    trailing = evidence(body, url.start(1), url.end(1)) if url else None
    if url:
        limit = url.start()
    out = []
    for match in re.finditer(r'[^\r\n]+', body[:limit]):
        raw = match[0]
        left = len(raw) - len(raw.lstrip(' \t'))
        right = len(raw.rstrip(' \t'))
        if right > left:
            out.append(evidence(body, match.start() + left, match.start() + right))
    return out, trailing


def headcount(number):
    """Exact decimal K-to-person conversion without rounding or float math."""
    sign = number[0] if number[0] in '+-' else ''
    magnitude = number.lstrip('+-')
    whole, _, fraction = magnitude.partition('.')
    if any(digit != '0' for digit in fraction[3:]):
        fail('invalid-macro-value')
    people = int(whole) * 1000 + int((fraction[:3] + '000')[:3])
    return sign + format(people, ',') + '人'


def quantity(body, token, start, unit, *, signed=False, same_cell_actual=None):
    match = re.fullmatch('(' + NUMBER + r')' + SPACE + r'([A-Za-z%]*)', token)
    if not match:
        fail('invalid-macro-value')
    if not match[2]:
        if same_cell_actual is None or same_cell_actual.unit != unit:
            fail('missing-macro-unit')
        unit_evidence = same_cell_actual.unit_evidence
        provenance = 'same-cell-explicit-actual-unit'
    else:
        if match[2].upper() != unit:
            fail('changed-macro-unit')
        unit_evidence = evidence(body, start + match.start(2), start + match.end(2))
        provenance = 'explicit'
    number = match[1].replace('−', '-')
    if signed and not number.startswith(('+', '-')):
        fail('missing-macro-sign')
    if unit == 'HOURS' and Decimal(number) < 0:
        fail('invalid-macro-value')
    if unit == 'K':
        headcount(number)  # Every supported payroll value must be integral.
    return Quantity(number, unit, token, evidence(body, start, start + len(token)),
                    unit_evidence, provenance)


def jobs_report(body, source_lines, trailing):
    header = source_lines[0]
    opening = re.fullmatch('(' + MONTH + r')[ \t]+U\.S\.[ \t]+JOBS REPORT(?:[ \t]+👇)?', header.quote, re.I)
    if not opening:
        fail('unsupported-macro-format')
    month = month_number(opening[1])
    found = []
    seen = set()
    for line in source_lines[1:]:
        spec = next((row for row in JOBS if re.match(row[1] + r'(?=[ \t]|$)', line.quote, re.I)), None)
        if spec is None:
            fail('unsupported-macro-tail')
        key, label, _, _, unit, role, basis = spec
        if key in seen:
            fail('duplicate-macro-metric')
        seen.add(key)
        match = re.fullmatch(label + r'[ \t]+(?P<actual>[^,()]+),' + SPACE
                             + r'\((?P<role>Est\.|Prev\.)[ \t]+(?P<comparison>[^,()]+)\)', line.quote, re.I)
        if not match:
            fail('unsupported-macro-format')
        parsed_role = 'estimate' if match['role'].lower() == 'est.' else 'prior'
        if parsed_role != role:
            fail('changed-macro-role')
        actual = quantity(body, match['actual'], line.start + match.start('actual'), unit, signed=unit == 'K')
        comparison = quantity(body, match['comparison'], line.start + match.start('comparison'), unit,
                              signed=unit == 'K', same_cell_actual=actual)
        # Month is explicitly scoped by the jobs-report header; no year or
        # previous-month date is inferred. YoY belongs only to the wage row.
        period = Period(month=month, basis=basis, evidence=(header, line) if basis else (header,))
        found.append(Metric(key, actual, comparison if role == 'estimate' else None,
                            comparison if role == 'prior' else None, period, line))
    if seen != {row[0] for row in JOBS}:
        fail('incomplete-macro-report')
    return Report('us-jobs-report', 'U.S.', month, tuple(found), None, header,
                  body, hashlib.sha256(body.encode()).hexdigest(), trailing)


def cpi_report(body, source_lines, trailing):
    first = source_lines[0]
    # Both comparisons and the historical maximum belong to headline CPI.
    pattern = (r'Eurozone(?:[ \t]+🇪🇺)?[ \t]+(?P<month>' + MONTH + r')[ \t]+CPI rose[ \t]+'
        r'(?P<actual>[^()]+?)[ \t]+YoY[ \t]+\(est\.[ \t]+(?P<estimate>[^,()]+),[ \t]+'
        r'prior[ \t]+(?P<prior>[^()]+)\),[ \t]+the highest since[ \t]+'
        r'(?P<since_month>' + MONTH + r')[ \t]+(?P<since_year>(?:19|20|21)\d{2})\.')
    match = re.fullmatch(pattern, first.quote, re.I)
    if not match:
        fail('unsupported-macro-format')
    actual = quantity(body, match['actual'], first.start + match.start('actual'), '%')
    estimate, prior = [quantity(body, match[name], first.start + match.start(name), '%', same_cell_actual=actual)
                       for name in ('estimate', 'prior')]
    if Decimal(actual.number) < 0:
        fail('invalid-macro-value')  # The supported source predicate is rose.
    month = month_number(match['month'])
    period = Period(month=month, basis='YoY', evidence=(first,))
    found = [Metric('cpi', actual, estimate, prior, period, first)]
    seen = {'cpi'}
    for line in source_lines[1:]:
        match_line = re.fullmatch(r'(?P<label>Core CPI|Services inflation):[ \t]+(?P<actual>[^()]+)', line.quote, re.I)
        if not match_line:
            fail('unsupported-macro-tail')
        key = 'core-cpi' if match_line['label'].lower() == 'core cpi' else 'services-inflation'
        if key in seen:
            fail('duplicate-macro-metric')
        seen.add(key)
        value = quantity(body, match_line['actual'], line.start + match_line.start('actual'), '%')
        # No month, year or annual comparison basis is explicit on these rows.
        found.append(Metric(key, value, None, None, Period(), line))
    if seen != {'cpi', 'core-cpi', 'services-inflation'}:
        fail('incomplete-macro-report')
    high = HistoricalHigh('cpi', month_number(match['since_month']), int(match['since_year']),
                          evidence(body, first.start + match.start('since_month'), first.start + match.end('since_year')))
    return Report('eurozone-cpi', 'Eurozone', month, tuple(found), high, first,
                  body, hashlib.sha256(body.encode()).hexdigest(), trailing)


def parse(body):
    """Consume one complete supported report or reject with a closed reason."""
    source_lines, trailing = lines(body)
    if not source_lines:
        fail('unsupported-macro-format')
    if re.match('(' + MONTH + r')[ \t]+U\.S\.[ \t]+JOBS REPORT', source_lines[0].quote, re.I):
        return jobs_report(body, source_lines, trailing)
    if re.match(r'Eurozone\b', source_lines[0].quote, re.I):
        return cpi_report(body, source_lines, trailing)
    fail('unsupported-macro-format')


def display(value, language):
    # Payroll magnitudes are converted exactly to Japanese person counts.
    # Percent/hour spellings and every explicit sign remain source-bound.
    if value.unit == 'K' and language == 'ja':
        return headcount(value.number)
    return value.number + (('時間' if language == 'ja' else ' hours') if value.unit == 'HOURS' else value.unit)


def same_binding(value, expected):
    """Dataclass equality alone treats bool/float quantities as integers."""
    if type(value) is not type(expected):
        return False
    if is_dataclass(expected):
        return all(same_binding(getattr(value, field.name), getattr(expected, field.name))
                   for field in fields(expected))
    if isinstance(expected, tuple):
        return len(value) == len(expected) and all(same_binding(a, b) for a, b in zip(value, expected))
    return value == expected


def render(report):
    """Render only a freshly source-rederived immutable binding, never prose."""
    if type(report) is not Report or not same_binding(report, parse(report.body)):
        fail('invalid-macro-binding')
    month_en = MONTHS[report.month - 1]
    if report.kind == 'us-jobs-report':
        ja = [f'報道によると、{report.month}月の米雇用統計は以下のとおり。']
        en = [f'The report gives the following U.S. jobs data for {month_en}.']
        for metric in report.metrics:
            jlabel, elabel = LABELS[metric.key]
            other = metric.estimate or metric.prior
            jrole, erole = ('予想', 'estimate') if metric.estimate else ('前回', 'prior')
            ja.append(f'{jlabel}：実績 {display(metric.actual,"ja")}、{jrole} {display(other,"ja")}。')
            en.append(f'{elabel}: actual {display(metric.actual,"en")}; {erole} {display(other,"en")}.')
        headline = next(metric for metric in report.metrics if metric.key == 'nonfarm-payrolls')
        return {'titleJa': f'米{report.month}月雇用統計：非農業部門雇用者数{display(headline.actual,"ja")}',
                'titleEn': f'U.S. {month_en} nonfarm payrolls {display(headline.actual,"en")}',
                'bodyJa': '\n'.join(ja), 'bodyEn': '\n'.join(en)}
    metrics = {metric.key: metric for metric in report.metrics}
    main, core, services = (metrics[key] for key in ('cpi', 'core-cpi', 'services-inflation'))
    high = report.historical_high
    ja = (f'報道によると、ユーロ圏の{report.month}月のCPI上昇率は前年同月比{display(main.actual,"ja")}'
          f'（予想 {display(main.estimate,"ja")}、前回 {display(main.prior,"ja")}）で、'
          f'{high.year}年{high.month}月以来の最高水準となった。\n'
          f'コアCPIは{display(core.actual,"ja")}、サービスのインフレ率は{display(services.actual,"ja")}だった。')
    en = (f'The report puts {month_en} Eurozone CPI inflation at {display(main.actual,"en")} year-over-year, '
          f'against an estimate of {display(main.estimate,"en")} and a prior reading of {display(main.prior,"en")}. '
          f'This was the highest reading since {MONTHS[high.month - 1]} {high.year}.\n'
          f'It lists core CPI at {display(core.actual,"en")} and services inflation at {display(services.actual,"en")}.')
    return {'titleJa': f'報道：ユーロ圏{report.month}月CPI、前年比{display(main.actual,"ja")}上昇',
            'titleEn': f'Reported Eurozone {month_en} CPI: {display(main.actual,"en")} YoY rise',
            'bodyJa': ja, 'bodyEn': en}


def compact_titles(report):
    """Whole editorial alternatives from a complete, source-rederived report.

    Keep persisted full titles and all report rows unchanged. This presentation
    projection does not decide materiality or promote an unverified report.
    """
    if type(report) is not Report or not same_binding(report, parse(report.body)):
        fail('invalid-macro-binding')
    return _compact_bound(report)


def derive_compact(body):
    """Derive both alternatives from one fresh, fully consumed source parse."""
    return _compact_bound(parse(body))


def _compact_bound(report):
    month_en = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul',
                'Aug', 'Sep', 'Oct', 'Nov', 'Dec')[report.month - 1]
    if report.kind == 'us-jobs-report':
        main = next(metric for metric in report.metrics if metric.key == 'nonfarm-payrolls')
        return {'shortTitleJa': f'米{report.month}月非農業部門雇用{display(main.actual,"ja")}',
                'shortTitleEn': f'U.S. {month_en} nonfarm payrolls {display(main.actual,"en")}'}
    main = next(metric for metric in report.metrics if metric.key == 'cpi')
    return {'shortTitleJa': f'報道：ユーロ圏{report.month}月CPI 前年比{display(main.actual,"ja")}',
            'shortTitleEn': f'Reported Eurozone {month_en} CPI: {display(main.actual,"en")} YoY'}


def derive(body):
    return render(parse(body))


def validate_rendered(body, value):
    """Reject edits, dropped fields, swapped roles and unsupported additions."""
    if not isinstance(value, dict) or value != derive(body):
        fail('changed-macro-copy')
    return value
