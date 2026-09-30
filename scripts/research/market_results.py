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

ACCOUNTS = {'tipranks', 'theflynews', 'wallstengine', 'fabymetal4'}
NAMES = {'tipranks': 'TipRanks', 'theflynews': 'The Fly',
         'wallstengine': 'Wall St Engine', 'fabymetal4': 'FabyΔ'}
VALUE = r'([-+−]?\d[\d,]*(?:\.\d+)?)\s*(B|M|K|billion|million|thousand|%)?'
METRICS = [
    ('revenue', '売上高', 'Revenue', r'(?:revenue|sales|売上高?)', True),
    ('eps', 'EPS', 'EPS', r'(?:(?:adjusted|non[- ]?GAAP|調整後)\s*)?EPS', False),
    ('gross-margin', '粗利益率', 'Gross margin', r'(?:(?:adjusted|non[- ]?GAAP|調整後)\s*)?(?:gross margin|粗利(?:益)?率)', False),
    ('operating-cash-flow', '営業キャッシュフロー', 'Operating cash flow', r'(?:operating cash flow|営業キャッシュフロー)', True),
]
MACRO = re.compile(r'\b(?:ADP|CPI|PPI|PCE|FOMC|NFP|nonfarm payrolls|GDP|unemployment rate)\b', re.I)
PREVIEW = re.compile(r'earnings preview|upcoming|ahead of|will report|scheduled to|expected to report', re.I)


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS market_result_publications(
      event_id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, url TEXT NOT NULL,
      sha TEXT NOT NULL, payload TEXT NOT NULL, published_at TEXT NOT NULL,
      processing_ms INTEGER NOT NULL)''')


def projection(text, tickers):
    if not isinstance(text, str) or len(text) > 160000 or PREVIEW.search(text):
        return None
    economic = 'ECON' in tickers
    if economic:
        label = MACRO.search(text)
        actual = re.search(r'(?:actual|実績|結果)\s*[:=]?\s*' + VALUE, text, re.I)
        if not label or not actual:
            return None
        number = actual[1].replace(',', '').replace('−', '-') + (actual[2] or '')
        return {'kind': 'economic', 'ticker': 'ECON', 'period': label[0].upper(),
                'facts': [{'key':'actual', 'ja':'結果', 'en':'Actual', 'value':number}],
                'titleJa': label[0].upper() + '：結果 ' + number,
                'titleEn': label[0].upper() + ': actual ' + number}
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
            m = re.search(r'(?<!\w)(' + pattern + r')\s*[:=]?\s*\$?\s*' + VALUE, part, re.I)
            if not m:
                continue
            number, unit = m[2].replace(',', '').replace('−', '-'), m[3] or ''
            if money and unit.lower() not in {'b','m','k','billion','million','thousand'}:
                continue
            if key == 'gross-margin' and unit != '%':
                continue
            if key == 'eps' and unit:
                continue
            unit = {'billion':'B','million':'M','thousand':'K'}.get(unit.lower(),unit.upper() if unit != '%' else '%')
            value = ('$' if key != 'gross-margin' else '') + number + unit
            if re.search(r'adjusted|non[- ]?GAAP|調整後', m[1], re.I):
                ja, en = '調整後' + ja, 'Adjusted ' + en
            if section:
                ja, en = '次四半期 ' + ja, 'Next-quarter ' + en
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


def public_feed(db, reference=None):
    schema(db)
    cutoff = ((reference or datetime.now(timezone.utc))-timedelta(hours=24)).isoformat()
    rows = db.execute('''SELECT p.payload,p.published_at,p.processing_ms,e.observed_at,e.published_at AS source_at
      FROM market_result_publications p JOIN signal_documents d
      ON d.source_id=p.source_id AND d.url=p.url AND d.sha=p.sha
      JOIN signal_events e ON e.id=p.event_id
      WHERE julianday(e.published_at)>=julianday(?) ORDER BY julianday(e.published_at) DESC LIMIT 20''',(cutoff,))
    items = []
    for row in rows:
        item = json.loads(row['payload'])
        item['publicAt'] = row['published_at']
        item['processingMs'] = row['processing_ms']
        item['sourceToDetectionMs'] = monitor.stored_latency_ms(row['source_at'],row['observed_at'])
        item['detectionToPublicMs'] = monitor.stored_latency_ms(row['observed_at'],row['published_at'])
        items.append(item)
    return items


def diagnostics(db):
    items = public_feed(db)
    return {"status":"running", "publishedLast24Hours":len(items),
            "latest":[{k:item[k] for k in ("researchId","ticker","kind","publishedAt","observedAt","publicAt","processingMs","sourceToDetectionMs","detectionToPublicMs")} for item in items[:5]],
            "unsupportedFormats":"held-private", "numericTranslation":"bilingual-field-labels"}
