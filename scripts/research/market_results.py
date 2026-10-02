"""Automatic bilingual factual flashes. Never copy a publisher's prose.

Only recognized result fields are published; previews, missing units, stale
revisions and unsupported formats remain private. Consensus is not blended.
"""
import json
import re
from datetime import datetime, timezone, timedelta
import time
from urllib.parse import urlsplit
import monitor

ACCOUNTS = {'tipranks', 'wallstengine', 'fabymetal4'}
NAMES = {'tipranks': 'TipRanks',
         'wallstengine': 'Wall St Engine', 'fabymetal4': 'FabyΔ'}
VALUE = r'([-+−]?\d[\d,]*(?:\.\d+)?)\s*(B|M|K|billion|million|thousand|%)?'
METRICS = [
    ('revenue', '売上高', 'Revenue', r'(?:revenue|sales|売上高?)', True),
    ('eps', 'EPS', 'EPS', r'(?:(?:adjusted|adj\.?|non[- ]?GAAP|GAAP|調整後)\s*)?EPS', False),
    ('gross-margin', '粗利益率', 'Gross margin', r'(?:(?:adjusted|adj\.?|non[- ]?GAAP|GAAP|調整後)\s*)?(?:gross margin|粗利(?:益)?率)', False),
    ('operating-cash-flow', '営業キャッシュフロー', 'Operating cash flow', r'(?:operating cash flow|営業キャッシュフロー)', True),
]
MACRO = re.compile(r'\b(?:ADP|CPI|PPI|PCE|FOMC|NFP|non[- ]?farm payrolls|GDP|unemployment rate|(?:average|avg\.?) hourly earnings)\b', re.I)
PREVIEW = re.compile(r'earnings preview|upcoming|ahead of|will report|scheduled to|expected to report', re.I)


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS market_result_publications(
      event_id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
      sha TEXT NOT NULL, payload TEXT NOT NULL, published_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL)''')



def economic_metric(text):
    label = MACRO.search(text)
    if not label:
        return None
    tail = text[label.end():]
    # Do not associate the first result with another metric later in a post.
    next_label = MACRO.search(tail)
    segment = tail[:next_label.start()] if next_label else tail
    actual = re.search(r'(?:actual|実績|結果)\s*[:=]?\s*' + VALUE, segment, re.I)
    if not actual:
        # Structured result labels can omit "Actual". Require a separator
        # and never promote forecasts/previous readings into actuals.
        prefix = re.split(r'[\n;|]', text[:label.start()])[-1]
        if re.search(r'\best\b|forecast|expected|estimate|consensus|previous|prior|予想|前回', prefix, re.I):
            return None
        actual = re.match(r'\s*(?:(?:\([^\n()]{1,30}\)|MoM|YoY|M/M|Y/Y)\s*)*(?:[:=]\s*|(?=[-+−\d]))' + VALUE, segment, re.I)
    if not actual or re.match(r'\s*(?:est\b|expected|forecast|estimate|consensus|previous|prior|予想|前回)', segment[actual.end():], re.I):
        return None
    if not re.fullmatch(r'[-+−]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?',actual[1]):
        return None
    number = actual[1].replace(',', '').replace('−', '-') + (actual[2] or '')
    period = label[0].upper()
    ja, en = period, period
    if re.fullmatch(r'NFP|non[- ]?farm payrolls',label[0],re.I):
        if actual[2] == '%':
            return None
        ja, en = '非農業部門雇用者数', 'Nonfarm payrolls'
    elif label[0].lower() == 'unemployment rate':
        if actual[2] != '%':
            return None
        ja, en = '失業率', 'Unemployment rate'
    elif re.fullmatch(r'(?:average|avg\.?) hourly earnings', label[0], re.I):
        if actual[2] != '%':
            return None
        basis = re.search(r'\b(MoM|YoY)\b|M/M|Y/Y|month.over.month|year.over.year',segment[:actual.end()],re.I)
        if not basis:
            return None
        monthly = bool(re.fullmatch(r'MoM|M/M|month.over.month',basis[0],re.I))
        suffix = 'MoM' if monthly else 'YoY'
        period += ' ('+suffix+')'
        ja, en = '平均時給（'+('前月比' if monthly else '前年比')+'）', 'Average hourly earnings ('+suffix+')'
    return {'kind': 'economic', 'ticker': 'ECON', 'period': period,
            'facts': [{'key':'actual', 'ja':'結果', 'en':'Actual', 'value':number}],
            'titleJa': ja + '：結果 ' + number,
            'titleEn': en + ': actual ' + number}


def economic_projection(text):
    labels = list(MACRO.finditer(text))
    parts = []
    for index, label in enumerate(labels):
        # Preserve a same-line forecast prefix and bound values to one metric.
        start = max(text.rfind('\n', 0, label.start()), text.rfind(';', 0, label.start()), text.rfind('|', 0, label.start())) + 1
        prefix = text[start:label.start()]
        if re.search(r'\best\b|forecast|expected|estimate|consensus|previous|prior|予想|前回', prefix, re.I):
            continue
        end = labels[index + 1].start() if index + 1 < len(labels) else len(text)
        item = economic_metric(text[label.start():end])
        if item:
            parts.append(item)
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    facts = []
    for item in parts:
        ja = item['titleJa'].split('：結果')[0]
        en = item['titleEn'].split(': actual')[0]
        key = {'Nonfarm payrolls':'nonfarm-payrolls', 'Unemployment rate':'unemployment-rate',
               'Average hourly earnings (MoM)':'hourly-earnings-mom', 'Average hourly earnings (YoY)':'hourly-earnings-yoy'}.get(en)
        if key:
            fact = {'key':key, 'ja':ja, 'en':en, 'value':item['facts'][0]['value']}
            if fact not in facts:
                facts.append(fact)
    if not facts:
        return parts[0]
    month = re.search(r'\b(January|February|March|April|May|June|July|August|September|October|November|December)\b.*?\b(?:U\.S\. )?JOBS REPORT\b', text, re.I)
    period = (month[1].upper() + ' JOBS REPORT') if month else 'EMPLOYMENT RESULTS'
    return {'kind':'economic', 'ticker':'ECON', 'period':period, 'facts':facts,
            'titleJa':'／'.join(f['ja']+' '+f['value'] for f in facts),
            'titleEn':'; '.join(f['en']+' '+f['value'] for f in facts)}

def projection(text, tickers):
    if not isinstance(text, str) or len(text) > 160000 or PREVIEW.search(text):
        return None
    if 'ECON' in tickers:
        return economic_projection(text)
    if len(tickers) != 1 or not re.search(r'earnings|results|highlights|決算', text, re.I):
        return None
    period = re.search(r'(?:(?:FY)?\s*(20\d{2})\s*)?Q([1-4])(?:\s*(?:FY)?\s*(20\d{2}))?', text, re.I)
    if not period:
        return None
    guidance = re.split(r'\b(?:guidance|outlook)\b|ガイダンス|見通し', text, maxsplit=1, flags=re.I)
    facts = []
    for section, part in enumerate(guidance):
        for key, ja, en, pattern, money in METRICS:
            if section and key not in {'revenue', 'eps'}:
                continue
            m = None
            for candidate in re.finditer(r'(?<!\w)(' + pattern + r')\s*[:=]?\s*\$?\s*' + VALUE, part, re.I):
                prefix = re.split(r'[\n;|]', part[:candidate.start()])[-1]
                if re.search(r'(?:est(?:imate[ds]?)?|expected|consensus|forecast|prior(?: quarter| year)?|previous(?: quarter| year)?)\s*[:=]?\s*$', prefix, re.I):
                    continue
                m = candidate
                break
            if not m:
                continue
            number, unit = m[2].replace(',', '').replace('−', '-'), m[3] or ''
            if key!='gross-margin' and '$' not in m[0]:
                continue  # Never silently assume USD for a currency-free or foreign-currency value.
            if money and unit.lower() not in {'b','m','k','billion','million','thousand'}:
                continue
            if key == 'gross-margin' and unit != '%':
                continue
            if key == 'eps' and unit:
                continue
            unit = {'billion':'B','million':'M','thousand':'K'}.get(unit.lower(),unit.upper() if unit != '%' else '%')
            value = ('$' if key != 'gross-margin' else '') + number + unit
            if re.search(r'adjusted|adj\.?|non[- ]?GAAP|調整後', m[1], re.I):
                ja, en = '調整後' + ja, 'Adjusted ' + en
            elif re.search(r'\bGAAP\b', m[1], re.I):
                ja, en = 'GAAP ' + ja, 'GAAP ' + en
            if section:
                annual = bool(re.search(r'(?:full[- ]year|annual|通期|FY\s*20\d{2})\s*$', guidance[0].strip(), re.I) or re.search(r'full[- ]year|annual|通期', part[:m.start()], re.I))
                ja, en = ('通期 ' + ja, 'Full-year ' + en) if annual else ('会社見通し ' + ja, 'Guidance ' + en)
            # Ranges are preserved only when explicitly present next to the value.
            tail = part[m.end():m.end()+35]
            spread = re.match(r'\s*(?:±|\+/-)\s*\$?\s*' + VALUE, tail, re.I)
            if spread:
                value += ' ± ' + ('$' if key != 'gross-margin' else '') + spread[1] + (spread[2] or unit)
            facts.append({'key':('guidance-' if section else '')+key, 'ja':ja, 'en':en, 'value':value})
    if not any(f['key'] in {'revenue','eps'} for f in facts):
        return None
    quarter = 'Q' + period[2] + (' ' + (period[1] or period[3]) if period[1] or period[3] else '')
    first = [f for f in facts if not f['key'].startswith('guidance-')][:2]
    return {'kind':'earnings', 'ticker':tickers[0], 'period':quarter, 'facts':facts,
            'titleJa':tickers[0]+' '+quarter+'決算：'+ '、'.join(f['ja']+f['value'] for f in first),
            'titleEn':tickers[0]+' '+quarter+' earnings: '+', '.join(f['en']+' '+f['value'] for f in first)}


def run_once(path, sources, reference=None):
    reference = reference or datetime.now(timezone.utc)
    allowed = {s['id']:s for s in sources if s.get('format') == 'x-api'}
    with monitor.connect(path) as db:
        schema(db)
        rows = db.execute('''SELECT e.*,d.text AS body,d.sha AS current_sha
          FROM signal_events e JOIN signal_documents d ON d.source_id=e.source_id AND d.url=e.url
          WHERE julianday(e.observed_at)>=julianday(?) ORDER BY e.id DESC LIMIT 200''',
                         ((reference-timedelta(hours=24)).isoformat(),)).fetchall()
        for row in rows:
            if row['source_id'] not in allowed or row['truncated'] or row['sha'] != row['current_sha']:
                continue
            url = urlsplit(row['url'])
            match = re.fullmatch(r'/([A-Za-z0-9_]+)/status/(\d+)',url.path)
            if url.scheme != 'https' or url.hostname != 'x.com' or not match or match[1].lower() not in ACCOUNTS:
                continue
            if match[1].lower() not in {a.lower() for a in allowed[row['source_id']].get('accounts',[])}:
                continue
            try:
                release = datetime.fromisoformat(row['published_at'].replace('Z','+00:00'))
                if release.tzinfo is None or not reference-timedelta(hours=24) <= release <= reference:
                    continue
            except (TypeError,ValueError,AttributeError):
                continue
            started = time.monotonic()
            result = projection(row['body'], json.loads(row['tickers_json']))
            if not result:
                continue
            result.update({'id':str(row['id']), 'url':row['url'], 'publisher':NAMES[match[1].lower()],
                           'publishedAt':row['published_at'], 'observedAt':row['observed_at'],
                           'researchId':'x-result-'+str(row['id'])})
            with db:
                db.execute('''INSERT OR IGNORE INTO market_result_publications VALUES(?,?,?,?,?,?,?)''',
                           (row['id'],row['source_id'],row['url'],row['sha'],json.dumps(result,ensure_ascii=False),
                            datetime.now(timezone.utc).isoformat(timespec='milliseconds'),round((time.monotonic()-started)*1000)))


def latest_source_posts(items):
    """Keep attributed source figures, even when publishers disagree.

    A newer post supersedes the same publisher's older post for that period.
    Never merge values across posts or replace a reported value with a hold.
    """
    latest={}
    for item in items:
        key=(item['ticker'],item['period'],item['publisher'])
        if key not in latest or datetime.fromisoformat(item['publishedAt'])>datetime.fromisoformat(latest[key]['publishedAt']):
            latest[key]=item
    return [item for item in items if latest[(item['ticker'],item['period'],item['publisher'])] is item]


def public_feed(db, reference=None):
    schema(db)
    cutoff = ((reference or datetime.now(timezone.utc))-timedelta(hours=24)).isoformat()
    rows = db.execute('''SELECT p.payload,p.published_at,p.processing_ms,e.observed_at,e.published_at AS source_at,d.text AS body,e.tickers_json
      FROM market_result_publications p JOIN signal_documents d
      ON d.source_id=p.source_id AND d.url=p.url AND d.sha=p.sha
      JOIN signal_events e ON e.id=p.event_id
      WHERE julianday(e.published_at)>=julianday(?) ORDER BY julianday(e.published_at) DESC LIMIT 20''',(cutoff,))
    items = []
    for row in rows:
        item = json.loads(row['payload'])
        account = re.fullmatch(r'/([A-Za-z0-9_]+)/status/\d+', urlsplit(item['url']).path)
        if not account or account[1].lower() not in ACCOUNTS:
            continue
        # Re-project stored flashes with the current parser, so earlier parsing
        # mistakes are not kept public merely because the source SHA is unchanged.
        current=projection(row['body'],json.loads(row['tickers_json']))
        if current is None:
            continue
        item.update(current)
        item['publicAt'] = row['published_at']
        item['processingMs'] = row['processing_ms']
        item['sourceToDetectionMs'] = monitor.stored_latency_ms(row['source_at'],row['observed_at'])
        item['detectionToPublicMs'] = monitor.stored_latency_ms(row['observed_at'],row['published_at'])
        items.append(item)
    return latest_source_posts(items)


def diagnostics(db):
    items = public_feed(db)
    return {"status":"running", "publishedLast24Hours":len(items),
            "latest":[{k:item[k] for k in ("researchId","ticker","kind","publishedAt","observedAt","publicAt","processingMs","sourceToDetectionMs","detectionToPublicMs")} for item in items[:5]],
            "unsupportedFormats":"held-private", "numericTranslation":"bilingual-field-labels"}
