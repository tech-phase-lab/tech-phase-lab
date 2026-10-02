"""Synthetic full-post-to-public-feed checks; no live provider calls."""
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
import threading
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import signals
import x_api
import x_market_news as news

ENV = {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true', 'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
       'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'synthetic-model', 'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '3'}


class MarketNewsTests(unittest.TestCase):
    def test_new_direct_story_publishes_during_an_inflight_market_translation(self):
        now = time.time()
        original = 'US 30-year Treasury yield rises +0.3% to its highest since 2002'
        started, release = threading.Event(), threading.Event()
        def provider(payload, key):
            started.set()
            release.wait(5)
            return {'status':'completed', 'output_text':json.dumps({
                'titleJa':'米国30年物国債利回りは+0.3%上昇し、2002年以来の最高水準。',
                'titleEn':original})}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'signals.sqlite'
            self.seed(path, original, now)
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(news.run_once, path, transport=provider, env=ENV, now=now)
                try:
                    self.assertTrue(started.wait(2))
                    source = next(s for s in signals.SOURCES if s['id']=='x-trendspider')
                    at = datetime.fromtimestamp(now-0.1, timezone.utc).isoformat()
                    payload = {'data':[{'id':'456','author_id':'1','created_at':at,
                        'text':'BREAKING: Moderna $MRNA will join the Nasdaq-100 index, replacing Warner Bros Discovery $WBD'}],
                        'includes':{'users':[{'id':'1','username':'TrendSpider'}]}}
                    with headline_translation.connect(path) as db:
                        signals.save(db,source,x_api.parse_response(source,payload,[]),{},at,'synthetic-config',1)
                    self.assertEqual(news.publish_direct_once(path,now=now),'done')
                    self.assertFalse(future.done())
                    self.assertEqual(news.publish_direct_once(path,now=now),'idle')
                    with headline_translation.connect(path) as db:
                        self.assertEqual([r['url'] for r in news.public_feed(db,now=now)],['https://x.com/TrendSpider/status/456'])
                        self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_headline_translation_calls').fetchone()[0],1)
                finally:
                    release.set()
                self.assertEqual(future.result(timeout=5),'done')
            with headline_translation.connect(path) as db:
                self.assertEqual({r['url'] for r in news.public_feed(db,now=now)},
                                 {'https://x.com/TrendSpider/status/456','https://x.com/Barchart/status/123'})

    def test_signed_numbers_maturity_direction_and_record_year(self):
        original = 'US 30-year Treasury yield rises +0.3% to its highest since 2002'
        valid = {'titleJa': '米国30年物国債利回りは+0.3%上昇し、2002年以来の最高水準。',
                 'titleEn': 'US 30-year Treasury yield rises +0.3% to its highest since 2002.'}
        news.validate(valid, original)
        for key, before, after in [('titleJa', '+0.3%', '-0.3%'), ('titleJa', '2002', '2022'),
                                   ('titleJa', '30年物', '10年物'), ('titleJa', '上昇', '下落'),
                                   ('titleEn', '+0.3%', '-0.3%')]:
            with self.subTest(key=key, after=after), self.assertRaises(ValueError):
                news.validate({**valid, key: valid[key].replace(before, after)}, original)

    def test_membership_roles_and_planned_status(self):
        original = 'S&P 500 rebalance: Additions $VYLR $TWLO; Removals $CTVA $WDB'
        valid = {'titleJa': 'S&P 500リバランス。追加：$VYLR $TWLO。除外：$CTVA $WDB。', 'titleEn': original}
        news.validate(valid, original)
        for key in valid:
            with self.assertRaises(ValueError):
                news.validate({**valid, key: valid[key].replace('$TWLO', '$TEMP').replace('$CTVA', '$TWLO').replace('$TEMP', '$CTVA')}, original)
        original = '$MRNA will join Nasdaq 100, replacing $WBD'
        valid = {'titleJa': 'NASDAQ 100に追加予定：$MRNA。除外予定：$WBD。',
                 'titleEn': 'Nasdaq 100: Added (scheduled): $MRNA. Removed (scheduled): $WBD.'}
        news.validate(valid, original)
        with self.assertRaises(ValueError):
            news.validate({**valid, 'titleJa': valid['titleJa'].replace('予定', '')}, original)

    def test_mixed_market_movements_do_not_suppress_an_accurate_translation(self):
        original = 'US Treasury yields rise +0.3%; Japanese government bond yields fall -0.2%.'
        news.validate({'titleJa': '米国国債利回りは+0.3%上昇、日本国債利回りは-0.2%下落。',
                       'titleEn': original}, original)

    def test_unambiguous_membership_announcement_has_direct_bilingual_copy(self):
        original = 'BREAKING: Moderna $MRNA will join the Nasdaq-100 index, replacing Warner Bros Discovery $WBD https://t.co/synthetic123'
        result = news.direct_membership_copy(original)
        self.assertIn('追加予定 Moderna（$MRNA）', result['titleJa'])
        self.assertIn('除外予定 Warner Bros Discovery（$WBD）', result['titleJa'])
        self.assertIn('Added (scheduled): Moderna $MRNA', result['titleEn'])
        self.assertIsNone(news.direct_membership_copy(original.replace('will join', 'might join')))
        self.assertIsNone(news.direct_membership_copy(original.replace('Nasdaq-100', 'Nasdaq Composite')))

    def test_direct_membership_publication_does_not_wait_for_model_budget(self):
        now = time.time()
        at = datetime.fromtimestamp(now-1, timezone.utc).isoformat()
        source = next(s for s in signals.SOURCES if s['id'] == 'x-trendspider')
        original = 'BREAKING: Moderna $MRNA will join the Nasdaq-100 index, replacing Warner Bros Discovery $WBD https://t.co/synthetic123'
        payload = {'data': [{'id': '456', 'author_id': '1', 'created_at': at, 'text': original}], 'includes': {'users': [{'id': '1', 'username': 'TrendSpider'}]}}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'signals.sqlite'
            with headline_translation.connect(path) as db:
                signals.save(db, source, x_api.parse_response(source, payload, []), {}, at, 'synthetic-config', 1)
                for n in range(3):
                    db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)", (now,'other','sha','synthetic-model','done',f'budget-{n}'))
            def unexpected_provider(payload, key):
                self.fail('Exact membership grammar must not use the model')
            self.assertEqual(news.run_once(path, transport=unexpected_provider, env=ENV, now=now), 'done')
            with headline_translation.connect(path) as db:
                self.assertEqual(news.public_feed(db, now=now)[0]['topic'], 'index-membership')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_headline_translation_calls').fetchone()[0], 3)

    def seed(self, path, original, now):
        source = next(s for s in signals.SOURCES if s['id'] == 'x-barchart')
        at = datetime.fromtimestamp(now-1, timezone.utc).isoformat()
        payload = {'data': [{'id': '123', 'author_id': '1', 'created_at': at, 'text': original}],
                   'includes': {'users': [{'id': '1', 'username': 'Barchart'}]}}
        items = x_api.parse_response(source, payload, [])
        with headline_translation.connect(path) as db:
            signals.save(db, source, items, {}, at, 'synthetic-config', 1)
        return items

    def test_full_original_to_bilingual_feed_and_revision_invalidation(self):
        now = time.time()
        original = 'Japan 10-year government bond yield reaches its highest in over 30 years.'
        result = {'titleJa': '日本の10年物国債利回りが30年以上ぶりの高水準に到達。', 'titleEn': original}
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'signals.sqlite'
            self.seed(path, original, now)
            def provider(payload, key):
                self.assertEqual(json.loads(payload['input']), {'post': original})
                self.assertFalse(payload['store'])
                return {'status': 'completed', 'output_text': json.dumps(result)}
            self.assertEqual(news.run_once(path, transport=provider, env=ENV, now=now), 'done')
            with headline_translation.connect(path) as db:
                self.assertEqual(news.public_feed(db, now=now)[0]['titleJa'], result['titleJa'])
                self.assertEqual(news.diagnostics(db, now=now)['pending'], 0)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
                db.execute("UPDATE signal_documents SET sha='revised'")
            with headline_translation.connect(path) as db:
                self.assertEqual(news.public_feed(db, now=now), [])

    def test_full_post_not_500_character_title_is_translation_input_and_budget_shared(self):
        now = time.time()
        original = 'Brent crude oil supply update. ' + 'Reported supply details. '*40 + 'Final reported oil price +3%.'
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'signals.sqlite'
            items = self.seed(path, original, now)
            self.assertEqual(len(items[0]['title']), 500)
            self.assertEqual(items[0]['text'], original)
            def provider(payload, key):
                self.assertEqual(json.loads(payload['input'])['post'], original)
                return {'status': 'incomplete'}
            self.assertEqual(news.run_once(path, transport=provider, env=ENV, now=now), 'retry')
            with headline_translation.connect(path) as db:
                self.assertEqual(news.public_feed(db, now=now), [])
                self.assertEqual(news.diagnostics(db, now=now)['failureKinds'], {'incomplete': 1})
                for n in range(2):
                    db.execute("INSERT INTO signal_headline_translation_calls(at,source_id,sha,model,state,lease) VALUES(?,?,?,?,?,?)", (now,'other','sha','synthetic-model','done',f'other-{n}'))
            self.assertEqual(news.run_once(path, transport=provider, env=ENV, now=now+100), 'budget')
