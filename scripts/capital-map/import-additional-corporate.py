"""Append-only import of reviewed corporate SEC 13F-HR reports (2026 Q2 and Q1).

Usage: python3 scripts/capital-map/import-additional-corporate.py SOURCE_DIRECTORY
Inputs and checks are the same as import-additional-managers.py:
KEY-{current,previous}-{meta.json,cover.xml,table.xml}, where the metadata holds the
SEC submissions filing record, CIK and the raw cover/table URLs. Operating companies
only; the original corporate file (NVIDIA, Google, Amazon, Intel, Cisco) is unchanged.
"""
import importlib.util
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('managers', Path(__file__).with_name('import-additional-managers.py'))
managers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(managers)

COMPANIES = {
    'amd': (2488, 'AMD', 'ADVANCED MICRO DEVICES INC'),
    'uber': (1543151, 'Uber', 'UBER TECHNOLOGIES, INC'),
    'walmart': (104169, 'Walmart', 'WALMART INC.'),
    'jnj': (200406, 'Johnson & Johnson', 'JOHNSON & JOHNSON'),
    'pfizer': (78003, 'Pfizer', 'PFIZER INC'),
    'merck': (310158, 'Merck', 'MERCK & CO., INC.'),
    'regeneron': (872589, 'Regeneron', 'REGENERON PHARMACEUTICALS, INC.'),
    'gilead': (882095, 'Gilead Sciences', 'GILEAD SCIENCES, INC.'),
    'ge': (40545, 'GE Aerospace', 'GENERAL ELECTRIC CO'),
}

# CUSIPs without a ticker in the existing map, matched by issuer name to SEC
# company_tickers.json (2026-11-18) and reviewed by hand. Ambiguous or unlisted
# issuers (Evaxion, Carisma, Arcellx, CUSIP 29384C908) stay without a ticker.
SYMBOLS = {
    '801056102': 'SANM', '67059N108': 'NTNX', '15675D103': 'CBRS', '00091E109': 'ABSI', '98390R102': 'XNDU',
    'G4124C109': 'GRAB', '051774107': 'AUR', '549498202': 'LCID', '950915108': 'WRD', '57142B104': 'MQ',
    '81758H106': 'SERV', '87151X101': 'SYM', 'G5279N105': 'KLAR', '39304D102': 'GDOT', '74366E102': 'PTGX',
    '63009J107': 'NBTX', 'G59665102': 'MGTX', '75383L102': 'RAPP', '21217B100': 'CTNM', '52490G102': 'LEGN',
    '126638105': 'CVRX', '98401F105': 'XNCR', '31189P102': 'FATE', '74276L105': 'PRCT', '640979100': 'NMRA',
    '929033207': 'VOR', '34385P108': 'LAB', '007002207': 'ACET', '007002108': 'ACET', '75120L209': 'RLYB',
    'M70700105': 'NNOX', '019770106': 'ALLO', '15102K100': 'CELC', '04335A105': 'ARVN', '747324101': 'PYXS',
    'Y95308105': 'WVE', 'G1110E107': 'BHVN', '142038108': 'CRBU', '98943L107': 'ZNTL', '68622P109': 'ORIC',
    '14147L108': 'CRDF', 'G9TY5A101': 'ZURA', '00860C102': 'AGMB', '097702203': 'BOLT', '65343E207': 'NXTC',
    '37611X209': 'DNA', '81727U105': 'SENS', '746964105': 'QTTB', '71535D106': 'PSNL', '501575104': 'KYMR',
    '01021M104': 'AKTS', '282564103': 'EIKN', '29384C108': 'TRDA', '869367201': 'STRO', '869367102': 'STRO',
    '014442107': 'ALEC', '92790C104': 'VRDN', '98422T209': 'XLO', '98422T100': 'XLO', '898920103': 'HURA',
    '64136E102': 'NEUP', '698955101': 'PBLS', '45826J105': 'NTLA', '03969F109': 'RCUS', '36315X101': 'LKFT',
    '045396207': 'ASMB', '501976104': 'KYTX', '449109107': 'HYLN',
}

if __name__ == '__main__':
    result = managers.import_reports(Path(sys.argv[1]), COMPANIES, kind='corporate', checked_on='2026-11-18',
        mapping_sources=('disclosures', 'corporate', 'acwi', 'history', 'additional-managers'), extra_symbols=SYMBOLS)
    output = ROOT / 'lib/research/capital-map-additional-corporate.json'
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'))+'\n')
    for p in result:
        print(p['name'], [(period, len(p[period]['holdings']), p[period]['source']['totalValue']) for period in ('current', 'previous')])
