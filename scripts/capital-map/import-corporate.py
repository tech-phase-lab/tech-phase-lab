"""Import reviewed corporate 13F files from a local directory; no network access.

Usage: python3 scripts/capital-map/import-corporate.py /path/to/source-files
Sources: SEC filings and https://www.sec.gov/files/company_tickers.json.
ETF identifiers: official iShares product pages 239724 (ITOT), 239726 (IVV).
"""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1])
REPORTS = [
    ('amazon', 'Amazon', '1018724', '000110465926092052', '2026-08-06', 'infotable.xml'),
    ('intel', 'Intel', '50863', '000005086326000176', '2026-08-14', 'information_table.xml'),
    ('cisco', 'Cisco', '858877', '000119312526302050', '2026-07-13', '55437.xml'),
]
# Reviewed issuer/class mappings. Symbols checked against SEC company_tickers.json.
SYMBOLS = dict(zip(
    ['01748X102', '04626A103', '086921103', '573874104', '76954A103', '98386P102',
     'G65163100', '60741F104', '21873S108', '84615Q103', '639193101', '781154109',
     '464287150', '464287200'],
    ['ALGT', 'ALAB', 'BETA', 'MRVL', 'RIVN', 'XE', 'JOBY', 'MBLY', 'CRWV', 'SPCX',
     'NAVN', 'RBRK', 'ITOT', 'IVV']))
NAMES = {'464287150': 'iShares Core S&P Total U.S. Stock Market ETF',
         '464287200': 'iShares Core S&P 500 ETF'}
portfolios = []
for key, name, cik, accession, filed, tablefile in REPORTS:
    coverraw = (SOURCE / (key + '-primary_doc.xml')).read_bytes()
    raw = (SOURCE / (key + '-' + tablefile)).read_bytes()
    cover = ET.fromstring(coverraw)
    rows = ET.fromstring(raw).findall('{*}infoTable')
    count = int(cover.findtext('.//{*}tableEntryTotal'))
    total = int(cover.findtext('.//{*}tableValueTotal'))
    assert cover.findtext('.//{*}submissionType') == '13F-HR'
    assert cover.findtext('.//{*}reportCalendarOrQuarter') == '06-30-2026'
    assert key.upper() in cover.findtext('.//{*}filingManager/{*}name').upper()
    assert len(rows) == count
    assert sum(int(r.findtext('{*}value')) for r in rows) == total
    grouped = {}
    for row in rows:
        cusip = row.findtext('{*}cusip').upper()
        instrument = (row.findtext('{*}putCall') or 'stock').lower()
        assert row.findtext('.//{*}sshPrnamtType') == 'SH'
        assert instrument in {'stock', 'put', 'call'}
        position = grouped.setdefault((cusip, instrument), dict(
            securityId=cusip, ticker=SYMBOLS.get(cusip, ''),
            name=NAMES.get(cusip, row.findtext('{*}nameOfIssuer')),
            shareClass=row.findtext('{*}titleOfClass'), instrument=instrument, shares=0, value=0))
        position['shares'] += int(row.findtext('.//{*}sshPrnamt'))
        position['value'] += int(row.findtext('{*}value'))
    base = f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession}/'
    portfolios.append(dict(id=key+'-13f', kind='corporate', name=name, subtitle='SEC 13F · 2026 Q2',
        current=dict(id=key+'-'+accession, asOf='2026-06-30', publishedOn=filed, complete=True,
            holdings=sorted(grouped.values(), key=lambda h: -h['value']),
            source=dict(type='13f', url=base+tablefile, coverUrl=base+'primary_doc.xml',
                accession=accession, checkedOn='2026-10-12', entryCount=count, totalValue=total,
                sha256=hashlib.sha256(raw).hexdigest()))))
(ROOT / 'lib/research/capital-map-corporate.json').write_text(
    json.dumps(portfolios, ensure_ascii=False, indent=2) + '\n')
for p in portfolios:
    print(p['name'], len(p['current']['holdings']), p['current']['source']['totalValue'])
