"""決算の深掘り for a new quarter, drafted by a model and published only when every check passes (owner, Nov 26). OFF by default.

The 21 dive files (lib/research/dives/<TICKER>.json) were written by hand from the official releases on Nov 25 and checked with
scripts/research/check_dives.py. This drafts the next quarter's file the same way, once the patrol (earnings_patrol.py) has read a
new release of a roster company:

  1. input: the release's own text (the 8-K Exhibit 99.1 / 6-K), the company's previous dive file (its structure, its wording style and
     its revenue history), and the figures the monitor's deterministic parser read from the same release;
  2. one model call (the service's own model and key, as the PRO deep analysis: RESEARCH_DEEP_MODEL), counted in llm_usage (lane
     'earnings-dive') like every paid call;
  3. checks, all of which must pass, else nothing is published and the owner is alerted (an operational incident):
       - check_dives.py, unchanged: every contract field, the section counts, the Japanese copy rules, no advice wording, and every
         number backed by a quote that appears in the release text (or plain arithmetic over quoted figures);
       - the quarter and the release date are the release's; revenue equals the parser's reading to its printed rounding;
       - the history continues the previous file: its last bar is the previous quarter's revenue as that file states it.
  At most MAX_ATTEMPTS calls per release.

A passed draft is stored (generated_dives) and served to the site (GET /company-dives); the company page uses it only when it is for
a newer quarter than the committed file and passes the site's own validateCompanyDive. Nothing here runs unless EARNINGS_DIVE_AI=true
(the owner's cost approval). The earnings section's figures never depend on this (lib/research/company-earnings-live.ts).
"""
from datetime import datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import re
import tempfile
import time

import check_dives
import monitor

ENABLED_ENV = 'EARNINGS_DIVE_AI'
LANE = 'earnings-dive'
MAX_ATTEMPTS = 2
MAX_RELEASE_CHARS = 60_000
MAX_OUTPUT_TOKENS = 16_000
DIVES = Path(__file__).resolve().parents[2] / 'lib/research/dives'
INCIDENT_PREFIX = 'earnings-dive:'
CATEGORY = 'earnings-dive'

INSTRUCTIONS = """You write the 決算の深掘り (earnings deep dive) data file of one company for a Japanese retail-investor research site.
Return ONE JSON object with exactly the keys of the previous file you are given, for the NEW quarter of the release you are given.
Rules (a file breaking any of them is rejected whole):
- Every figure comes from the release text given. Amounts in millions of the file's currency, as the previous file does.
- evidence: one entry per number in numbers, history and tiles: {"field": "numbers.revenue.current" (the same field names as the previous
  file), "url": the release url given, "quote": an exact passage copied from the release text (the figure must appear in it, or give
  "calc": plain arithmetic over figures in the quote, with "round" when rounded)}. Never paraphrase a quote.
- history: the previous file's history without its oldest bar, plus one bar for the previous quarter (label, end = the previous file's
  periodEnd, value = the previous file's numbers.revenue.current), oldest first. Its evidence may quote the previous release (use the
  previous file's own evidence quote and url for that bar, and list that url in sources).
- period: the issuer's own fiscal label in the previous file's style; releasedOn: the release date given; reviewedOn: today given.
- summary: 1-3 conclusion paragraphs; cards growth, change, caution, next, each 1-3 chips and 3-4 distinct sections, as in the previous file.
- Japanese: natural, ドル (never 米ドル), Japanese money units (億ドル, 兆ウォン), no 。or 、 right after a closing parenthesis.
- Never give advice or a rating (no buy/sell, no price target, no recommendation); keep guidance as the company's guidance; no forecast of your own.
- tiles: three, like the previous file's, for the new quarter."""


def enabled(env=None):
    return (os.environ if env is None else env).get(ENABLED_ENV, '').strip().lower() == 'true'


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS generated_dives(
      ticker TEXT NOT NULL, period TEXT NOT NULL, release_accession TEXT NOT NULL, attempt INTEGER NOT NULL, state TEXT NOT NULL,
      payload TEXT, fixture TEXT, errors TEXT, model TEXT, at TEXT NOT NULL, PRIMARY KEY(ticker, release_accession, attempt))''')


def previous_dive(ticker, folder=None):
    path = (folder or DIVES) / f'{ticker}.json'
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else None


def payload(ticker, release, previous, model, today):
    """The one request: the fixed instructions first (the provider's prompt cache can serve them), then this release."""
    text = check_dives.normalize(release['text'])[:MAX_RELEASE_CHARS]
    return {'model': model, 'store': False, 'max_output_tokens': MAX_OUTPUT_TOKENS, 'instructions': INSTRUCTIONS,
            'prompt_cache_key': 'tech-phase-earnings-dive-v1', 'text': {'format': {'type': 'json_object'}},
            'input': json.dumps({'ticker': ticker, 'releaseUrl': release['url'], 'releasedOn': release['releasedOn'], 'today': today,
                                 'parsedFigures': release['facts'], 'previousFile': previous, 'releaseText': text}, ensure_ascii=False)}


def fixture_text(draft, texts):
    """check_dives' cached source text for the draft: each quote with WINDOW characters either side, from the full texts given."""
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
    """Every problem with a draft ([] = publishable). check_dives runs unchanged against the draft and the release text."""
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


def normalize_period(label):
    m = re.match(r'^Q([1-4]) (FYE?)?\s?(\d{2}|20\d{2})$', str(label or '').strip())
    if not m:
        return None
    year = m[3] if len(m[3]) == 4 else '20' + m[3]
    return f'Q{m[1]} FY{year}' if m[2] else f'Q{m[1]} {year}'


def generate(db, ticker, release, transport, model, now=None, previous=None, texts=None):
    """Draft, check and store one dive. Returns 'passed', 'failed' or 'exhausted'. `release`: {'url', 'accession', 'releasedOn',
    'period', 'facts', 'text'}; `texts`: {url: full normalized text} for every source the draft may quote (default: the release)."""
    import brief_generator
    import llm_cost
    schema(db)
    now = now or datetime.now(timezone.utc)
    previous = previous if previous is not None else previous_dive(ticker)
    attempts = db.execute('SELECT count(*) FROM generated_dives WHERE ticker=? AND release_accession=?', (ticker, release['accession'])).fetchone()[0]
    if db.execute("SELECT 1 FROM generated_dives WHERE ticker=? AND release_accession=? AND state='passed'", (ticker, release['accession'])).fetchone():
        return 'passed'
    if attempts >= MAX_ATTEMPTS:
        return 'exhausted'
    texts = texts or {release['url']: check_dives.normalize(release['text'])}
    if previous:  # the previous release's quoted passages, for the history bar it adds
        for e in previous.get('evidence') or []:
            texts.setdefault(e['url'], '')
            texts[e['url']] += ' ' + check_dives.normalize(e['quote'])
    response = transport(payload(ticker, release, previous, model, now.date().isoformat()))
    llm_cost.record(db, LANE, f'{ticker}:{release["accession"]}', model, response, now=time.time())
    try:
        draft = json.loads(brief_generator.output_text(response))
        problems = checks(ticker, draft, release, previous, texts)
    except Exception as exc:  # noqa: BLE001
        draft, problems = None, [type(exc).__name__]
    state = 'failed' if problems else 'passed'
    with db:
        db.execute('INSERT INTO generated_dives VALUES(?,?,?,?,?,?,?,?,?,?)',
                   (ticker, str((draft or {}).get('period') or release.get('period') or ''), release['accession'], attempts + 1, state,
                    json.dumps(draft, ensure_ascii=False) if draft is not None else None,
                    fixture_text(draft, texts) if isinstance(draft, dict) else None, json.dumps(problems[:20], ensure_ascii=False), model,
                    now.isoformat(timespec='seconds')))
    at = now.isoformat(timespec='seconds')
    if state == 'failed' and attempts + 1 >= MAX_ATTEMPTS:
        monitor.record_operational_incident(db, INCIDENT_PREFIX + ticker, CATEGORY, ticker, 'warning', 'checks-failed', seen_at=at)
    elif state == 'passed':
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


def due(patrol_results, db, folder=None):
    """The roster releases a draft is due for: a release read cleanly by the patrol, newer than the committed file, not yet passed."""
    out = []
    for key, release in patrol_results.items():
        if not key.endswith(':release') or not release or 'facts' not in release:
            continue
        ticker = key[:-len(':release')]
        previous = previous_dive(ticker, folder)
        if not previous or normalize_period(release.get('period')) == normalize_period(previous.get('period')):
            continue
        schema(db)
        if db.execute("SELECT 1 FROM generated_dives WHERE ticker=? AND release_accession=? AND state='passed'",
                      (ticker, release['accession'])).fetchone():
            continue
        out.append(ticker)
    return out
