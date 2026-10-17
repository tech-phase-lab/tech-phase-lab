"""Offline production-path tests for publisher taxonomy, HTTP proof and races."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import format_datetime
from html import escape
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import article_document
import feed_category_admission as gate
import headline_translation
import monitor
import official_release_bridge as bridge
import official_research
import signals
# The service discovery fixture replaces sys.modules after research imports.
# Exercise one coherent production module graph, including its lazy imports.
signals = official_research.signals

URL = 'https://news.skhynix.com/en/synthetic-story/'
TITLE = 'SK hynix announces semiconductor research platform'
BODY = 'SK hynix announced a semiconductor research platform. The platform supports research by semiconductor companies. ' * 15
POLICY = {'version': 1, 'allowAny': ['STORY'], 'denyAny': ['Media'], 'maxAgeSeconds': 900}
TICKERS = list(signals.ALIASES)
TEST_NOW = datetime.now(timezone.utc) - timedelta(seconds=5)


def entry(url=URL, categories=('STORY',), text=BODY):
    return (f'<item><title>{TITLE}</title><link>{url}</link><pubDate>{format_datetime(TEST_NOW - timedelta(hours=1))}</pubDate>'
            + ''.join(f'<category>{escape(term)}</category>' for term in categories)
            + f'<description>{escape(text)}</description></item>')


def feed(*items):
    return ('<rss><channel>' + ''.join(items or [entry()]) + '</channel></rss>').encode()


def html(title=TITLE, url=URL):
    from test_skhynix_article_category import document
    return document(url=url, title=title).replace('<img src="logo.svg">', '').replace('<p>Article body.</p>', '<p>' + BODY + '</p>') + '<div>Download Photos</div>'



class SkhynixFeedRoutingTests(unittest.TestCase):
    def setUp(self):
        # Discovery's service fixture can replace sys.modules['signals']. Bind
        # lazy imports to the same module whose source configuration is patched.
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'offline.sqlite'
        self.db = official_research.connect(self.path); self.addCleanup(self.db.close)
        self.source = next(source for source in signals.SOURCES if source['id'] == 'skhynix-news')
        config = patch.dict(self.source, {'officialUpdates': True, 'requireCurrentDocument': True,
                                          'publisherArticleCategories': deepcopy(POLICY)})
        config.start(); self.addCleanup(config.stop)
        self.now = TEST_NOW
        no_network = patch.object(signals, 'build_opener', side_effect=AssertionError('network forbidden'))
        no_network.start(); self.addCleanup(no_network.stop)

    def acquire(self, body=None, at=None, transport=None):
        with patch.object(signals, 'stamp', return_value=(at or self.now).isoformat()):
            return signals.check(self.db, self.source, TICKERS, transport=transport or
                (lambda *_: {'body': body or feed(), 'etag': '"feed-v1"',
                             'last_modified': 'Sun, 04 Oct 2026 11:00:00 GMT'}))

    def row(self):
        return dict(self.db.execute('SELECT * FROM signal_events WHERE url=? ORDER BY id DESC', (URL,)).fetchone())

    def public(self):
        return signals.public_official_updates(self.db, reference=self.now, read_only=True, include_bodies=False)

    def test_existing_source_acquisition_and_real_projection_retains_media_without_target(self):
        result = self.acquire(feed(entry(), *(entry(URL[:-1] + f'-{i}/', ('Media',)) for i in range(1, 5))))
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['events'], 5)
        self.assertEqual([item['url'] for item in self.public()], [URL])
        diagnostics = headline_translation.diagnostics(self.db, now=self.now.timestamp())
        self.assertEqual(diagnostics['pending'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_documents').fetchone()[0], 5)
        before = self.db.total_changes
        self.db.execute('PRAGMA query_only=ON')
        self.assertEqual(len(self.public()), 1)
        self.assertEqual(before, self.db.total_changes)

    def test_legacy_same_config_requires_full_poll_and_preserves_first_clocks(self):
        earlier = self.now - timedelta(hours=1)
        with self.db:
            signals.save_evidence(self.db, self.source, signals.parse(self.source, feed(), TICKERS), {}, earlier.isoformat())
            self.db.execute('INSERT INTO signal_routes(id,initialized,etag,config_sha) VALUES(?,1,?,?)',
                (self.source['id'], '"legacy"', signals.fingerprint(self.source, TICKERS)))
        original = self.row(); seen = []
        self.assertEqual(self.public(), [])
        def transport(source, validators):
            seen.append(validators)
            return {'body': feed(), 'etag': '"current"'}
        self.assertEqual(self.acquire(transport=transport)['status'], 'ok')
        self.assertEqual(seen, [{}]); self.assertEqual(self.row(), original)
        self.assertEqual(self.db.execute('SELECT first_seen_at FROM signal_documents').fetchone()[0], earlier.isoformat())
        self.assertEqual(len(self.public()), 1)

    def test_actual_http_304_binds_both_outgoing_validators_and_preserves_evidence(self):
        self.acquire(); original = self.row(); old_head = gate.head(self.db, self.source['id'])
        seen = []
        class Opener:
            def open(self, request, **kwargs):
                seen.append(dict(request.header_items()))
                raise HTTPError(request.full_url, 304, 'Not Modified', Message(), io.BytesIO())
        with patch.object(signals, 'build_opener', return_value=Opener()):
            result = self.acquire(at=self.now + timedelta(seconds=1), transport=signals.fetch)
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(seen[0]['If-none-match'], '"feed-v1"')
        self.assertEqual(seen[0]['If-modified-since'], 'Sun, 04 Oct 2026 11:00:00 GMT')
        self.assertEqual(self.row(), original)
        current = gate.head(self.db, self.source['id'])
        self.assertEqual(current['snapshot_id'], old_head['snapshot_id'])
        self.assertEqual(current['generation'], old_head['generation'] + 1)
        self.assertEqual(current['confirmed_at'], (self.now + timedelta(seconds=1)).isoformat())

    def test_bare_mismatched_or_unconditional_304_cannot_renew_proof(self):
        self.acquire(); original = gate.head(self.db, self.source['id'])
        responses = [{'not_modified': True}, {'not_modified': True, '_http_status': 304,
            '_feed_request': {'url': self.source['url'], 'validators': {'etag': '"wrong"'}}}]
        for response in responses:
            self.assertEqual(self.acquire(transport=lambda *_: response)['status'], 'error')
            self.assertEqual(gate.head(self.db, self.source['id']), original)
        with patch.dict(self.source, {'conditionalRequests': False}):
            self.acquire()
            original = gate.head(self.db, self.source['id'])
            def unconditional(source, validators):
                return {'not_modified': True, '_http_status': 304,
                        '_feed_request': gate.request_identity(source, validators)}
            self.assertEqual(self.acquire(transport=unconditional)['status'], 'error')
            self.assertEqual(gate.head(self.db, self.source['id']), original)

    def test_policy_change_and_parser_migration_force_unconditional_normal_poll(self):
        self.acquire()
        for change in ('policy', 'parser'):
            if change == 'policy':
                self.source['publisherArticleCategories'] = {**POLICY, 'maxAgeSeconds': 800}
            else:
                self.db.execute('UPDATE signal_feed_category_snapshots SET parser_version=0'); self.db.commit()
            seen = []
            result = self.acquire(transport=lambda source, validators: (seen.append(validators) or {'body': feed()}))
            self.assertEqual(result['status'], 'ok'); self.assertEqual(seen, [{}])
            self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 1)

    def test_slower_response_cannot_restore_story_or_overwrite_newer_route(self):
        self.acquire(); route_after = []
        def slow(source, validators):
            self.assertEqual(self.acquire(feed(entry(categories=('Media',))), at=self.now + timedelta(seconds=1))['status'], 'ok')
            route_after.append(dict(self.db.execute('SELECT * FROM signal_routes').fetchone()))
            return {'body': feed(), 'etag': '"old"'}
        result = self.acquire(transport=slow, at=self.now + timedelta(seconds=2))
        self.assertEqual(result['reason'], 'superseded-feed-response')
        self.assertEqual(dict(self.db.execute('SELECT * FROM signal_routes').fetchone()), route_after[0])
        self.assertEqual(self.public(), [])

    def test_policy_replaced_during_request_does_not_commit_response(self):
        self.acquire(); original = self.row(); original_head = gate.head(self.db, self.source['id'])
        def transport(source, validators):
            self.source['publisherArticleCategories'] = {**POLICY, 'allowAny': ['OTHER']}
            return {'body': feed(entry(text='Changed publisher body.'))}
        result = self.acquire(transport=transport)
        self.assertEqual(result['reason'], 'source-identity-changed')
        self.assertEqual(self.row(), original); self.assertEqual(gate.head(self.db, self.source['id']), original_head)

    def test_redirected_304_matches_the_last_full_response_effective_url(self):
        effective = 'https://news.skhynix.com/en/feed/'
        self.acquire(transport=lambda *_: {'body': feed(), 'etag': '"feed-v1"', '_effective_url': effective})
        original = gate.head(self.db, self.source['id'])
        class Opener:
            final = 'https://news.skhynix.com/other-feed/'
            def open(self, request, **kwargs):
                raise HTTPError(self.final, 304, 'Not Modified', Message(), io.BytesIO())
        opener = Opener()
        with patch.object(signals, 'build_opener', return_value=opener):
            self.assertEqual(self.acquire(transport=signals.fetch)['status'], 'error')
            self.assertEqual(gate.head(self.db, self.source['id']), original)
            opener.final = effective
            self.assertEqual(self.acquire(transport=signals.fetch)['status'], 'unchanged')
        self.assertEqual(gate.head(self.db, self.source['id'])['generation'], original['generation'] + 1)

    def test_delayed_http_or_parse_failure_does_not_overwrite_newer_success(self):
        self.acquire()
        for failed_response in ('http', 'xml'):
            route_after = []
            def slow(source, validators):
                self.assertEqual(self.acquire(feed(entry(categories=('Media',))))['status'], 'ok')
                route_after.append(dict(self.db.execute('SELECT * FROM signal_routes').fetchone()))
                if failed_response == 'http':
                    raise HTTPError(source['url'], 403, 'Forbidden', Message(), io.BytesIO())
                return {'body': b'<rss><broken>'}
            self.assertEqual(self.acquire(transport=slow)['reason'], 'superseded-feed-response')
            self.assertEqual(dict(self.db.execute('SELECT * FROM signal_routes').fetchone()), route_after[0])
            self.assertEqual(self.public(), [])

    def test_primary_exact_url_ownership_blocks_story_before_headline_budget(self):
        self.acquire()
        monitor.add_source(self.db, 'SKHY', URL, '2026-10-04', TITLE)
        self.db.execute("UPDATE sources SET status='held' WHERE url=?", (URL,)); self.db.commit()
        self.assertEqual(self.public(), [])
        self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 2, 'test-model', self.now.timestamp()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_category_change_between_projection_and_claim_spends_nothing(self):
        self.acquire()
        original = signals.public_official_updates
        def projection(*args, **kwargs):
            items = original(*args, **kwargs)
            self.acquire(feed(entry(categories=('Media',))))
            self.acquire(feed())  # Reversion cannot revive an in-flight token.
            return items
        with patch.object(signals, 'public_official_updates', side_effect=projection):
            self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 2, 'test-model', self.now.timestamp()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_story_body_selection_and_post_fetch_revocation(self):
        self.acquire()
        self.assertEqual(official_research.prepare_story_body(self.path, self.now,
            request=lambda *_: {'body': html().encode()}, clock=lambda: self.now), 'ready')
        cached = self.db.execute('SELECT * FROM official_story_bodies').fetchone()
        self.assertNotIn('Unrelated', cached['body']); self.assertNotIn('Download', cached['body'])
        self.assertEqual(cached['body_sha'], hashlib.sha256(cached['body'].encode()).hexdigest())
        self.db.execute('UPDATE official_story_bodies SET next_at=0'); self.db.commit()
        def revoked(*args):
            self.acquire(feed(entry(categories=('Media',))))
            return {'body': html().encode()}
        self.assertEqual(official_research.prepare_story_body(self.path, self.now, request=revoked, clock=lambda: self.now), 'stale')
        self.assertEqual(dict(self.db.execute('SELECT * FROM official_story_bodies').fetchone()), dict(cached) | {'next_at': 0})
        self.assertEqual(self.public(), [])

    def test_research_candidate_revision_and_claim_obey_category_tokens(self):
        self.acquire()
        self.assertEqual(official_research.prepare_story_body(self.path, self.now,
            request=lambda *_: {'body': html().encode()}, clock=lambda: self.now), 'ready')
        rows = official_research.candidates(self.db, self.now)
        row = next(row for row in rows if row['url'] == URL)
        self.assertTrue(official_research.current_revision(self.db, row, reference=self.now))
        self.acquire(feed(entry(categories=('Media',)))); self.acquire(feed())
        self.assertFalse(official_research.current_revision(self.db, row, reference=self.now))
        with patch.object(official_research, 'candidates', return_value=[row]):
            self.assertIsNone(official_research.claim(self.db, self.now, 'test-model', 5))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    @staticmethod
    def env():
        return {'OFFICIAL_HEADLINE_TRANSLATION_ENABLED': 'true',
                'OPENAI_API_KEY': 'synthetic-test-key-only-1234',
                'OFFICIAL_HEADLINE_TRANSLATION_MODEL': 'synthetic-model',
                'OFFICIAL_HEADLINE_TRANSLATION_DAILY_LIMIT': '5'}

    @staticmethod
    def note():
        quote = 'SK hynix announced a semiconductor research platform.'
        def part(ja, en):
            return {'ja': ja, 'en': en, 'evidenceQuote': quote}
        return {'title': part('SK hynix、半導体研究基盤を発表', 'SK hynix announces research platform'),
                'summary': part('SK hynixが半導体研究基盤を発表した。', 'SK hynix announced a semiconductor research platform.'),
                'facts': [part('SK hynixが研究基盤を発表した。', 'SK hynix announced a research platform.'),
                          part('半導体研究向けの基盤。', 'The platform is for semiconductor research.'),
                          part('研究基盤を発表。', 'The research platform was announced.')],
                'purpose': part('半導体研究向けの基盤。', 'The platform is for semiconductor research.')}

    def test_headline_post_model_save_rechecks_category_and_preserves_cost_record(self):
        self.acquire()
        def provider(*args):
            self.acquire(feed(entry(categories=('Media',))))
            self.acquire(feed())
            return {'status': 'completed', 'output_text': json.dumps(
                {'titleJa': 'SK hynix、半導体研究プラットフォームを発表'})}
        result = headline_translation.run_once(self.path, provider, self.env(), now=self.now.timestamp())
        self.assertEqual(result, 'stale')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translations').fetchone()[0], 0)
        self.assertEqual([row[0] for row in self.db.execute('SELECT state FROM signal_headline_translation_calls')], ['stale'])

    def test_research_post_model_save_rechecks_category_and_preserves_cost_record(self):
        self.acquire()
        self.assertEqual(official_research.prepare_story_body(self.path, self.now,
            request=lambda *_: {'body': html().encode()}, clock=lambda: self.now), 'ready')
        def provider(*args):
            self.acquire(feed(entry(categories=('Media',))))
            self.acquire(feed())
            return {'status': 'completed', 'output_text': json.dumps(self.note())}
        result = official_research.run_once(self.path, provider, self.env(), now=self.now.timestamp())
        self.assertEqual(result, 'stale')
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
        self.assertEqual([row[0] for row in self.db.execute('SELECT state FROM signal_headline_translation_calls')], ['stale'])

    def test_saved_publication_disappears_on_category_withdrawal_without_read_writes(self):
        self.acquire()
        self.assertEqual(official_research.prepare_story_body(self.path, self.now,
            request=lambda *_: {'body': html().encode()}, clock=lambda: self.now), 'ready')
        result = official_research.run_once(self.path, lambda *_: {'status': 'completed',
            'output_text': json.dumps(self.note())}, self.env(), now=self.now.timestamp())
        self.assertEqual(result, 'done')
        self.assertIn('bodyJa', official_research.public_story_body(self.db, self.row(), reference=self.now))
        before = self.row()
        self.acquire(feed(entry(categories=('Media',))))
        self.db.execute('PRAGMA query_only=ON'); changes = self.db.total_changes
        self.assertEqual(official_research.public_story_body(self.db, self.row(), reference=self.now), {})
        self.assertEqual(self.public(), [])
        self.assertEqual(self.db.total_changes, changes); self.assertEqual(self.row(), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 1)

    def test_claim_rechecks_wall_clock_after_a_stale_projection_reference(self):
        stale = self.now - timedelta(seconds=901)
        self.acquire(at=stale)
        self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 5, 'test-model', stale.timestamp()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_source_policy_rechecked_inside_200_save_transaction(self):
        self.acquire(); original = self.row(); prepared = gate.prepare
        def mutate(*args, **kwargs):
            result = prepared(*args, **kwargs)
            self.source['publisherArticleCategories'] = {**POLICY, 'allowAny': ['OTHER']}
            return result
        with patch.object(gate, 'prepare', side_effect=mutate):
            result = self.acquire(feed(entry(text='Changed after parsing.')))
        self.assertEqual(result['reason'], 'source-identity-changed'); self.assertEqual(self.row(), original)

    def test_missing_category_tables_read_only_never_migrates(self):
        self.acquire()
        self.db.execute('DROP TABLE signal_feed_category_heads')
        self.db.execute('DROP TABLE signal_feed_category_snapshots'); self.db.commit()
        self.db.execute('PRAGMA query_only=ON'); before = self.db.total_changes
        self.assertEqual(self.public(), [])
        self.assertEqual(before, self.db.total_changes)

    def test_category_scope_cannot_downgrade_to_legacy_by_removing_policy(self):
        self.acquire(); self.assertEqual(len(self.public()), 1)
        self.source.pop('publisherArticleCategories'); self.source.pop('requireCurrentDocument')
        self.assertEqual(self.public(), [])


class SkhynixArticleTemplateTests(unittest.TestCase):
    def test_template_opt_in_does_not_change_the_primary_article_reader(self):
        with self.assertRaisesRegex(ValueError, 'article-response-title-mismatch'):
            article_document.validate(html(), URL, TITLE)

    def test_exact_heading_branding_canonical_and_unique_body(self):
        parsed = article_document.validate(html(), URL, TITLE, publisher_template=True)
        self.assertEqual(parsed.headings, [TITLE])
        body = monitor.extract_html_text(article_document.selected_body(html(), URL).encode())
        self.assertIn('semiconductor research platform', body)
        self.assertNotIn('Unrelated', body); self.assertNotIn('Download Photos', body)

    def test_heading_template_identity_and_brand_attacks_fail_closed(self):
        changes = [
            ('<h2 class="post-title">' + TITLE, '<h2 class="post-title">Different article'),
            ('</main>', '<h2 class="post-title">' + TITLE + '</h2></main>'),
            ('post-title', 'other-title'),
            ('<h2 class="post-title">' + TITLE, '<h2 class="post-title">' + TITLE + '<h2 class="post-title"></h2>'),
            ('<h1 class="logo"></h1>', '<h1 class="logo">Other title</h1>'),
            ('<h1 class="logo"></h1>', '<h1 class="unknown"></h1>'),
            ('class="post-title"', 'class="post-title" class="hidden"'),
            ('content="' + TITLE + ' | SK hynix Newsroom"', 'content="' + TITLE + ' | Other Publisher"'),
            ('property="og:site_name" content="SK hynix Newsroom"', 'property="og:site_name" content="Other Publisher"'),
            ('rel="canonical" href="' + URL + '"', 'rel="canonical" href="' + URL + 'other"'),
            ('</head>', '<meta property="og:site_name" content="Other Publisher"></head>'),
        ]
        for old, new in changes:
            with self.subTest(old=old), self.assertRaises(ValueError):
                article_document.validate(html().replace(old, new), URL, TITLE, publisher_template=True)
        for host in ('news.skhynix.com.example.org', 'other.example.org'):
            with self.subTest(host=host), self.assertRaises(ValueError):
                article_document.validate(html().replace('news.skhynix.com', host), URL.replace('news.skhynix.com', host), TITLE, publisher_template=True)

    def test_body_missing_duplicate_or_wrong_config_cannot_use_main_fallback(self):
        for value in (html().replace('<div class="post-contents"><p>' + BODY + '</p></div>', '<img class="post-contents">'),
                      html().replace('class="post-contents"', 'class="unrelated" class="post-contents"'),
                      html()[:html().index('</p>')],
                      html().replace('post-contents', 'other-body'),
                      html().replace('</main>', '<div class="post-contents">Other</div></main>')):
            with self.assertRaisesRegex(ValueError, 'article-body-container-unavailable'):
                article_document.selected_body(value, URL)
        with self.assertRaisesRegex(ValueError, 'article-body-container-mismatch'):
            article_document.selected_body(html(), URL, 'post-body')


if __name__ == '__main__':
    unittest.main()
