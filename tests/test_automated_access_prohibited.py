import json
import sys
import unittest
import urllib.request
from pathlib import Path
from unittest import mock
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts/research'))
import monitor
import signals

class ProhibitedSite(unittest.TestCase):
    def test_only_sk_hynix_is_marked_and_nothing_else_changes(self):
        marked=[p['ticker'] for p in json.loads((ROOT/'lib/research/providers.json').read_text()) if p.get('automatedAccess')]
        self.assertEqual(marked,['SKHY'])
    def test_no_request_leaves_for_a_prohibited_site_but_sec_and_other_companies_are_unchanged(self):
        with mock.patch.object(urllib.request,'urlopen',side_effect=AssertionError('no network')) as network:
            for url in ('https://news.skhynix.com/en/category/ir/','https://news.skhynix.com/en/q3-2026-business-results/','https://www.skhynix.com/'):
                with self.assertRaisesRegex(ValueError,'automated-access-prohibited'): monitor.fetch(url,'SKHY')
            network.assert_not_called()
        self.assertTrue(monitor.automated_access_prohibited('SKHY','https://news.skhynix.com/en/x/'))
        self.assertFalse(monitor.automated_access_prohibited('SKHY','https://data.sec.gov/submissions/CIK0002120882.json'))   # SEC EDGAR stays allowed
        self.assertFalse(monitor.automated_access_prohibited('SKHY','https://www.sec.gov/Archives/edgar/data/2120882/x.htm'))
        for ticker in monitor.PROVIDERS:
            if ticker!='SKHY': self.assertFalse(monitor.automated_access_prohibited(ticker,'https://example.com/'),ticker)

class NewsFeed(unittest.TestCase):
    def test_the_sk_hynix_newsroom_feed_is_never_requested(self):
        sources=json.loads((ROOT/'scripts/research/signal_sources.json').read_text())       # the file as shipped, whatever other tests do to signals.SOURCES
        self.assertEqual([source['id'] for source in sources if source.get('automatedAccess')],['skhynix-news'])    # no other source is marked
        source=next(source for source in sources if source['id']=='skhynix-news')
        self.assertEqual(source['automatedAccess'],'prohibited')
        with mock.patch.object(signals,'build_opener',side_effect=AssertionError('no network')) as network:
            with self.assertRaisesRegex(ValueError,'automated-access-prohibited'): signals.fetch(source,{})
            network.assert_not_called()
        other={**source,'automatedAccess':None}
        with mock.patch.object(signals,'build_opener',side_effect=RuntimeError('reached the network layer')):
            with self.assertRaisesRegex(RuntimeError,'reached the network layer'): signals.fetch(other,{})     # without the marker the same source would go out

if __name__=='__main__': unittest.main()
