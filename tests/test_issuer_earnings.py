"""Quarter/annual and GAAP/non-GAAP boundaries must not cross."""
import json
import unittest
import test_official_research as base
NOW=base.NOW
import official_research as research

BODY='''Micron Technology, Inc. Reports Record Fiscal Fourth-Quarter and Full-Year 2026 Results
Fiscal Q4 2026 Highlights
Revenue of $54.23 billion versus $41.46 billion for the prior quarter and $11.32 billion for the same period last year
GAAP net income of $37.70 billion, or $32.87 per diluted share
Non-GAAP net income of $38.40 billion, or $33.42 per diluted share
Operating cash flow of $43.97 billion versus $25.39 billion for the prior quarter and $5.73 billion for the same period last year
Fiscal 2026 Highlights
Revenue of $133.19 billion versus $37.38 billion for the prior year
Business Outlook
The following table presents Micron’s guidance for the first quarter of 2027:
FQ1-27
GAAP(1) Outlook
Non-GAAP(2) Outlook
Revenue
$61.5 billion ± $1.5 billion
Gross margin
Approximately 85.95%
Approximately 86.25%
Operating expenses
Approximately $2.31 billion
Approximately $2.06 billion
Diluted earnings per share
$37.84 ± $1.00
$38.15 ± $1.00
Further information on Micron’s business outlook is included in the prepared remarks and slides.
'''+('Historical financial tables. '*30)

class IssuerEarningsTests(unittest.TestCase):
    setUp=base.OfficialResearchTests.setUp
    feed=base.OfficialResearchTests.feed
    def test_factual_path_publishes_without_provider_and_is_idempotent(self):
        with research.connect(self.path) as db:
            url='https://investors.micron.com/news/press-release/2026/Micron-Technology-Inc--Reports-Record-Fiscal-Fourth-Quarter-and-Full-Year-2026-Results/default.aspx'
            db.execute("PRAGMA defer_foreign_keys=ON")
            for table in ('sources','source_revisions','release_events'):
                db.execute(f'UPDATE {table} SET url=?',(url,))
            db.execute("UPDATE sources SET ticker='MU',title=NULL")
            db.execute("UPDATE source_revisions SET extracted_text=?,extracted_chars=?",(BODY,len(BODY)))
        no_call=lambda *_:self.fail('must not consume API budget')
        self.assertEqual(research.run_once(self.path,no_call,{},NOW.timestamp()),'done')
        item=self.feed()[0]
        self.assertEqual(item['kind'],'earnings')
        self.assertIn('54.23',item['summary']['ja'])
        self.assertIn('33.42',item['facts'][1]['ja'])
        self.assertIn('38.15',item['facts'][4]['en'])
        self.assertNotIn('32.87',json.dumps(item))
        self.assertNotIn('133.19',json.dumps(item))
        with research.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0],0)
        self.assertEqual(research.run_once(self.path,no_call,{},NOW.timestamp()),'disabled')

    def test_unknown_or_incomplete_layout_fails_closed(self):
        row={'ticker':'MU','title':'Fiscal Fourth-Quarter Results','body':BODY}
        for body in (BODY.replace('Non-GAAP net income','Adjusted profit'),BODY.replace('Non-GAAP(2) Outlook','Unknown'),BODY.replace('Fiscal Q4','Fiscal FY'),BODY.replace('$38.15 ± $1.00','')):
            self.assertIsNone(research.earnings_note({**row,'body':body}))
        self.assertIsNone(research.earnings_note({**row,'ticker':'NVDA'}))
        revised=research.earnings_note({**row,'body':BODY.replace('54.23','59.25')})
        self.assertIn('59.25',revised['title']['ja'])
        self.assertNotIn('54.23',json.dumps(revised))
