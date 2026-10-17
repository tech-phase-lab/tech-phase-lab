"""Import reviewed local SEC XML and issuer holdings files. No network or scheduler.

Usage: python scripts/capital-map/import-reviewed.py /path/to/capital-more
XLSX imports require openpyxl. Sources and content hashes are retained in the output.
"""
from pathlib import Path
import csv
import datetime as dt
import hashlib
import io
import json
import re
import sys
import xml.etree.ElementTree as ET
import openpyxl

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1])
urls = json.loads((ROOT / 'scripts/capital-map/sources.json').read_text())
output = ROOT / 'lib/research/capital-map-disclosures.json'
existing = json.loads(output.read_text())
# Preserve the three previously reviewed snapshots.
portfolios = [p for p in existing if p['id'] in {'berkshire-13f', 'nvidia-13f', 'alphabet-13f'}]
assert len(portfolios) == 3
mapping = {h['securityId']: h['ticker'] for p in portfolios for h in p['current']['holdings'] if h['ticker']}
checked = '2026-10-12'

def num(value):
    return float(str(value).replace(',', '').replace('$', '').replace('%', '').strip())

def source(file, count, total=0, kind='issuer', cover=None, accession=''):
    raw = (SOURCE / file).read_bytes()
    return dict(type=kind, url=urls[file], coverUrl=urls.get(cover, urls[file]), accession=accession,
                checkedOn=checked, entryCount=count, totalValue=total, sha256=hashlib.sha256(raw).hexdigest())

def etf(ticker, subtitle, date, holdings, file, raw_count):
    assert holdings and len({h['securityId'] for h in holdings}) == len(holdings)
    assert all(h['shares'] > 0 and 0 <= h['reportedWeight'] <= 100 for h in holdings)
    assert 98 < sum(h['reportedWeight'] for h in holdings) <= 100.1
    return dict(id=ticker.lower()+'-etf', kind='etf', name=ticker, subtitle=subtitle,
                current=dict(id=ticker.lower()+'-'+date, asOf=date, publishedOn=date, complete=True,
                             holdings=sorted(holdings, key=lambda h:-h['reportedWeight']),
                             source=source(file, raw_count, round(sum(h['value'] for h in holdings), 2))))

etfs = []
for ticker, subtitle in [('SPY','S&P 500'), ('XLK','Technology'), ('XLF','Financials')]:
    file=ticker+'.xlsx'
    rows=list(openpyxl.load_workbook(SOURCE/file,read_only=True,data_only=True).active.values)
    assert rows[1][1] == ticker and rows[4][:3] == ('Name','Ticker','Identifier')
    date=dt.datetime.strptime(rows[2][1], 'As of %d-%b-%Y').date().isoformat()
    entries=[r for r in rows[5:] if isinstance(r[4], (float,int))]
    holdings=[]
    for r in entries:
        # The issuer file identifies cash / money market with '-' and futures by month.
        if not r[1] or r[1]=='-' or re.search(r'\b(?:MAR|JUN|SEP|DEC)\d{2}\b',str(r[0])):
            continue
        symbol=r[1] if re.fullmatch(r'[A-Z][A-Z0-9.-]{0,14}',r[1]) else ''
        if symbol:
            if r[2] in mapping: assert mapping[r[2]] == symbol
            mapping[r[2]]=symbol
        holdings.append(dict(securityId=r[2],ticker=symbol,name=r[0],instrument='stock',shares=r[6],value=0,reportedWeight=r[4]))
    etfs.append(etf(ticker,subtitle,date,holdings,file,len(entries)))

# Use the same security identifiers across issuer files for overlap comparisons.
reverse={v:k for k,v in mapping.items()}
file='SOXX.csv'
raw=(SOURCE/file).read_text(encoding='utf-8-sig')
lines=raw.splitlines()
date=dt.datetime.strptime(next(csv.reader([lines[1]]))[1],'%b %d, %Y').date().isoformat()
start=next(i for i,line in enumerate(lines) if line.startswith('Ticker,Name,'))
entries=list(csv.DictReader(io.StringIO('\n'.join(lines[start:]))))
holdings=[]
for r in entries:
    if r.get('Asset Class') != 'Equity': continue
    symbol=r['Ticker']
    holdings.append(dict(securityId=reverse.get(symbol,'ticker:'+symbol),ticker=symbol,name=r['Name'],instrument='stock',shares=num(r['Quantity']),value=num(r['Market Value']),reportedWeight=num(r['Weight (%)'])))
etfs.append(etf('SOXX','iShares Semiconductor',date,holdings,file,len(entries)))
file='SMH.xlsx'
rows=list(openpyxl.load_workbook(SOURCE/file,read_only=True,data_only=True).active.values)
date=dt.datetime.strptime(re.search(r'\d{2}/\d{2}/\d{4}',rows[0][0])[0],'%m/%d/%Y').date().isoformat()
entries=[r for r in rows[3:] if isinstance(r[0],(int,float))]
holdings=[]
for r in entries:
    if r[5]!='Stock':continue
    symbol=r[1]
    holdings.append(dict(securityId=reverse.get(symbol,'ticker:'+symbol),ticker=symbol,name=r[2],instrument='stock',shares=num(r[4]),value=num(r[6]),reportedWeight=num(r[8])))
etfs.append(etf('SMH','VanEck Semiconductor',date,holdings,file,len(entries)))

managers=[('pershing','Pershing Square'),('bridgewater','Bridgewater Associates'),('appaloosa','Appaloosa'),('coatue','Coatue Management'),('tiger','Tiger Global Management'),('viking','Viking Global Investors'),('fundsmith','Fundsmith')]

for key,name in managers:
    coverfile=key+'-cover.xml'; file=key+'-table.xml'
    cover=ET.fromstring((SOURCE/coverfile).read_bytes())
    rows=ET.fromstring((SOURCE/file).read_bytes()).findall('{*}infoTable')
    count=int(cover.findtext('.//{*}tableEntryTotal')); total=int(cover.findtext('.//{*}tableValueTotal'))
    assert len(rows)==count, (key,len(rows),count)
    assert cover.findtext('.//{*}submissionType')=='13F-HR'
    assert cover.findtext('.//{*}reportCalendarOrQuarter')=='06-30-2026'
    # Reject inconsistent tables instead of guessing a dollar/thousands conversion.
    assert sum(int(row.findtext('{*}value')) for row in rows)==total, key
    grouped={}
    for r in rows:
        cusip=r.findtext('{*}cusip').upper(); inst=(r.findtext('{*}putCall') or 'stock').lower()
        assert r.findtext('.//{*}sshPrnamtType')=='SH' and inst in {'stock','put','call'}
        k=(cusip,inst)
        if k not in grouped:
            grouped[k]=dict(securityId=cusip,ticker=mapping.get(cusip,''),name=r.findtext('{*}nameOfIssuer'),shareClass=r.findtext('{*}titleOfClass'),instrument=inst,shares=0,value=0)
        grouped[k]['shares']+=int(r.findtext('.//{*}sshPrnamt'))
        grouped[k]['value']+=int(r.findtext('{*}value'))
    holdings=sorted(grouped.values(),key=lambda h:-h['value'])
    accession=urls[file].split('/')[-2]
    filed=dt.datetime.strptime(cover.findtext('.//{*}signatureDate'),'%m-%d-%Y').date().isoformat()
    if (SOURCE/(key+'-filings.json')).exists():
        filings=json.loads((SOURCE/(key+'-filings.json')).read_text())
        assert len(filings)==1 and filings[0]['accessionNumber'].replace('-','')==accession
        filed=filings[0]['filingDate']
    if key=='fundsmith':
        assert 'FUNDSMITH' in cover.findtext('.//{*}filingManager/{*}name').upper()
    portfolios.append(dict(id=key+'-13f',kind='manager',name=name,subtitle='SEC 13F',current=dict(id=key+'-'+accession,asOf='2026-06-30',publishedOn=filed,complete=True,holdings=holdings,source=source(file,count,total,'13f',coverfile,accession))))

portfolios+=sorted(etfs,key=lambda p:['SPY','SMH','SOXX','XLK','XLF'].index(p['name']))
for p in portfolios:print(p['name'],len(p['current']['holdings']),p['current']['asOf'])
output.write_text(json.dumps(portfolios,ensure_ascii=False,indent=2)+'\n')
