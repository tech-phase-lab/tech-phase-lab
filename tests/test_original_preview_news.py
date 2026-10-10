"""Synthetic-only unattended original preview publication, no provider traffic."""
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals
_service_spec = importlib.util.spec_from_file_location('original_preview_test_service',
    Path(__file__).resolve().parents[1] / 'scripts/research/service.py')
service = importlib.util.module_from_spec(_service_spec)
_service_spec.loader.exec_module(service)
import x_api
import original_preview_news as preview

NOW = datetime(2026, 10, 5, 1, tzinfo=timezone.utc)
ACQUIRED = '2026-10-05T00:02:53.343+00:00'
PUBLISHED = '2026-10-05T00:02:04.000Z'
X = next(s for s in signals.SOURCES if s['id'] == 'x-wallstengine')
DISTRIBUTOR = next(s for s in signals.SOURCES if s['id'] == 'prnewswire-public')


class OriginalPreviewTests(unittest.TestCase):
    def setUp(self):
        # Other discovery fixtures replace canonical modules. Bind lazy imports
        # to this fixture's exact collector so no fake source can escape a mock.
        self.enterContext(patch.dict(sys.modules, {'signals': signals, 'monitor': monitor}))
        self.enterContext(patch.object(preview, 'signals', signals))
        # The lane is off by default; these tests exercise it when enabled.
        self.enterContext(patch.dict('os.environ', {'RESEARCH_ORIGINAL_PREVIEW': '1'}))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'monitor.sqlite'
        self.db = monitor.connect(self.path)
        signals.schema(self.db)
        self.addCleanup(self.db.close)

    def raw(self, text='A new update from an unfamiliar organization appears in the retained source.',
            number=1, at=ACQUIRED, published=PUBLISHED, source=X, selected=False):
        payload = {'data': [{'id': str(number), 'author_id': 'test', 'text': text, 'created_at': published}],
                   'includes': {'users': [{'id': 'test', 'username': source.get('accounts', ['wallstengine'])[0]}]}}
        acquired = x_api.acquired_posts(source, payload)
        items = x_api.parse_response(source, payload, list(monitor.PROVIDERS)) if selected else []
        with self.db:
            signals.save_evidence(self.db, source, items, {'_acquired_posts': acquired}, at)
        return acquired[0]['url']

    def article(self, title='Unfamiliar Industries introduces a new system for customers around the world',
                at=ACQUIRED, published=None, on=None, url=None, source=DISTRIBUTOR):
        url = url or 'https://www.prnewswire.com/news-releases/synthetic-original-update-123456789.html'
        body = title + '. Retained full source body is private. ' + 'Private detail. ' * 40
        with self.db:
            signals.save_evidence(self.db, source, [{'url': url, 'title': title, 'text': body,
                'matches': {'UNLISTED': ['Unfamiliar Industries']}, 'publishedAt': published,
                'publishedOn': on, 'truncated': False}], {}, at)
        return url

    def publish(self, now=NOW):
        return preview.publish_once(self.path, reference=now)

    def feed(self, now=NOW, **kwargs):
        return preview.public_feed(self.db, now, **kwargs)

    def test_raw_no_event_or_ticker_requires_worker_receipt_and_never_model(self):
        self.raw()
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 0)
        self.assertEqual(self.feed(), [])
        with patch.object(signals, 'fetch', side_effect=AssertionError('network')), \
             patch.object(x_api, 'fetch_posts', side_effect=AssertionError('X query')), \
             patch.object(service.brief_generator, 'request_response', side_effect=AssertionError('model')):
            self.assertEqual(self.publish(), 1)
            item = self.feed()[0]
        self.assertEqual(item['sourceName'], '@wallstengine · X')
        self.assertEqual(item['acquiredAt'], ACQUIRED)
        self.assertEqual(item['previewPublishedAt'], NOW.isoformat(timespec='milliseconds'))
        self.assertNotEqual(item['previewPublishedAt'], item['acquiredAt'])
        self.assertEqual(item['status'], preview.STATUS)
        self.assertNotIn('ticker', item)
        self.assertNotIn('text', item)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_x_request_attempts').fetchone()[0], 0)

    def test_unknown_ticker_distributor_and_missing_time_are_visible_without_actor(self):
        self.article()
        self.publish()
        item = self.feed()[0]
        self.assertEqual(item['sourceName'], DISTRIBUTOR['name'])
        self.assertEqual(item['sourceTimePrecision'], 'missing')
        self.assertIsNone(item['sourcePublishedAt'])
        self.assertIsNone(item['sourcePublishedOn'])
        self.assertEqual(set(item), {'id', 'sourceName', 'sourceUrl', 'excerptOriginal', 'sourcePublishedAt',
            'sourcePublishedOn', 'sourceTimePrecision', 'acquiredAt', 'previewPublishedAt', 'status'})

    def test_date_only_stays_date_only(self):
        self.article(on='2026-10-04')
        self.publish()
        item = self.feed()[0]
        self.assertEqual(item['sourceTimePrecision'], 'date')
        self.assertEqual(item['sourcePublishedOn'], '2026-10-04')
        self.assertIsNone(item['sourcePublishedAt'])

    def test_repeat_observation_cannot_rewrite_either_clock(self):
        self.raw()
        self.publish()
        first = self.feed()[0]
        self.raw(at='2026-10-05T00:30:00+00:00')
        self.publish(NOW + timedelta(minutes=1))
        self.assertEqual(self.feed(NOW + timedelta(minutes=1))[0], first)
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)

    def test_new_revision_waits_for_own_receipt_then_withdrawal_hides_it(self):
        self.raw()
        self.publish()
        old = self.feed()[0]
        self.raw('The newly revised source says that discussions are still ongoing.', at='2026-10-05T01:01:00+00:00')
        later = NOW + timedelta(minutes=2)
        self.assertEqual(self.feed(later), [])
        self.publish(later)
        new = self.feed(later)[0]
        self.assertEqual(new['id'], old['id'])
        self.assertNotEqual(new['previewPublishedAt'], old['previewPublishedAt'])
        self.assertEqual(new['acquiredAt'], '2026-10-05T01:01:00+00:00')
        self.raw('RETRACTION: The earlier report was false.', at='2026-10-05T01:03:00+00:00')
        self.assertEqual(self.feed(NOW + timedelta(minutes=4)), [])
        self.publish(NOW + timedelta(minutes=4))
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 2)

    def test_article_revision_invalidation_and_document_deletion(self):
        self.article()
        self.publish()
        self.assertEqual(len(self.feed()), 1)
        self.article(title='An updated original headline in the same retained article', at='2026-10-05T01:01:00Z')
        self.assertEqual(self.feed(NOW + timedelta(minutes=2)), [])
        self.publish(NOW + timedelta(minutes=2))
        self.assertEqual(self.feed(NOW + timedelta(minutes=2))[0]['acquiredAt'], '2026-10-05T01:01:00Z')
        with self.db:
            self.db.execute('DELETE FROM signal_documents')
        self.assertEqual(self.feed(NOW + timedelta(minutes=2)), [])

    def test_verified_url_wins_but_invalid_saved_copy_does_not_hide_original(self):
        url = self.raw()
        self.publish()
        self.assertEqual(self.feed(verified_urls=[url + '/']), [])
        with self.db:
            service.analyst_news.schema(self.db)
            self.db.execute('INSERT INTO analyst_news_publications VALUES(?,?,?,?,?,?,?)',
                (X['id'], url, 'old-withdrawn-sha', 999, 1, '{}', ACQUIRED))
        before = self.db.execute('SELECT * FROM analyst_news_publications').fetchone()
        self.assertEqual(len(self.feed()), 1)
        self.publish()
        self.assertEqual(tuple(before), tuple(self.db.execute('SELECT * FROM analyst_news_publications').fetchone()))

    def test_pending_failed_research_job_does_not_own_preview(self):
        self.raw()
        service.official_research.schema(self.db)
        with self.db:
            self.db.execute('INSERT INTO official_research_jobs VALUES(?,?,?,?,?,?,?)', (1, 'sha', 1, 0, '', 'failed', 'invalid-copy'))
        self.publish()
        self.assertEqual(len(self.feed()), 1)

    def test_duplicate_source_url_produces_one_excerpt(self):
        self.article()
        duplicate = {**DISTRIBUTOR, 'id': 'other-configured-publisher'}
        self.publish()
        self.article(source=duplicate, at='2026-10-05T00:30:00Z')
        sources = [DISTRIBUTOR, duplicate]
        preview.publish_once(self.path, reference=NOW, sources=sources)
        self.assertEqual(len(self.feed(sources=sources)), 1)

    def test_disabled_unapproved_route_reposts_promotions_and_credentials_stay_private(self):
        for number, text in enumerate(['RT @publisher A retained update', 'Register now for our new webinar',
                '{"error": "source fetch failed"}', 'Bearer abcdefghijklmnopqrstuvwxyz',
                'API_KEY=private-placeholder', '\u202eHidden direction text'], 1):
            self.raw(text, number=number)
        self.publish()
        self.assertEqual(self.feed(), [])
        with self.db:
            self.db.execute('UPDATE signal_x_acquisition SET source_id=?', ('unapproved',))
        self.assertEqual(self.feed(), [])

    def test_original_excerpt_is_small_and_not_multiplied_across_title_body(self):
        for text, cap in [(' '.join('word' + str(n) for n in range(100)), 100), ('原文の短い断片' * 40, 40)]:
            self.assertLessEqual(len(preview.excerpt(text)), cap)
            self.assertLessEqual(len(preview.excerpt(text).split()), 20)
        self.assertEqual(preview.excerpt('An original statement https://example.com/read a second claim'), 'An original statement')

    def test_bad_clocks_old_backfill_and_credential_urls_fail_closed(self):
        self.raw(number=1, published='2026-10-05T02:00:00Z')
        self.raw(number=2, at='2026-09-01T00:00:00Z', published=None)
        self.raw(number=3, at='2026-10-05T00:02:53', published=None)
        self.raw(number=4, published='invalid')
        self.article(url='https://user:pass@www.prnewswire.com/news-releases/synthetic-original-update-123456789.html')
        self.publish()
        self.assertEqual(self.feed(), [])
        self.assertIsNone(preview.canonical_url('https://x.com/a/status/1?token=abc'))

    def test_corrupt_receipt_never_fakes_first_preview_clock(self):
        self.raw()
        self.publish()
        with self.db:
            self.db.execute('UPDATE original_preview_receipts SET first_published_at=?', ('2026-10-01T00:00:00Z',))
        self.assertEqual(self.feed(), [])
        self.publish()
        self.assertEqual(self.feed(), [])

    def test_read_is_select_only_and_never_creates_schema_or_receipts(self):
        self.raw()
        before = list(self.db.iterdump())
        self.assertEqual(self.feed(), [])
        self.assertEqual(list(self.db.iterdump()), before)
        self.publish()
        before = list(self.db.iterdump())
        read = sqlite3.connect(f'file:{self.path}?mode=ro', uri=True)
        read.row_factory = sqlite3.Row
        try:
            read.execute('PRAGMA query_only=ON')
            with patch.object(preview, 'schema', side_effect=AssertionError('read schema')), \
                 patch.object(preview, 'publish_once', side_effect=AssertionError('read write')):
                self.assertEqual(len(preview.public_feed(read, NOW)), 1)
        finally:
            read.close()
        self.assertEqual(list(self.db.iterdump()), before)

    def test_window_caps_disclose_omissions_and_fresh_rows_win_without_receipt_eviction(self):
        for number in range(1, 212):
            at = (NOW - timedelta(seconds=500-number)).isoformat()
            self.raw(number=number, at=at, published=None)
        self.publish()
        result = preview.preview_payload(self.db, {'items': [], 'officialUpdates': []}, NOW)
        self.assertEqual(len(result['originalPreviewItems']), 30)
        stats = result['originalPreviewWindow']
        self.assertEqual(stats['eligibleInScan'], 200)
        self.assertEqual(stats['omittedInScan'], 170)
        self.assertTrue(stats['scanLimited'])
        self.assertTrue(result['originalPreviewItems'][0]['sourceUrl'].endswith('/211'))
        first_clock = self.db.execute('SELECT first_published_at FROM original_preview_receipts LIMIT 1').fetchone()[0]
        self.publish(NOW + timedelta(days=8))
        self.assertEqual(len(self.feed(NOW + timedelta(days=8))), 0)
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 30)
        self.assertEqual(self.db.execute('SELECT first_published_at FROM original_preview_receipts LIMIT 1').fetchone()[0], first_clock)

    def test_optional_bytes_never_evict_or_change_verified_sections(self):
        self.raw()
        self.publish()
        payload = {'items': [{'url': 'https://example.com/verified', 'summary': 'v' * 449500}], 'officialUpdates': []}
        before = json.dumps(payload, sort_keys=True)
        result = preview.preview_payload(self.db, payload, NOW)
        self.assertEqual(json.dumps({k: result[k] for k in payload}, sort_keys=True), before)
        self.assertEqual(json.dumps(payload, sort_keys=True), before)

    def test_new_denial_reporting_is_visible_but_source_self_withdrawal_is_not(self):
        for number, text in enumerate([
                'Microsoft says the report of a new acquisition is false.',
                'Microsoft says a claim about a new acquisition is incorrect.',
                'Microsoft says reports of a new acquisition are false.'], 1):
            self.raw(text, number=number)
        self.raw('RETRACTION: The earlier report was false.', number=4)
        self.raw('This post has been withdrawn.', number=5)
        self.raw('Our report was retracted.', number=6)
        self.publish()
        cards = self.feed()
        self.assertEqual(len(cards), 3)
        self.assertEqual({card['sourceUrl'].rsplit('/', 1)[1] for card in cards}, {'1', '2', '3'})
        self.assertTrue(all(card['status'] == preview.STATUS for card in cards))
        # A revised denial can itself be literal news while the older claim
        # disappears before filtering, including under another account casing.
        self.raw('Microsoft says the report of a different acquisition is false.', number=1,
            source={**X, 'accounts': ['WallStEngine']}, at='2026-10-05T01:01:00Z')
        later = NOW + timedelta(minutes=2)
        self.assertEqual(len(self.feed(later)), 2)
        self.publish(later)
        cards = self.feed(later)
        self.assertEqual(len(cards), 3)
        self.assertTrue(any('different acquisition is false' in card['excerptOriginal'] for card in cards))

    def test_canonical_x_case_revision_withdrawal_invalidates_older_spelling(self):
        self.raw()
        self.publish()
        self.raw('RETRACTION: The earlier report was false.',
            source={**X, 'accounts': ['WallStEngine']}, at='2026-10-05T01:01:00Z')
        self.assertEqual(self.feed(NOW + timedelta(minutes=2)), [])

    def test_canonical_article_slash_withdrawal_invalidates_older_spelling(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'microsoft-blog')
        url = 'https://blogs.microsoft.com/blog/2026/10/04/synthetic-original-release'
        self.article(source=source, url=url)
        self.publish()
        self.article(source=source, url=url + '/', title='RETRACTION: The earlier report was false.',
            at='2026-10-05T01:01:00Z')
        self.assertEqual(self.feed(NOW + timedelta(minutes=2)), [])

    def test_primary_explicit_hold_binds_alias_but_discovery_alone_does_not(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'microsoft-blog')
        url = 'https://blogs.microsoft.com/blog/2026/10/04/synthetic-original-release'
        with self.db:
            monitor.add_source(self.db, 'MSFT', url, '2026-10-04', 'A genuine held issuer release')
        self.article(source=source, url=url + '/')
        self.publish()
        self.assertEqual(len(self.feed()), 1, 'a discovered primary without a body is not a rejection')
        with self.db:
            self.db.execute("UPDATE sources SET status='held' WHERE url=?", (url,))
        self.assertEqual(self.feed(), [])
        self.publish()
        self.assertEqual(self.feed(), [])

    def test_visible_analyst_without_public_url_suppresses_only_its_current_original(self):
        self.raw('Morgan Stanley upgraded Micron $MU to Overweight from Equal Weight.', selected=True)
        self.publish()
        result = service.analyst_news.run_once(self.path, now=NOW)
        self.assertEqual(result['published'], 1)
        visible = service.analyst_news.public_feed(self.db, now=NOW)
        self.assertEqual(len(visible), 1)
        self.assertNotIn('url', visible[0])
        payload = preview.preview_payload(self.db, {'analystUpdates': visible}, NOW)
        self.assertEqual(payload['originalPreviewItems'], [])
        with self.db:
            self.db.execute("UPDATE analyst_news_publications SET payload='{}'")
        invalid = service.analyst_news.public_feed(self.db, now=NOW)
        self.assertEqual(invalid, [])
        self.assertEqual(len(preview.preview_payload(self.db, {'analystUpdates': invalid}, NOW)['originalPreviewItems']), 1)

    def test_preview_capability_requires_configured_bearer_but_legacy_route_unchanged(self):
        for token, supplied, path, expected in [('', '', '/news?originalPreview=1', 401),
                ('test-token', '', '/news?originalPreview=1', 401),
                ('test-token', 'Bearer wrong', '/news?originalPreview=1', 401),
                ('test-token', 'Bearer test-token', '/news?originalPreview=1', 200),
                ('', '', '/news', 200)]:
            with self.subTest(token=bool(token), supplied=bool(supplied), path=path):
                handler = object.__new__(service.Handler)
                handler.path, handler.headers, handler.server = path, {'Authorization': supplied}, Mock()
                handler.send_json = Mock()
                with patch.dict(os.environ, {'RESEARCH_API_TOKEN': token}):
                    handler.do_GET()
                self.assertEqual(handler.send_json.call_args.args[0], expected)
                if expected == 401:
                    handler.server.app.public_news.assert_not_called()
                elif path == '/news':
                    handler.server.app.public_news.assert_called_once_with()
                else:
                    handler.server.app.public_news.assert_called_once_with(original_preview=True)

    def test_all_reviewed_cjk_script_blocks_use_forty_codepoint_excerpt(self):
        for text in ('ﾆｭｰｽ' * 30, '𠀀' * 120, '가' * 60):
            with self.subTest(text=text[:4]):
                self.assertEqual(len(preview.excerpt(text)), 40)

    def test_publisher_category_withdrawal_is_current_without_ticker_classification(self):
        import feed_category_admission as category
        source = next(s for s in signals.SOURCES if s['id'] == 'skhynix-news')
        url = 'https://news.skhynix.com/en/synthetic-original-article/'
        def acquire(term, at):
            raw = ('<rss><channel><item><title>SK hynix original article</title><link>' + url +
                   '</link><pubDate>Sun, 04 Oct 2026 23:00:00 GMT</pubDate><category>' + term +
                   '</category><description>SK hynix original retained source body.</description></item></channel></rss>').encode()
            prepared = category.prepare(source, raw, list(signals.ALIASES), category.head(self.db, source['id']), at)
            with self.db:
                signals.save_evidence(self.db, source, prepared['items'], {}, at)
                category.persist_200(self.db, source, list(signals.ALIASES), prepared)
                self.db.execute("UPDATE signal_events SET tickers_json='[]'")
        acquire('STORY', ACQUIRED)
        self.publish()
        self.assertEqual(len(self.feed()), 1)
        acquire('Media', '2026-10-05T01:01:00Z')
        self.assertEqual(self.feed(NOW + timedelta(minutes=2)), [])

    def test_primary_transport_bytes_do_not_change_content_receipt(self):
        url = 'https://nvidianews.nvidia.com/news/synthetic-original-preview-release'
        title = 'An original issuer release headline'
        text = title + '. The complete retained primary source stays private.'
        with self.db:
            monitor.add_source(self.db, 'NVDA', url, '2026-10-05', title)
            self.db.execute("UPDATE sources SET discovered_at=?,checked_at=?,sha256=?,extracted_text=?,status='ok' WHERE url=?",
                (ACQUIRED, ACQUIRED, 'raw-sha-1', text, url))
            self.db.execute('INSERT INTO source_revisions VALUES(?,?,?,?,?,?,?)',
                (url, 'raw-sha-1', ACQUIRED, 'text/html', 1000, text, len(text)))
        self.publish()
        first = self.feed()[0]
        with self.db:
            self.db.execute('INSERT INTO source_revisions VALUES(?,?,?,?,?,?,?)',
                (url, 'raw-sha-2', '2026-10-05T01:01:00Z', 'text/html', 2000, text, len(text)))
            self.db.execute('UPDATE sources SET sha256=?,checked_at=? WHERE url=?', ('raw-sha-2', '2026-10-05T01:01:00Z', url))
        later = NOW + timedelta(minutes=2)
        self.publish(later)
        self.assertEqual(self.feed(later)[0], first)
        self.assertEqual(self.db.execute('SELECT count(*) FROM original_preview_receipts').fetchone()[0], 1)
        with self.db:
            self.db.execute("UPDATE sources SET status='held' WHERE url=?", (url,))
        self.assertEqual(self.feed(later), [])

    def test_service_capability_is_additive_and_does_not_run_publisher_on_read(self):
        self.raw()
        self.publish()
        app = service.AutomaticMonitor(self.path, Path(self.tmp.name) / 'snapshot.json')
        with patch.object(service.news_drafts, 'public_feed', return_value={'ok': True, 'enabled': False, 'items': []}), \
             patch.object(service.signals, 'public_official_updates', return_value=[]), \
             patch.object(service.official_research, 'news_projection', return_value={'officialUpdates': []}), \
             patch.object(service.x_market_news, 'public_feed', return_value=[]), \
             patch.object(service.analyst_news, 'public_feed', return_value=[]), \
             patch.object(service.market_results, 'public_feed', return_value=[]), \
             patch.object(preview, 'publish_once', side_effect=AssertionError('read must not publish')), \
             patch.object(preview, 'preview_payload', wraps=preview.preview_payload) as projected:
            base = app.public_news()
            self.assertNotIn('originalPreviewItems', base)
            projected.assert_not_called()
            enabled = app.public_news(original_preview=True)
            self.assertIn('originalPreviewItems', enabled)
            self.assertEqual({k: enabled[k] for k in base}, base)
            projected.assert_called_once()

    def test_real_collector_and_default_no_model_worker_publish_raw_no_event(self):
        app = service.AutomaticMonitor(self.path, Path(self.tmp.name) / 'snapshot.json')
        text = 'Unfamiliar organization supplied another ordinary announcement with no supported ticker.'
        payload = {'data': [{'id': '5123', 'author_id': 'test', 'text': text, 'created_at': PUBLISHED}],
                   'includes': {'users': [{'id': 'test', 'username': 'wallstengine'}]}}
        response = {'_items': x_api.parse_response(X, payload, app.tickers),
                    '_acquired_posts': x_api.acquired_posts(X, payload)}
        self.assertEqual(response['_items'], [])
        with patch.object(signals, 'acquire', return_value=response) as acquisition, \
             patch.object(signals, 'reserve_x_api_request'), \
             patch.object(signals, 'require_x_polling_storage'), \
             patch.object(signals, 'prepare_x_query_window'), \
             patch.object(signals, 'stamp', return_value=ACQUIRED):
            app.check_signal_source(X)
        acquisition.assert_called_once()
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 0)
        original_publish = preview.publish_once
        def fixed_publish(path):
            return original_publish(path, reference=NOW)
        def end_cycle(*_args, **_kwargs):
            app.stop_event.set()
        with patch.dict(os.environ, {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'false', 'RESEARCH_AUTO_DRAFTS': 'false', 'OPENAI_API_KEY': '', 'RESEARCH_SUMMARY_MODEL': ''}), \
             patch.object(preview, 'publish_once', side_effect=fixed_publish) as published, \
             patch.object(service.analyst_news, 'run_once', return_value=None), \
             patch.object(service.market_results, 'run_once', side_effect=end_cycle), \
             patch.object(x_api, 'fetch_posts', side_effect=AssertionError('additional X')), \
             patch.object(service.brief_generator, 'request_response', side_effect=AssertionError('model')):
            app.run_results()
        published.assert_called_once_with(self.path)
        self.assertTrue(self.feed()[0]['sourceUrl'].endswith('/5123'))


if __name__ == '__main__':
    unittest.main()
