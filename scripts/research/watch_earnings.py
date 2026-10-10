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

VERSION = 'mu-watch-v3'
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


SEGMENTS = {
    'cloud': ('Cloud Memory Business Unit', 'クラウド'),
    'core': ('Core Data Center Business Unit', 'コア・データセンター'),
    'client': ('Mobile and Client Business Unit', 'モバイル・クライアント'),
    'auto': ('Automotive and Embedded Business Unit', '車載・組み込み'),
}


def table_facts(text, quarter, year, metrics, evidence):
    """Optional tables: exact period order, units and row counts are required.

    Unknown tables never block the quarterly highlights or borrow old facts.
    Six-column GAAP/non-GAAP rows must repeat the same three revenue values.
    """
    current=f'FQ{quarter}-{str(year)[-2:]}'
    prior=f'FQ{quarter-1 if quarter>1 else 4}-{str(year if quarter>1 else year-1)[-2:]}'
    older=f'FQ{quarter}-{str(year-1)[-2:]}'
    def section(start, end):
        found=list(re.finditer(re.escape(start)+r' (.*?)'+re.escape(end),text,re.I))
        return found[0][1] if len(found)==1 else None
    def periods(body, repeats):
        return re.findall(r'FQ[1-4]-\d{2}',body)==[current,prior,older]*repeats
    def values(body, start, end, count, percent=False):
        found=list(re.finditer(re.escape(start)+r' (.*?)'+re.escape(end),body,re.I))
        if len(found)!=1: return None
        row=found[0][1]
        # Allow only numeric cells and their currency/percentage separators.
        if re.sub(NUMBER+r'|[\s$%|]', '', row): return None
        nums=[decimal(x) for x in re.findall(NUMBER,row)]
        if len(nums)!=count or (percent and row.count('%')!=count): return None
        # Loss margins may be negative (and can fall below -100%).
        if percent and any(x>100 for x in nums): return None
        return nums
    financial=section('Quarterly Financial Results','Annual Financial Results')
    if financial and 'in millions' in financial.lower() and periods(financial,2) and re.search(r'GAAP.*Non-GAAP',financial,re.I):
        revenue=values(financial,'Revenue','Gross margin',6)
        margin=values(financial,'Percent of revenue','Operating expenses',6,True)
        # Rounded highlight values may differ by at most half their last digit.
        tolerance=Decimal(str(metrics.pop('_revenueTolerance',0)))
        keys=['revenueMillionUSD','previousRevenueMillionUSD','yearAgoRevenueMillionUSD']
        if revenue and revenue[:3]==revenue[3:] and all(x>=0 and abs(x-Decimal(str(metrics[k])))<=tolerance for k,x in zip(keys,revenue)):
            metrics.update({k:float(x) for k,x in zip(keys,revenue)})
            if margin:
                metrics.update(adjustedGrossMarginPercent=float(margin[3]),previousAdjustedGrossMarginPercent=float(margin[4]))
            evidence.append(financial)
    metrics.pop('_revenueTolerance',None)
    business=section('Quarterly Business Unit Financial Results','Business Outlook')
    segments={}
    if business and financial and 'in millions' in financial.lower() and periods(business,1):
        names='|'.join(re.escape(v[0]) for v in SEGMENTS.values())
        for key,(name,_) in SEGMENTS.items():
            found=list(re.finditer(re.escape(name)+r' (.*?)(?='+names+r'|$)',business,re.I))
            if len(found)!=1: continue
            body=found[0][1]
            revenue=values(body,'Revenue','Gross margin',3)
            gross=values(body,'Gross margin','Operating margin',3,True)
            operating=values(body+' END','Operating margin','END',3,True)
            if revenue and gross and operating and all(x>=0 for x in revenue):
                segments[key]={'revenueMillionUSD':float(revenue[0]),'previousRevenueMillionUSD':float(revenue[1]),'operatingMarginPercent':float(operating[0]),'previousOperatingMarginPercent':float(operating[1])}
        # The issuer table leaves small unallocated residuals. Preserve those
        # explicitly; don't call them rounding or silently scale segment values.
        residuals={k:Decimal(str(metrics[k]))-sum(Decimal(str(s[k])) for s in segments.values()) for k in ('revenueMillionUSD','previousRevenueMillionUSD')}
        if len(segments)==len(SEGMENTS) and all(0<=value<=Decimal(str(metrics[k]))*Decimal('0.001') for k,value in residuals.items()):
            metrics['segments']=segments
            metrics['segmentResidualMillionUSD']={k:float(v) for k,v in residuals.items()}
            evidence.append(business)


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
    metrics['_revenueTolerance']=float(Decimal('0.5')*Decimal(10)**decimal(rev[1]).as_tuple().exponent*unit)
    table_facts(text,int(section[1]),int(section[2]),metrics,evidence)
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
            margins=list(re.finditer(r'Gross margin Approximately '+NUMBER+r'% Approximately '+NUMBER+r'%',outlook[1],re.I))
            if len(margins)==1 and re.search(r'GAAP.*Non-GAAP',outlook[1],re.I):
                value=number(margins[0][2])
                if value<=100:
                    metrics['guidanceAdjustedGrossMarginPercent']=value
                    evidence.append(margins[0][0])
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
            published_at=publication_at(db,row)
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
                    publishedAt=published_at,processingMs=round((time.perf_counter()-clock)*1000,3),method='deterministic-issuer-numbers')
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
    if 'adjustedGrossMarginPercent' in m and m['adjustedGrossMarginPercent']<m['previousAdjustedGrossMarginPercent']:
        risk.append(c('調整後粗利益率が前四半期から低下','Adjusted gross margin declined sequentially'))
    segments=m.get('segments',{})
    for key,s in segments.items():
        if s['operatingMarginPercent']<s['previousOperatingMarginPercent']:
            name,ja=SEGMENTS[key]
            risk.append(c(ja+'営業利益率 '+n(s['previousOperatingMarginPercent'])+'% → '+n(s['operatingMarginPercent'])+'%',name.replace(' Business Unit','')+' operating margin '+n(s['previousOperatingMarginPercent'])+'% → '+n(s['operatingMarginPercent'])+'%'))
    if 'guidanceAdjustedGrossMarginPercent' in m and 'adjustedGrossMarginPercent' in m and m['guidanceAdjustedGrossMarginPercent']<m['adjustedGrossMarginPercent']:
        risk.append(c('次期の調整後粗利益率見通しは今回実績を下回る','Next-quarter adjusted gross margin guidance is below current actual'))
    if not risk: risk=[c('今回抽出した数値だけではリスク全体を評価できません','The extracted figures do not establish the full risk picture')]
    titles=[c('成長の中身','Growth drivers'),c('前回からの変化','What changed'),c('注意点','Risks to watch'),c('次に見るポイント','Next checkpoints')]
    heads=[c('売上と現金収支を確認','Revenue and operating cash flow'),growth,risk[0],c('次期の会社見通しを追う','Track company guidance')]
    points=[[c('売上高 '+revenue['ja'],'Revenue '+revenue['en']),c('営業キャッシュフロー '+cash['ja'],'Operating cash flow '+cash['en'])],[compare,eps],risk,[c('売上見通し '+guide['ja'],'Revenue guidance '+guide['en'])]]
    details=[c('部門別の寄与はこの自動抽出では取得していません。','Segment contributions are not extracted by this adapter.'),c('売上の増減率は同じ公式発表の前四半期実績から算出。EPSはnon-GAAPです。','Revenue growth is calculated against the prior-quarter actual in the same release. EPS is non-GAAP.'),c('減収・赤字・現金収支を定型で確認。その他のリスクがないことを意味しません。','Rule-based checks cover falling revenue, losses and cash flow. This does not establish the absence of other risks.'),c('会社予想であり、実績や市場予想とは異なります。','Company guidance is neither an actual result nor analyst consensus.')]
    if segments:
        key=max(segments,key=lambda key:abs(segments[key]['revenueMillionUSD']-segments[key]['previousRevenueMillionUSD']))
        s=segments[key]; name,ja=SEGMENTS[key]; en=name.replace(' Business Unit','')
        before,after=money(s['previousRevenueMillionUSD']),money(s['revenueMillionUSD'])
        heads[0]=c('部門別で売上変化が最大：'+ja,'Largest segment revenue change: '+en)
        points[0]=[c('部門売上 '+before['ja']+' → '+after['ja'],'Segment revenue '+before['en']+' → '+after['en']),c('部門営業利益率 '+n(s['previousOperatingMarginPercent'])+'% → '+n(s['operatingMarginPercent'])+'%','Segment operating margin '+n(s['previousOperatingMarginPercent'])+'% → '+n(s['operatingMarginPercent'])+'%')]
        delta=Decimal(str(m['revenueMillionUSD']))-Decimal(str(baseline))
        segment_delta=Decimal(str(s['revenueMillionUSD']))-Decimal(str(s['previousRevenueMillionUSD']))
        if delta and delta*segment_delta>0:
            share=segment_delta/delta*100
            residual=m.get('segmentResidualMillionUSD',{})
            suffix=(' 部門合計と全社売上には差額があります。' if any(residual.values()) else '')
            en_suffix=(' Segment totals differ slightly from company revenue.' if any(residual.values()) else '')
            details[0]=c('全社の売上変化額に対する部門の寄与は'+f'{share:.1f}'+'%。価格・数量・製品構成の寄与は分けられません。'+suffix,'The segment accounts for '+f'{share:.1f}'+'% of the company revenue change. Pricing, volume and mix contributions are not isolated.'+en_suffix)
        else:
            details[0]=c('同じ発表の前四半期実績と比較。全社と逆方向の変化、または全社変化ゼロの場合、寄与率は示しません。','Compared with prior-quarter actuals in the same release. Contribution shares are omitted when the company change is zero or has the opposite sign.')
    if 'adjustedGrossMarginPercent' in m:
        current,prior=m['adjustedGrossMarginPercent'],m['previousAdjustedGrossMarginPercent']
        difference=Decimal(str(current))-Decimal(str(prior))
        points[1]=[growth,c('調整後粗利益率 '+n(prior)+'% → '+n(current)+'%','Adjusted gross margin '+n(prior)+'% → '+n(current)+'%')]
        details[1]=c('粗利益率の変化は'+f'{difference:+.1f}'+'ポイント。増減率（%）とは異なります。EPSはnon-GAAPです。','Gross margin changed '+f'{difference:+.1f}'+' percentage points, not percent. EPS is non-GAAP.')
    if 'guidanceAdjustedGrossMarginPercent' in m:
        value=n(m['guidanceAdjustedGrossMarginPercent'])
        points[3].append(c('調整後粗利益率見通し 約'+value+'%','Adjusted gross margin guidance: approximately '+value+'%'))
    # Keep the visible summary compact; retain every detected risk in detail.
    points[2]=risk[:2]
    if len(risk)>2:
        details[2]=c('／'.join(x['ja'] for x in risk[2:])+'。その他のリスクがないことを意味しません。','; '.join(x['en'] for x in risk[2:])+'. This does not establish the absence of other risks.')
    if len(risk)==1 and risk[0]['en'].startswith('The extracted figures'):
        heads[2]=c('リスク評価の範囲','Scope of risk checks')
    return {'tiles':tiles,'cards':[{'title':titles[i],'headline':heads[i],'points':points[i],'detail':details[i],'sourceSection':'Fiscal quarterly highlights / Quarterly Financial Results / Quarterly Business Unit Financial Results / Business Outlook'} for i in range(4)]}
