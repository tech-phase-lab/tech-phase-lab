"""Retained text-only Treasury detail; temporary DBs and no external requests."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation
import signals
import x_api
import x_market_news as news

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/treasury-period-post.json').read_text())


class TreasuryPeriodDetailTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / 'test.sqlite'
        self.db = headline_translation.connect(self.path)
        self.addCleanup(self.db.close)
        news.schema(self.db)
        self.now = datetime.fromisoformat('2026-10-04T01:00:00+00:00').timestamp()
        self.source = next(s for s in signals.SOURCES if s['id'] == FIXTURE['sourceId'])
        self.seed(FIXTURE['retainedText'])
        self.row = news.candidates(self.db, now=self.now)[0]
        self.payload = news.publication_payload(self.row, news.direct_period_copy(self.row['body']))
        # Publication clock is synthetic; source and acquisition clocks are the
        # exact retained fixture. Read projection must rewrite none of them.
        self.public_at = '2026-10-04T00:49:12+00:00'
        self.db.execute('INSERT INTO x_market_publications VALUES(?,?,?,?,?)',
                        (self.row['source_id'], self.row['url'], self.row['sha'],
                         json.dumps(self.payload), self.public_at))
        self.db.commit()

    def seed(self, original):
        payload = {'data': [{'id': FIXTURE['sourceUrl'].rsplit('/', 1)[1], 'author_id': '1',
                            'created_at': FIXTURE['publishedAt'], 'text': original}],
                   'includes': {'users': [{'id': '1', 'username': 'Barchart'}]}}
        signals.save(self.db, self.source, x_api.parse_response(self.source, payload, []), {},
                     FIXTURE['observedAt'], 'synthetic-config', 1)

    def feed(self):
        return news.public_feed(self.db, now=self.now)

    def test_exact_retained_source_adds_only_attributed_period_explanation(self):
        self.assertEqual(self.row['sha'], FIXTURE['sourceSha256'])
        self.assertEqual(hashlib.sha256(self.row['body'].encode()).hexdigest(), FIXTURE['bodySha256'])
        item = self.feed()[0]
        self.assertEqual(item['titleJa'], '米国債、10年間の成績が史上最悪に')
        self.assertEqual(item['titleEn'], 'U.S. Treasuries suffer their worst 10-year period in history')
        self.assertEqual(item['detailPolicy'], news.PERIOD_DETAIL_POLICY)
        self.assertIn('Barchartは、', item['bodyJa'])
        self.assertIn('「10年」は成績を測る期間', item['bodyJa'])
        self.assertIn('国債の満期を示すものではない', item['bodyJa'])
        self.assertIn('投稿本文には具体的な騰落率や計算方法は記されていない', item['bodyJa'])
        self.assertIn('Barchart reported', item['bodyEn'])
        self.assertIn('performance measurement period, not bond maturity', item['bodyEn'])
        self.assertIn('does not give a specific percentage change or calculation method', item['bodyEn'])
        for field in ('id', 'url', 'topic', 'titleJa', 'titleEn', 'publishedAt', 'observedAt'):
            self.assertEqual(item[field], self.payload[field])
        for unsupported in ('−2%', '-2%', 'Sep', '15yr+', 'BofA', 'annualized', 'total return',
                            'rolling', 'yield', '利回り', 'ローリング', '年率', '利息', 'チャート'):
            self.assertNotIn(unsupported, item['bodyJa'] + item['bodyEn'])

    def test_projection_adds_no_queries_writes_external_fetches_or_provider_calls(self):
        before = self.db.total_changes
        stored = list(self.db.execute('SELECT payload,published_at FROM x_market_publications'))
        traces = []
        self.db.set_trace_callback(traces.append)
        self.addCleanup(self.db.set_trace_callback, None)
        self.db.execute('PRAGMA query_only=ON')
        with patch.object(news.x_api, 'fetch_posts', side_effect=AssertionError('No external query')), \
             patch.object(news.brief_generator, 'request_response', side_effect=AssertionError('No provider')):
            traces.clear()
            with patch.object(news, 'period_detail', return_value={}):
                headline_only = self.feed()[0]
            baseline_queries = list(traces)
            traces.clear()
            detailed = self.feed()[0]
            self.assertEqual(traces, baseline_queries)
            later = news.public_feed(self.db, now=self.now + 60)[0]
            self.assertEqual(later, detailed)
            diagnostic = news.diagnostics(self.db, now=self.now)
        self.assertEqual(self.db.total_changes, before)
        self.assertEqual(list(self.db.execute('SELECT payload,published_at FROM x_market_publications')), stored)
        self.assertEqual({k: v for k, v in detailed.items() if k not in news.PERIOD_DETAIL_FIELDS}, headline_only)
        self.assertEqual(diagnostic['latest'][0]['publicAt'], self.public_at)
        self.assertEqual(diagnostic['latest'][0]['publishedAt'], FIXTURE['publishedAt'])
        self.assertEqual(diagnostic['latest'][0]['observedAt'], FIXTURE['observedAt'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
        self.assertFalse(any(q.lstrip().upper().startswith(('UPDATE ', 'INSERT ', 'DELETE ', 'REPLACE ')) for q in traces))

    def test_untrusted_optional_markers_or_bodies_drop_only_detail(self):
        expected = self.feed()[0]
        mutations = [
            {'detailPolicy': 'wrong', 'bodyJa': '利回り -2%', 'bodyEn': 'Annualized return -2%'},
            {'detailPolicy': {'version': 1}, 'bodyJa': None, 'bodyEn': ['PRIVATE']},
            {'bodyJa': 'PRIVATE'},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.db.execute('UPDATE x_market_publications SET payload=?',
                                (json.dumps({**self.payload, **mutation}),))
                self.db.commit()
                before = self.db.total_changes
                self.assertEqual(self.feed(), [self.payload])
                self.assertEqual(self.db.total_changes, before)
        self.db.execute('UPDATE x_market_publications SET payload=?', (json.dumps(expected),))
        self.db.commit()
        self.assertEqual(self.feed(), [expected])

    def test_wrong_source_scope_titles_or_full_text_cannot_enable_detail(self):
        for change in ({'topic': 'crude-oil'}, {'source_id': 'x-trendspider'},
                       {'url': self.row['url'].replace('Barchart', 'TrendSpider')},
                       {'sha': 'wrong'}, {'title': 'wrong'}, {'body': self.row['body'] + ' Additional claim.'},
                       {'body': 'U.S. Treasuries may suffer their worst 10-year period in history'}):
            with self.subTest(change=change):
                self.assertEqual(news.period_detail({**self.row, **change}, self.payload), {})
        for change in ({'topic': 'crude-oil'}, {'url': 'https://x.com/TrendSpider/status/123'},
                       {'id': '999'}, {'titleJa': self.payload['titleJa'].replace('10', '20')},
                       {'titleEn': self.payload['titleEn'].replace('10', '20')}):
            with self.subTest(change=change):
                self.assertEqual(news.period_detail(self.row, {**self.payload, **change}), {})
        for original in (
            'U.S. Treasuries may suffer their worst 10-year period in history',
            'U.S. Treasuries are on track for their worst 10-year period in history',
            'U.S. Treasuries have suffered their worst 10-year period since 1981',
            'U.S. 10-year Treasuries have now suffered their worst period in history',
            'U.S. Treasuries have suffered their worst 10-year period in history. Returns fell 2%.',
            'U.S. Treasuries have now enjoyed their best 10-year period in history',
            'Treasury market update: details to follow',
        ):
            with self.subTest(original=original):
                title = ' '.join(original.split())[:500]
                row = {**self.row, 'body': original, 'title': title,
                       'sha': hashlib.sha256((title + '\n' + original).encode()).hexdigest()}
                self.assertEqual(news.period_detail(row, self.payload), {})
        # The optional source-integrity guard never removes the valid headline.
        self.db.execute("UPDATE signal_documents SET text=text || ' '")
        self.db.commit()
        item = self.feed()[0]
        self.assertEqual(item['titleJa'], self.payload['titleJa'])
        self.assertFalse(set(news.PERIOD_DETAIL_FIELDS) & item.keys())

    def test_same_url_revision_withdrawal_and_generic_years_do_not_reuse_old_detail(self):
        old = self.feed()[0]
        self.seed(FIXTURE['retainedText'].replace('10-year', '15-year'))
        self.assertEqual(self.feed(), [])
        self.assertEqual(news.publish_direct_once(self.path, now=self.now), 'done')
        fresh = self.feed()[0]
        self.assertNotEqual(fresh['id'], old['id'])
        self.assertIn('15年間', fresh['bodyJa'])
        self.assertIn('15 years', fresh['bodyEn'])
        self.assertNotIn('10年', fresh['bodyJa'])
        self.db.execute('DELETE FROM x_market_publications WHERE sha<>?', (self.row['sha'],))
        self.db.commit()
        self.assertEqual(self.feed(), [])
        self.db.execute('DELETE FROM signal_documents')
        self.db.commit()
        self.assertEqual(self.feed(), [])


if __name__ == '__main__':
    unittest.main()
