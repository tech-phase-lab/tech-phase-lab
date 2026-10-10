"""Historical STORY display, fresh paid admission and existing article refresh."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import io
import json
from email.message import Message
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import feed_category_admission as gate
import headline_translation
import official_release_bridge as bridge
import official_research
import signals
# The service discovery fixture replaces sys.modules after research imports.
# Exercise one coherent production module graph, including its lazy imports.
signals = official_research.signals
import test_skhynix_feed_routing as fixture
import test_skhynix_article_category as template


class SkhynixCategoryHistoryTests(unittest.TestCase):
    def setUp(self):
        self.fx = fixture.SkhynixFeedRoutingTests()
        self.fx.setUp(); self.addCleanup(self.fx.doCleanups)
        self.db, self.path, self.source = self.fx.db, self.fx.path, self.fx.source
        self.t0 = self.fx.now

    @contextmanager
    def clock(self, at):
        class Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return at.astimezone(tz) if tz else at.replace(tzinfo=None)
        with patch.object(bridge, 'datetime', Clock), patch.object(official_research, 'datetime', Clock), patch.object(headline_translation, 'datetime', Clock):
            yield

    def html(self, category='STORY', body=fixture.BODY):
        href = template.STORY if category == 'STORY' else template.MEDIA
        return template.document(template.category(category, href), url=fixture.URL, title=fixture.TITLE).replace(
            '<p>Article body.</p>', '<p>' + body + '</p>').encode()

    def refresh(self, at, *, category='STORY', body=fixture.BODY, request=None):
        with self.clock(at):
            return official_research.prepare_story_body(self.path, at, request=request or
                (lambda *_: {'body': self.html(category, body)}), clock=lambda: at)

    def public(self, at):
        with self.clock(at):
            return next((item for item in signals.public_official_updates(self.db, reference=at,
                read_only=True, include_bodies=True) if item['url'] == fixture.URL), None)

    def omit(self, at):
        return self.fx.acquire(fixture.feed(fixture.entry(
            url='https://news.skhynix.com/en/other-newer-item/', categories=('Media',))), at=at)

    def publish(self):
        self.fx.acquire(at=self.t0)
        self.assertEqual(self.refresh(self.t0), 'ready')
        with self.clock(self.t0):
            result = official_research.run_once(self.path, lambda *_: {'status': 'completed',
                'output_text': json.dumps(self.fx.note())}, self.fx.env(), now=self.t0.timestamp())
        self.assertEqual(result, 'done')
        self.assertIn('bodyJa', self.public(self.t0))

    def decision(self, at, **kwargs):
        return gate.decision(self.db, self.source, fixture.TICKERS, self.fx.row(), at, **kwargs)

    def test_published_story_omission_expiry_refresh_media_and_revised_body(self):
        self.publish()
        event = self.fx.row()
        original_body = dict(self.db.execute('SELECT * FROM official_story_bodies').fetchone())
        original_publication = dict(self.db.execute('SELECT * FROM official_research_publications').fetchone())
        original_token = self.decision(self.t0)['token']
        self.assertEqual(self.omit(self.t0 + timedelta(seconds=1))['status'], 'ok')
        omitted = self.public(self.t0 + timedelta(seconds=1))
        self.assertIn('bodyJa', omitted)
        self.assertFalse(omitted['categoryEvidence']['currentFeedMember'])
        expired_at = self.t0 + timedelta(seconds=902)
        expired = self.public(expired_at)
        self.assertIn('bodyJa', expired)
        self.assertEqual(expired['categoryEvidence']['verifiedAt'], self.t0.isoformat())
        self.assertFalse(expired['categoryEvidence']['freshForGeneration'])
        self.assertEqual(expired['categoryEvidence']['status'], 'last-verified')
        self.assertEqual(self.decision(expired_at)['token'], original_token)
        self.assertEqual(self.decision(expired_at, require_fresh=True)['reason'], 'category-proof-stale')
        before_calls = self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0]
        with self.clock(expired_at):
            self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 5, 'mock-model', expired_at.timestamp()))
            diagnostics = headline_translation.diagnostics(self.db, now=expired_at.timestamp())
        self.assertEqual(diagnostics['pending'], 0)
        self.assertEqual(diagnostics['awaitingSourceRefresh'], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], before_calls)
        self.assertEqual(self.refresh(expired_at), 'ready')
        refreshed = self.public(expired_at)
        self.assertIn('bodyJa', refreshed)
        self.assertEqual(refreshed['categoryEvidence']['verifiedAt'], expired_at.isoformat())
        self.assertEqual(refreshed['categoryEvidence']['kind'], 'article')
        self.assertTrue(refreshed['categoryEvidence']['freshForGeneration'])
        self.assertEqual(self.decision(expired_at)['token'], original_token)
        self.assertEqual(self.db.execute('SELECT fetched_at FROM official_story_bodies').fetchone()[0], original_body['fetched_at'])
        media_at = expired_at + timedelta(seconds=901)
        self.assertEqual(self.refresh(media_at, category='Media'), 'retry')
        self.assertIsNone(self.public(media_at))
        self.assertEqual(self.decision(media_at)['reason'], 'publisher-excluded-category')
        restored_at = media_at + timedelta(seconds=301)
        self.assertEqual(self.refresh(restored_at), 'ready')
        self.assertIn('bodyJa', self.public(restored_at))
        self.assertNotEqual(self.decision(restored_at)['token'], original_token)
        with self.clock(restored_at):
            old_row = next(row for row in official_research.candidates(self.db, restored_at) if row['url'] == fixture.URL)
        revised_at = restored_at + timedelta(seconds=901)
        revised_body = fixture.BODY.replace('a semiconductor research platform', 'an updated semiconductor research platform')
        self.assertEqual(self.refresh(revised_at, body=revised_body), 'ready')
        revised = self.public(revised_at)
        self.assertIsNotNone(revised)
        self.assertNotIn('bodyJa', revised)
        with self.clock(revised_at):
            self.assertFalse(official_research.current_revision(self.db, old_row, reference=revised_at))
        self.assertEqual(self.fx.row(), event)
        self.assertEqual(dict(self.db.execute('SELECT * FROM official_research_publications').fetchone()), original_publication)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], before_calls)

    def test_omitted_304_does_not_refresh_historical_article_clock(self):
        self.publish(); self.omit(self.t0 + timedelta(seconds=1))
        request = gate.capture_request(self.db, self.source, fixture.TICKERS,
            signals.validators_for(self.db, self.source, fixture.TICKERS))
        at = self.t0 + timedelta(seconds=1000)
        response = {'not_modified': True, '_http_status': 304, '_feed_request': request['request'],
                    '_effective_url': self.source['url']}
        self.assertEqual(self.fx.acquire(at=at, transport=lambda *_: response)['status'], 'unchanged')
        visible = self.public(at)
        self.assertIn('bodyJa', visible)
        self.assertEqual(visible['categoryEvidence']['verifiedAt'], self.t0.isoformat())
        self.assertFalse(visible['categoryEvidence']['freshForGeneration'])

    def test_unrelated_feed_changes_and_agreeing_article_do_not_invalidate_claim_token(self):
        self.fx.acquire(at=self.t0)
        token = self.decision(self.t0)['token']
        self.assertEqual(self.refresh(self.t0), 'ready')
        self.assertEqual(self.decision(self.t0)['token'], token)
        self.omit(self.t0 + timedelta(seconds=1))
        self.assertEqual(self.decision(self.t0 + timedelta(seconds=1))['token'], token)

    def test_article_media_cannot_be_erased_by_feed_304_or_repeated_story_200(self):
        self.publish()
        at = self.t0 + timedelta(seconds=901)
        self.assertEqual(self.refresh(at, category='Media'), 'retry')
        request = gate.capture_request(self.db, self.source, fixture.TICKERS,
            signals.validators_for(self.db, self.source, fixture.TICKERS))
        response = {'not_modified': True, '_http_status': 304, '_feed_request': request['request'],
                    '_effective_url': self.source['url']}
        self.assertEqual(self.fx.acquire(at=at, transport=lambda *_: response)['status'], 'unchanged')
        self.assertIsNone(self.public(at))
        self.fx.acquire(at=at)
        self.assertIsNone(self.public(at))

    def test_feed_media_during_delayed_article_response_cannot_be_overwritten(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        def delayed(*args):
            self.fx.acquire(fixture.feed(fixture.entry(categories=('Media',))), at=at)
            return {'body': self.html()}
        self.assertEqual(self.refresh(at, request=delayed), 'stale')
        self.assertIsNone(self.public(at))
        self.assertEqual(self.db.execute("SELECT count(*) FROM signal_category_evidence WHERE kind='article'").fetchone()[0], 1)

    def test_delayed_article_failure_cannot_replace_newer_body_refresh(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        newer_body = fixture.BODY + ' Additional verified publisher context.'
        def delayed(*args):
            self.assertEqual(self.refresh(at, body=newer_body), 'ready')
            raise HTTPError(fixture.URL, 403, 'Forbidden', Message(), io.BytesIO())
        self.assertEqual(self.refresh(at, request=delayed), 'stale')
        cached = self.db.execute('SELECT * FROM official_story_bodies').fetchone()
        self.assertIn('Additional verified', cached['body'])
        self.assertIsNone(cached['error'])

    def test_missing_or_ambiguous_article_category_withholds_and_can_refresh_later(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        raw = template.document('', url=fixture.URL, title=fixture.TITLE).replace('<p>Article body.</p>', '<p>' + fixture.BODY + '</p>')
        self.assertEqual(self.refresh(at, request=lambda *_: {'body': raw.encode()}), 'retry')
        self.assertIsNone(self.public(at))
        self.assertEqual(self.refresh(at + timedelta(seconds=301)), 'ready')
        self.assertIn('bodyJa', self.public(at + timedelta(seconds=301)))

    def test_actual_404_and_410_withhold_historical_copy_without_deleting_it(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        for status in (404, 410):
            def missing(*args):
                raise HTTPError(fixture.URL, status, 'No article', Message(), io.BytesIO())
            self.assertEqual(self.refresh(at, request=missing), 'retry')
            self.assertIsNone(self.public(at))
            self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 1)
            at += timedelta(seconds=301)

    def test_expired_history_still_checks_source_policy_body_revision_and_primary_owner(self):
        self.publish(); self.omit(self.t0 + timedelta(seconds=1)); at = self.t0 + timedelta(seconds=1000)
        self.assertIn('bodyJa', self.public(at))
        with patch.dict(self.source, {'enabled': False}):
            self.assertIsNone(self.public(at))
        with patch.dict(self.source, {'publisherArticleCategories': {**fixture.POLICY, 'maxAgeSeconds': 1000}}):
            self.assertIsNone(self.public(at))
        self.db.execute("UPDATE signal_documents SET sha='revised-source' WHERE url=?", (fixture.URL,)); self.db.commit()
        self.assertIsNone(self.public(at))

    def assert_negative_survives_feed_revision(self, request):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        self.assertEqual(self.refresh(at, request=request), 'retry')
        self.fx.acquire(fixture.feed(fixture.entry(text=fixture.BODY + ' Updated feed description.')), at=at)
        self.assertIsNone(self.public(at))
        with self.clock(at):
            self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 5, 'mock-model', at.timestamp()))
        self.assertEqual(self.refresh(at), 'ready')
        self.assertIsNotNone(self.public(at))
        self.assertNotIn('bodyJa', self.public(at))  # Old event publication is not inherited.

    def test_410_cannot_be_erased_by_a_fresh_feed_body_revision(self):
        def withdrawn(*args):
            raise HTTPError(fixture.URL, 410, 'Gone', Message(), io.BytesIO())
        self.assert_negative_survives_feed_revision(withdrawn)

    def test_article_media_cannot_be_erased_by_a_fresh_feed_body_revision(self):
        self.assert_negative_survives_feed_revision(lambda *_: {'body': self.html('Media')})

    def test_invalid_article_category_cannot_be_erased_by_a_fresh_feed_body_revision(self):
        raw = template.document('', url=fixture.URL, title=fixture.TITLE).replace(
            '<p>Article body.</p>', '<p>' + fixture.BODY + '</p>').encode()
        self.assert_negative_survives_feed_revision(lambda *_: {'body': raw})

    def test_source_policy_full_poll_cannot_erase_explicit_article_withdrawal(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        def withdrawn(*args):
            raise HTTPError(fixture.URL, 410, 'Gone', Message(), io.BytesIO())
        self.assertEqual(self.refresh(at, request=withdrawn), 'retry')
        self.source['publisherArticleCategories'] = {**fixture.POLICY, 'maxAgeSeconds': 800}
        self.assertEqual(self.fx.acquire(at=at)['status'], 'ok')
        self.assertIsNone(self.public(at))
        with self.clock(at):
            self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 5, 'mock-model', at.timestamp()))
        self.db.execute('UPDATE official_story_bodies SET next_at=0'); self.db.commit()
        self.assertEqual(self.refresh(at), 'ready')
        self.assertIn('bodyJa', self.public(at))

    def test_unrequested_article_304_cannot_refresh_an_expired_category(self):
        self.publish(); self.omit(self.t0 + timedelta(seconds=1)); at = self.t0 + timedelta(seconds=902)
        self.assertEqual(self.refresh(at, request=lambda *_: {'not_modified': True, '_http_status': 304}), 'retry')
        visible = self.public(at)
        self.assertIn('bodyJa', visible)
        self.assertFalse(visible['categoryEvidence']['freshForGeneration'])
        self.assertEqual(visible['categoryEvidence']['verifiedAt'], self.t0.isoformat())

    def test_article_media_during_delayed_feed_304_remains_withheld(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        def delayed(source, validators):
            self.assertEqual(self.refresh(at, category='Media'), 'retry')
            return {'not_modified': True, '_http_status': 304,
                    '_feed_request': gate.request_identity(source, validators), '_effective_url': source['url']}
        self.assertEqual(self.fx.acquire(at=at, transport=delayed)['status'], 'unchanged')
        self.assertIsNone(self.public(at))

    def test_omission_during_article_refresh_preserves_same_revision_permission(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        def delayed(*args):
            self.omit(at)
            return {'body': self.html()}
        self.assertEqual(self.refresh(at, request=delayed), 'ready')
        self.assertIn('bodyJa', self.public(at))
        self.assertTrue(self.public(at)['categoryEvidence']['freshForGeneration'])

    def identity_mismatch(self, kind):
        raw = self.html()
        if kind == 'canonical':
            return raw.replace(('<link rel="canonical" href="' + fixture.URL + '">').encode(),
                b'<link rel="canonical" href="https://news.skhynix.com/en/different-story/">')
        if kind == 'title':
            return raw.replace(('<h2 class="post-title">' + fixture.TITLE + '</h2>').encode(),
                b'<h2 class="post-title">A different publisher announcement</h2>')
        return raw.replace(b'</head>', b'<meta property="article:published_time" content="2000-01-01T01:00:00Z"></head>')

    def assert_identity_denial_lifecycle(self, kind):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        event = self.fx.row()
        publication = dict(self.db.execute('SELECT * FROM official_research_publications').fetchone())
        original_body = dict(self.db.execute('SELECT * FROM official_story_bodies').fetchone())
        original_proof = dict(self.db.execute('SELECT * FROM official_story_body_proofs').fetchone())
        token = self.decision(self.t0)['token']
        self.assertEqual(self.refresh(at, request=lambda *_: {'body': self.identity_mismatch(kind)}), 'retry')
        self.assertIsNone(self.public(at))
        self.assertEqual(self.fx.acquire(at=at)['status'], 'ok')
        self.assertIsNone(self.public(at))
        request = gate.capture_request(self.db, self.source, fixture.TICKERS,
            signals.validators_for(self.db, self.source, fixture.TICKERS))
        response = {'not_modified': True, '_http_status': 304, '_feed_request': request['request'],
                    '_effective_url': self.source['url']}
        self.assertEqual(self.fx.acquire(at=at, transport=lambda *_: response)['status'], 'unchanged')
        self.assertIsNone(self.public(at))
        with self.clock(at):
            self.assertIsNone(headline_translation.claim(self.db, signals.SOURCES, 5, 'mock-model', at.timestamp()))
        restored = at + timedelta(seconds=301)
        self.assertEqual(self.refresh(restored), 'ready')
        self.assertIn('bodyJa', self.public(restored))
        self.assertNotEqual(self.decision(restored)['token'], token)
        self.assertEqual(self.fx.row(), event)
        self.assertEqual(dict(self.db.execute('SELECT * FROM official_research_publications').fetchone()), publication)
        self.assertEqual(self.db.execute('SELECT fetched_at FROM official_story_bodies').fetchone()[0], original_body['fetched_at'])
        self.assertEqual(dict(self.db.execute('SELECT * FROM official_story_body_proofs').fetchone()), original_proof)

    def test_conflicting_canonical_denies_until_valid_article_restoration(self):
        self.assert_identity_denial_lifecycle('canonical')

    def test_substantive_title_mismatch_denies_until_valid_article_restoration(self):
        self.assert_identity_denial_lifecycle('title')

    def test_source_date_mismatch_denies_until_valid_article_restoration(self):
        self.assert_identity_denial_lifecycle('date')

    def test_identity_denial_survives_changed_source_revision(self):
        self.assert_negative_survives_feed_revision(lambda *_: {'body': self.identity_mismatch('canonical')})

    def test_delayed_identity_conflict_cannot_replace_newer_article_evidence(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        def delayed(*args):
            self.assertEqual(self.refresh(at, body=fixture.BODY + ' Current publisher update.'), 'ready')
            return {'body': self.identity_mismatch('canonical')}
        self.assertEqual(self.refresh(at, request=delayed), 'stale')
        self.assertTrue(self.decision(at)['admitted'])
        self.assertIsNone(self.db.execute('SELECT error FROM official_story_bodies').fetchone()[0])

    def test_missing_ambiguous_or_brand_only_identity_does_not_invent_conflict(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        original = self.html()
        variants = [
            original.replace(('<link rel="canonical" href="' + fixture.URL + '">').encode(), b'')
                    .replace(('<meta property="og:url" content="' + fixture.URL + '">').encode(), b''),
            original.replace(('<h2 class="post-title">' + fixture.TITLE + '</h2>').encode(), b''),
            original.replace(b'class="post-title"', b'class="post-title" class="other"'),
            original.replace(b' | SK hynix Newsroom', b' | New site branding'),
        ]
        for raw in variants:
            self.assertEqual(self.refresh(at, request=lambda *_: {'body': raw}), 'retry')
            self.assertIn('bodyJa', self.public(at))
            self.assertFalse(self.public(at)['categoryEvidence']['freshForGeneration'])
            self.assertEqual(self.db.execute("SELECT count(*) FROM signal_category_evidence WHERE kind='article'").fetchone()[0], 1)
            at += timedelta(seconds=301)

    def test_timeout_403_and_5xx_remain_transient_without_identity_denial(self):
        self.publish(); at = self.t0 + timedelta(seconds=901)
        for failure in (TimeoutError('synthetic timeout'), HTTPError(fixture.URL, 403, 'Forbidden', Message(), io.BytesIO()),
                        HTTPError(fixture.URL, 503, 'Unavailable', Message(), io.BytesIO())):
            def transient(*args):
                raise failure
            self.assertEqual(self.refresh(at, request=transient), 'retry')
            self.assertIn('bodyJa', self.public(at))
            self.assertEqual(self.public(at)['categoryEvidence']['verifiedAt'], self.t0.isoformat())
            self.assertFalse(self.public(at)['categoryEvidence']['freshForGeneration'])
            self.assertEqual(self.db.execute("SELECT count(*) FROM signal_category_evidence WHERE kind='article'").fetchone()[0], 1)
            at += timedelta(seconds=21601)

    def test_missing_durable_migration_state_forces_200_and_rejects_304(self):
        self.fx.acquire(at=self.t0)
        self.db.execute('DELETE FROM signal_category_evidence_heads'); self.db.commit()
        seen = []
        result = self.fx.acquire(transport=lambda source, validators: (seen.append(validators) or {
            'not_modified': True, '_http_status': 304, '_feed_request': gate.request_identity(source, validators),
            '_effective_url': source['url']}))
        self.assertEqual(seen, [{}]); self.assertEqual(result['status'], 'error')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_category_evidence_heads').fetchone()[0], 0)

    def test_published_history_reads_are_query_only(self):
        self.publish(); self.omit(self.t0 + timedelta(seconds=1))
        self.db.execute('PRAGMA query_only=ON'); before = self.db.total_changes
        self.assertIn('bodyJa', self.public(self.t0 + timedelta(seconds=1000)))
        self.assertEqual(before, self.db.total_changes)


if __name__ == '__main__':
    unittest.main()
