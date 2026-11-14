import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import issuer_result_flash as flash

ROOT=Path(__file__).resolve().parents[1]
PRIMARY=b'<html><body><p>FORM 6-K REPORT OF FOREIGN PRIVATE ISSUER. Furnished exhibits follow.</p></body></html>'
BOTH=b'<table><tr><td>1</td><td><a href="exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td></tr><tr><td>2</td><td><a href="exhibit992.htm">exhibit992.htm</a></td><td>EX-99.2</td></tr></table>'
ONLY1=b'<table><tr><td>1</td><td><a href="exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td></tr></table>'
LETTER=('<main><p>Dear Shareholder, Arm delivered a record second quarter, reflecting strong execution. '+'Revenue reached 1.44 billion, up 27 percent year over year. '*8+'</p></main>').encode()
NOTICE=('<main><p>Arm Holdings plc reports results for the second quarter; the shareholder letter is available on the investor site. '+'More details are in the letter. '*3+'</p></main>').encode()

def cik_of(ticker):
    for provider in json.loads((ROOT/'lib/research/providers.json').read_text()):
        if provider['ticker']==ticker:
            for source in [*provider.get('supplementalSources',[]),*provider.get('fallbackSources',[])]:
                if source.get('format')=='sec-json': return int(source['cik'])
    raise AssertionError(ticker)

def run(ticker,index):
    """One 6-K whose index lists EX-99.1 (and maybe EX-99.2), at the company's own SEC address (its provider only admits that directory)."""
    directory=f'https://www.sec.gov/Archives/edgar/data/{cik_of(ticker)}/000197323926000141/'
    filing,idx,ex1,ex2=directory+'x-20261104.htm',directory+'0001973239-26-000141-index.html',directory+'exhibit991.htm',directory+'exhibit992.htm'
    requested=[]
    def transport(url,tick,validators=None,include_metadata=False):
        requested.append(url.rsplit('/',1)[-1])
        if url==idx: return index,'text/html'
        if url==ex1: return NOTICE,'text/html'
        if url==ex2: return LETTER,'text/html'
        raise AssertionError('unexpected '+url)
    result=monitor.sec_exhibit_evidence(PRIMARY,filing,ticker,transport)
    return result,requested,directory

class Routing(unittest.TestCase):
    def test_arm_reads_the_shareholder_letter_and_only_the_letter(self):
        result,requested,directory=run('ARM',BOTH)
        self.assertEqual((result['url'],result['number']),(directory+'exhibit992.htm','2'))
        self.assertIn('Dear Shareholder',result['extractedText'])
        self.assertEqual(requested,['0001973239-26-000141-index.html','exhibit992.htm'])                  # the filing index once, then one exhibit: the same two requests as for any company
    def test_arm_falls_back_to_exhibit_1_when_a_filing_has_no_exhibit_2(self):
        result,requested,directory=run('ARM',ONLY1)
        self.assertEqual((result['url'],result['number']),(directory+'exhibit991.htm','1'))
        self.assertEqual(requested,['0001973239-26-000141-index.html','exhibit991.htm'])                  # the index is not fetched twice
    def test_every_other_company_is_exactly_as_before(self):
        providers=json.loads((ROOT/'lib/research/providers.json').read_text())
        self.assertEqual([p['ticker'] for p in providers if 'secExhibits' in p],['ARM'])
        for provider in providers:
            if provider['ticker']!='ARM': self.assertEqual(monitor.sec_exhibit_numbers(provider['ticker']),['1'],provider['ticker'])
        for ticker in ('MRVL','AMD','MSFT','TSM','ASML','NVDA'):
            result,requested,directory=run(ticker,BOTH)
            self.assertEqual((result['url'],result['number']),(directory+'exhibit991.htm','1'),ticker)       # EX-99.1 even when an EX-99.2 exists
            self.assertEqual(requested,['0001973239-26-000141-index.html','exhibit991.htm'],ticker)                              # same requests, same count
        for ticker in ('MRVL','ARM'):
            idx=f'https://www.sec.gov/Archives/edgar/data/{cik_of(ticker)}/000197323926000141/0001973239-26-000141-index.html'
            self.assertEqual(monitor.sec_exhibit_links(BOTH,idx,ticker),monitor.sec_exhibit_links(BOTH,idx,ticker,'1'))
    def test_the_provider_cannot_ask_for_arbitrary_exhibits(self):
        original=monitor.PROVIDERS['MRVL']
        try:
            for bad in (['9'],['1','x'],'2',[],None,['99.2']):
                monitor.PROVIDERS['MRVL']={**original,'secExhibits':bad}
                self.assertEqual(monitor.sec_exhibit_numbers('MRVL'),['1'],bad)
        finally: monitor.PROVIDERS['MRVL']=original

class Letter(unittest.TestCase):
    TEXT=(ROOT/'tests/fixtures/arm-shareholder-letter-q2fye27.txt').read_text()
    def test_figures_from_the_letters_income_statement_against_its_headline(self):
        parsed=flash.PROFILES['ARM']['parse'](self.TEXT)
        self.assertEqual(parsed['period'],'Q2 FYE27')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$1.443B','$1.135B'),('eps','$0.12','$0.22'),('net-income','$130M','$238M'),('operating-income','$201M','$163M')])
        keys=lambda text:[f[0] for f in flash.PROFILES['ARM']['parse'](text)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['ARM']['parse'](self.TEXT.replace('Total revenue 1,443','Total revenue 1,543'))                      # revenue against the stated +27%
        with self.assertRaises(ValueError): flash.PROFILES['ARM']['parse'](self.TEXT.replace('Total revenue increased 27%','Total revenue increased 37%'))
        self.assertNotIn('operating-income',keys(self.TEXT.replace('Operating income (loss) 201 163','Operating income (loss) 211 163')))
        self.assertNotIn('net-income',keys(self.TEXT.replace('Net income (loss) $ 130 $ 238','Net income (loss) $ 140 $ 238')))
        self.assertNotIn('eps',keys(self.TEXT.replace('Diluted $ 0.12 $ 0.22','Diluted $ 0.32 $ 0.22')))
        with self.assertRaises(ValueError): flash.PROFILES['ARM']['parse'](self.TEXT.replace('Q2 FYE27 Financial Overview','Q2 results'))
        with self.assertRaises(ValueError): flash.PROFILES['ARM']['parse'](self.TEXT.replace('Arm Holdings plc','Another plc'))

if __name__=='__main__': unittest.main()
