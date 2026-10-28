"""Append-only import of reviewed SEC reports; never rewrites the existing map.

Usage: python3 scripts/capital-map/import-additional-managers.py SOURCE_DIRECTORY
Inputs: KEY-{current,previous}-{meta.json,cover.xml,table.xml}. Metadata contains
SEC submissions filing data, CIK and raw cover/table URLs. See CAPITAL-MAP.md.
"""
import datetime as dt
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
MANAGERS = {
    'thiel': (1562087, 'Thiel Macro', 'THIEL MACRO LLC'),
    'soros': (1029160, 'Soros Fund Management', 'SOROS FUND MANAGEMENT LLC'),
    'ark': (1697748, 'ARK Investment Management', 'ARK INVESTMENT MANAGEMENT LLC'),
    'jpmorgan': (19617, 'JPMorgan Chase', 'JPMORGAN CHASE & CO'),
    'blackrock': (2012383, 'BlackRock', 'BLACKROCK, INC.'),
}

def import_reports(directory):
    symbols = {}
    def collect(value):
        if isinstance(value, list):
            for item in value: collect(item)
        elif isinstance(value, dict):
            if value.get('securityId') and value.get('ticker'):
                symbols.setdefault(value['securityId'], set()).add(value['ticker'])
            for item in value.values():
                if isinstance(item, (list, dict)): collect(item)
    for name in ['disclosures', 'corporate', 'acwi', 'history']:
        collect(json.loads((ROOT / f'lib/research/capital-map-{name}.json').read_text()))
    mapping = {k: next(iter(v)) for k, v in symbols.items() if len(v) == 1}
    portfolios = []
    for key, (cik, name, identity) in MANAGERS.items():
        snapshots = {}
        for period, date in [('current', '2026-06-30'), ('previous', '2026-03-31')]:
            stem = directory / f'{key}-{period}'
            meta = json.loads(Path(str(stem) + '-meta.json').read_text())
            filing = meta['filing']; accession = filing['accessionNumber']
            base = f'https://www.sec.gov/Archives/edgar/data/{cik}/{accession.replace("-", "")}/'
            assert meta['cik'] == cik and filing['reportDate'] == date
            assert all(url.startswith(base) for url in meta['urls'].values())
            cover_raw = Path(str(stem) + '-cover.xml').read_bytes()
            cover = ET.fromstring(cover_raw)
            raw = Path(str(stem) + '-table.xml').read_bytes()
            rows = ET.fromstring(raw).findall('{*}infoTable')
            count = int(cover.findtext('.//{*}tableEntryTotal'))
            total = int(cover.findtext('.//{*}tableValueTotal'))
            actual_identity = cover.findtext('.//{*}filingManager/{*}name').upper().rstrip('.')
            assert actual_identity == identity.rstrip('.'), (key, actual_identity)
            assert dt.datetime.strptime(cover.findtext('.//{*}reportCalendarOrQuarter'), '%m-%d-%Y').date().isoformat() == date
            assert cover.findtext('.//{*}submissionType') == filing['form']
            assert filing['form'] in ('13F-HR', '13F-HR/A')
            if filing['form'] == '13F-HR/A':
                assert cover.findtext('.//{*}amendmentType') == 'RESTATEMENT', key
            assert len(rows) == count and sum(int(r.findtext('{*}value')) for r in rows) == total
            grouped = {}
            for row in rows:
                cusip = row.findtext('{*}cusip').upper()
                instrument = (row.findtext('{*}putCall') or 'stock').lower()
                shares = int(row.findtext('.//{*}sshPrnamt')); value = int(row.findtext('{*}value'))
                assert shares >= 0 and value >= 0 and instrument in ('stock', 'put', 'call')
                unit = row.findtext('.//{*}sshPrnamtType')
                assert unit in ('SH', 'PRN'), (key, cusip)
                if unit == 'PRN':
                    assert instrument == 'stock'
                    instrument = 'bond'
                # Thiel explicitly filed a single zero-value NA placeholder in Q1.
                if cusip == '000000000' and row.findtext('{*}nameOfIssuer') == 'NA' and shares == value == 0:
                    continue
                position = grouped.setdefault((cusip, instrument), dict(securityId=cusip,
                    ticker=mapping.get(cusip, ''), name=row.findtext('{*}nameOfIssuer'),
                    shareClass=row.findtext('{*}titleOfClass'), instrument=instrument, shares=0, value=0))
                position['shares'] += shares; position['value'] += value
            holdings = sorted(grouped.values(), key=lambda h: (-h['value'], h['securityId'], h['instrument']))
            assert sum(h['value'] for h in holdings) == total
            snapshots[period] = dict(id=key+'-'+accession, asOf=date, publishedOn=filing['filingDate'],
                complete=True, source=dict(type='13f', url=meta['urls']['table'], coverUrl=meta['urls']['cover'],
                    accession=accession.replace('-', ''), checkedOn='2026-10-25', entryCount=count,
                    totalValue=total, sha256=hashlib.sha256(raw).hexdigest()), holdings=holdings)
        portfolios.append(dict(id=key+'-13f', kind='manager', name=name, subtitle='SEC 13F', **snapshots))
    return portfolios

if __name__ == '__main__':
    result = import_reports(Path(sys.argv[1]))
    output = ROOT / 'lib/research/capital-map-additional-managers.json'
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    for p in result:
        print(p['name'], [(period, len(p[period]['holdings']), p[period]['source']['totalValue']) for period in ('current', 'previous')])
