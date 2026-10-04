"""MU watch snapshots from retained issuer releases. No network, LLM or news writes.

Versions are immutable and tied to the current source revision. Unknown layouts
remain diagnosable; they do not relabel a previous quarter as a new result.
"""
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import re
import sqlite3
import time
from urllib.parse import urlsplit

VERSION = 'mu-watch-v1'
NUMBER = r'([−-]?\d+(?:,\d{3})*(?:\.\d+)?)'


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds')


def schema(db):
    db.execute('''CREATE TABLE IF NOT EXISTS watch_earnings_versions(
      revision TEXT PRIMARY KEY, ticker TEXT NOT NULL, url TEXT NOT NULL,
      source_sha TEXT NOT NULL, body_sha TEXT NOT NULL, version TEXT NOT NULL,
      state TEXT NOT NULL, reason TEXT, payload TEXT, attempted_at TEXT NOT NULL)''')


def connect(path, readonly=False):
    db = sqlite3.connect(f'file:{path}?mode=ro' if readonly else path, uri=readonly, timeout=5)
    db.row_factory = sqlite3.Row
    return db


def rows(db):
    # Exact issuer ownership, not incidental ticker mentions. No recent-feed cap.
    return [dict(r) for r in db.execute('''SELECT s.url,s.sha256,s.published_on,
        s.status,s.title,r.extracted_text AS body,r.observed_at AS body_at,
        COALESCE(e.detected_at,s.discovered_at) AS detected_at
        FROM sources s LEFT JOIN source_revisions r ON r.url=s.url AND r.sha256=s.sha256
        LEFT JOIN release_events e ON e.url=s.url
        WHERE s.ticker='MU' AND lower(s.title) LIKE '%quarter%'
        AND lower(s.title) LIKE '%results%'
        ORDER BY s.published_on DESC,s.url''')
        if urlsplit(r['url']).scheme == 'https'
        and urlsplit(r['url']).hostname == 'investors.micron.com']


def revision(row):
    body_sha = hashlib.sha256((row['body'] or '').encode()).hexdigest()
    key = hashlib.sha256((VERSION+'\0'+row['url']+'\0'+str(row['sha256'])+'\0'+body_sha).encode()).hexdigest()
    return key, body_sha


def decimal(text):
    return Decimal(text.replace(',', '').replace('−', '-'))


def number(text, multiplier=1):
    return float(decimal(text)*multiplier)


def parse(row):
    text = re.sub(r'\s+', ' ', row['body'] or '').strip()
    if 'micron' not in (row.get('title') or '').lower() or 'micron' not in text.lower():
        raise ValueError('issuer-identity-missing')
    section = re.search(r'Fiscal Q([1-4]) (20\d{2}) Highlights (.*?)(?:Fiscal 20\d{2} Highlights|Business Outlook)', text, re.I)
    if not section:
        raise ValueError('quarter-section-unrecognized')
    title_years=re.findall(r'20\d{2}',row['title'])
    if title_years and section[2] not in title_years: raise ValueError('period-title-mismatch')
    section_text = section[3]
    def unique(pattern, source=section_text):
        found = list(re.finditer(pattern, source, re.I))
        if len(found)>1:
            raise ValueError('ambiguous-metric')
        return found[0] if found else None
    rev = unique(r'Revenue of \$'+NUMBER+r' (billion|million) versus \$'+NUMBER+r' \2 for the prior quarter and \$'+NUMBER+r' \2 for the same period last year')
    if not rev:
        raise ValueError('quarter-revenue-unrecognized')
    unit = 1000 if rev[2].lower() == 'billion' else 1
    metrics = {'revenueMillionUSD':number(rev[1],unit), 'previousRevenueMillionUSD':number(rev[3],unit), 'yearAgoRevenueMillionUSD':number(rev[4],unit)}
    if any(value < 0 for value in metrics.values()):
        raise ValueError('negative-revenue')
    eps = unique(r'Non-GAAP net (?:income|loss) of \$'+NUMBER+r' (?:billion|million), or \$'+NUMBER+r' per diluted share')
    cash = unique(r'Operating cash flow of \$'+NUMBER+r' (billion|million) versus \$'+NUMBER+r' \2 for the prior quarter')
    if eps:
        metrics['adjustedEPS'] = number(eps[2])
        if 'loss' in eps[0].lower(): metrics['adjustedEPS'] = -abs(metrics['adjustedEPS'])
    if cash:
        metrics['operatingCashFlowMillionUSD'] = number(cash[1],1000 if cash[2].lower()=='billion' else 1)
        metrics['previousOperatingCashFlowMillionUSD'] = number(cash[3],1000 if cash[2].lower()=='billion' else 1)
    evidence = [rev[0], *([eps[0]] if eps else []), *([cash[0]] if cash else [])]
    outlook = re.search(r'Business Outlook (.*?)Further information',text,re.I)
    if outlook:
        period = re.search(r'FQ([1-4])[- ](\d{2}|20\d{2})\b',outlook[1])
        guidance = unique(r'Revenue \$'+NUMBER+r' (billion|million) ± \$'+NUMBER+r' \2',outlook[1])
        if period and guidance:
            factor = 1000 if guidance[2].lower()=='billion' else 1
            mid, spread = decimal(guidance[1])*factor, decimal(guidance[3])*factor
            next_q = int(section[1])%4+1
            next_y = int(section[2])+(int(section[1])==4)
            if (int(period[1]),int(period[2][-2:])+2000)!=(next_q,next_y) or spread<0 or mid<spread:
                raise ValueError('invalid-guidance-period-or-range')
            metrics.update(guidanceLowMillionUSD=float(mid-spread), guidanceHighMillionUSD=float(mid+spread))
            evidence.append(guidance[0])
    return {'ticker':'MU','period':f'FQ{section[1]} {section[2]}','periodOrder':int(section[2])*4+int(section[1]),
            'metrics':metrics,'evidence':evidence}


def latency(start, end):
    try:
        a,b=(datetime.fromisoformat(v.replace('Z','+00:00')) for v in (start,end))
        if a.tzinfo is None or b.tzinfo is None: return None
        value=round((b-a).total_seconds()*1000)
        return value if value>=0 else None
    except (ValueError,TypeError,AttributeError): return None


def publication_at(db,row):
    if not db.execute("SELECT 1 FROM sqlite_master WHERE name='signal_events'").fetchone(): return None
    for r in db.execute("SELECT published_at FROM signal_events WHERE url=? AND source_id LIKE 'primary-ir-%' ORDER BY id DESC",(row['url'],)):
        if r[0] and r[0][:10]==row['published_on'] and latency(r[0],row['detected_at']) is not None: return r[0]
    return None


def run_once(path):
    with connect(path) as db:
        schema(db)
        candidates=rows(db)
        if not candidates: return 'idle'
        # Process all revisions so an older fallback remains available, without
        # allowing an older backfill to outrank a more recent fiscal quarter.
        changed=0
        for row in candidates:
            key,body_sha=revision(row)
            if not row['body'] or row['status'] in {'held','rejected'}: continue
            if db.execute('SELECT 1 FROM watch_earnings_versions WHERE revision=?',(key,)).fetchone(): continue
            started=stamp(); clock=time.perf_counter(); reason=None; payload=None
            try:
                if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}',row['published_on'] or ''): raise ValueError('publication-date-missing')
                released=datetime.fromisoformat(row['published_on']).date()
                if released>datetime.now(timezone.utc).date(): raise ValueError('future-release')
                payload=parse(row)
                payload.update(presentation(payload))
                public=stamp()
                payload.update(revision=key,sourceUrl=row['url'],releasedOn=row['published_on'],
                    detectedAt=row['detected_at'],bodyReadyAt=row['body_at'],preparedAt=started,publicAt=public,
                    publishedAt=publication_at(db,row),processingMs=round((time.perf_counter()-clock)*1000,3),method='deterministic-issuer-numbers')
                payload['sourceToDetectionMs']=latency(payload['publishedAt'],payload['detectedAt'])
                payload['detectionToPublicMs']=latency(payload['detectedAt'],public)
            except ValueError as exc: reason=str(exc)
            db.execute('INSERT INTO watch_earnings_versions VALUES(?,?,?,?,?,?,?,?,?,?)',
                (key,'MU',row['url'],row['sha256'] or '',body_sha,VERSION,'ready' if payload else 'unsupported',reason,
                 json.dumps(payload,ensure_ascii=False) if payload else None,stamp()))
            changed+=1
        return 'updated' if changed else 'idle'


def feed(path):
    with connect(path,readonly=True) as db:
        if not db.execute("SELECT 1 FROM sqlite_master WHERE name='watch_earnings_versions'").fetchone():
            return {'ok':True,'snapshot':None,'status':'waiting'}
        ready=[]; unavailable=[]
        for row in rows(db):
            key,_=revision(row)
            saved=db.execute('SELECT * FROM watch_earnings_versions WHERE revision=?',(key,)).fetchone()
            if row['status'] in {'held','rejected'}: continue
            if saved and saved['state']=='ready': ready.append(json.loads(saved['payload']))
            else: unavailable.append({'releasedOn':row['published_on'],'reason':saved['reason'] if saved else 'waiting-for-body'})
        ready.sort(key=lambda p:(p['periodOrder'],p['releasedOn'],p['bodyReadyAt']),reverse=True)
        latest=ready[0] if ready else None
        pending=[u for u in unavailable if not latest or (u['releasedOn'] or '')>=latest['releasedOn']]
        if latest: latest.pop('evidence',None)
        return {'ok':True,'snapshot':latest,'status':'partial' if pending else 'ready' if latest else 'waiting'}


def presentation(payload):
    """Persist equivalent JA/EN wording once per revision; optional != invented."""
    m=payload['metrics']
    def c(ja,en): return {'ja':ja,'en':en}
    def n(value): return format(Decimal(str(value)).normalize(),'f')
    def money(value): return c(n(Decimal(str(value))/100)+'億ドル', '$'+n(Decimal(str(value))/1000)+'B')
    def metric(label,value,note): return {'label':label,'value':value,'note':note}
    unknown=c('未取得','Not extracted')
    revenue=money(m['revenueMillionUSD']); previous=money(m['previousRevenueMillionUSD'])
    compare=c('前四半期 '+previous['ja'],'Prior quarter '+previous['en'])
    cash=money(m['operatingCashFlowMillionUSD']) if 'operatingCashFlowMillionUSD' in m else unknown
    guide=(c(money(m['guidanceLowMillionUSD'])['ja']+'〜'+money(m['guidanceHighMillionUSD'])['ja'],money(m['guidanceLowMillionUSD'])['en']+'–'+money(m['guidanceHighMillionUSD'])['en']) if 'guidanceLowMillionUSD' in m else unknown)
    tiles=[metric(c('売上高','Revenue'),revenue,compare),metric(c('営業キャッシュフロー','Operating cash flow'),cash,c('四半期実績','Quarterly actual')),metric(c('次四半期の売上見通し','Next-quarter revenue guidance'),guide,c('会社予想','Company forecast'))]
    baseline=m['previousRevenueMillionUSD']
    change=(Decimal(str(m['revenueMillionUSD']))/Decimal(str(baseline))-1)*100 if baseline>0 else None
    growth=c('前四半期比 '+f'{change:+.1f}'+'%','Quarter-on-quarter '+f'{change:+.1f}'+'%') if change is not None else c('比較元がゼロのため増減率は算出しません','Percentage change is unavailable with a zero baseline')
    eps=c('調整後EPS '+n(m['adjustedEPS'])+'ドル','Non-GAAP diluted EPS $'+n(m['adjustedEPS'])) if 'adjustedEPS' in m else c('調整後EPSは未取得','Non-GAAP diluted EPS not extracted')
    risk=[]
    if change is not None and change<0: risk.append(c('前四半期から減収','Revenue declined sequentially'))
    if m.get('adjustedEPS',0)<0: risk.append(c('調整後EPSはマイナス','Non-GAAP diluted EPS is negative'))
    if m.get('operatingCashFlowMillionUSD',0)<0: risk.append(c('営業キャッシュフローはマイナス','Operating cash flow is negative'))
    if 'guidanceHighMillionUSD' in m and m['guidanceHighMillionUSD']<m['revenueMillionUSD']: risk.append(c('次期売上見通しの上限が今回実績を下回る','The upper end of next-quarter revenue guidance is below current revenue'))
    if not risk: risk=[c('今回抽出した数値だけではリスク全体を評価できません','The extracted figures do not establish the full risk picture')]
    titles=[c('成長の中身','Growth drivers'),c('前回からの変化','What changed'),c('注意点','Risks to watch'),c('次に見るポイント','Next checkpoints')]
    heads=[c('売上と現金収支を確認','Revenue and operating cash flow'),growth,risk[0],c('次期の会社見通しを追う','Track company guidance')]
    points=[[c('売上高 '+revenue['ja'],'Revenue '+revenue['en']),c('営業キャッシュフロー '+cash['ja'],'Operating cash flow '+cash['en'])],[compare,eps],risk,[c('売上見通し '+guide['ja'],'Revenue guidance '+guide['en'])]]
    details=[c('部門別の寄与はこの自動抽出では取得していません。','Segment contributions are not extracted by this adapter.'),c('売上の増減率は同じ公式発表の前四半期実績から算出。EPSはnon-GAAPです。','Revenue growth is calculated against the prior-quarter actual in the same release. EPS is non-GAAP.'),c('減収・赤字・現金収支を定型で確認。その他のリスクがないことを意味しません。','Rule-based checks cover falling revenue, losses and cash flow. This does not establish the absence of other risks.'),c('会社予想であり、実績や市場予想とは異なります。','Company guidance is neither an actual result nor analyst consensus.')]
    return {'tiles':tiles,'cards':[{'title':titles[i],'headline':heads[i],'points':points[i],'detail':details[i],'sourceSection':'Fiscal quarterly highlights / Business Outlook'} for i in range(4)]}
