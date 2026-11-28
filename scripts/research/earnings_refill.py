"""Fill the blanks of earnings results already stored, once per parser version (Nov 28).

Rows stored before the parsers improved keep their figures but lack some: CrowdStrike's GAAP EPS and operating loss, the adjusted EPS
of AMAT / KLAC / STX / LRCX / ANET (no 市場予想 without it), the year-ago columns of LITE, SNDK, TSLA, PLTR, ... The live flash re-reads
a release only for seven days; this reads each older stored release again with the current parser (issuer_result_flash.PROFILES and
release_extras.supplement, the live flash's own reading) and only FILLS:

- a missing year-ago value (comparisons.yearAgo / growth) of a figure whose stored value the new reading confirms;
- a figure (key) the row does not have, when the new reading has it;
- an outlook only when the row has none for the same figure and horizon.

A stored value is never changed. It is confirmed when the new reading, rounded to the stored figure's own precision, is the stored
figure ("$1.58B" and "$1.583419B"); the filled year-ago value is then written at that same precision ("$1.23B"), so the card keeps
what it showed. A release whose new reading names another period, or disagrees with a stored value, is left as it is (code
`conflict`). Only the payload is written: observed_at and published_at stay, so nothing is "fresh" again for a push, the patrol's
release trigger or the news feed (a push notice needs a release published within 15 minutes; X posts are copied by the owner).

Text: the monitor's stored revision of the release when it has one, else the SEC exhibit read again (public SEC, ≤ 4 requests a
second, the monitor's SEC User-Agent). Each row is tried once per VERSION; a network failure is retried on the next run.
"""
import contextlib
import json
import re
import urllib.error
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import earnings_history_backfill as backfill
import issuer_result_flash as flash
import monitor
import release_extras

VERSION = 'refill-v1'
LIVE = flash.WINDOW   # younger rows are re-read by the live flash itself
MAX_FACTS = 16
AMOUNT = re.compile(r'^(NT\$|\$|€|₩)?(-?)(\d+(?:\.(\d+))?)([BMKT]?)$')
SCALE = {'T': Decimal(10) ** 12, 'B': Decimal(10) ** 9, 'M': Decimal(10) ** 6, 'K': Decimal(1000), '': Decimal(1)}


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS earnings_refills(
      key TEXT NOT NULL, store TEXT NOT NULL, version TEXT NOT NULL, state TEXT NOT NULL, filled TEXT, at TEXT NOT NULL,
      PRIMARY KEY(key, store, version))''')


def amount(text):
    """'$1.583419B' -> (currency, value, decimals, unit); None for a range, a band or anything else."""
    m = AMOUNT.match((text or '').strip())
    if not m:
        return None
    try:
        value = Decimal(m[3]) * SCALE[m[5]]
    except InvalidOperation:
        return None
    return m[1] or '$', -value if m[2] else value, len(m[4] or ''), m[5]


def at_precision(text, like):
    """`text` written with the unit and decimals of `like` ('$-26.776M' like '$24.9M' -> '$-26.8M'); None when either is unreadable."""
    a, b = amount(text), amount(like)
    if not a or not b or a[0] != b[0]:
        return None
    scaled = (a[1] / SCALE[b[3]]).quantize(Decimal(1).scaleb(-b[2]))
    return f'{b[0]}{"-" if scaled < 0 else ""}{abs(scaled)}{b[3]}'


def confirms(stored, read):
    """The new reading is the stored figure, to the stored figure's own precision (or exactly, for text that is not an amount)."""
    if stored == read:
        return True
    return at_precision(read, stored) == stored


def horizon(fact):
    label = f"{fact.get('ja', '')} {fact.get('en', '')}"
    if fact['key'].startswith('guidance-fy-') or re.search(r'通期|full[- ]year', label, re.I):
        return 'year'
    if re.search(r'次四半期|next[- ]quarter|[（(]Q[1-4] ?FY', label, re.I):
        return 'quarter'
    return None


def metric(key):
    return re.sub(r'^guidance-(?:fy-)?', '', key)


def fill(stored, read):
    """(new facts, filled codes) of a stored payload's facts with the blanks the new reading fills; never changes a stored value.
    Raises ValueError('conflict') when the reading disagrees with a stored figure."""
    facts = [dict(f, comparisons=dict(f['comparisons'])) if f.get('comparisons') else dict(f) for f in stored]
    filled = []
    # Dell's full-year outlook was stored as guidance-revenue (labelled 通期) before Nov 28; when today's reading has the same value as
    # guidance-fy-revenue, the stored fact takes that key (its value and label stay), so the next quarter's outlook can be filled.
    read_keys = {f['key']: f for f in read}
    for old in facts:
        renamed = 'guidance-fy-' + metric(old['key'])
        if old['key'].startswith('guidance-') and not old['key'].startswith('guidance-fy-') and horizon(old) == 'year' \
                and renamed in read_keys and confirms(old['value'], read_keys[renamed]['value']) and renamed not in {f['key'] for f in facts}:
            filled.append(f"{old['key']} as {renamed}")
            old['key'] = renamed
    by_key = {f['key']: f for f in facts}
    for new in read:
        old = by_key.get(new['key'])
        if old is None:
            continue
        if new['key'].startswith('guidance-'):
            # an outlook of the same horizon and value may take the release's own previous figure (Dell's 'Previous' column)
            prior = (new.get('comparisons') or {}).get('priorGuidance')
            if prior and horizon(old) == horizon(new) and confirms(old['value'], new['value']) \
                    and not (old.get('comparisons') or {}).get('priorGuidance'):
                old['comparisons'] = {**(old.get('comparisons') or {}), 'priorGuidance': prior}
                filled.append(f"{new['key']}.priorGuidance")
            continue  # otherwise a stored outlook is left as it is
        if not confirms(old['value'], new['value']):
            raise ValueError('conflict')
        comparisons = old.get('comparisons') or {}
        for name in ('yearAgo', 'growth'):
            value = (new.get('comparisons') or {}).get(name)
            if not value or comparisons.get(name):
                continue
            if name == 'yearAgo':
                value = value if amount(old['value']) is None or old['value'] == new['value'] else at_precision(value, old['value'])
                if value is None:
                    continue
            comparisons[name] = value
            filled.append(f"{new['key']}.{name}")
        if comparisons:
            old['comparisons'] = comparisons
    for new in read:
        if new['key'] in by_key or len(facts) >= MAX_FACTS:
            continue
        if new['key'].startswith('guidance-') and any(o['key'].startswith('guidance-') and metric(o['key']) == metric(new['key'])
                                                      and horizon(o) == horizon(new) for o in facts):
            continue
        at = len(facts) if new['key'].startswith('guidance-') else next(
            (i for i, f in enumerate(facts) if f['key'].startswith('guidance-')), len(facts))
        facts.insert(at, new)
        by_key[new['key']] = new
        filled.append(new['key'])
    return facts, filled


def release_text(db, url, client):
    row = db.execute('SELECT r.extracted_text FROM sources s JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256 WHERE s.url=?',
                     (url,)).fetchone() if db.execute("SELECT 1 FROM sqlite_master WHERE name='source_revisions'").fetchone() else None
    if row and row[0]:
        return row[0]
    content, kind = client.get(url)
    return monitor.extract_text(content, kind)


def sec_text(client, ticker, url):
    """The release text behind a stored SEC link: the exhibit itself, or, for a link to the 8-K's own document (DELL, NVDA, CRWD,
    PANW, AMAT, CRWV), its results exhibit read with the monitor's SEC code, as the live flash and the backfill read it."""
    content, kind = client.get(url)
    evidence = monitor.sec_exhibit_evidence(content, url, ticker, client.transport)
    if evidence and evidence.get('extractedText'):
        return evidence['extractedText']
    return monitor.extract_text(content, kind)


def reading(ticker, url, text):
    """The facts the live flash would store for this release today (its payload shape)."""
    parsed = release_extras.supplement(text, flash.parse_with_sentences(ticker, text, url))
    _key, payload = flash.build(ticker, url, parsed, flash.stamp())
    return parsed['period'], payload['facts']


STORES = (('issuer_result_publications', 'key', 'observed_at'), ('earnings_prior_releases', 'key', 'observed_at'))


def run_once(path, now=None, client=None, lock=None, log=print):
    """One pass over the stored rows older than the live window that this VERSION has not tried. Returns counts."""
    now = now or datetime.now(timezone.utc)
    guard = lock or contextlib.nullcontext()
    counts = {'filled': 0, 'unchanged': 0, 'conflict': 0, 'unreadable': 0, 'failed': 0}
    with guard:
        db = monitor.connect(path)
        try:
            schema(db)
            db.commit()
            todo = []
            for store, key, observed in STORES:
                if not db.execute("SELECT 1 FROM sqlite_master WHERE name=?", (store,)).fetchone():
                    continue
                for row in db.execute(f'SELECT {key} AS key,ticker,url,payload,{observed} AS observed FROM {store} '
                                      'WHERE julianday(' + observed + ')<julianday(?)', ((now - LIVE).isoformat(),)):
                    done = db.execute('SELECT 1 FROM earnings_refills WHERE key=? AND store=? AND version=?', (row['key'], store, VERSION)).fetchone()
                    if not done and row['ticker'] in flash.PROFILES and json.loads(row['payload']).get('facts'):
                        todo.append((store, dict(row)))
        finally:
            db.close()
    for store, row in todo:
        state, filled = 'unchanged', []
        try:
            with guard:
                db = monitor.connect(path)
                try:
                    stored_text = release_text(db, row['url'], _NoNetwork())
                except _Offline:
                    stored_text = None
                finally:
                    db.close()
            if stored_text is None:
                client = client or backfill.Client(per_second=4.0, user_agent=monitor.sec_user_agent())
                stored_text = sec_text(client, row['ticker'], row['url'])
            payload = json.loads(row['payload'])
            period, read = reading(row['ticker'], row['url'], stored_text)
            if period != payload.get('period'):
                raise ValueError('conflict')
            facts, filled = fill(payload['facts'], read)
            if filled:
                state = 'filled'
                payload['facts'] = facts
        except (urllib.error.URLError, TimeoutError, OSError):
            counts['failed'] += 1
            continue
        except ValueError as exc:
            state = 'conflict' if str(exc) == 'conflict' else 'unreadable'
        except Exception:  # noqa: BLE001 - one row never stops the others
            state = 'unreadable'
        with guard:
            db = monitor.connect(path)
            try:
                with db:
                    if state == 'filled':  # the payload only: its times stay, so nothing reads as a new release
                        db.execute(f'UPDATE {store} SET payload=? WHERE key=?', (json.dumps(payload, ensure_ascii=False), row['key']))
                    db.execute('INSERT OR REPLACE INTO earnings_refills VALUES(?,?,?,?,?,?)',
                               (row['key'], store, VERSION, state, json.dumps(filled), flash.stamp(now)))
            finally:
                db.close()
        counts[state] += 1
        if filled:
            log(json.dumps({'event': 'earnings-refill', 'ticker': row['ticker'], 'period': payload.get('period'), 'filled': filled}))
    log(json.dumps({'event': 'earnings-refill-run', **counts}))
    return counts


class _Offline(Exception):
    pass


class _NoNetwork:
    """release_text's client while the database lock is held: the network is never used under the lock."""

    def get(self, _url):
        raise _Offline()


