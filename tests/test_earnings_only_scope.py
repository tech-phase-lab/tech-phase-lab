"""Owner, Oct 11: the 15 added companies are followed for earnings only."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation as translation
import monitor
import signals
from test_official_release_bridge import NOW

# LITE and ALAB replaced DELL and ORCL on the roster later the same day.
ADDED = {'AAPL', 'AMZN', 'META', 'TSLA', 'DELL', 'COHR', 'AAOI', 'IREN', 'APH', 'ORCL', 'VST', 'SOFI', 'IONQ', 'STX', 'CEG', 'IBM', 'LRCX'}


class EarningsOnlyScopeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'

    def add(self, url, title):
        with translation.connect(self.path) as db:
            db.execute('''INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256)
              VALUES(?,?,?,?,?,?)''', (url, 'AAPL', title, '2026-10-01', '2026-10-01T11:00:29+00:00', url[-8:]))
            db.execute('INSERT INTO release_events(url,ticker,detected_at) VALUES(?,?,?)', (url, 'AAPL', '2026-10-01T11:00:29+00:00'))
            db.execute('''INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars)
              VALUES(?,?,?,?,?)''', (url, url[-8:], '2026-10-01T11:00:41+00:00', 'Synthetic body. ' * 100, 1600))

    def test_only_results_releases_are_published_for_an_earnings_only_company(self):
        self.add('https://www.apple.com/newsroom/2026/10/apple-unveils-new-ipad/', 'Apple unveils new iPad')
        self.add('https://www.apple.com/newsroom/2026/10/apple-reports-fourth-quarter-results/', 'Apple reports fourth quarter results')
        with translation.connect(self.path) as db:
            titles = [item['title'] for item in signals.public_official_updates(db, reference=NOW)]
        self.assertEqual(titles, ['Apple reports fourth quarter results'])

    def test_the_research_roster_stays_at_22_and_names_are_not_matched(self):
        scoped = {ticker for ticker, provider in monitor.PROVIDERS.items() if provider.get('scope') == 'earnings'}
        self.assertEqual(scoped, ADDED)
        self.assertEqual(len(monitor.PROVIDERS) - len(scoped), 22)
        self.assertFalse(ADDED & set(signals.ALIASES))
        self.assertEqual(signals.match_companies('Apple and Amazon unveil products', list(signals.ALIASES)), {})


if __name__ == '__main__':
    unittest.main()
