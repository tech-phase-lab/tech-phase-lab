import sqlite3
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts' / 'research'))
import company_wire  # noqa: E402

RSS = b'''<?xml version="1.0"?><rss><channel>
<item><title>Credo Expands Portfolio - Credo Technology Group</title><link>https://news.example/a</link>
<source>Credo Technology Group</source><pubDate>Tue, 13 Oct 2026 12:00:00 GMT</pubDate></item>
<item><title>Why Credo stock slid - Investing.com</title><link>https://news.example/b</link>
<source>Investing.com</source><pubDate>Tue, 13 Oct 2026 13:00:00 GMT</pubDate></item>
<item><title>No date</title><link>https://news.example/c</link></item>
<item><title>Plain http</title><link>http://news.example/d</link><pubDate>Tue, 13 Oct 2026 13:00:00 GMT</pubDate></item>
</channel></rss>'''


class CompanyWireTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        company_wire.schema(self.db)

    def test_parse_skips_undated_and_insecure_and_strips_publisher(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual([r['title'] for r in rows], ['Credo Expands Portfolio', 'Why Credo stock slid'])

    def test_origin_separates_company_and_wire_from_third_party(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual([company_wire.origin(r, 'Credo') for r in rows], ['wire', 'third-party'])
        self.assertEqual(company_wire.origin({'publisher': 'Business Wire'}, 'Credo'), 'wire')
        self.assertEqual(company_wire.origin({'publisher': ''}, 'Credo'), 'unknown')

    def test_store_dedupes_across_sources(self):
        rows = company_wire.parse(RSS, 'gnews', 'CRDO')
        self.assertEqual(company_wire.store(self.db, rows, 'Credo'), 2)
        again = company_wire.parse(RSS, 'yahoo', 'CRDO')
        self.assertEqual(company_wire.store(self.db, again, 'Credo'), 0)

    def test_only_known_hosts_are_fetched(self):
        with self.assertRaises(ValueError):
            company_wire.fetch_feed('https://example.com/rss')

    def test_roster_is_the_non_earnings_providers(self):
        tickers = company_wire.roster()
        self.assertEqual(len(tickers), 22)
        self.assertIn('CRDO', tickers)
        self.assertNotIn('DELL', tickers)

    def test_status_reports_counts_without_titles(self):
        company_wire.store(self.db, company_wire.parse(RSS, 'gnews', 'CRDO'), 'Credo',
                           seen_at=datetime(2026, 10, 13, 14, 0, tzinfo=timezone.utc))
        status = company_wire.status(self.db, {('CRDO', 'yahoo'): 'URLError'})
        self.assertNotIn('Credo Expands', repr(status))
        self.assertEqual(status['CRDO']['feedErrors'], ['yahoo:URLError'])


if __name__ == '__main__':
    unittest.main()
