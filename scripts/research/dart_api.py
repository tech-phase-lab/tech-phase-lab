"""SK hynix's preliminary results from OpenDART (Korea's official disclosure API): the notice, then its figures. Needs a free key.

The key is the environment variable OPENDART_API_KEY (set by the owner on the monitor service; never in code, a log, /health or an error).
Without a valid-looking key this module makes NO request at all. Around SK hynix's scheduled results time (dart_watch.in_window) it asks
OpenDART's notice list for SK hynix's "영업(잠정)실적(공정공시)" every few seconds; when it appears it records the "announced" line
(link to the DART notice) and reads the notice's table through the API (document.xml, never the web viewer that robots.txt disallows):
revenue, operating profit and profit for the period, each only if the table's own stated changes agree with the values.

/health shows only codes: dart.key = set|missing|invalid, dart.selfCheck = ok:<figures>|<error code>, dart.lastPoll = <code>.
"""
import hashlib
import io
import json
import os
import re
import time
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from xml.etree import ElementTree

import dart_watch
import issuer_result_flash as flash
import monitor

API = 'https://opendart.fss.or.kr/api/'
TICKER = 'SKHY'
STOCK_CODE = '000660'
NOTICE = dart_watch.NOTICE
MAX_BYTES = 6_000_000
SELF_CHECK_FROM, SELF_CHECK_TO = '20261027', '20261029'   # Q3 2026 results, announced Oct 28 2026
KOREA = timezone(timedelta(hours=9))
STATE = {'selfCheck': 'pending', 'lastPoll': None, 'corp': None, 'documents': {}}


def key():
    """(state, value): the key only if it looks like an OpenDART key (40 hex characters)."""
    value = os.environ.get('OPENDART_API_KEY', '').strip()
    if not value:
        return 'missing', None
    return ('set', value) if re.fullmatch(r'[0-9a-fA-F]{40}', value) else ('invalid', None)


def call(path, params, raw=False):
    """One OpenDART request. Every failure becomes a short code; the URL (which carries the key) never leaves this function."""
    state, value = key()
    if value is None:
        raise ValueError('no-key')
    url = API + path + '?' + urllib.parse.urlencode({'crtfc_key': value, **params})
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'TechPhaseResearch-SourceCheck/0.1', 'Accept-Encoding': 'identity'})
        with urllib.request.urlopen(request, timeout=10) as response:
            if urllib.parse.urlsplit(response.geturl()).hostname != 'opendart.fss.or.kr':
                raise ValueError('redirect-off-host')
            body = response.read(MAX_BYTES + 1)
    except ValueError as exc:
        raise ValueError(str(exc)) from None
    except urllib.error.HTTPError as exc:
        raise ValueError('http-%d' % exc.code) from None
    except TimeoutError:
        raise ValueError('timeout') from None
    except Exception:
        raise ValueError('network') from None
    if not body or len(body) > MAX_BYTES:
        raise ValueError('bad-size')
    if raw:
        return body
    try:
        data = json.loads(body)
    except ValueError:
        raise ValueError('bad-json') from None
    status = data.get('status') if isinstance(data, dict) else None
    if status not in ('000', '013'):       # 013: no data for the query
        raise ValueError('dart-status-%s' % (status if isinstance(status, str) and re.fullmatch(r'\d{3}', status) else 'unknown'))
    return data


def corp_code(call_fn=call):
    """SK hynix's OpenDART company code, from the official code list (looked up once per process)."""
    if STATE['corp']:
        return STATE['corp']
    body = call_fn('corpCode.xml', {}, raw=True)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            names = archive.namelist()
            if len(names) != 1 or archive.getinfo(names[0]).file_size > 60_000_000:
                raise ValueError('bad-zip')
            xml = archive.read(names[0])
    except zipfile.BadZipFile:
        # a wrong key is answered with a small JSON/XML error, not a zip
        raise ValueError('not-a-zip') from None
    if b'<!DOCTYPE' in xml[:2000].upper() or b'<!ENTITY' in xml.upper():
        raise ValueError('bad-xml')
    root = ElementTree.fromstring(xml)
    for item in root.iter('list'):
        if (item.findtext('stock_code') or '').strip() == STOCK_CODE:
            code = (item.findtext('corp_code') or '').strip()
            if re.fullmatch(r'\d{8}', code):
                STATE['corp'] = code
                return code
    raise ValueError('company-not-found')


def notices(code, start, end, call_fn=call):
    """[(rcept_no, report name)] of SK hynix's preliminary-results notices filed between two YYYYMMDD dates."""
    data = call_fn('list.json', {'corp_code': code, 'bgn_de': start, 'end_de': end, 'page_count': '100'})
    found = []
    for item in data.get('list') or []:
        name = item.get('report_nm') if isinstance(item, dict) else None
        number = item.get('rcept_no') if isinstance(item, dict) else None
        if isinstance(name, str) and NOTICE.search(name) and isinstance(number, str) and re.fullmatch(r'\d{14}', number):
            found.append((number, name[:200]))
    return found


def notice_url(number):
    return 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + number     # shown as a link only; never fetched (robots.txt disallows it)


def document_text(number, call_fn=call):
    """The notice's text through the API (a zip with the notice as XML/HTML), tags stripped, whitespace collapsed."""
    body = call_fn('document.xml', {'rcept_no': number}, raw=True)
    try:
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            parts = [archive.read(name) for name in archive.namelist()[:4] if archive.getinfo(name).file_size <= 6_000_000]
    except zipfile.BadZipFile:
        raise ValueError('not-a-zip') from None
    text = ' '.join(re.sub(r'<[^>]+>', ' ', part.decode('utf-8', 'replace')) for part in parts)
    return ' '.join(re.sub(r'&nbsp;|&#160;', ' ', text).replace('&amp;', '&').split())


ROWS = (('revenue', '매출액'), ('operating-income', '영업이익'), ('net-income', '당기순이익'))
NEXT_LABELS = ('매출액', '영업이익', '법인세비용차감전', '당기순이익', '지배', '비지배', '구분', '※', '2.', '3.')


def parse_prelim(text):
    """Figures from the Korean 영업(잠정)실적 table (millions of won): this period first, then the previous quarter and the same quarter a year
    earlier, with the table's stated changes (%). A row is kept only when exactly one reading of the row agrees with BOTH stated changes
    (0.06 points). The quarter comes from the period end date printed with the table. Returns the same shape as issuer_result_flash parsers."""
    t = ' '.join((text or '').split())
    if not re.search(r'SK\s*하이닉스|SK\s*hynix', t, re.I) or not NOTICE.search(t):
        raise ValueError('notice-not-recognized')
    end = re.search(r'~\s*(20\d\d)\s*[.\-년/ ]\s*(\d{1,2})\s*[.\-월/ ]\s*(\d{1,2})', t)
    if not end or int(end[2]) not in (3, 6, 9, 12):
        raise ValueError('period-unrecognized')
    quarter, year = int(end[2]) // 3, int(end[1])
    if '백만원' not in t:
        raise ValueError('units-unrecognized')
    starts = []
    for key_, label in ROWS:
        found = [m.start() for m in re.finditer(label, t)]
        starts.append((key_, found[0] if found else None))
    positions = sorted(p for _, p in starts if p is not None)
    rows = {}
    for key_, position in starts:
        if position is None:
            continue
        later = [p for p in positions if p > position]
        run = t[position:(later[0] if later else position + 400)][:400]
        amounts = [Decimal(n.replace(',', '')) * (-1 if bracket else 1) for bracket, n in re.findall(r'(?<![\d,.])(\(?)(\d{1,3}(?:,\d{3})+)', run)]
        percents = [Decimal(n) * (-1 if bracket else 1) for bracket, n in re.findall(r'(?<![\d,])(\(?)(-?\d+\.\d)(?![\d,])', run)]
        if len(amounts) < 3 or len(percents) < 2:
            continue
        # the table's order is: this period, previous quarter, change vs it, year-earlier quarter, change vs that (amounts and percents each in that order)
        current, matches = amounts[0], set()
        for i in range(1, len(amounts)):
            for j in range(i + 1, len(amounts)):
                previous, ago = amounts[i], amounts[j]
                if previous <= 0 or ago <= 0:
                    continue
                for k in range(len(percents)):
                    for m in range(k + 1, len(percents)):
                        if abs((current / previous - 1) * 100 - percents[k]) <= Decimal('0.06') and abs((current / ago - 1) * 100 - percents[m]) <= Decimal('0.06'):
                            matches.add((previous, ago))
        if len(matches) == 1:
            rows[key_] = (current, next(iter(matches))[1])
    if 'revenue' not in rows:
        raise ValueError('revenue-row-unrecognized')

    def won(value):
        return flash.prefixed('₩', value / 1000000, 'T')
    names = {'revenue': ('売上高（暫定・兆ウォン）', 'Revenue (preliminary, KRW trillion)'),
             'operating-income': ('営業利益（暫定・兆ウォン）', 'Operating profit (preliminary, KRW trillion)'),
             'net-income': ('当期利益（暫定・兆ウォン）', 'Profit for the period (preliminary, KRW trillion)')}
    facts = [(k, won(rows[k][0]), won(rows[k][1]), names[k]) for k in ('revenue', 'operating-income', 'net-income') if k in rows]
    order = {k: i for i, k in enumerate(flash.ORDER)}
    facts.sort(key=lambda f: order[f[0]])
    return {'period': f'Q{quarter} {year}', 'facts': facts}


def publish(path, number, parsed, now):
    """Store the figures like every other issuer flash (same table, same feed)."""
    url = notice_url(number)
    started = time.monotonic()
    with monitor.connect(path) as db:
        flash.schema(db)
        key_, payload = flash.build(TICKER, url, parsed, flash.stamp(now))
        payload['publisher'] = 'SK hynix IR (DART)'
        with db:
            db.execute('''INSERT INTO issuer_result_publications VALUES(?,?,?,?,?,?,?,?,?)
              ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at,processing_ms=excluded.processing_ms,version=excluded.version''',
                       (key_, TICKER, url, parsed['period'], json.dumps(payload, ensure_ascii=False), flash.stamp(now), flash.stamp(),
                        round((time.monotonic() - started) * 1000), flash.VERSION))


def record_line(path, number, now):
    """The 'announced' line, the same row dart_watch writes from the RSS (same canonical URL, so it is one line)."""
    import earnings_announce
    url = notice_url(number)
    key_ = hashlib.sha256('\0'.join([TICKER, url]).encode()).hexdigest()
    with monitor.connect(path) as db:
        earnings_announce.schema(db)
        with db:
            return db.execute('INSERT OR IGNORE INTO earnings_announcements VALUES(?,?,?,?,?,?,?)',
                              (key_, TICKER, url, 'Latest', now.isoformat(timespec='milliseconds'),
                               datetime.now(timezone.utc).isoformat(timespec='milliseconds'), 0)).rowcount


def run_once(path, now=None, events=None, call_fn=call):
    """Poll inside the results window (nothing outside it, and nothing at all without a key). Returns the number of changes."""
    state, _ = key()
    if state != 'set':
        return 0
    now = now or datetime.now(timezone.utc)
    if not dart_watch.in_window(now, events):
        return 0
    if time.monotonic() - STATE.get('lastAt', 0.0) < dart_watch.POLL_SECONDS:
        return 0
    STATE['lastAt'] = time.monotonic()
    changed = 0
    try:
        code = corp_code(call_fn)
        today = now.astimezone(KOREA).strftime('%Y%m%d')
        yesterday = (now.astimezone(KOREA) - timedelta(days=1)).strftime('%Y%m%d')
        found = notices(code, yesterday, today, call_fn)
        STATE['lastPoll'] = 'ok'
    except ValueError as exc:
        STATE['lastPoll'] = str(exc)[:40]
        return 0
    except Exception:
        STATE['lastPoll'] = 'error'
        return 0
    for number, _name in found:
        changed += record_line(path, number, now)
        done = STATE['documents'].setdefault(number, {'tries': 0, 'done': False, 'at': 0.0})
        if done['done'] or done['tries'] >= 30 or time.monotonic() - done['at'] < 10:
            continue
        done['tries'] += 1
        done['at'] = time.monotonic()
        try:
            publish(path, number, parse_prelim(document_text(number, call_fn)), now)
            done['done'] = True
            changed += 1
        except Exception:
            pass           # the line is out; the figures come from the SEC 6-K if this never reads
    return changed


def self_check(call_fn=call):
    """Once at start: read the Oct 28 2026 notice through the API and parse it. Only a code is kept."""
    state, _ = key()
    if state != 'set':
        STATE['selfCheck'] = 'no-key'
        return STATE['selfCheck']
    try:
        code = corp_code(call_fn)
        found = notices(code, SELF_CHECK_FROM, SELF_CHECK_TO, call_fn)
        if not found:
            STATE['selfCheck'] = 'notice-not-listed'
        else:
            parsed = parse_prelim(document_text(found[0][0], call_fn))
            STATE['selfCheck'] = 'ok:%d' % len(parsed['facts'])
    except ValueError as exc:
        STATE['selfCheck'] = ('error:' + str(exc))[:60]
    except Exception:
        STATE['selfCheck'] = 'error'
    return STATE['selfCheck']


def diagnostics():
    return {'key': key()[0], 'selfCheck': STATE['selfCheck'], 'lastPoll': STATE['lastPoll']}
