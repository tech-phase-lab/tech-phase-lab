"""決算の深掘り for a new quarter, built WITHOUT any model call (owner, Nov 26).

The cost of AI on an earnings release was approved once: the PRO deep analysis (deep_analysis.py, research-note format since #693),
one call per release with RESEARCH_DEEP_MODEL. This module never calls a model. It is a pure transform of what already exists:

  - the release's figures, read by the monitor's deterministic parser (issuer_result_flash, via earnings_patrol.latest_release):
    revenue (and the year-ago column), EPS, gross margin, next-quarter revenue guidance, and the quarter's end date from the release text;
  - the previous quarter's committed dive file (lib/research/dives/<TICKER>.json): its name, basis, revenue history and the quoted
    passages behind them, so the history and the "previous" figures keep their original evidence;
  - the stored deep analysis of the same release (deep_analyses, state done): its summary, sections, scenarios, unknowns and next
    points, already checked by deep_analysis.bind (evidence, banned wording, money units) when it was written.

What the analysis does not carry is filled from the parsed figures with fixed templates (never a new call): the tiles, every chip, the
card headlines, each card's 「何が起きたか」 (happened) section, numbers, history and evidence. The deep analysis is read as is; only the
site's two copy rules are applied to it (「米ドル」→「ドル」, no 。/、 right after a closing parenthesis).

Every draft passes check_dives.py unchanged (contract, counts, copy rules, no advice wording, every number backed by a quote found in the
release text) and the cross-checks below before it is stored as passed and served to the site (GET /company-dives); anything else is
kept as failed with its reasons and opens an operational incident for the owner. Off with EARNINGS_DIVE_AUTO=false.
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import json
import os
from pathlib import Path
import re
import tempfile

import check_dives
import monitor

ENABLED_ENV = 'EARNINGS_DIVE_AUTO'
DIVES = Path(__file__).resolve().parents[2] / 'lib/research/dives'
INCIDENT_PREFIX = 'earnings-dive:'
CATEGORY = 'earnings-dive'
SAME_RELEASE = timedelta(days=2)
QUOTE_SIDE = 160  # characters of release text either side of a quoted figure


def enabled(env=None):
    return (os.environ if env is None else env).get(ENABLED_ENV, 'true').strip().lower() not in {'false', '0', 'no'}


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS generated_dives(
      ticker TEXT NOT NULL, period TEXT NOT NULL, release_accession TEXT NOT NULL, attempt INTEGER NOT NULL, state TEXT NOT NULL,
      payload TEXT, fixture TEXT, errors TEXT, model TEXT, at TEXT NOT NULL, PRIMARY KEY(ticker, release_accession, attempt))''')


def previous_dive(ticker, folder=None):
    path = (folder or DIVES) / f'{ticker}.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def normalize_period(label):
    m = re.match(r'^Q([1-4]) (FYE?)?\s?(\d{2}|20\d{2})$', str(label or '').strip())
    if not m:
        return None
    year = m[3] if len(m[3]) == 4 else '20' + m[3]
    return f'Q{m[1]} FY{year}' if m[2] else f'Q{m[1]} {year}'


# ---- the deep analysis of the same release ----------------------------------------------------------------------------------

def stored_analysis(db, ticker, accepted):
    """The finished deep analysis (research note) of this release: subject = ticker, written within SAME_RELEASE of it. None if not yet."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='deep_analyses'").fetchone():
        return None
    best = None
    for row in db.execute("SELECT payload,created_at,published_at FROM deep_analyses WHERE kind='earnings' AND subject=? AND state='done'", (ticker,)):
        try:
            at = datetime.fromisoformat(str(row['created_at']).replace('Z', '+00:00'))
            at = at if at.tzinfo else at.replace(tzinfo=timezone.utc)
            note = json.loads(row['payload'])
        except (TypeError, ValueError):
            continue
        if abs(at - accepted) <= SAME_RELEASE and isinstance(note, dict) and note.get('sections'):
            if best is None or at > best[0]:
                best = (at, note)
    return best[1] if best else None


def site_copy(item):
    """The site's two Japanese copy rules, applied to a stored analysis text (nothing else is changed)."""
    ja = str(item.get('ja', '')).replace('米ドル', 'ドル')
    ja = re.sub(r'([)）])[。、]', r'\1', ja)
    return {'ja': ja, 'en': str(item.get('en', ''))}


# ---- money in the dive's units (lib/research/dive-money.ts) -----------------------------------------------------------------

UNITS = {'USD': ('億ドル', 100, '$', 'B'), 'EUR': ('億ユーロ', 100, '€', 'B'), 'TWD': ('億台湾ドル', 100, 'NT$', 'B'),
         'KRW': ('兆ウォン', 1_000_000, '₩', 'T')}
PER_SHARE = {'USD': ('ドル', '$', 2), 'EUR': ('ユーロ', '€', 2), 'TWD': ('台湾ドル', 'NT$', 2), 'KRW': ('ウォン', '₩', 0)}


def _q(value, places):
    return Decimal(value).quantize(Decimal(1).scaleb(-places), ROUND_HALF_UP)


def _group(text):
    whole, _, fraction = text.partition('.')
    return f'{int(whole):,}' + (f'.{fraction}' if fraction else '')


def _trim(text):
    return text.rstrip('0').rstrip('.') if '.' in text else text


def money(million, currency):
    """{'ja': '1,158.44億ドル'-style trimmed, 'en': '$115.84B'} and the en number with its rounding places (for the evidence calc)."""
    ja_unit, ja_div, prefix, suffix = UNITS[currency]
    value, sign = abs(Decimal(million)), '−' if Decimal(million) < 0 else ''
    ja = sign + _group(_trim(format(_q(value / ja_div, 2), 'f'))) + ja_unit
    if currency != 'KRW' and value < 1000:
        en_number, places, scale = _trim(format(_q(value, 1), 'f')), 1, 'M'
    else:
        div = 1_000_000 if currency == 'KRW' else 1000
        en_number, places, scale = format(_q(value / div, 2), 'f'), 2, suffix
    return {'ja': ja, 'en': f'{sign}{prefix}{_group(en_number)}{scale}'}, places, scale


def per_share(value, currency):
    ja_unit, prefix, places = PER_SHARE[currency]
    text = _group(format(_q(abs(Decimal(value)), places), 'f'))
    sign = '−' if Decimal(value) < 0 else ''
    return {'ja': f'{sign}{text}{ja_unit}', 'en': f'{sign}{prefix}{text}'}


def pct(value):
    v = _q(value, 1)
    return ('+' if v > 0 else '−' if v < 0 else '±') + format(abs(v), 'f') + '%'


# ---- evidence: every figure quoted from the release text --------------------------------------------------------------------

def _renderings(million):
    """How a release may print an amount of `million` millions: in millions, in thousands, in billions (with 'billion')."""
    m = Decimal(million)
    out = []
    if m == m.to_integral_value():
        out.append((f'{int(m):,}', None))
    else:
        out.append((_group(_trim(format(m.normalize(), 'f'))), None))
    thousands = m * 1000
    if thousands == thousands.to_integral_value():
        out.append((f'{int(thousands):,}', '/ 1000'))
    billions = m / 1000
    if billions >= 1:  # "$130.0 billion", "$17 billion", "€11.662 billion": the printed figure times 1000 is the amount
        for text in dict.fromkeys([format(billions.normalize(), 'f'), format(billions, '.1f'), format(billions, '.2f'), format(billions, '.3f')]):
            if Decimal(text) == billions:
                out.append((text, '* 1000'))
    return out


def quote_for(text, rendering, near=None):
    """The release passage around `rendering` (a printed figure, not part of a longer number), preferring one that also names `near`."""
    pattern = re.compile(r'(?<![\d.,])' + re.escape(rendering) + r'(?![\d]|[.,]\d)')
    hits = list(pattern.finditer(text))
    if not hits:
        return None
    if near:
        hits.sort(key=lambda m: 0 if re.search(near, text[max(0, m.start() - 200):m.end() + 80], re.I) else 1)
    m = hits[0]
    a, b = max(0, m.start() - QUOTE_SIDE), min(len(text), m.end() + QUOTE_SIDE)
    while a > 0 and text[a - 1] != ' ':
        a -= 1
    while b < len(text) and text[b] != ' ':
        b += 1
    return text[a:b].strip()


def amount_evidence(field, million, text, url, near=None):
    """An evidence entry for an amount in millions (quote, and calc when the release prints it in another unit); None if not found."""
    for rendering, op in _renderings(million):
        quote = quote_for(text, rendering, near)
        if quote:
            entry = {'field': field, 'url': url, 'quote': quote}
            if op:
                entry['calc'] = f"{rendering.replace(',', '')} {op}"
            return entry
    return None


def plain_evidence(field, value, text, url, near=None):
    """A percentage or a per-share amount printed as is."""
    rendering = format(Decimal(str(value)).normalize(), 'f')
    for candidate in dict.fromkeys([rendering, format(_q(Decimal(str(value)), 2), 'f')]):
        quote = quote_for(text, candidate, near)
        if quote:
            return {'field': field, 'url': url, 'quote': quote}
    return None


# ---- the figures ------------------------------------------------------------------------------------------------------------

def _adjusted(text):
    text = text or ''
    return bool(re.search(r'non-?GAAP|non-?IFRS', text, re.I) or (re.search(r'\badjusted\b', text, re.I) and not re.search(r'\bno adjusted\b', text, re.I)))


def _amount(value):
    import earnings_patrol as patrol
    return patrol.amount(value)


MONTH_DATE = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d\d)')
ENDED = re.compile(r'\b(?:ended|ending|as of)\b', re.I)


def period_end(text, after=None, before=None):
    """The quarter's end date as the release's tables state it: of the dates written right after "ended" (column headers, "the quarter
    ended …"), the one between the previous quarter's end and the release date that the release repeats most. None when none fits."""
    counts = {}
    for m in ENDED.finditer(text or ''):
        # Only a full date right after the word ("Three Months Ended August 1, 2026"); a header that lists several month-days before one
        # year ("Ended October 25, October 26, … 2026 2025") is ambiguous and never read.
        window = text[m.end():m.end() + 60].lstrip()
        d = MONTH_DATE.match(window)
        if not d:
            continue
        try:
            day = datetime.strptime(f'{d[1]} {d[2]} {d[3]}', '%B %d %Y').date().isoformat()
        except ValueError:
            continue
        if (after is None or day > after) and (before is None or day < before):
            counts[day] = counts.get(day, 0) + 1
    if not counts:  # a preliminary-results 6-K (SK hynix): "Current Period (Third quarter(1) of 2026)" and "(1) ... from July 1 to September 30"
        m = re.search(r'Current Period \((?:First|Second|Third|Fourth) quarter\(1\) of (20\d\d)\).{0,1500}?\(1\) Refers to the three-month period from '
                      r'[A-Z][a-z]+ \d{1,2} to ([A-Z][a-z]+) (\d{1,2}) of a given year', text or '')
        if m:
            try:
                day = datetime.strptime(f'{m[2]} {m[3]} {m[1]}', '%B %d %Y').date().isoformat()
            except ValueError:
                day = None
            if day and (after is None or day > after) and (before is None or day < before):
                return day
    return max(counts, key=lambda k: (counts[k], k)) if counts else None


def build(ticker, release, previous, note, today):
    """The dive file for the release's quarter (a dict), or raises ValueError naming what is missing. No model, no network."""
    if not previous:
        raise ValueError('no-previous-file')
    text, url = check_dives.normalize(release['text']), release['url']
    currency = previous['currency']
    facts = release['facts']
    period = normalize_period(release.get('period'))
    if not period:
        raise ValueError('period-unreadable')
    end = period_end(text, previous['periodEnd'], release['releasedOn'])
    if not end:
        raise ValueError('period-end-unreadable')
    writer = None
    try:
        import dive_writers
        writer = dive_writers.WRITERS.get(ticker)
    except ImportError:
        writer = None
    if writer:
        return company_dive(ticker, release, previous, writer, text, url, period, end, today)
    evidence, missing = [], []

    def need(entry, what):
        if entry:
            evidence.append(entry)
            return entry
        missing.append(what)
        return None

    # revenue: this quarter and its year-ago column from the release, the previous quarter from the previous file (its own quote)
    revenue = _amount(facts.get('revenue', {}).get('value'))
    if not revenue or revenue[0] != currency:
        raise ValueError('revenue-unreadable')
    current = revenue[1]
    rev_evidence = need(amount_evidence('numbers.revenue.current', current, text, url, r'revenue|sales'), 'revenue quote')
    prev_rev = Decimal(str(previous['numbers']['revenue']['current']))
    prev_quotes = {e['field']: e for e in previous.get('evidence') or []}
    prev_url_used = set()

    def carry(old_field, new_field):
        entry = prev_quotes.get(old_field)
        if entry:
            prev_url_used.add(entry['url'])
            evidence.append({**entry, 'field': new_field})
        else:
            missing.append(f'{old_field} quote in the previous file')

    carry('numbers.revenue.current', 'numbers.revenue.previous')
    year_ago = _amount(facts.get('revenue', {}).get('yearAgo')) if facts.get('revenue', {}).get('yearAgo') else None
    year_ago_value = None
    if year_ago and year_ago[0] == currency:
        entry = amount_evidence('numbers.revenue.yearAgo', year_ago[1], text, url, r'revenue|sales')
        if entry:
            year_ago_value = year_ago[1]
            evidence.append(entry)
    basis = previous.get('basis') or {}
    eps_key = 'adjusted-eps' if (not basis.get('eps') or _adjusted(basis.get('eps'))) else 'eps'
    eps = None
    import earnings_patrol as patrol
    eps_read = patrol.per_share(facts.get(eps_key, {}).get('value'))
    if eps_read and eps_read[0] == currency:
        entry = plain_evidence('numbers.adjustedEPS', eps_read[1], text, url, r'per (?:diluted )?share|EPS')
        if entry:
            eps = eps_read[1]
            evidence.append(entry)
    gross = None
    gm_text = facts.get('gross-margin', {}).get('value', '')
    prev_gm = (previous['numbers'].get('grossMargin') or {}).get('current')
    if gm_text.endswith('%') and prev_gm is not None and not _adjusted(basis.get('grossMargin')):
        value = Decimal(gm_text[:-1])
        entry = plain_evidence('numbers.grossMargin.current', value, text, url, r'gross margin')
        if entry:
            gross = {'current': float(value), 'previous': prev_gm}
            evidence.append(entry)
            carry('numbers.grossMargin.current', 'numbers.grossMargin.previous')
    guidance = None
    g = facts.get('guidance-revenue')
    if g and re.search(r'(?i)next[- ]quarter', g.get('label', '')):
        read = patrol.guidance(g['value'])
        if read and read[0] == currency:
            band = re.match(r'^(\S+)\s*±\s*(\d+(?:\.\d+)?)%$', g['value'].strip())
            low_e = amount_evidence('numbers.guidance.low', read[1], text, url, r'outlook|expect|guidance') if not band else None
            high_e = amount_evidence('numbers.guidance.high', read[2], text, url, r'outlook|expect|guidance') if not band else None
            if band:  # "$130.0 billion, plus or minus 3%": the bounds are the release's own two figures
                mid = _amount(band[1])
                base = amount_evidence('numbers.guidance.low', mid[1], text, url, r'outlook|expect|guidance') if mid else None
                if base and band[2] in base['quote']:
                    centre = base['calc'] if base.get('calc') else format(mid[1].normalize(), 'f')
                    centre = f"({centre})" if base.get('calc') else centre
                    low_e = {**base, 'calc': f"{centre} * (100 - {band[2]}) / 100"}
                    high_e = {**base, 'field': 'numbers.guidance.high', 'calc': f"{centre} * (100 + {band[2]}) / 100"}
            if low_e and high_e:
                guidance = {'low': float(read[1]), 'high': float(read[2]), 'grossMarginPercent': None}
                evidence.extend([low_e, high_e])

    # history: the previous file's bars without the oldest, plus the previous quarter, each with the previous file's own quote
    old = previous['history']
    history = [dict(h) for h in old[1:]] + [{'label': f"Q{previous['periodQuarter']}", 'end': previous['periodEnd'],
                                             'value': previous['numbers']['revenue']['current']}]
    for i in range(len(history) - 1):
        carry(f'history[{i + 1}].value', f'history[{i}].value')
    carry('numbers.revenue.current', f'history[{len(history) - 1}].value')

    # tiles: revenue, then margin or EPS, then the outlook or the year-ago revenue (rounded to the site's units, with a calc)
    tiles = []

    def amount_tile(label, million, base):
        shown, places, scale = money(million, currency)
        if not base:
            return
        figure = base['calc'].split(' ')[0] if base.get('calc') else format(Decimal(million).normalize(), 'f').replace(',', '')
        unit_div = {'M': '', 'B': ' / 1000', 'T': ' / 1000 / 1000'}[scale]
        to_millions = f" {base['calc'].split(' ', 1)[1]}" if base.get('calc') else ''
        calc = f"{figure}{to_millions}{unit_div}" if (to_millions or unit_div) else None
        entry = {'field': f'tiles[{len(tiles)}].value', 'url': base['url'], 'quote': base['quote']}
        if calc:
            entry.update({'calc': calc, 'round': places})
        evidence.append(entry)
        tiles.append({'label': label, 'value': shown, 'note': {'ja': '四半期実績', 'en': 'Quarterly actual'}})

    amount_tile({'ja': '売上高', 'en': 'Revenue'}, current, rev_evidence)
    if gross:
        evidence.append({**[e for e in evidence if e['field'] == 'numbers.grossMargin.current'][0], 'field': f'tiles[{len(tiles)}].value'})
        tiles.append({'label': {'ja': '粗利益率', 'en': 'Gross margin'}, 'value': {'ja': f"{gross['current']}%", 'en': f"{gross['current']}%"},
                      'note': {'ja': f"前四半期 {gross['previous']}%", 'en': f"Prior quarter {gross['previous']}%"}})
        carry('numbers.grossMargin.current', f'tiles[{len(tiles) - 1}].note')
    elif eps is not None:
        evidence.append({**[e for e in evidence if e['field'] == 'numbers.adjustedEPS'][0], 'field': f'tiles[{len(tiles)}].value'})
        label = {'ja': '調整後EPS', 'en': 'Adjusted EPS'} if eps_key == 'adjusted-eps' else {'ja': 'EPS', 'en': 'EPS'}
        tiles.append({'label': label, 'value': per_share(eps, currency), 'note': {'ja': '1株あたり利益', 'en': 'Earnings per share'}})
    if guidance:
        low, _, _ = money(guidance['low'], currency)
        high, places, scale = money(guidance['high'], currency)
        base = [e for e in evidence if e['field'] == 'numbers.guidance.low'][0]
        value = {'ja': high['ja'], 'en': high['en']} if guidance['low'] == guidance['high'] else \
            {'ja': f"{re.sub(r'[^0-9.,−]+$', '', low['ja'])}〜{high['ja']}", 'en': f"{low['en']}–{high['en']}"}
        unit_div = {'M': '', 'B': ' / 1000', 'T': ' / 1000 / 1000'}[scale]
        entry = {'field': f'tiles[{len(tiles)}].value', 'url': base['url'], 'quote': base['quote']}
        calc = f"({base['calc']}){unit_div}" if base.get('calc') else (f"{format(Decimal(str(guidance['low'])).normalize(), 'f')}{unit_div}" if unit_div else None)
        if calc:
            entry.update({'calc': calc, 'round': places})
        evidence.append(entry)
        tiles.append({'label': {'ja': '次四半期の売上見通し', 'en': 'Next-quarter revenue guidance'}, 'value': value,
                      'note': {'ja': '会社予想', 'en': 'Company guidance'}})
    elif year_ago_value is not None and len(tiles) < 3:
        amount_tile({'ja': '前年同期の売上高', 'en': 'Year-ago revenue'}, year_ago_value,
                    [e for e in evidence if e['field'] == 'numbers.revenue.yearAgo'][0])
    # AMD (Nov 26): no outlook sentence the parser reads and a non-GAAP EPS basis the release table does not give: the release's own
    # operating income or net income fills the tiles, from the same table, quoted like every figure.
    for key, label in (('operating-income', {'ja': '営業利益(GAAP)', 'en': 'GAAP operating income'}), ('net-income', {'ja': '純利益(GAAP)', 'en': 'GAAP net income'})):
        if len(tiles) >= 3:
            break
        read = _amount(facts.get(key, {}).get('value'))
        if read and read[0] == currency and read[1] > 0:
            entry = amount_evidence(f'tiles.{key}', read[1], text, url, r'operating income' if key == 'operating-income' else r'net income')
            if entry:
                amount_tile(label, read[1], entry)
    if len(tiles) < 3:
        missing.append('a third figure for the tiles (guidance, margin, year-ago revenue or a profit line)')
    if missing:
        raise ValueError('missing: ' + '; '.join(missing))

    numbers = {'revenue': {'current': float(current), 'previous': float(prev_rev), 'yearAgo': float(year_ago_value) if year_ago_value is not None else None},
               'adjustedEPS': float(eps) if eps is not None else None, 'epsEstimate': None, 'grossMargin': gross, 'guidance': guidance, 'segments': None}
    summary = summarize(numbers, currency, note, eps_key, basis)
    sources = [{'url': url, 'title': f"{previous['name']} {period} results release (Form {release.get('form', '8-K')}, SEC)",
                'location': 'Results release and financial tables'}]
    sources += [s for s in previous.get('sources') or [] if s['url'] in prev_url_used and s['url'] != url]
    return {'ticker': ticker, 'name': previous['name'], 'exchange': previous['exchange'], 'quoteTicker': previous['quoteTicker'],
            'period': period, 'periodQuarter': int(period[1]), 'releasedOn': release['releasedOn'], 'periodEnd': end, 'reviewedOn': today,
            'currency': currency, 'basis': previous.get('basis'), 'sources': sources, 'evidence': evidence, 'tiles': tiles[:3],
            'numbers': numbers, 'history': history, 'summary': summary}


def company_dive(ticker, release, previous, writer, text, url, period, end, today):
    """A company with its own writer (dive_writers): the hand-made file's cards and figure kinds, from the release's tables."""
    import dive_figures
    if ticker in dive_figures.DOC_SPECS:  # results in several exhibits of one 6-K (release, presentation, statements)
        figures = dive_figures.read_docs(ticker, [(url, release['text'])] + [(e['url'], e['text']) for e in release.get('exhibits') or []])
    else:
        figures = dive_figures.read(ticker, release['text'])
    old = previous['history']
    extra_sources = []
    report = {}
    if release.get('report'):  # the 10-Q, once filed: the figures only it carries
        report = dive_figures.read_report(ticker, release['report']['text'])
        for fig in report.values():
            fig.url = release['report']['url']
        if report:
            extra_sources.append({'url': release['report']['url'], 'title': f"{previous['name']} Form {release['report'].get('form', '10-Q')} for {period}",
                                  'location': 'Notes to the financial statements and risk factors'})
    for exhibit in release.get('exhibits') or []:  # the other exhibits of the results filing (a presentation, statements, a letter)
        extra_sources.append({'url': exhibit['url'], 'title': f"{previous['name']} {period} results, another exhibit of the same filing", 'location': 'Exhibit'})
    events = []
    for event in release.get('events') or []:  # other 8-Ks of the quarter: a deal, a preliminary result
        found = {**dive_figures.deal(event['text']), **dive_figures.read_event(ticker, event['text'])}
        if not found:
            continue
        for fig in found.values():
            fig.url = event['url']
        day = event['accepted'].astimezone(timezone.utc)
        events.append({'figures': found, 'url': event['url'], 'date': f'{day.month}月{day.day}日', 'dateEn': f'{day.strftime("%B")} {day.day}'})
        form = event.get('form', '8-K')
        extra_sources.append({'url': event['url'], 'title': f"{previous['name']} Form {form}" + (', Exhibit 99.1' if form == '8-K' else '') + f" ({day.date().isoformat()})",
                              'location': 'Press release' if form == '8-K' else 'Notice filed the same day'})
    extra = {}
    if ticker in dive_figures.PRIOR:  # the previous quarter's release: figures this release prints without that quarter
        prior = release.get('prior') or {}
        extra['prior'] = dive_figures.read(ticker, prior.get('text') or '')
        for fig in extra['prior'].values():
            fig.url = prior.get('url')
    written = writer(figures, url, Decimal(str(old[-1]['value'])) if old else None, report=report, events=events, previous=previous, **extra)
    history = [dict(h) for h in old[1:]] + [{'label': f"Q{previous['periodQuarter']}", 'end': previous['periodEnd'],
                                             'value': previous['numbers']['revenue']['current']}]
    evidence = list(written['evidence'])
    quotes = {e['field']: e for e in previous.get('evidence') or []}
    used = set()
    for i in range(len(history)):
        source = quotes.get(f'history[{i + 1}].value') if i < len(history) - 1 else quotes.get('numbers.revenue.current')
        if not source:
            raise ValueError(f'missing: history[{i}] quote in the previous file')
        used.add(source['url'])
        evidence.append({**source, 'field': f'history[{i}].value'})
    sources = [{'url': url, 'title': f"{previous['name']} {period} results release (Form {release.get('form', '8-K')}, SEC)",
                'location': 'Results release, financial tables and outlook'}]
    cited = {e['url'] for e in evidence}
    sources += [x for x in extra_sources if x['url'] in cited]
    used |= {e['url'] for e in written['evidence']}
    sources += [s for s in previous.get('sources') or [] if s['url'] in used and s['url'] not in {x['url'] for x in sources}]
    return {'ticker': ticker, 'name': previous['name'], 'exchange': previous['exchange'], 'quoteTicker': previous['quoteTicker'],
            'period': period, 'periodQuarter': int(period[1]), 'releasedOn': release['releasedOn'], 'periodEnd': end, 'reviewedOn': today,
            'currency': previous['currency'], 'basis': previous.get('basis'), 'sources': sources, 'evidence': evidence,
            'tiles': written['tiles'], 'numbers': written['numbers'], 'history': history, 'summary': written['summary']}


# ---- the summary: MU's own template first, then the stored deep analysis ----------------------------------------------------

MARGIN_WORDS = (('調整後粗利益率', 'Adjusted gross margin'), ('調整後粗利益率', 'Adj. gross margin'), ('調整後粗利益率', 'adjusted gross margin'))


def mu_template(n, currency, margin_label):
    """MU's automatic dive (earnings_dive.summary: fixed templates over the parsed figures, no model) for this company's figures.
    Its amounts are written in 億ドル / $…B; for EUR and TWD (same scale) the unit is swapped, KRW (another scale) is not used.
    MU's margin is non-GAAP: the label is the company's own basis (e.g. 粗利益率(GAAP)). None when the template cannot be used."""
    import earnings_dive
    if currency not in ('USD', 'EUR', 'TWD'):
        return None
    try:
        out = earnings_dive.summary(n)
    except (ValueError, KeyError, TypeError, ArithmeticError):
        return None
    ja_unit, _, prefix, _ = UNITS[currency]
    text = json.dumps(out, ensure_ascii=False)
    if currency != 'USD':
        text = text.replace('億ドル', ja_unit).replace('$', prefix)
    if margin_label['ja'] != '調整後粗利益率':
        text = text.replace('調整後粗利益率', margin_label['ja']).replace('Adj. gross margin', margin_label['en']) \
            .replace('Adjusted gross margin', margin_label['en']).replace('adjusted gross margin', margin_label['en'].lower())
    return json.loads(text)


def margin_label(basis):
    text = (basis or {}).get('grossMargin')
    if not text or _adjusted(text):
        return {'ja': '調整後粗利益率', 'en': 'Adjusted gross margin'}
    for std in ('TIFRS', 'IFRS', 'GAAP'):
        if re.search(r'\b' + std + r'\b', text):
            return {'ja': f'粗利益率({std})', 'en': f'{std} gross margin'}
    return {'ja': '粗利益率', 'en': 'Gross margin'}


def summarize(n, currency, note, eps_key, basis=None):
    """Conclusion and the four cards, at MU's depth: MU's own template over the parsed figures first (the same headlines, chips and
    sections MU's page gets), then, for any card the template cannot build or leaves with fewer than three sections, the stored deep
    analysis of the same release (its sections, unknowns, scenarios and next points, in its own order). Never a model call."""
    rev = n['revenue']
    up = rev['current'] >= rev['previous']
    qoq = (Decimal(str(rev['current'])) / Decimal(str(rev['previous'])) - 1) * 100
    cur, _, _ = money(rev['current'], currency)
    prev, _, _ = money(rev['previous'], currency)
    label = margin_label(basis)
    template = mu_template(n, currency, label) or {'conclusion': [], 'cards': {}}
    note = note or {}
    pool = {'sections': [site_copy(s) for s in note.get('sections') or []],
            'unknowns': [site_copy(u) for u in note.get('unknowns') or []],
            'next': [site_copy(x) for x in note.get('next') or []]}
    scenarios = {s['case']: site_copy(s) for s in note.get('scenarios') or []}

    def take(*names):
        for name in names:
            if pool.get(name):
                return pool[name].pop(0)
        return None

    conclusion = list(template['conclusion']) or [{'ja': f"売上は前期の{prev['ja']}から{cur['ja']}へ、前期比{pct(qoq)}でした。",
                                                   'en': f"Revenue {'rose' if up else 'fell'} from {prev['en']} to {cur['en']}, {pct(qoq)} from the previous quarter."}]
    if note.get('summary') and len(conclusion) < 3:
        conclusion.append(site_copy(note['summary']))

    def fill(card, extra):
        """Up to four sections: the template's own, then the analysis texts for keys the card does not have yet."""
        keys = {s['key'] for s in card['sections']}
        for key, text in extra:
            if text and key not in keys and len(card['sections']) < 4:
                card['sections'].append({'key': key, 'text': text})
                keys.add(key)
        return card

    cards = template['cards']
    chip_rev = {'tone': 'up' if up else 'down', 'text': {'ja': f"売上 前期比 {pct(qoq)}", 'en': f"Revenue {pct(qoq)} QoQ"}}
    if 'growth' not in cards:  # MU's growth card needs segment figures; without them the analysis explains the growth
        chips = [chip_rev]
        if rev.get('yearAgo'):
            yoy = (Decimal(str(rev['current'])) / Decimal(str(rev['yearAgo'])) - 1) * 100
            chips.append({'tone': 'up' if yoy >= 0 else 'down', 'text': {'ja': f"前年同期比 {pct(yoy)}", 'en': f"{pct(yoy)} YoY"}})
        cards['growth'] = {'headline': {'ja': f"売上は{cur['ja']}", 'en': f"Revenue of {cur['en']}"}, 'chips': chips,
                           'sections': [{'key': 'happened', 'text': {'ja': f"売上は前期の{prev['ja']}から{cur['ja']}になりました。前期比は{pct(qoq)}です。",
                                                                     'en': f"Revenue went from {prev['en']} last quarter to {cur['en']} ({pct(qoq)} QoQ)."}}]}
    fill(cards['growth'], [('means', take('sections')), ('good', take('sections')), ('view', take('sections'))])
    if 'change' not in cards:
        cards['change'] = {'headline': chip_rev['text'], 'chips': [chip_rev], 'sections': [{'key': 'happened', 'text': take('sections') or cards['growth']['sections'][0]['text']}]}
    if n['adjustedEPS'] is not None and len(cards['change']['chips']) < 3:
        eps = per_share(n['adjustedEPS'], currency)
        word = ('調整後EPS', 'Adjusted EPS') if eps_key == 'adjusted-eps' else ('EPS', 'EPS')
        cards['change']['chips'].append({'tone': 'gold', 'text': {'ja': f"{word[0]} {eps['ja']}", 'en': f"{word[1]} {eps['en']}"}})
    fill(cards['change'], [('means', take('sections')), ('good', take('sections')), ('view', take('sections') or scenarios.get('base'))])
    if 'caution' not in cards:
        cards['caution'] = {'headline': {'ja': '確認したい点', 'en': 'Points to check'},
                            'chips': [{'tone': 'gold', 'text': {'ja': '会社資料に未記載の点', 'en': 'Not stated in the release'}}],
                            'sections': [{'key': 'happened', 'text': take('unknowns', 'sections')}] if pool['unknowns'] or pool['sections'] else []}
    fill(cards['caution'], [('watch', take('unknowns') or scenarios.get('reassessment')), ('means', take('sections')),
                            ('view', scenarios.get('reassessment') or take('unknowns'))])
    if 'next' not in cards:
        first = take('next')
        cards['next'] = {'headline': {'ja': '次の決算で確かめたい点', 'en': 'What to check in the next report'},
                         'chips': [{'tone': 'gold', 'text': {'ja': '次の決算', 'en': 'Next report'}}],
                         'sections': [{'key': 'happened', 'text': first}] if first else []}
    fill(cards['next'], [('watch', take('next')), ('view', scenarios.get('base') or scenarios.get('upside') or take('next')),
                         ('means', take('next'))])
    for card in cards.values():
        card.pop('segment', None)  # MU's segment keys; these companies' numbers carry no segments
    return {'conclusion': conclusion[:3], 'cards': {k: cards[k] for k in ('growth', 'change', 'caution', 'next')}}


# ---- checks, storage and the run ----------------------------------------------------------------------------------------------

def fixture_text(draft, texts):
    """check_dives' cached source text for the draft: each quote with WINDOW characters either side, from the texts given."""
    spans = {}
    for e in draft.get('evidence') or []:
        if not isinstance(e, dict):
            continue
        text, quote = texts.get(e.get('url')), check_dives.normalize(str(e.get('quote', '')))
        at = text.find(quote) if text and quote else -1
        if at >= 0:
            spans.setdefault(e['url'], []).append((max(0, at - check_dives.WINDOW), min(len(text), at + len(quote) + check_dives.WINDOW)))
    lines = []
    for url, ranges in spans.items():
        merged = []
        for a, b in sorted(ranges):
            if merged and a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        lines.append(f'@@ {url}')
        lines.extend(texts[url][a:b].strip() for a, b in merged)
        lines.append('')
    return '\n'.join(lines)


def checks(ticker, draft, release, previous, texts):
    """Every problem with a draft ([] = publishable). check_dives runs unchanged against the draft and the source texts."""
    import earnings_patrol as patrol
    problems = []
    if not isinstance(draft, dict):
        return ['not a JSON object']
    with tempfile.TemporaryDirectory() as folder:
        fixtures = Path(folder)
        (fixtures / f'{ticker}-source.txt').write_text(fixture_text(draft, texts), encoding='utf-8')
        path = fixtures / f'{ticker}.json'
        path.write_text(json.dumps(draft, ensure_ascii=False), encoding='utf-8')
        saved = check_dives.FIXTURES
        check_dives.FIXTURES = fixtures
        try:
            problems.extend(check_dives.Checker(path).run())
        finally:
            check_dives.FIXTURES = saved
    if draft.get('ticker') != ticker:
        problems.append('ticker')
    if draft.get('releasedOn') != release['releasedOn']:
        problems.append('releasedOn is not the release date')
    if previous and draft.get('period') == previous.get('period'):
        problems.append('period is the previous quarter')
    if release.get('period') and normalize_period(draft.get('period')) != normalize_period(release['period']):
        problems.append('period is not the release\'s quarter')
    revenue = patrol.amount((release['facts'].get('revenue') or {}).get('value'))
    current = ((draft.get('numbers') or {}).get('revenue') or {}).get('current')
    if not revenue or not isinstance(current, (int, float)) or abs(Decimal(str(current)) - revenue[1]) > revenue[2]:
        problems.append('revenue differs from the deterministic reading of the release')
    history = draft.get('history') or []
    if previous and (not history or history[-1].get('end') != previous.get('periodEnd')
                     or history[-1].get('value') != previous['numbers']['revenue']['current']):
        problems.append('history does not continue the previous file')
    return problems


def generate(db, ticker, release, now=None, previous=None, note=None):
    """Build, check and store one dive from what already exists. Returns 'passed', 'failed' or 'waiting' (MU's template alone does not
    pass and the release's deep analysis is not written yet).
    `release`: {'url', 'accession', 'accepted', 'releasedOn', 'period', 'facts', 'text', 'form'}. Never calls a model."""
    schema(db)
    now = now or datetime.now(timezone.utc)
    previous = previous if previous is not None else previous_dive(ticker)
    if db.execute("SELECT 1 FROM generated_dives WHERE ticker=? AND release_accession=? AND state='passed'", (ticker, dive_key(release))).fetchone():
        return 'passed'
    note = note if note is not None else stored_analysis(db, ticker, release['accepted'])
    texts = {release['url']: check_dives.normalize(release['text'])}
    for other in [release.get('report'), release.get('prior')] + list(release.get('events') or []) + list(release.get('exhibits') or []):  # 10-Q, the previous release, other 8-Ks, other exhibits
        if other and other.get('url') and other.get('text'):
            texts[other['url']] = check_dives.normalize(other['text'])
    for e in (previous or {}).get('evidence') or []:  # the previous file's quoted passages, for the figures it carries forward
        texts[e['url']] = (texts.get(e['url'], '') + ' ' + check_dives.normalize(e['quote'])).strip()
    try:
        draft = build(ticker, release, previous, note, now.date().isoformat())
        problems = checks(ticker, draft, release, previous, texts)
    except ValueError as exc:
        draft, problems = None, [str(exc)[:300]]
    if problems and note is None:
        return 'waiting'  # MU's template alone is not enough here: wait for the release's deep analysis (written minutes after it)
    attempt = db.execute('SELECT count(*) FROM generated_dives WHERE ticker=? AND release_accession=?', (ticker, dive_key(release))).fetchone()[0] + 1
    state = 'failed' if problems else 'passed'
    fixture = fixture_text(draft, texts) if isinstance(draft, dict) else None
    previous_failure = db.execute("SELECT errors FROM generated_dives WHERE ticker=? AND release_accession=? ORDER BY attempt DESC LIMIT 1",
                                  (ticker, dive_key(release))).fetchone()
    if state == 'failed' and previous_failure and previous_failure[0] == json.dumps(problems[:20], ensure_ascii=False):
        return 'failed'  # the same inputs fail the same way: nothing new to store
    with db:
        db.execute('INSERT INTO generated_dives VALUES(?,?,?,?,?,?,?,?,?,?)',
                   (ticker, str((draft or {}).get('period') or release.get('period') or ''), dive_key(release), attempt, state,
                    json.dumps(draft, ensure_ascii=False) if draft is not None else None, fixture,
                    json.dumps(problems[:20], ensure_ascii=False), None, now.isoformat(timespec='seconds')))
    at = now.isoformat(timespec='seconds')
    if state == 'failed':
        monitor.record_operational_incident(db, INCIDENT_PREFIX + ticker, CATEGORY, ticker, 'warning', 'checks-failed', seen_at=at)
    else:
        monitor.resolve_operational_incident(db, INCIDENT_PREFIX + ticker, resolved_at=at)
    return state


def published(db):
    """{ticker: dive} of the newest passed draft per company, for GET /company-dives (the site validates each one again)."""
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='generated_dives'").fetchone():
        return {}
    out = {}
    for row in db.execute("SELECT ticker,payload FROM generated_dives WHERE state='passed' ORDER BY at"):
        out[row['ticker']] = json.loads(row['payload'])
    return out


def dive_key(release):
    """One dive per release AND per set of filings it was built from: the 10-Q or a deal 8-K filed later makes a new, deeper version."""
    parts = [release['accession']]
    if release.get('report'):
        parts.append('report:' + release['report']['accession'])
    parts += ['event:' + e['accession'] for e in release.get('events') or []]
    return '|'.join(parts)


def due(patrol_results, db, folder=None):
    """The roster releases a dive is due for: a release read cleanly by the patrol, newer than the committed file, not yet passed."""
    out = []
    for key, release in patrol_results.items():
        if not key.endswith(':release') or not release or 'facts' not in release:
            continue
        ticker = key[:-len(':release')]
        previous = previous_dive(ticker, folder)
        if not previous or normalize_period(release.get('period')) == normalize_period(previous.get('period')):
            continue
        out.append(ticker)  # generate() itself skips a key (release, 10-Q, 8-Ks) already passed
    return out
