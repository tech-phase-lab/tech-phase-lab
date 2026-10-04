"""Read-only timing from current public market rows, never private candidates."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import signals
import x_api
import x_market_news as news


class MarketPublicationTimingTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.db = headline_translation.connect(Path(tmp.name) / 'test.sqlite')
        self.addCleanup(self.db.close)
        news.schema(self.db)
        self.source = next(s for s in signals.SOURCES if s['id'] == 'x-barchart')
        self.source_at = '2026-10-02T19:07:25.000Z'
        self.acquired_at = '2026-10-02T19:08:01.778+00:00'
        self.public_at = '2026-10-02T19:08:05.100+00:00'
        self.now = datetime(2026,10,2,19,10,tzinfo=timezone.utc).timestamp()
        self.original = 'U.S. 10-Year Treasury Yield Rising Sharply Again'
        self.copy = {'titleJa':'米国10年物国債利回りが再び急上昇中', 'titleEn':self.original}

    def seed(self, post, published=False, **copy):
        payload = {'data':[{'id':str(post),'author_id':'1','created_at':self.source_at,'text':self.original}],
                   'includes':{'users':[{'id':'1','username':'Barchart'}]}}
        signals.save(self.db,self.source,x_api.parse_response(self.source,payload,[]),{},
                     self.acquired_at,'synthetic-config',1)
        row = self.db.execute('SELECT * FROM signal_events WHERE url=?',
                              (f'https://x.com/Barchart/status/{post}',)).fetchone()
        if published:
            candidate = {**dict(row),'topic':'government-bonds'}
            self.db.execute('INSERT INTO x_market_publications VALUES(?,?,?,?,?)',
                (row['source_id'],row['url'],row['sha'],json.dumps(news.publication_payload(candidate,{**self.copy,**copy})),self.public_at))
        self.db.commit()
        return row

    def test_only_valid_public_rows_have_original_timing_and_reads_do_not_rewrite_it(self):
        public = self.seed(123,True)
        self.seed(124)  # Acquired but never released.
        self.seed(125,True,titleJa='米国20年物国債利回りが再び急上昇中')  # Rejected translation.
        stale = self.seed(126,True)
        self.db.execute('UPDATE signal_documents SET sha=? WHERE url=?',('corrected',stale['url']))
        self.db.commit()
        changes = self.db.total_changes
        diagnostic = news.diagnostics(self.db,now=self.now)
        self.assertEqual(diagnostic['latest'],[{'id':str(public['id']),
            'publishedAt':self.source_at,'observedAt':self.acquired_at,
            'publicAt':datetime.fromisoformat(self.public_at).isoformat(),
            'sourceToDetectionMs':36778,'detectionToPublicMs':3322}])
        self.assertEqual(self.db.total_changes,changes)
        serialized=json.dumps(diagnostic['latest'])
        for private in ('titleJa','titleEn','url','body',self.original,'124','125','126'):
            self.assertNotIn(private,serialized)
        later = news.diagnostics(self.db,now=self.now+60)
        self.assertEqual(later['latest'],diagnostic['latest'])
        self.assertEqual(self.db.execute('SELECT published_at FROM x_market_publications WHERE url=?',
                                         (public['url'],)).fetchone()[0],self.public_at)

    def test_timing_is_bounded_and_does_not_invent_missing_or_invalid_clocks(self):
        for post in range(10,17):
            self.seed(post,True)
        self.assertEqual(len(news.diagnostics(self.db,now=self.now)['latest']),5)
        for value in ('invalid','2026-10-02T19:08:05','2026-10-02T19:07:00Z','2026-10-03T19:08:05Z'):
            with self.subTest(value=value):
                self.db.execute('UPDATE x_market_publications SET published_at=?',(value,))
                self.db.commit()
                self.assertEqual(news.diagnostics(self.db,now=self.now)['latest'],[])


if __name__ == '__main__':
    unittest.main()
