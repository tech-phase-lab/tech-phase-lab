"""X market posts: one-line headline plus an optional checked detail (no live calls)."""
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import x_market_news as news
import test_x_market_news as fixtures
from test_x_market_news import ENV

ORIGINAL = 'Japan 10-year government bond yield rises to 1.85%, its highest in over 30 years.'
TITLES = {'titleJa': '日本の10年物国債利回りが1.85%に上昇、30年以上ぶりの高水準', 'titleEn': ORIGINAL}


class MarketDetailTests(unittest.TestCase):
    seed = fixtures.MarketNewsTests.seed

    def publish(self, detail):
        now = time.time()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / 'signals.sqlite'
        self.seed(path, ORIGINAL, now)
        seen = []

        def provider(payload, key):
            seen.append(payload)
            return {'status': 'completed', 'output_text': json.dumps({**TITLES, **detail}, ensure_ascii=False)}
        self.assertEqual(news.run_once(path, provider, ENV, now), 'done')
        with headline_translation.connect(path) as db:
            return news.public_feed(db, now=now)[0], seen[0]

    def test_checked_detail_is_published_behind_the_headline(self):
        detail = {'bodyJa': 'Barchartによると、日本の10年物国債利回りは1.85%に上昇し、30年以上ぶりの高水準となった。',
                  'bodyEn': 'Barchart reported that the Japan 10-year government bond yield rose to 1.85%, its highest in over 30 years.'}
        item, payload = self.publish(detail)
        self.assertIn('bodyJa', payload['text']['format']['schema']['properties'])
        self.assertEqual((item['detailPolicy'], item['bodyJa'], item['bodyEn']),
                         (news.SUMMARY_DETAIL_POLICY, detail['bodyJa'], detail['bodyEn']))

    def test_reversed_or_invented_detail_is_dropped_but_headline_still_publishes(self):
        for detail in (
            {'bodyJa': 'Barchartによると、日本の10年物国債利回りは1.85%に低下した。',
             'bodyEn': 'Barchart reported that the Japan 10-year government bond yield fell to 1.85%.'},
            {'bodyJa': 'Barchartによると、利回りは2.10%に上昇した。',
             'bodyEn': 'Barchart reported the yield rose to 2.10%.'},
            {'bodyJa': None, 'bodyEn': None},
        ):
            with self.subTest(detail=detail):
                item, _ = self.publish(detail)
                self.assertEqual(item['titleJa'], TITLES['titleJa'])
                self.assertNotIn('bodyJa', item)


if __name__ == '__main__':
    unittest.main()
