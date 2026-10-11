"""Owner, Oct 11: an earnings release that reaches us only as an SEC exhibit
99.1 (the issuer's IR site refuses our server) is published under its own
heading. Other SEC filings stay evidence."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))

import headline_translation as translation
import signals
from test_official_release_bridge import NOW

SEC_URL = 'https://www.sec.gov/Archives/edgar/data/1513845/000151384526000099/ex991.htm'
IR_URL = 'https://nebius.com/newsroom/nebius-reports-third-quarter-2026-financial-results'
HEADING = 'Nebius Group Reports Third Quarter 2026 Financial Results'
EXHIBIT = 'Exhibit 99.1\n' + HEADING + '\nAMSTERDAM, October 1, 2026 -- synthetic results paragraph. ' + 'Body. ' * 300


class SecEarningsReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'

    def add(self, url, title, text, evidence='sec-exhibit-99.1', sha='body-v1'):
        with translation.connect(self.path) as db:
            db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256,evidence_kind)
              VALUES(?,?,?,?,?,?,?)''', (url, 'NBIS', title, '2026-10-01', '2026-10-01T11:00:29+00:00', sha, evidence))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)',
                       (url, 'NBIS', '2026-10-01T11:00:29+00:00'))
            db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
              VALUES(?,?,?,?,?)''', (url, sha, '2026-10-01T11:00:41+00:00', text, len(text)))

    def feed(self):
        with translation.connect(self.path) as db:
            return signals.public_official_updates(db, reference=NOW)

    def test_an_sec_earnings_exhibit_is_published_under_its_own_heading(self):
        self.add(SEC_URL, '6-K · Report of foreign private issuer', EXHIBIT)
        [item] = self.feed()
        self.assertEqual(item['url'], SEC_URL)
        self.assertEqual(item['title'], HEADING)

    def test_other_sec_filings_stay_evidence(self):
        self.add(SEC_URL, '6-K · Report of foreign private issuer',
                 'Exhibit 99.1\nNebius announces annual general meeting results of voting\n' + 'Body. ' * 300)
        self.assertEqual(self.feed(), [])
        self.add(SEC_URL.replace('ex991', 'form6k'), '6-K · Report', EXHIBIT, evidence='direct', sha='body-v2')
        self.assertEqual(self.feed(), [])

    def test_the_issuer_page_wins_when_both_exist(self):
        self.add(IR_URL, HEADING, 'Synthetic IR body. ' * 100, evidence='direct', sha='ir-v1')
        self.assertEqual([item['url'] for item in self.feed()], [IR_URL])
        self.add(SEC_URL, '6-K · Report of foreign private issuer', EXHIBIT)
        self.assertEqual([item['url'] for item in self.feed()], [IR_URL])


if __name__ == '__main__':
    unittest.main()
