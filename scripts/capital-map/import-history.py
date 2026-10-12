"""Import reviewed prior-quarter SEC 13F XML, retaining source checksums.

Usage: python3 scripts/capital-map/import-history.py /path/to/quarter-sources
Each portfolio needs <id>-cover.xml, <id>-table.xml and <id>-meta.json.
Metadata provides id, name, url, coverUrl, accession and publishedOn from SEC.
No network access; never replace current snapshots or infer trades from values.
"""
from pathlib import Path
import hashlib
import json
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(sys.argv[1])
portfolios = sum([json.loads((ROOT/'lib/research'/name).read_text()) for name in
    ['capital-map-disclosures.json', 'capital-map-corporate.json']], [])
mapping = {h['securityId']: h['ticker'] for p in portfolios
           for h in p['current']['holdings'] if h['ticker']}
history = {}
for p in portfolios:
    if p['kind'] == 'etf':
        continue
    key = p['id']
    meta = json.loads((SOURCE/(key+'-meta.json')).read_text())
    cover = ET.fromstring((SOURCE/(key+'-cover.xml')).read_bytes())
    raw = (SOURCE/(key+'-table.xml')).read_bytes()
    rows = ET.fromstring(raw).findall('{*}infoTable')
    count = int(cover.findtext('.//{*}tableEntryTotal'))
    total = int(cover.findtext('.//{*}tableValueTotal'))
    assert meta['id'] == key and meta['publishedOn'] < p['current']['publishedOn']
    assert int(meta['url'].split('/')[6]) == int(p['current']['source']['url'].split('/')[6])
    assert int(cover.findtext('.//{*}credentials/{*}cik')) == int(meta['url'].split('/')[6])
    assert meta['accession'] == meta['url'].split('/')[-2]
    assert cover.findtext('.//{*}submissionType') == '13F-HR'
    assert cover.findtext('.//{*}reportCalendarOrQuarter') == '03-31-2026'
    assert cover.findtext('.//{*}isAmendment') in ('false', 'N', None)
    assert len(rows) == count and sum(int(r.findtext('{*}value')) for r in rows) == total
    grouped = {}
    for row in rows:
        cusip = row.findtext('{*}cusip').upper()
        instrument = (row.findtext('{*}putCall') or 'stock').lower()
        assert instrument in {'stock', 'put', 'call'}
        assert row.findtext('.//{*}sshPrnamtType') == 'SH'
        h = grouped.setdefault((cusip, instrument), dict(securityId=cusip,
            ticker=mapping.get(cusip, ''), name=row.findtext('{*}nameOfIssuer'),
            shareClass=row.findtext('{*}titleOfClass'), instrument=instrument, shares=0, value=0))
        h['shares'] += int(row.findtext('.//{*}sshPrnamt'))
        h['value'] += int(row.findtext('{*}value'))
    history[key] = dict(id=key+'-'+meta['accession'], asOf='2026-03-31',
        publishedOn=meta['publishedOn'], complete=True,
        holdings=sorted(grouped.values(), key=lambda h: -h['value']),
        source=dict(type='13f', url=meta['url'], coverUrl=meta['coverUrl'],
            accession=meta['accession'], checkedOn='2026-10-12', entryCount=count,
            totalValue=total, sha256=hashlib.sha256(raw).hexdigest()))
    print(key, count, len(grouped), total)
(ROOT/'lib/research/capital-map-history.json').write_text(
    json.dumps(history, ensure_ascii=False, indent=2)+'\n')
