"""Offline production routing regressions; no live source or provider calls."""
from copy import deepcopy
from datetime import datetime, timezone, timedelta
from html import escape
from email.utils import format_datetime
import json
from pathlib import Path
import sqlite3
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import signals
import headline_translation
import feed_category_admission as gate
import official_release_bridge as bridge

NOW = datetime.now(timezone.utc).replace(microsecond=0)
SOURCE = {**next(s for s in signals.SOURCES if s['id'] == 'skhynix-news'),
          'officialUpdates': True, 'requireCurrentDocument': True,
          'publisherArticleCategories': {'version': 1, 'allowAny': ['STORY'],
              'denyAny': ['Media'], 'maxAgeSeconds': 900}}
URL = 'https://news.skhynix.com/en/synthetic-article/'
TITLE = 'SK hynix announces semiconductor research platform'
TICKERS = list(signals.ALIASES)


def item(url=URL, categories=('STORY',), body='Synthetic publisher evidence.', title=TITLE, date=None):
    date = date or format_datetime(NOW - timedelta(hours=1))
    return '<item><title>' + escape(title) + '</title><link>' + escape(url) + '</link><pubDate>' + date + '</pubDate>' + ''.join('<category>' + escape(c) + '</category>' for c in categories) + '<description>' + escape(body) + '</description></item>'


def feed(*entries):
    return ('<rss><channel>' + ''.join(entries) + '</channel></rss>').encode()


class FeedCategoryAdmissionTests(unittest.TestCase):
    def setUp(self):
        # Discovery's service fixture can replace sys.modules['signals']. Bind
        # lazy imports to the same module whose source configuration is patched.
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.addCleanup(self.db.close)
        signals.schema(self.db)
        headline_translation.schema(self.db)
        gate.schema(self.db)
        self.sources = patch.object(signals, 'SOURCES', [SOURCE])
        self.sources.start(); self.addCleanup(self.sources.stop)
        self.network = patch.object(signals, 'fetch', side_effect=AssertionError('network forbidden'))
        self.network.start(); self.addCleanup(self.network.stop)

    def acquire(self, raw, when=NOW, source=SOURCE):
        prepared = gate.prepare(source, raw, TICKERS, gate.head(self.db, source['id']), when.isoformat())
        self.db.commit()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            signals.save_evidence(self.db, source, prepared['items'], {}, when.isoformat())
            gate.persist_200(self.db, source, TICKERS, prepared)
        return prepared

    def conditional_request(self, etag='"feed-v1"'):
        with self.db:
            self.db.execute('INSERT INTO signal_routes(id,initialized,etag,config_sha) VALUES(?,1,?,?) '
                'ON CONFLICT(id) DO UPDATE SET etag=excluded.etag,config_sha=excluded.config_sha',
                (SOURCE['id'], etag, signals.fingerprint(SOURCE, TICKERS)))
        validators = signals.validators_for(self.db, SOURCE, TICKERS)
        return gate.capture_request(self.db, SOURCE, TICKERS, validators)

    @staticmethod
    def not_modified(request):
        return {'not_modified': True, '_http_status': 304, '_feed_request': request['request'],
                '_effective_url': SOURCE['url']}

    def row(self, url=URL):
        return dict(self.db.execute('SELECT * FROM signal_events WHERE url=? ORDER BY id DESC LIMIT 1', (url,)).fetchone())

    def decide(self, url=URL, source=SOURCE, reference=NOW, **kwargs):
        return gate.decision(self.db, source, TICKERS, self.row(url), reference, **kwargs)

    def test_one_story_four_media_all_evidence_retained(self):
        self.acquire(feed(item(), *(item(URL[:-1] + '-' + str(i) + '/', ('Media', 'CVC')) for i in range(1, 5))))
        self.assertTrue(self.decide()['admitted'])
        for i in range(1, 5):
            self.assertEqual(self.decide(URL[:-1] + '-' + str(i) + '/')['reason'], 'publisher-excluded-category')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 5)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_documents').fetchone()[0], 5)

    def test_no_suffix_or_body_length_heuristic(self):
        suffix = URL[:-1] + '-4/'
        self.acquire(feed(item(categories=('Media',), body='x' * 11041), item(suffix, ('STORY',), body='short')))
        self.assertFalse(self.decide()['admitted'])
        self.assertTrue(self.decide(suffix)['admitted'])

    def test_deny_overrides_story_even_when_not_first_category(self):
        self.acquire(feed(item(categories=('STORY', 'CVC', 'Media'))))
        self.assertEqual(self.decide()['reason'], 'publisher-excluded-category')

    def test_missing_unknown_and_oversize_categories_fail_closed(self):
        for cats, reason in [((), 'category-missing'), (('CVC',), 'publisher-category-not-allowed'),
            (('STORY', 'x' * 257), 'category-invalid-bound'),
            (tuple(['STORY'] * 16 + ['Media']), 'category-invalid-bound')]:
            with self.subTest(cats=cats):
                self.acquire(feed(item(categories=cats)))
                self.assertEqual(self.decide()['reason'], reason)

    def test_category_only_change_and_removal_hold_without_rewriting_events(self):
        self.acquire(feed(item()))
        before = self.row(); token = self.decide()['token']
        for offset, cats in [(1, ('Media',)), (2, ())]:
            self.acquire(feed(item(categories=cats)), NOW + timedelta(seconds=offset))
            self.assertEqual(self.row(), before)
            self.assertFalse(self.decide(reference=NOW + timedelta(seconds=offset))['admitted'])
        self.acquire(feed(item()), NOW + timedelta(seconds=3))
        self.assertTrue(self.decide(reference=NOW + timedelta(seconds=3))['admitted'])
        self.assertEqual(self.decide(reference=NOW + timedelta(seconds=3), expected_token=token)['reason'], 'category-proof-changed-in-flight')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_feed_category_snapshots').fetchone()[0], 4)

    def test_body_change_never_authorizes_previous_event(self):
        self.acquire(feed(item())); old = self.row()
        self.acquire(feed(item(body='Changed current source body.')), NOW + timedelta(seconds=1))
        self.assertEqual(gate.decision(self.db, SOURCE, TICKERS, old, NOW + timedelta(seconds=1))['reason'], 'category-proof-revision-mismatch')
        self.assertTrue(self.decide(reference=NOW + timedelta(seconds=1))['admitted'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 2)

    def test_legacy_row_needs_new_authoritative_observation(self):
        items = signals.parse(SOURCE, feed(item()), TICKERS)
        with self.db:
            signals.save_evidence(self.db, SOURCE, items, {}, (NOW - timedelta(days=1)).isoformat())
        before = self.row()
        self.assertEqual(self.decide()['reason'], 'category-proof-unavailable')
        with self.assertRaisesRegex(ValueError, '304-without'):
            with self.db:
                self.db.execute('BEGIN IMMEDIATE')
                request = gate.capture_request(self.db, SOURCE, TICKERS, {})
                gate.persist_304(self.db, SOURCE, TICKERS, request, self.not_modified(request), NOW.isoformat())
        self.acquire(feed(item()))
        self.assertTrue(self.decide()['admitted'])
        self.assertEqual(self.row(), before)

    def test_current_feed_absence_preserves_historical_category_without_retraction(self):
        self.acquire(feed(item())); before = self.row()
        self.acquire(feed(), NOW + timedelta(seconds=1))
        current = self.decide(reference=NOW + timedelta(seconds=1))
        self.assertTrue(current['admitted'])
        self.assertFalse(current['evidence']['currentFeedMember'])
        self.assertEqual(current['evidence']['verifiedAt'], NOW.isoformat())
        self.assertEqual(self.row(), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_documents').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_feed_category_snapshots').fetchone()[0], 2)

    def test_disabled_source_or_changed_identity_fail_closed(self):
        self.acquire(feed(item()))
        for change, reason in [({'enabled': False}, 'source-not-admitted'), ({'officialUpdates': False}, 'source-not-admitted'),
            ({'url': SOURCE['url'] + '?different=1'}, 'category-proof-source-mismatch'),
            ({'tickers': ['MSFT']}, 'source-ticker-mismatch')]:
            self.assertEqual(self.decide(source={**SOURCE, **change})['reason'], reason)

    def test_stale_future_and_mismatched_parser_proof(self):
        self.acquire(feed(item()))
        self.assertEqual(self.decide(reference=NOW + timedelta(seconds=901), require_fresh=True)['reason'], 'category-proof-stale')
        self.assertEqual(self.decide(reference=NOW - timedelta(seconds=1))['reason'], 'category-proof-clock-invalid')
        self.db.execute('UPDATE signal_feed_category_snapshots SET parser_version=0')
        self.assertEqual(self.decide()['reason'], 'category-proof-source-mismatch')

    def test_source_or_content_changed_before_save_rolls_back_whole_acquisition(self):
        self.acquire(feed(item())); before = self.row()
        prepared = gate.prepare(SOURCE, feed(item(body='New body.')), TICKERS, gate.head(self.db, SOURCE['id']), NOW.isoformat())
        with self.assertRaisesRegex(ValueError, 'source-identity-changed'):
            with self.db:
                self.db.execute('BEGIN IMMEDIATE')
                signals.save_evidence(self.db, SOURCE, prepared['items'], {}, NOW.isoformat())
                gate.persist_200(self.db, {**SOURCE, 'enabled': False}, TICKERS, prepared)
        self.assertEqual(self.row(), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 1)

    def test_out_of_order_fetch_does_not_restore_old_story_permission(self):
        self.acquire(feed(item()))
        stale = gate.prepare(SOURCE, feed(item()), TICKERS, gate.head(self.db, SOURCE['id']), NOW.isoformat())
        self.acquire(feed(item(categories=('Media',))), NOW + timedelta(seconds=1))
        with self.assertRaisesRegex(ValueError, 'superseded-feed-response'):
            with self.db:
                self.db.execute('BEGIN IMMEDIATE')
                gate.persist_200(self.db, SOURCE, TICKERS, stale)
        self.assertFalse(self.decide(reference=NOW + timedelta(seconds=1))['admitted'])

    def test_real_304_renews_existing_proof_not_body_or_acquisition_clocks(self):
        self.acquire(feed(item())); before = self.row(); original = gate.head(self.db, SOURCE['id'])
        request = self.conditional_request()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            gate.persist_304(self.db, SOURCE, TICKERS, request, self.not_modified(request), (NOW + timedelta(seconds=800)).isoformat())
        self.assertTrue(self.decide(reference=NOW + timedelta(seconds=1200))['admitted'])
        self.assertEqual(self.row(), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_feed_category_snapshots').fetchone()[0], 1)

    def test_identical_poll_preserves_snapshot_and_event_clock(self):
        self.acquire(feed(item())); before = self.row(); token = self.decide()['token']
        self.acquire(feed(item()), NOW + timedelta(seconds=1))
        self.assertEqual(self.decide(reference=NOW + timedelta(seconds=1))['token'], token)
        self.assertEqual(self.row(), before)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_feed_category_snapshots').fetchone()[0], 1)

    def test_projection_is_query_only_and_has_no_read_side_schema_writes(self):
        self.acquire(feed(item()))
        before = self.db.total_changes
        self.db.execute('PRAGMA query_only=ON')
        self.assertTrue(self.decide()['admitted'])
        self.assertEqual(self.db.total_changes, before)

    def test_duplicate_feed_url_is_ambiguous_not_last_wins_allow(self):
        self.acquire(feed(item(categories=('Media',)), item(categories=('STORY',))))
        self.assertEqual(self.decide()['reason'], 'category-ambiguous-url')

    def test_atom_term_is_used_not_display_label(self):
        raw = ('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>' + TITLE + '</title><link href="' + URL
            + '"/><published>2026-10-04T11:00:00Z</published><category term="Media" label="STORY"/><summary>Evidence.</summary></entry></feed>').encode()
        self.acquire(raw)
        self.assertEqual(self.decide()['reason'], 'publisher-excluded-category')

    def test_namespaced_fake_category_or_nested_category_cannot_grant_permission(self):
        for cats in ['<fake:category xmlns:fake="https://evil.example/">STORY</fake:category>',
                     '<category><b>STORY</b></category>', '<category domain="https://other.example/">STORY</category>']:
            raw = feed(item(categories=())).replace(b'</item>', (cats + '</item>').encode())
            self.acquire(raw)
            self.assertFalse(self.decide()['admitted'])

    def test_exact_primary_owner_wins_even_when_primary_held_or_absent_from_scan(self):
        self.acquire(feed(item()))
        self.assertEqual(self.decide(primary_owned_urls={URL})['reason'], 'primary-owned-url')
        self.assertTrue(self.decide(primary_owned_urls={URL + 'other'})['admitted'])

    def test_record_title_publisher_clock_document_and_truncation_are_bound(self):
        self.acquire(feed(item()))
        for changes in [{'sha': 'wrong'}, {'title': 'Wrong title'}, {'published_at': '2026-10-04T10:00:00+00:00'}, {'truncated': 1}]:
            row = {**self.row(), **changes}
            self.assertEqual(gate.decision(self.db, SOURCE, TICKERS, row, NOW)['reason'], 'category-proof-revision-mismatch')
        self.db.execute("UPDATE signal_documents SET sha='wrong'")
        self.assertEqual(self.decide()['reason'], 'category-proof-revision-mismatch')

    def test_unsafe_xml_feed_is_rejected_before_transaction(self):
        with self.assertRaisesRegex(ValueError, 'unsafe-signal-xml'):
            gate.prepare(SOURCE, b'<!DOCTYPE rss><rss/>', TICKERS, None, NOW.isoformat())
        self.assertFalse(self.db.in_transaction)

    def test_candidate_filter_reuses_existing_shared_model_cap_no_media_reservation(self):
        self.acquire(feed(*(item(URL[:-1] + str(i) + '/', ('STORY',)) for i in range(3)),
                          *(item(URL[:-1] + 'media' + str(i) + '/', ('Media',)) for i in range(4))))
        with patch.object(signals, 'SOURCES', [SOURCE]):
            self.assertIsNotNone(headline_translation.claim(self.db, [SOURCE], 2, 'synthetic-model', NOW.timestamp()))
            self.assertIsNotNone(headline_translation.claim(self.db, [SOURCE], 2, 'synthetic-model', NOW.timestamp()))
            self.assertIsNone(headline_translation.claim(self.db, [SOURCE], 2, 'synthetic-model', NOW.timestamp()))
        calls = self.db.execute('SELECT * FROM signal_headline_translation_calls').fetchall()
        self.assertEqual(len(calls), 2)
        jobs = self.db.execute('SELECT url FROM signal_headline_translation_jobs').fetchall()
        self.assertTrue(all('media' not in r['url'] for r in jobs))

    def test_normal_poll_policy_activation_clears_http_validators(self):
        old_source = {key: value for key, value in SOURCE.items() if key not in
                      {'officialUpdates', 'requireCurrentDocument', 'publisherArticleCategories'}}
        with self.db:
            self.db.execute('INSERT INTO signal_routes(id,initialized,etag,config_sha) VALUES(?,1,?,?)',
                (SOURCE['id'], '"old-feed"', signals.fingerprint(old_source, TICKERS)))
        # Existing full-source fingerprint detects the newly added category policy.
        self.assertEqual(signals.validators_for(self.db, SOURCE, TICKERS), {})
        before_calls = self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0]
        self.acquire(feed(item()))
        with self.db:
            self.db.execute('UPDATE signal_routes SET config_sha=? WHERE id=?',
                (signals.fingerprint(SOURCE, TICKERS), SOURCE['id']))
        validators = signals.validators_for(self.db, SOURCE, TICKERS)
        self.assertEqual(gate.conditional_validators(self.db, SOURCE, TICKERS, validators)['etag'], '"old-feed"')
        self.assertTrue(self.decide()['admitted'])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], before_calls)

    def test_same_config_migration_without_proof_and_parser_upgrade_request_full_poll(self):
        with self.db:
            self.db.execute('INSERT INTO signal_routes(id,initialized,etag,config_sha) VALUES(?,1,?,?)',
                (SOURCE['id'], '"retained-feed"', signals.fingerprint(SOURCE, TICKERS)))
        validators = signals.validators_for(self.db, SOURCE, TICKERS)
        self.assertEqual(validators['etag'], '"retained-feed"')
        self.assertEqual(gate.conditional_validators(self.db, SOURCE, TICKERS, validators), {})
        self.acquire(feed(item()))
        self.assertEqual(gate.conditional_validators(self.db, SOURCE, TICKERS, validators), validators)
        self.db.execute('UPDATE signal_feed_category_snapshots SET parser_version=0')
        self.assertEqual(gate.conditional_validators(self.db, SOURCE, TICKERS, validators), {})

    def test_batched_projection_reads_once_not_per_candidate(self):
        self.acquire(feed(*(item(URL + str(i)) for i in range(20))))
        rows = [dict(r) for r in self.db.execute('SELECT * FROM signal_events')]
        statements = []
        self.db.set_trace_callback(statements.append)
        context = gate.read_context(self.db, SOURCE, TICKERS, rows)
        reads = len(statements)
        results = [gate.decision(self.db, SOURCE, TICKERS, row, NOW, context=context) for row in rows]
        self.assertTrue(all(result['admitted'] for result in results))
        self.assertEqual(len(statements), reads)
        self.assertEqual(reads, 7)  # bounded snapshot, documents, durable evidence and decision reads
        with self.assertRaisesRegex(ValueError, 'candidate-bound'):
            gate.read_context(self.db, SOURCE, TICKERS, rows * 26)
        self.db.set_trace_callback(None)

    def test_total_metadata_bound_never_truncates_category_list_into_permission(self):
        raw = feed(*(item(URL + str(i), ('STORY',) + tuple('k' * 256 for _ in range(15))) for i in range(500)))
        self.acquire(raw)
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_events').fetchone()[0], 500)
        self.assertLessEqual(len(self.db.execute('SELECT entries_json FROM signal_feed_category_snapshots').fetchone()[0].encode()), gate.MAX_SNAPSHOT_BYTES)
        self.assertEqual(self.decide(URL + '0')['reason'], 'category-invalid-snapshot-bound')

    def test_oversized_url_metadata_keeps_ordinary_evidence_but_never_admits(self):
        url = 'https://news.skhynix.com/en/' + 'long' * 300 + '/'
        self.acquire(feed(item(url)))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_documents').fetchone()[0], 1)
        self.assertEqual(self.decide(url)['reason'], 'category-invalid-url-bound')
        validators = self.conditional_request()
        self.assertEqual(gate.conditional_validators(self.db, SOURCE, TICKERS, validators), {})

    def test_production_source_activates_only_the_reviewed_story_policy(self):
        configured = next(s for s in json.loads(Path(signals.__file__).with_name('signal_sources.json').read_text())
                          if s['id'] == 'skhynix-news')
        self.assertIs(configured.get('officialUpdates'), True)
        self.assertIs(configured.get('requireCurrentDocument'), True)
        self.assertEqual(configured['publisherArticleCategories'], {'version': 1, 'allowAny': ['STORY'],
            'denyAny': ['Media'], 'maxAgeSeconds': 900})
        self.assertEqual(configured['url'], 'https://news.skhynix.com/feed/')
        self.assertEqual(configured['intervalSeconds'], 120)
        self.assertEqual(configured['tickers'], ['SKHY'])


if __name__ == '__main__':
    unittest.main()
