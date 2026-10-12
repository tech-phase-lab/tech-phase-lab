"""Import a reviewed local iShares ACWI CSV; preserve published weights and identities.
Usage: python3 scripts/capital-map/import-acwi.py /path/to/ACWI.csv
"""
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
raw = Path(sys.argv[1]).read_bytes()
text = raw.decode('utf-8-sig')
assert text.splitlines()[0] == 'iShares MSCI ACWI ETF'
as_of = dt.datetime.strptime(next(csv.reader([text.splitlines()[1]]))[1], '%b %d, %Y').date().isoformat()
rows = list(csv.DictReader(io.StringIO(text[text.index('Ticker,Name,'):])) )
existing = json.loads((ROOT / 'lib/research/capital-map-disclosures.json').read_text())
# Match only listings on the same US exchanges. A local foreign share must not
# accidentally match a US ADR or a ticker reused on another exchange.
known = {h['ticker']: h['securityId'] for p in existing if p['kind'] == 'etf' for h in p['current']['holdings'] if h['ticker']}
number = lambda v: float(v.replace(',', ''))
holdings = []
for row in rows:
    if row.get('Asset Class') != 'Equity':
        continue
    ticker = row['Ticker']
    us_listing = row['Exchange'] in {'NYSE', 'NASDAQ'}
    if us_listing:
        ticker = ticker.replace(' ', '.')
    security = known.get(ticker) if us_listing else None
    security = security or 'acwi:' + ':'.join([row['Exchange'], ticker, row['Name']])
    holdings.append(dict(securityId=security, ticker=ticker, name=row['Name'], instrument='stock',
                         shares=number(row['Quantity']), value=number(row['Market Value']), reportedWeight=number(row['Weight (%)'])))
assert len(holdings) == 2197, 'Review a changed source count before import'
assert len({h['securityId'] for h in holdings}) == len(holdings)
assert all(h['shares'] > 0 and h['value'] >= 0 and 0 <= h['reportedWeight'] <= 100 for h in holdings)
assert 98 < sum(h['reportedWeight'] for h in holdings) <= 100.1
url = 'https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf/latest-holdings.csv'
portfolio = dict(id='acwi-etf', kind='etf', name='ACWI', subtitle='MSCI All Country World', current=dict(
    id='acwi-'+as_of, asOf=as_of, publishedOn=as_of, complete=True, holdings=holdings,
    source=dict(type='issuer', url=url, coverUrl='https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf',
                accession='', checkedOn='2026-10-12', entryCount=len(holdings),
                totalValue=round(sum(h['value'] for h in holdings), 2), sha256=hashlib.sha256(raw).hexdigest())))
(ROOT / 'lib/research/capital-map-acwi.json').write_text(json.dumps(portfolio, ensure_ascii=False, separators=(',', ':'))+'\n')
print(as_of, len(holdings), round(sum(h['reportedWeight'] for h in holdings), 2))
