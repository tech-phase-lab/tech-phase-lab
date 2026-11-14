import re
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts/research'))
import monitor
import issuer_result_flash as flash
import market_results
import signals
import release_watch

FX=Path(__file__).parent/'fixtures'
def fixture(name): return (FX/name).read_text()
NOW=datetime(2026,11,12,13,0,30,tzinfo=timezone.utc)
DETECTED='2026-11-12T13:00:05+00:00'
NB_PAGE='https://nebius.com/newsroom/nebius-reports-third-quarter-2026-financial-results'
PDF='https://assets.nebius.com/assets/72a8c258-bbb7-4df7-ab9d-8698f6cb88fc/PR.pdf'
LETTER='https://assets.nebius.com/assets/a6ecfd85-a6cb-4967-8ef7-9a25bd261f9c/SHLQ226.pdf'
CR_URL='https://www.sec.gov/Archives/edgar/data/1769628/000176962826000461/coreweave3q26earningspress.htm'

class Parsers(unittest.TestCase):
    def test_nebius_tables_of_four_releases(self):
        expected={'q226':('Q2 2026',[('revenue','$582.3M'),('net-income','$-190.4M'),('adjusted-ebitda','$236.2M'),('adjusted-net-income','$-33.2M')]),
                  'q126':('Q1 2026',[('revenue','$399M'),('net-income','$621.2M'),('adjusted-ebitda','$129.5M'),('adjusted-net-income','$-100.3M')]),
                  'q425':('Q4 2025',[('revenue','$227.7M'),('net-income','$-249.6M'),('adjusted-ebitda','$15M'),('adjusted-net-income','$-173M')]),
                  'q325':('Q3 2025',[('revenue','$146.1M'),('net-income','$-119.6M'),('adjusted-ebitda','$-5.2M'),('adjusted-net-income','$-100.4M')])}
        for name,(period,facts) in expected.items():
            parsed=flash.parse_nebius(fixture(f'nebius-results-{name}.txt'))
            self.assertEqual((parsed['period'],[(k,v) for k,v,_ in parsed['facts']]),(period,facts),name)
    def test_nebius_q3_2026_pdf_with_garbled_text_publishes_only_the_clean_rows(self):
        # The real Nov 12 release: extraction dropped the 'U' of USD and split digits in the net income row.
        parsed=flash.parse_nebius(fixture('nebius-results-q326.txt'))
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual(parsed['facts'],[('revenue','$980.8M','$146.1M'),('adjusted-ebitda','$465.8M','$-5.2M'),('adjusted-net-income','$90.9M','$-100.4M')])
        # a garbled digit in the revenue row is refused (the stated +571% no longer matches)
        with self.assertRaises(ValueError): flash.parse_nebius(fixture('nebius-results-q326.txt').replace('980.8','9 80.8',1).replace('Revenues 146.1 9 80.8','Revenues 146.1 580.8'))
    def test_text_as_read_by_the_monitors_pypdf_610_gives_the_same_figures(self):
        # Production runs pypdf 6.10.0, which splits words and numbers ("R e v enues 146 . 1 980 . 8"); local pypdf did not.
        clean=flash.parse_nebius(fixture('nebius-results-q326.txt'),NB_PAGE)
        split=flash.parse_nebius(fixture('nebius-results-q326-pypdf610.txt'),NB_PAGE)
        self.assertEqual(split,clean)
        self.assertEqual(split['facts'][0],('revenue','$980.8M','$146.1M'))
        # the net income row has digits split from digits ("(3 7 . 5)"): never guessed, so it is absent
        self.assertNotIn('net-income',[f[0] for f in split['facts']])
    def test_garbled_heading_still_parses_with_the_quarter_from_the_page_address(self):
        spaced=fixture('nebius-results-q326.txt').replace('Q3 2026 Financial Highlights','Q3 2 026 F inancial H ighlights')
        self.assertEqual(flash.parse_nebius(spaced)['period'],'Q3 2026')       # spaces inside the heading are tolerated
        text=fixture('nebius-results-q326.txt').replace('Q3 2026 Financial Highlights','Q3 2026 Financia1 Highlights')   # a damaged letter
        parsed=flash.parse_nebius(text,NB_PAGE)
        self.assertEqual((parsed['period'],parsed['facts'][0]),('Q3 2026',('revenue','$980.8M','$146.1M')))
        # no heading and no quarter in the address: nothing is published
        with self.assertRaises(ValueError): flash.parse_nebius(text,'https://nebius.com/newsroom/some-other-post')
        # the quarter in the address must agree with the table's year columns
        with self.assertRaises(ValueError): flash.parse_nebius(text,'https://nebius.com/newsroom/nebius-reports-third-quarter-2027-financial-results')
    def test_nvidia_summary_tables_checked_against_both_stated_changes(self):
        parsed=flash.parse_nvidia(fixture('nvidia-results-q2fy27.txt'))
        self.assertEqual(parsed['period'],'Q2 FY2027')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[
            ('revenue','$96.221B','$46.743B'),('gross-margin','75.0%','72.4%'),('eps','$2.46','$1.08'),('adjusted-eps','$2.22','$1.01'),
            ('net-income','$59.688B','$26.422B'),('operating-income','$63.734B','$28.44B'),('guidance-revenue','$108.0B ± 2%',None)])
        # a mis-read digit disagrees with the stated Y/Y change: the revenue row is refused, so nothing is published
        with self.assertRaises(ValueError): flash.parse_nvidia(fixture('nvidia-results-q2fy27.txt').replace('$96,221 $81,615 $46,743 18 % 106 %','$96,221 $81,615 $46,743 18 % 126 %',1))
        # a changed column order is not guessed
        with self.assertRaises(ValueError): flash.parse_nvidia(fixture('nvidia-results-q2fy27.txt').replace('Q2 FY27 Q1 FY27 Q2 FY26','Q1 FY27 Q2 FY27 Q2 FY26',1))
        # one row with a wrong figure is left out while the others stay
        bad=fixture('nvidia-results-q2fy27.txt').replace('Net income $59,688 $58,321 $26,422 2 % 126 %','Net income $59,688 $58,321 $26,422 2 % 226 %',1)
        self.assertNotIn('net-income',[f[0] for f in flash.parse_nvidia(bad)['facts']])
    def test_dell_table_rows_checked_against_their_stated_changes(self):
        text=fixture('dell-results-q2fy27.txt')
        parsed=flash.parse_dell(text)
        self.assertEqual(parsed['period'],'Q2 FY2027')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$46.971B','$29.776B'),('eps','$6.34','$1.70'),
            ('net-income','$4.133B','$1.164B'),('operating-income','$5.385B','$1.773B'),('guidance-revenue','$192.0B',None)])
        with self.assertRaises(ValueError): flash.parse_dell(text.replace('Total net revenue 46,971 29,776 58%','Total net revenue 46,971 29,776 38%',1))
        with self.assertRaises(ValueError): flash.parse_dell(__import__('re').sub('(?i)dell technologies','Other Company',text))
        bad=text.replace('Net income $ 4,133 $ 1,164 255%','Net income $ 4,133 $ 1,164 155%')
        self.assertNotIn('net-income',[f[0] for f in flash.parse_dell(bad)['facts']])
    def test_statement_companies_checked_against_headline_and_arithmetic(self):
        expected={'MRVL':('marvell-results-q2fy27.txt','Q2 FY2027',[('revenue','$2.7393B','$2.0061B'),('eps','$0.33','$0.22'),('net-income','$308M','$194.8M'),('operating-income','$459.7M','$290.1M')]),
                  'CRDO':('credo-results-q1fy27.txt','Q1 FY2027',[('revenue','$479.003M','$223.074M'),('eps','$0.67','$0.34'),('net-income','$129.425M','$63.399M'),('operating-income','$120.7M','$60.742M')]),
                  'AVGO':('broadcom-results-q3fy26.txt','Q3 FY2026',[('revenue','$29.591B','$15.952B'),('eps','$2.68','$0.85'),('net-income','$13.088B','$4.14B'),('operating-income','$15.955B','$5.887B'),('guidance-revenue','$34.8B',None)])}
        for ticker,(name,period,facts) in expected.items():
            parsed=flash.PROFILES[ticker]['parse'](fixture(name))
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
    def test_statement_companies_refuse_or_drop_what_does_not_add_up(self):
        mrvl,avgo,crdo=fixture('marvell-results-q2fy27.txt'),fixture('broadcom-results-q3fy26.txt'),fixture('credo-results-q1fy27.txt')
        parse=lambda t,x: flash.PROFILES[t]['parse'](x)
        # revenue that disagrees with the growth stated in the headline: nothing is published
        with self.assertRaises(ValueError): parse('MRVL',mrvl.replace('Net revenue $ 2,739.3','Net revenue $ 2,839.3',1))
        with self.assertRaises(ValueError): parse('AVGO',avgo.replace('up 86 percent','up 66 percent',1))
        with self.assertRaises(ValueError): parse('CRDO',crdo.replace('Revenue $ 479,003','Revenue $ 479,903',1))
        # a wrong operating income breaks gross profit - expenses: that row is dropped, the others stay
        keys=lambda parsed:[f[0] for f in parsed['facts']]
        self.assertNotIn('operating-income',keys(parse('MRVL',mrvl.replace('Operating income 459.7','Operating income 495.7',1))))
        self.assertNotIn('net-income',keys(parse('AVGO',avgo.replace('Net income $ 13,088','Net income $ 13,188'))))
        # EPS that does not match net income / diluted shares is dropped
        self.assertNotIn('eps',keys(parse('CRDO',crdo.replace('Diluted $ 0.67','Diluted $ 0.76',1))))
        # another company's release is not read with this layout; a changed heading is not guessed
        with self.assertRaises(ValueError): parse('MRVL',avgo)
        with self.assertRaises(ValueError): parse('CRDO',crdo.replace('Condensed Consolidated Statements of Operations','Condensed Statements',1))
    def test_micron_checked_against_highlights_and_its_own_arithmetic(self):
        text=fixture('micron-results-q4fy26.txt')
        parsed=flash.parse_micron(text)
        self.assertEqual(parsed['period'],'Q4 FY2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$54.229B','$11.315B'),('eps','$32.87','$2.83'),
            ('net-income','$37.701B','$3.201B'),('operating-income','$43.751B','$3.654B')])
        with self.assertRaises(ValueError): flash.parse_micron(text.replace('Revenue $ 54,229','Revenue $ 55,229'))
        keys=lambda x:[f[0] for f in flash.parse_micron(x)['facts']]
        self.assertNotIn('operating-income',keys(text.replace('Operating income 43,751','Operating income 43,851')))
        self.assertNotIn('net-income',keys(text.replace('Net income $ 37,701','Net income $ 37,801')))
        with self.assertRaises(ValueError): flash.parse_micron(text.replace('Micron Technology','Other Company').replace('MICRON TECHNOLOGY','OTHER COMPANY'))
    def test_tsmc_table_checked_against_yoy_and_qoq_and_the_headline_margin(self):
        text=fixture('tsmc-results-q326.txt')
        parsed=flash.parse_tsmc(text)
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','NT$1494.243B','NT$989.918B'),('gross-margin','66.4%',None),
            ('eps','NT$29.43','NT$17.44'),('net-income','NT$763.064B','NT$452.302B'),('operating-income','NT$876.445B','NT$500.685B'),('guidance-revenue','$52.3B-$54.3B',None)])
        with self.assertRaises(ValueError): flash.parse_tsmc(text.replace('Net sales 1,494,243 989,918 50.9','Net sales 1,494,243 989,918 59.9'))
        keys=lambda x:[f[0] for f in flash.parse_tsmc(x)['facts']]
        self.assertNotIn('net-income',keys(text.replace('Net income 763,064 452,302 68.7','Net income 763,064 452,302 69.7')))
        self.assertNotIn('gross-margin',keys(text.replace('Gross margin for the quarter was 66.4%','Gross margin for the quarter was 64.4%')))
        with self.assertRaises(ValueError): flash.parse_tsmc(text.replace('3Q26Amounta 3Q25Amount','3Q25Amounta 3Q26Amount'))
    def test_asml_table_checked_against_the_headline(self):
        text=fixture('asml-results-q326.txt')
        parsed=flash.parse_asml(text)
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(f[0],f[1]) for f in parsed['facts']],[('revenue','€11.662B'),('gross-margin','57.5%'),('eps','€12.95'),('net-income','€4.96B'),('guidance-revenue','€14.2B-€15.2B')])
        with self.assertRaises(ValueError): flash.parse_asml(text.replace('Total net sales 9,326 11,662','Total net sales 9,326 12,662'))
        keys=lambda x:[f[0] for f in flash.parse_asml(x)['facts']]
        self.assertNotIn('net-income',keys(text.replace('Net income 2,918 4,960','Net income 2,918 4,560')))
        self.assertNotIn('gross-margin',keys(text.replace('Gross profit 5,035 6,700','Gross profit 5,035 6,300')))
        with self.assertRaises(ValueError): flash.parse_asml(text.replace('Q2 2026 Q3 2026','Q3 2026 Q2 2026',1))
    def test_more_statement_companies_checked_against_headline_and_arithmetic(self):
        expected={'ANET':('arista-results-q326.txt','Q3 2026',[('revenue','$3.6576B','$2.3083B'),('eps','$1.22','$0.67'),('net-income','$1.5604B','$853M'),('operating-income','$1.6424B','$978.2M')]),
                  'PLTR':('palantir-results-q326.txt','Q3 2026',[('revenue','$2.313411B','$1.181092B'),('eps','$0.44','$0.18'),('net-income','$1.128012B','$475.599M'),('operating-income','$1.084845B','$393.256M')]),
                  'SNDK':('sandisk-results-q1fy27.txt','Q1 FY2027',[('revenue','$11.031B','$2.308B'),('eps','$52.60','$0.75'),('net-income','$8.101B','$112M'),('operating-income','$8.78B','$176M')]),
                  'AMD':('amd-results-q326.txt','Q3 2026',[('revenue','$13.377B','$9.246B'),('eps','$1.46','$0.75'),('net-income','$2.428B','$1.243B'),('operating-income','$2.832B','$1.27B')])}
        keys=lambda ticker,x:[f[0] for f in flash.PROFILES[ticker]['parse'](x)['facts']]
        for ticker,(name,period,facts) in expected.items():
            parsed=flash.PROFILES[ticker]['parse'](fixture(name))
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
        # revenue that disagrees with the headline is refused as a whole
        with self.assertRaises(ValueError): flash.PROFILES['ANET']['parse'](fixture('arista-results-q326.txt').replace('Total revenue 3,657.6','Total revenue 3,757.6'))
        with self.assertRaises(ValueError): flash.PROFILES['PLTR']['parse'](fixture('palantir-results-q326.txt').replace('Revenue $ 2,313,411','Revenue $ 2,413,411'))
        with self.assertRaises(ValueError): flash.PROFILES['SNDK']['parse'](fixture('sandisk-results-q1fy27.txt').replace('Revenue, net $ 11,031','Revenue, net $ 12,031'))
        with self.assertRaises(ValueError): flash.PROFILES['AMD']['parse'](fixture('amd-results-q326.txt').replace('Net revenue $ 13,377','Net revenue $ 14,377'))
        # rows that do not add up are dropped
        self.assertNotIn('operating-income',keys('AMD',fixture('amd-results-q326.txt').replace('Operating income 2,832','Operating income 2,932')))
        self.assertNotIn('net-income',keys('AMD',fixture('amd-results-q326.txt').replace('Net income $ 2,428','Net income $ 2,528')))
        self.assertNotIn('net-income',keys('PLTR',fixture('palantir-results-q326.txt').replace('$ 1,128,012','$ 1,138,012')))
        self.assertNotIn('net-income',keys('SNDK',fixture('sandisk-results-q1fy27.txt').replace('Net income $ 8,101 $ 112 Net income per','Net income $ 8,201 $ 112 Net income per')))
        self.assertNotIn('eps',keys('ANET',fixture('arista-results-q326.txt').replace('Diluted $ 1.22','Diluted $ 1.32')))
    def test_microsoft_statement_checked_against_headline_and_arithmetic(self):
        text=fixture('msft-results-q1fy27.txt')
        parsed=flash.PROFILES['MSFT']['parse'](text)
        self.assertEqual(parsed['period'],'Q1 FY2027')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$92.279B','$77.673B'),('eps','$4.92','$3.72'),('net-income','$36.629B','$27.747B'),('operating-income','$45.915B','$37.961B')])
        keys=lambda x:[f[0] for f in flash.PROFILES['MSFT']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['MSFT']['parse'](text.replace('Total revenue 92,279','Total revenue 98,279'))
        self.assertNotIn('operating-income',keys(text.replace('Operating income 45,915','Operating income 46,915')))
        self.assertNotIn('net-income',keys(text.replace('Net income $36,629 $27,747 Earnings','Net income $37,629 $27,747 Earnings')))
        self.assertNotIn('eps',keys(text.replace('Diluted $4.92','Diluted $5.92')))
        # a missing component of the operating-expense sum withholds operating income rather than guessing
        self.assertNotIn('operating-income',keys(text.replace('Sales and marketing 5,716','Marketing 5,716')))
    def test_applied_materials_statement_with_a_row_missing_its_dashes(self):
        text=fixture('applied-materials-results-q426.txt')
        parsed=flash.PROFILES['AMAT']['parse'](text)
        self.assertEqual(parsed['period'],'Q4 FY2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$10.409B','$6.8B'),('eps','$3.40','$2.38'),('net-income','$2.718B','$1.897B'),('operating-income','$3.658B','$1.712B')])
        keys=lambda x:[f[0] for f in flash.PROFILES['AMAT']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['AMAT']['parse'](text.replace('Revenue $ 10,409 $ 6,800','Revenue $ 11,409 $ 6,800'))
        self.assertNotIn('operating-income',keys(text.replace('Income from operations 3,658','Income from operations 3,758')))
        self.assertNotIn('net-income',keys(text.replace('Net income $ 2,718','Net income $ 2,818')))
        self.assertNotIn('eps',keys(text.replace('Diluted $ 3.40','Diluted $ 4.40')))
    def test_platform_and_device_statements_batch2(self):
        cases={
         'META':('meta-results-q326.txt','Q3 2026',[('revenue','$64.601B','$51.242B'),('eps','$3.83','$1.05'),('net-income','$9.86B','$2.709B'),('operating-income','$12.988B','$20.535B')],
                 [('Income from operations 12,988','Income from operations 13,988','operating-income'),('Net income $ 9,860','Net income $ 9,960','net-income'),('Basic $ 3.86 $ 1.08 $ 20.64 $ 14.96 Diluted $ 3.83','Basic $ 3.86 $ 1.08 $ 20.64 $ 14.96 Diluted $ 4.83','eps')],'Revenue $ 64,601','Revenue $ 74,601'),
         'NFLX':('nflx-results-q326.txt','Q3 2026',[('revenue','$12.874176B','$11.510307B'),('eps','$0.87','$0.59'),('net-income','$3.663927B','$2.546916B'),('operating-income','$4.4586B','$3.248247B')],
                 [('Operating income 4,458,600','Operating income 4,558,600','operating-income'),('Net income $ 3,663,927','Net income $ 3,763,927','net-income'),('Basic $ 0.89 $ 0.81 $ 0.60 $ 2.95 $ 2.01 Diluted $ 0.87','Basic $ 0.89 $ 0.81 $ 0.60 $ 2.95 $ 2.01 Diluted $ 0.97','eps')],'Revenues $ 12,874,176','Revenues $ 13,874,176'),
         'NOW':('now-results-q326.txt','Q3 2026',[('revenue','$4.106B','$3.407B'),('eps','$0.27','$0.48'),('net-income','$277M','$502M'),('operating-income','$385M','$572M')],
                [('Income from operations 385','Income from operations 395','operating-income'),('Net income $ 277','Net income $ 287','net-income'),('diluted (2) $ 0.27','diluted (2) $ 0.37','eps')],'Total revenues 4,106','Total revenues 4,306'),
         'INTC':('intc-results-q326.txt','Q3 2026',[('revenue','$16.513B','$13.653B'),('eps','$0.60','$0.90'),('net-income','$3.32B','$4.063B'),('operating-income','$2.522B','$683M')],
                 [('Operating income (loss) 2,522','Operating income (loss) 2,622','operating-income'),('attributable to Intel $ 3,320','attributable to Intel $ 3,420','net-income')],'Net revenue $ 16,513','Net revenue $ 17,513'),
         'AAPL':('aapl-results-q4fy26.txt','Q4 FY2026',[('revenue','$114.477B','$102.466B'),('eps','$2.10','$1.85'),('net-income','$30.711B','$27.466B'),('operating-income','$35.631B','$32.427B')],
                 [('Operating income 35,631','Operating income 36,631','operating-income'),('Net income $ 30,711','Net income $ 31,711','net-income'),('Diluted $ 2.10','Diluted $ 3.10','eps')],'Total net sales (1) 114,477','Total net sales (1) 124,477'),
        }
        for ticker,(name,period,facts,tampers,old_rev,new_rev) in cases.items():
            text=fixture(name); parse=flash.PROFILES[ticker]['parse']
            parsed=parse(text)
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
            for old,new,key in tampers:
                self.assertIn(old,text,ticker)
                self.assertNotIn(key,[f[0] for f in parse(text.replace(old,new))['facts']],(ticker,key))
            self.assertIn(old_rev,text,ticker)
            with self.assertRaises(ValueError): parse(text.replace(old_rev,new_rev))
            with self.assertRaises(ValueError): parse(re.sub(flash.STATEMENT[ticker]['identity'],'someone else',text,flags=re.I))
    def test_security_and_software_statements_batch1(self):
        # (fixture, period, facts, [(old, new, withheld key)]) -- every tamper must withhold that figure; a wrong revenue withholds everything
        cases={
         'PANW':('panw-results-q4fy26.txt','Q4 FY2026',[('revenue','$3.41B','$2.536B'),('eps','$-0.35','$0.36'),('net-income','$-282M','$254M'),('operating-income','$172M','$497M')],
                 [('Operating income 172 497','Operating income 182 497','operating-income'),('Net income (loss) $ (282)','Net income (loss) $ (292)','net-income'),('per share, diluted $ (0.35)','per share, diluted $ (0.45)','eps')],'Total revenue 3,410 2,536','Total revenue 3,510 2,536'),
         'CRWD':('crwd-results-q2fy27.txt','Q2 FY2027',[('revenue','$1.470897B','$1.168952B'),('eps','$0.01','$-0.07'),('net-income','$5.306M','$-70.153M'),('operating-income','$-33.232M','$-105.457M')],
                 [('Loss from operations (33,232)','Loss from operations (34,232)','operating-income'),('attributable to CrowdStrike $ 5,306','attributable to CrowdStrike $ 6,306','net-income')],'Total revenue 1,470,897','Total revenue 1,570,897'),
         'SNOW':('snow-results-q2fy27.txt','Q2 FY2027',[('revenue','$1.546793B','$1.144969B'),('eps','$-0.55','$-0.89'),('net-income','$-191.72M','$-298.017M'),('operating-income','$-262.967M','$-340.276M')],
                 [('Operating loss (262,967)','Operating loss (272,967)','operating-income'),('Net loss (191,720)','Net loss (192,720)','net-income'),('basic and diluted $ (0.55)','basic and diluted $ (0.65)','eps')],'Revenue $ 1,546,793','Revenue $ 1,646,793'),
         'CRM':('crm-results-q2fy27.txt','Q2 FY2027',[('revenue','$11.345B','$10.236B'),('eps','$4.29','$1.96'),('net-income','$3.526B','$1.887B'),('operating-income','$2.331B','$2.332B')],
                [('Income from operations 2,331','Income from operations 2,431','operating-income'),('Net income $ 3,526','Net income $ 3,626','net-income'),('(3) $ 4.29','(3) $ 5.29','eps')],'Total revenues 11,345','Total revenues 12,345'),
         'ADBE':('adbe-results-q3fy26.txt','Q3 FY2026',[('revenue','$6.76B','$5.988B'),('eps','$4.62','$4.18'),('net-income','$1.827B','$1.772B'),('operating-income','$2.354B','$2.173B')],
                 [('Operating income 2,354','Operating income 2,454','operating-income'),('Net income $ 1,827','Net income $ 1,927','net-income'),('Diluted net income per share $ 4.62','Diluted net income per share $ 5.62','eps')],'Total revenue 6,760','Total revenue 7,760'),
        }
        for ticker,(name,period,facts,tampers,old_rev,new_rev) in cases.items():
            text=fixture(name); parse=flash.PROFILES[ticker]['parse']
            parsed=parse(text)
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
            for old,new,key in tampers:
                self.assertIn(old,text,ticker)
                self.assertNotIn(key,[f[0] for f in parse(text.replace(old,new))['facts']],(ticker,key))
            self.assertIn(old_rev,text,ticker)
            with self.assertRaises(ValueError): parse(text.replace(old_rev,new_rev))
            with self.assertRaises(ValueError): parse(re.sub(flash.STATEMENT[ticker]['identity'],'someone else',text,flags=re.I))
    def test_semiconductor_equipment_storage_and_power_statements_batch3(self):
        cases={
         'KLAC':('klac-results-q1fy27.txt','Q1 FY2027',[('revenue','$4.136015B','$3.209696B'),('eps','$1.18','$0.85'),('net-income','$1.548588B','$1.12104B')],
                 [('Net income $ 1,548,588 $ 1,363,059 $ 1,121,040 Net income per share','Net income $ 1,648,588 $ 1,363,059 $ 1,121,040 Net income per share','net-income'),('Diluted $ 1.18','Diluted $ 1.28','eps')],'Total revenues 4,136,015','Total revenues 4,436,015'),
         'LRCX':('lrcx-results-sep26.txt','Sep 2026 quarter',[('revenue','$8.219418B','$5.324173B'),('eps','$2.19','$1.24'),('net-income','$2.753138B','$1.56866B'),('operating-income','$3.283727B','$1.829088B')],
                 [('Operating income 3,283,727','Operating income 3,383,727','operating-income'),('Net income $ 2,753,138','Net income $ 2,853,138','net-income'),('Diluted $ 2.19','Diluted $ 2.29','eps')],'Revenue $ 8,219,418','Revenue $ 9,219,418'),
         'STX':('stx-results-q1fy27.txt','Q1 FY2027',[('revenue','$4.233B','$2.629B'),('eps','$7.59','$2.43'),('net-income','$1.761B','$549M'),('operating-income','$2.064B','$694M')],
                [('Income from operations 2,064','Income from operations 2,164','operating-income'),('Net income $ 1,761','Net income $ 1,861','net-income'),('Diluted $ 7.59','Diluted $ 8.59','eps')],'Revenue $ 4,233','Revenue $ 5,233'),
         'APH':('aph-results-q326.txt','Q3 2026',[('revenue','$10.2297B','$6.1944B'),('eps','$0.79','$0.49'),('net-income','$2.0343B','$1.2457B'),('operating-income','$3.0208B','$1.7023B')],
                [('Operating income 3,020.8','Operating income 3,120.8','operating-income'),('Amphenol Corporation $ 2,034.3','Amphenol Corporation $ 2,134.3','net-income')],'Net sales $ 10,229.7','Net sales $ 11,229.7'),
         'BE':('be-results-q326.txt','Q3 2026',[('revenue','$1.235837B','$519.048M'),('eps','$0.78','$-0.10'),('net-income','$250.271M','$-23.093M'),('operating-income','$225.449M','$7.846M')],
               [('Income from operations 225,449','Income from operations 235,449','operating-income'),('common stockholders $ 250,271','common stockholders $ 260,271','net-income')],'Total revenue 1,235,837','Total revenue 1,335,837'),
        }
        for ticker,(name,period,facts,tampers,old_rev,new_rev) in cases.items():
            text=fixture(name); parse=flash.PROFILES[ticker]['parse']
            parsed=parse(text)
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
            for old,new,key in tampers:
                self.assertIn(old,text,ticker)
                self.assertNotIn(key,[f[0] for f in parse(text.replace(old,new))['facts']],(ticker,key))
            self.assertIn(old_rev,text,ticker)
            with self.assertRaises(ValueError): parse(text.replace(old_rev,new_rev))
            with self.assertRaises(ValueError): parse(re.sub(flash.STATEMENT[ticker]['identity'],'someone else',text,flags=re.I))
    def test_connectivity_optics_and_quantum_statements_batch4(self):
        cases={
         'ALAB':('alab-results-q326.txt','Q3 2026',[('revenue','$584.899M','$230.575M'),('eps','$0.99','$0.50'),('net-income','$182.944M','$91.114M'),('operating-income','$179.056M','$55.406M')],
                 [('Operating income 179,056','Operating income 189,056','operating-income'),('Net income $ 182,944','Net income $ 192,944','net-income'),('Diluted $ 0.99','Diluted $ 1.99','eps')],'Revenue $ 584,899','Revenue $ 684,899'),
         'LITE':('lite-results-q1fy27.txt','Q1 FY2027',[('revenue','$1.2626B','$533.8M'),('eps','$3.54','$0.05'),('net-income','$360.3M','$4.2M'),('operating-income','$359.8M','$6.7M')],
                 [('Income from operations 359.8','Income from operations 369.8','operating-income'),('Net income $ 360.3','Net income $ 370.3','net-income'),('Diluted $ 3.54','Diluted $ 4.54','eps')],'Net revenue $ 1,262.6','Net revenue $ 1,362.6'),
         'AAOI':('aaoi-results-q326.txt','Q3 2026',[('revenue','$269.875M','$118.63M'),('eps','$0.07','$-0.28'),('net-income','$6.3M','$-17.936M'),('operating-income','$-1.442M','$-18.187M')],
                 [('Operating Loss (1,442 )','Operating Loss (1,542 )','operating-income'),('Net income (loss) $ 6,300','Net income (loss) $ 7,300','net-income'),('diluted $ 0.07','diluted $ 0.17','eps')],'Total Revenue 269,875','Total Revenue 279,875'),
         'IONQ':('ionq-results-q326.txt','Q3 2026',[('revenue','$173.831M','$39.866M'),('net-income','$563.957M','$-1.054955B'),('operating-income','$-433.075M','$-168.813M')],
                 [('Loss from operations (433,075 )','Loss from operations (443,075 )','operating-income'),('attributable to IonQ, Inc. $ 563,957','attributable to IonQ, Inc. $ 573,957','net-income')],'Revenue $ 173,831','Revenue $ 183,831'),
        }
        for ticker,(name,period,facts,tampers,old_rev,new_rev) in cases.items():
            text=fixture(name); parse=flash.PROFILES[ticker]['parse']
            parsed=parse(text)
            self.assertEqual(parsed['period'],period,ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
            for old,new,key in tampers:
                self.assertIn(old,text,ticker)
                self.assertNotIn(key,[f[0] for f in parse(text.replace(old,new))['facts']],(ticker,key))
            self.assertIn(old_rev,text,ticker)
            with self.assertRaises(ValueError): parse(text.replace(old_rev,new_rev))
            with self.assertRaises(ValueError): parse(re.sub(flash.STATEMENT[ticker]['identity'],'someone else',text,flags=re.I))
    def test_alphabet_and_amazon_statements_print_the_year_ago_column_first(self):
        expected={'GOOGL':('alphabet-results-q326.txt',[('revenue','$127.577B','$102.346B'),('eps','$2.12','$2.87'),('net-income','$26.17B','$34.979B'),('operating-income','$40.576B','$31.228B')]),
                  'AMZN':('amazon-results-q326.txt',[('revenue','$201.944B','$180.169B'),('eps','$1.89','$1.95'),('net-income','$20.685B','$21.187B'),('operating-income','$28.076B','$17.422B')])}
        keys=lambda t,x:[f[0] for f in flash.PROFILES[t]['parse'](x)['facts']]
        for ticker,(name,facts) in expected.items():
            parsed=flash.PROFILES[ticker]['parse'](fixture(name))
            self.assertEqual(parsed['period'],'Q3 2026',ticker)
            self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],facts,ticker)
        g,a=fixture('alphabet-results-q326.txt'),fixture('amazon-results-q326.txt')
        with self.assertRaises(ValueError): flash.PROFILES['GOOGL']['parse'](g.replace('Revenues $ 102,346 $ 127,577','Revenues $ 102,346 $ 137,577'))
        with self.assertRaises(ValueError): flash.PROFILES['AMZN']['parse'](a.replace('Total net sales 180,169 201,944','Total net sales 180,169 211,944'))
        # columns read in the wrong order would show a 25% rise as a fall: the headline check refuses it
        with self.assertRaises(ValueError): flash.PROFILES['GOOGL']['parse'](g.replace('Revenues $ 102,346 $ 127,577','Revenues $ 127,577 $ 102,346'))
        self.assertNotIn('operating-income',keys('GOOGL',g.replace('Income from operations 31,228 40,576','Income from operations 31,228 41,576')))
        self.assertNotIn('net-income',keys('GOOGL',g.replace('Net income available to common stockholders $ 34,979 $ 26,170','Net income available to common stockholders $ 34,979 $ 26,270')))
        self.assertNotIn('operating-income',keys('AMZN',a.replace('Operating income 17,422 28,076','Operating income 17,422 28,176')))
        self.assertNotIn('net-income',keys('AMZN',a.replace('Net income $ 21,187 $ 20,685','Net income $ 21,187 $ 20,785')))
        self.assertNotIn('eps',keys('AMZN',a.replace('Diluted earnings per share $ 1.95 $ 1.89','Diluted earnings per share $ 1.95 $ 2.89')))
    def test_ge_vernova_summary_table_checked_against_stated_changes_and_headline(self):
        text=fixture('gevernova-results-q326.txt')
        parsed=flash.PROFILES['GEV']['parse'](text)
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$12.642B','$9.969B'),('eps','$4.81','$1.64'),('net-income','$1.289B','$453M'),('adjusted-ebitda','$1.943B','$811M')])
        keys=lambda x:[f[0] for f in flash.PROFILES['GEV']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['GEV']['parse'](text.replace('Total revenues $12,642','Total revenues $13,642'))
        with self.assertRaises(ValueError): flash.PROFILES['GEV']['parse'](text.replace('Revenue of $12.6B, +27%','Revenue of $12.6B, +37%'))
        self.assertNotIn('net-income',keys(text.replace('Net income (loss) $1,289 $453 $836','Net income (loss) $1,299 $453 $836')))
        self.assertNotIn('eps',keys(text.replace('Diluted EPS $4.81 $1.64 193%','Diluted EPS $5.81 $1.64 193%')))
        self.assertNotIn('adjusted-ebitda',keys(text.replace('Adjusted EBITDA $1,943 $811 $1,131','Adjusted EBITDA $1,953 $811 $1,131')))
        with self.assertRaises(ValueError): flash.PROFILES['GEV']['parse'](text.replace('(Dollars in millions, except per share) 2026 2025','(Dollars in millions, except per share) 2025 2026',1))
    def test_vertiv_statement_with_operating_profit_checked_against_all_cost_lines(self):
        text=fixture('vertiv-results-q326.txt')
        parsed=flash.PROFILES['VRT']['parse'](text)
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$4.3128B','$2.6758B'),('eps','$1.95','$1.02'),('net-income','$764.5M','$398.5M'),('operating-income','$983.8M','$516.7M')])
        keys=lambda x:[f[0] for f in flash.PROFILES['VRT']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['VRT']['parse'](text.replace('Net sales 4,312.8','Net sales 4,712.8'))
        self.assertNotIn('operating-income',keys(text.replace('Operating profit (loss) 983.8','Operating profit (loss) 993.8')))
        self.assertNotIn('operating-income',keys(text.replace('Amortization of intangibles 65.3','Amortization of intangibles 66.3')))
        self.assertNotIn('net-income',keys(text.replace('Net income (loss) $ 764.5','Net income (loss) $ 774.5')))
        self.assertNotIn('eps',keys(text.replace('Diluted $ 1.95','Diluted $ 2.95')))
    def test_oracle_statement_with_percent_cells_checked_against_headline_and_arithmetic(self):
        text=fixture('oracle-results-q1fy27.txt')
        parsed=flash.PROFILES['ORCL']['parse'](text)
        self.assertEqual(parsed['period'],'Q1 FY2027')
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','$19.345B','$14.926B'),('eps','$1.56','$1.01'),('net-income','$4.76B','$2.927B'),('operating-income','$6.728B','$4.277B')])
        keys=lambda x:[f[0] for f in flash.PROFILES['ORCL']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['ORCL']['parse'](text.replace('Total revenues 19,345','Total revenues 21,345'))
        with self.assertRaises(ValueError): flash.PROFILES['ORCL']['parse'](text.replace('Total Revenues up 30%','Total Revenues up 40%'))
        self.assertNotIn('operating-income',keys(text.replace('OPERATING INCOME 6,728','OPERATING INCOME 6,828')))
        self.assertNotIn('net-income',keys(text.replace('NET INCOME $ 4,760','NET INCOME $ 4,860')))
        self.assertNotIn('eps',keys(text.replace('Diluted $ 1.56','Diluted $ 1.96')))
        self.assertNotIn('eps',keys(text.replace('Preferred stock dividends 81','Preferred stock dividends 181')))
        with self.assertRaises(ValueError): flash.PROFILES['ORCL']['parse'](text.replace('Three Months Ended August 31','Three Months Ended July 31'))
    def test_sk_hynix_preliminary_results_in_won_checked_against_stated_changes(self):
        text=fixture('skhynix-prelim-q326.txt')
        parsed=flash.PROFILES['SKHY']['parse'](text)
        self.assertEqual(parsed['period'],'Q3 2026')
        # millions of won -> trillions, digits exactly as printed (104,615,483 -> 104.615483); the label says preliminary and the unit
        self.assertEqual([(f[0],f[1],f[2]) for f in parsed['facts']],[('revenue','₩104.615483T','₩24.448929T'),('net-income','₩39.775593T','₩12.597538T'),('operating-income','₩83.333818T','₩11.38339T')])
        self.assertTrue(all('暫定' in f[3][0] and 'preliminary' in f[3][1] and '兆ウォン' in f[3][0] and 'KRW trillion' in f[3][1] for f in parsed['facts']))
        keys=lambda x:[f[0] for f in flash.PROFILES['SKHY']['parse'](x)['facts']]
        with self.assertRaises(ValueError): flash.PROFILES['SKHY']['parse'](text.replace('104,615,483 236,510,516','105,615,483 236,510,516'))   # revenue disagrees with its stated changes
        self.assertEqual(keys(text.replace('83,333,818 181,486,709','84,333,818 181,486,709')),['revenue','net-income'])                         # operating profit dropped
        self.assertEqual(keys(text.replace('39,775,593 174,044,095','38,775,593 174,044,095')),['revenue','operating-income'])                 # net profit dropped
        self.assertEqual(keys(text.replace('(58.7 N.A. ) *','(57.0 N.A. ) *',1)),['revenue','net-income','operating-income'])                     # the pretax row is not published, so its change does not matter
        with self.assertRaises(ValueError): flash.PROFILES['SKHY']['parse'](text.replace('Previous Period (Second quarter(2) of 2026)','Previous Period (First quarter(2) of 2026)'))
        with self.assertRaises(ValueError): flash.PROFILES['SKHY']['parse'](text.replace('in millions of Won','in thousands of Won'))
        with self.assertRaises(ValueError): flash.PROFILES['SKHY']['parse'](text.replace('Preliminary Results of Operations','Results of Operations'))
    def test_coreweave_table_and_guidance(self):
        parsed=flash.parse_coreweave(fixture('coreweave-results-q326.txt'))
        self.assertEqual(parsed['period'],'Q3 2026')
        self.assertEqual([(k,v) for k,v,_ in parsed['facts']],[('revenue','$3.661B'),('eps','$-1.27'),('net-income','$-709M'),('operating-income','$207M'),
                                           ('adjusted-ebitda','$2.256B'),('guidance-revenue','$13.0B-$13.3B')])
        # the prior-year column (Q3 2025), read from the same rows
        self.assertEqual([(k,y) for k,_,y in parsed['facts']],[('revenue','$1.365B'),('eps','$-0.22'),('net-income','$-110M'),('operating-income','$52M'),
                                           ('adjusted-ebitda','$838M'),('guidance-revenue',None)])
    def test_unknown_layouts_publish_nothing(self):
        text=fixture('nebius-results-q226.txt')
        for broken in (text.replace('Revenues','Net sales'),                        # revenue row renamed
                       text.replace('2025 2026 Change','2024 2025 Change',1),       # columns are not the reported quarter
                       text.replace('Q2 2026 financial highlights','Q2 2026 results'),
                       text.replace('In USD $ millions','In thousands')):
            with self.assertRaises(ValueError): flash.parse_nebius(broken)
        cr=fixture('coreweave-results-q326.txt')
        for broken in (cr.replace('Revenue $ 3,661','Sales $ 3,661'),cr.replace('Three Months Ended September 30, 2026 2025','Three Months Ended September 30, 2025 2026'),
                       cr.replace('(In millions','(In thousands')):
            with self.assertRaises(ValueError): flash.parse_coreweave(broken)
    def test_a_repeated_row_is_left_out_not_guessed(self):
        text=fixture('nebius-results-q226.txt').replace('Adjusted net loss (91.5) (33.2) -64% (175.2) (133.5) -24%',
            'Adjusted net loss (91.5) (33.2) -64% (175.2) (133.5) -24%\nAdjusted net loss (1.0) (2.0) -64% (1.0) (2.0) -24%')
        keys=[f[0] for f in flash.parse_nebius(text)['facts']]
        self.assertNotIn('adjusted-net-income',keys); self.assertIn('revenue',keys)
    def test_only_the_nebius_results_page_is_a_candidate(self):
        ok=flash.NEBIUS_RESULTS_PATH.match
        self.assertTrue(ok('/newsroom/nebius-reports-third-quarter-2026-financial-results'))
        self.assertTrue(ok('/newsroom/nebius-group-n-v-announces-third-quarter-2024-financial-results'))
        self.assertFalse(ok('/newsroom/nebius-group-announces-date-of-third-quarter-2026-results-and-conference-call'))
        self.assertFalse(ok('/newsroom/nebius-secures-3-5-billion-financing-facility-with-citi'))

class BodyCompanies(unittest.TestCase):
    def test_nvidia_figures_from_the_stored_release_text(self):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
        path=str(Path(tmp.name)/'db.sqlite')
        with monitor.connect(path) as db: signals.schema(db)
        url='https://www.sec.gov/Archives/edgar/data/1045810/000104581026000073/q2fy27pr.htm'
        body=fixture('nvidia-results-q2fy27.txt'); sha=hashlib.sha256(body.encode()).hexdigest()
        with monitor.connect(path) as db:
            db.execute('INSERT INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',(url,'NVDA','2026-11-12T21:00:10+00:00',sha))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,'NVDA','2026-11-12T21:00:10+00:00'))
            db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,'2026-11-12T21:00:11+00:00',body,len(body)))
            db.execute('INSERT INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',('https://evil.example/q2fy27pr.htm','NVDA','2026-11-12T21:00:10+00:00','y'))
        self.assertEqual(flash.run_once(path,datetime(2026,11,12,21,1,tzinfo=timezone.utc)),1)
        with monitor.connect(path) as db: [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
        self.assertEqual((item['ticker'],item['period'],item['publisher'],item['facts'][0]['value']),('NVDA','Q2 FY2027','NVIDIA IR','$96.221B'))
        self.assertEqual(item['facts'][0]['comparisons'],{'yearAgo':'$46.743B'})
        self.assertEqual(item['facts'][-1]['ja'],'次四半期見通し 売上高')

    def test_statement_companies_figures_from_the_stored_release_text(self):
        cases=[('DELL','dell-results-q2fy27.txt','https://www.sec.gov/Archives/edgar/data/1571996/000157199626000039/exhibit991earnings8kq2fy27.htm','Q2 FY2027','$46.971B','Dell Technologies IR (SEC 8-K)'),
               ('MRVL','marvell-results-q2fy27.txt','https://www.sec.gov/Archives/edgar/data/1835632/000183563226000022/q227_8kx812026ex-991.htm','Q2 FY2027','$2.7393B','Marvell IR (SEC 8-K)'),
               ('CRDO','credo-results-q1fy27.txt','https://www.sec.gov/Archives/edgar/data/1807794/000162828026059795/credoq12027ex-991.htm','Q1 FY2027','$479.003M','Credo IR (SEC 8-K)'),
               ('TSM','tsmc-results-q326.txt','https://www.sec.gov/Archives/edgar/data/1046179/000104617926000100/a3q26e_withguidancexfinal.htm','Q3 2026','NT$1494.243B','TSMC IR (SEC 6-K)'),
               ('ASML','asml-results-q326.txt','https://www.sec.gov/Archives/edgar/data/937966/000093796626000040/pressreleasefinancialresul.htm','Q3 2026','€11.662B','ASML IR (SEC 6-K)'),
               ('AVGO','broadcom-results-q3fy26.txt','https://www.sec.gov/Archives/edgar/data/1730168/000173016826000076/avgo-08022026x8kxex99.htm','Q3 FY2026','$29.591B','Broadcom IR (SEC 8-K)')]
        for ticker,name,url,period,revenue,publisher in cases:
            with self.subTest(ticker):
                tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup)
                path=str(Path(tmp.name)/'db.sqlite')
                with monitor.connect(path) as db: signals.schema(db)
                body=fixture(name); sha=hashlib.sha256(body.encode()).hexdigest()
                with monitor.connect(path) as db:
                    db.execute('INSERT INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',(url,ticker,'2026-11-12T21:00:10+00:00',sha))
                    db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,ticker,'2026-11-12T21:00:10+00:00'))
                    db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,'2026-11-12T21:00:11+00:00',body,len(body)))
                self.assertEqual(flash.run_once(path,datetime(2026,11,12,21,1,tzinfo=timezone.utc)),1)
                with monitor.connect(path) as db: [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
                self.assertEqual((item['ticker'],item['period'],item['publisher'],item['facts'][0]['value']),(ticker,period,publisher,revenue))
                self.assertGreaterEqual(len([f for f in item['facts'] if not f['key'].startswith('guidance-')]),3)

class Publication(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=str(Path(self.tmp.name)/'db.sqlite')
        with monitor.connect(self.path) as db: signals.schema(db)
        flash._attempts.clear()
    def source(self,url,ticker,detected=DETECTED,body=None):
        sha=hashlib.sha256((body or url).encode()).hexdigest()
        with monitor.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO sources(url,ticker,discovered_at,sha256) VALUES(?,?,?,?)',(url,ticker,detected,sha))
            db.execute('INSERT OR REPLACE INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',(url,ticker,detected))
            if body:
                db.execute('INSERT OR REPLACE INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',(url,sha,detected,body,len(body)))
    def fetcher(self,table=None,links=(LETTER,PDF)):
        calls=[]
        def fetch(url,ticker):
            calls.append(url)
            assert ticker=='NBIS'
            if url==NB_PAGE: return ('<html>'+''.join(f'<a href="{l}">x</a>' for l in links)+'</html>').encode(),'text/html'
            return b'%PDF-1.4 '+url.encode(),'application/pdf'
        fetch.calls=calls
        return fetch
    def extract(self,table):
        def extract(content, first_pages=0):
            return table if PDF.encode() in content else 'Shareholder letter without the results table. '*5
        return extract
    def test_nebius_page_then_pdf_published_with_the_detection_clock(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026').replace('2025 2026 Change','2025 2026 Change')
        fetch=self.fetcher()
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),1)
        with monitor.connect(self.path) as db:
            [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
        self.assertEqual((item['ticker'],item['period'],item['kind'],item['url']),('NBIS','Q3 2026','earnings',NB_PAGE))
        self.assertEqual(item['researchId'],'ir-flash-'+item['id'])
        self.assertEqual(item['facts'][0],{'key':'revenue','ja':'売上高','en':'Revenue','value':'$582.3M','comparisons':{'yearAgo':'$105.1M'}})
        self.assertEqual(item['publishedAt'],'2026-11-12T13:00:05.000+00:00')
        self.assertEqual(item['titleJa'],'NBIS Q3 2026決算：売上高$582.3M、純損益$-190.4M')
        self.assertIn('detectionToPublicMs',item)
        # the letter PDF is tried first and skipped; the release PDF is the one used
        self.assertEqual(fetch.calls,[NB_PAGE,LETTER,PDF])
    def test_matches_the_nebius_calendar_entry(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            flash.run_once(self.path,NOW,self.fetcher())
        with monitor.connect(self.path) as db:
            items=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
        event={'id':'nbis-q3-2026-call','kind':'earnings','ticker':'NBIS','phase':'call','at':datetime(2026,11,12,13,0,tzinfo=timezone.utc)}
        public=release_watch.match(event,{'resultBriefs':items})
        self.assertIsNotNone(public)
    def test_not_republished_and_a_missing_pdf_is_retried_politely(self):
        self.source(NB_PAGE,'NBIS')
        fetch=self.fetcher(links=())
        with mock.patch.object(monitor,'extract_pdf_text',self.extract('')):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),0)
            self.assertEqual(flash.run_once(self.path,NOW,fetch),0)   # inside the retry wait: no second fetch
        self.assertEqual(fetch.calls,[NB_PAGE])
    def test_unchanged_release_is_idempotent_and_a_correction_replaces(self):
        self.source(NB_PAGE,'NBIS')
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        fetch=self.fetcher()
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            self.assertEqual(flash.run_once(self.path,NOW,fetch),1)
        with monitor.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM issuer_result_publications').fetchone()[0],1)
    def test_coreweave_from_the_stored_8k_exhibit(self):
        body='EX-99.1 '+fixture('coreweave-results-q326.txt')
        self.source(CR_URL,'CRWV','2026-11-10T21:05:58+00:00',body)
        now=datetime(2026,11,12,9,0,tzinfo=timezone.utc)
        self.assertEqual(flash.run_once(self.path,now,self.fetcher()),1)
        self.assertEqual(flash.run_once(self.path,now,self.fetcher()),0)
        with monitor.connect(self.path) as db:
            [item]=flash.public_feed(db,'2026-11-05T00:00:00+00:00')
            self.assertEqual([f['value'] for f in item['facts']],['$3.661B','$-1.27','$-709M','$207M','$2.256B','$13.0B-$13.3B'])
            merged=market_results.public_feed(db,reference=now,earnings_hours=24*7)
        self.assertEqual([i['researchId'] for i in merged],[item['researchId']])
    def test_old_or_unrelated_sources_are_ignored(self):
        body='EX-99.1 '+fixture('coreweave-results-q326.txt')
        self.source(CR_URL,'CRWV','2026-10-01T21:05:58+00:00',body)           # outside the 7-day window
        self.source('https://www.sec.gov/Archives/edgar/data/1769628/x/other.htm','CRWV',DETECTED,'no table here')
        self.source('https://nebius.com/newsroom/nebius-group-announces-date-of-third-quarter-2026-results-and-conference-call','NBIS')
        fetch=self.fetcher()
        self.assertEqual(flash.run_once(self.path,NOW,fetch),0)
        self.assertEqual(fetch.calls,[])

class Diagnostics(Publication):
    def test_health_shows_why_nothing_was_published_then_the_published_flash(self):
        flash.STATUS.clear()
        self.source(NB_PAGE,'NBIS')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract('')):
            flash.run_once(self.path,NOW,self.fetcher(links=()))
        with monitor.connect(self.path) as db: info=flash.diagnostics(db)
        self.assertEqual([(w['ticker'],w['state'],w['reason']) for w in info['waiting']],[('NBIS','unreadable','results-pdf-not-linked-yet')])
        self.assertEqual(info['published'],0)
        flash._attempts.clear()
        table=fixture('nebius-results-q226.txt').replace('Q2 2026','Q3 2026')
        with mock.patch.object(monitor,'extract_pdf_text',self.extract(table)):
            flash.run_once(self.path,NOW,self.fetcher())
        with monitor.connect(self.path) as db: info=flash.diagnostics(db)
        self.assertEqual((info['published'],info['waiting'],info['latest'][0]['period']),(1,[],'Q3 2026'))

class FirstPages(unittest.TestCase):
    def test_only_the_first_pages_are_read_when_asked(self):
        import io, importlib.util
        from pypdf import PdfWriter, PdfReader
        spec=importlib.util.spec_from_file_location('intake',Path(__file__).parent/'test_research_intake.py')
        # reuse the dependency-free one-line PDF builder from the intake tests
        text_pdf=__import__('test_research_intake').text_pdf
        writer=PdfWriter()
        for line in ('Q3 2026 financial highlights revenue first page words here','Second page words that must not be read when only one page is asked'):
            for page in PdfReader(io.BytesIO(text_pdf(line))).pages: writer.add_page(page)
        buffer=io.BytesIO(); writer.write(buffer)
        both=monitor.extract_pdf_text(buffer.getvalue())
        first=monitor.extract_pdf_text(buffer.getvalue(),first_pages=1)
        self.assertIn('Second page',both)
        self.assertIn('first page',first); self.assertNotIn('Second page',first)

class DirectFetch(unittest.TestCase):
    def test_only_the_issuer_asset_host_is_downloaded_and_codes_name_the_failing_step(self):
        for url in ('https://evil.example/a.pdf','http://assets.nebius.com/a.pdf','https://user@assets.nebius.com/a.pdf','https://nebius.com/a.pdf'):
            with self.assertRaises(ValueError) as c: flash.direct_pdf(url)
            self.assertEqual(str(c.exception),'host-not-allowed')
        self.assertEqual(flash.failure_code(ValueError('fetch-empty')),'fetch-empty')
        self.assertEqual(flash.failure_code(ValueError('PDF text extraction timed out')),'extract-timeout')
        self.assertEqual(flash.failure_code(ValueError('Empty or oversized source')),'fetch-oversized')
    def test_a_failing_letter_does_not_hide_the_release_pdfs_own_outcome(self):
        def fetch(url,ticker):
            if url==NB_PAGE: return ('<a href="%s">r</a><a href="%s">l</a>'%(PDF,LETTER)).encode(),'text/html'
            if url==LETTER: raise ValueError('fetch-empty')
            return b'%PDF-1.4 x','application/pdf'
        with mock.patch.object(monitor,'extract_pdf_text',lambda c,first_pages=0:'a release page without the table, words words words words words'):
            with self.assertRaises(ValueError) as c: flash.nebius_pdf_text(NB_PAGE,fetch)
        self.assertEqual(str(c.exception),'no-heading')   # the first PDF's outcome, not the letter's 'fetch-empty'

if __name__=='__main__': unittest.main()
