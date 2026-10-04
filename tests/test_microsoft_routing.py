"""Offline, synthetic coverage for exact-URL issuer ownership and feed admission."""
from datetime import datetime, timezone
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import headline_translation as translation
import official_release_bridge as bridge
import official_research as research
import signals
from test_headline_translation import ENV

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
SOURCE = next(s for s in signals.SOURCES if s['id'] == 'microsoft-blog')
URL = 'https://blogs.microsoft.com/blog/2026/10/01/synthetic-leadership-update/'
TITLE = 'Microsoft announces a leadership update'
PUBLISHED = '2026-10-01T15:03:27+00:00'
OBSERVED = '2026-10-01T15:05:14+00:00'
BODY_AT = '2026-10-01T15:06:00+00:00'
QUOTES = ['Microsoft announced a leadership update for its business.',
          'Alex Lee will lead the products team.',
          'The products team will continue developing business software.',
          'The company aims to support its business customers.']
BODY = '\n'.join(QUOTES) + '\n' + ('Synthetic corporate announcement background. ' * 45)


def pair(ja, en, quote):
    return {'ja': ja, 'en': en, 'evidenceQuote': quote}


NOTE = {'title': pair('Microsoftが経営体制の変更を発表', TITLE, QUOTES[0]),
        'summary': pair('Microsoftが事業の経営体制の変更を発表した。',
                        'Microsoft announced a leadership update for its business.', QUOTES[0]),
        'facts': [pair('Alex Leeが製品チームを率いる予定。', 'Alex Lee will lead the products team.', QUOTES[1]),
                  pair('製品チームはビジネスソフトウェアの開発を続ける予定。',
                       'The products team will continue developing business software.', QUOTES[2]),
                  pair('Microsoftが経営体制の変更を発表した。', 'Microsoft announced a leadership update.', QUOTES[0])],
        'purpose': pair('法人顧客の支援を目指す。', 'The company aims to support its business customers.', QUOTES[3])}


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def response(*_):
    return {'status': 'completed', 'output_text': json.dumps(NOTE, ensure_ascii=False)}


@contextmanager
def withdrawn_configuration(case):
    current = [dict(s) for s in signals.SOURCES]
    source = next(s for s in current if s['id'] == SOURCE['id'])
    if case == 'source-removed':
        current = [s for s in current if s['id'] != SOURCE['id']]
    elif case == 'flags-removed':
        source.pop('officialUpdates')
        source.pop('requireCurrentDocument')
    else:
        key, value = {'hosts-removed': ('allowedHosts', []), 'wrong-host': ('allowedHosts', ['example.com']),
                      'wrong-kind': ('kind', 'other'), 'disabled': ('enabled', False),
                      'wrong-ticker': ('tickers', ['NBIS'])}[case]
        source[key] = value
    with patch.object(signals, 'SOURCES', current):
        yield


class MicrosoftRoutingTests(unittest.TestCase):
    def setUp(self):
        # Discovery can replace sys.modules['signals'] in the service fixture.
        # Keep lazy imports on the module our research/headline mocks use, and
        # restore the discovery binding after each test.
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'routing.sqlite'
        self.db = research.connect(self.path)
        self.addCleanup(self.db.close)
        self.addCleanup(patch.stopall)
        # Every transport is synthetic; accidental network/provider use fails.
        patch.object(signals, 'fetch', side_effect=AssertionError('network forbidden')).start()
        patch.object(research.brief_generator, 'request_response', side_effect=AssertionError('provider forbidden')).start()

    def supplemental(self, url=URL, source=SOURCE, title=TITLE, body=BODY):
        sha = digest(title + '\n' + body)
        cursor = self.db.execute('''INSERT INTO signal_events(
          source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
          published_at,observed_at,excerpt,diff,truncated) VALUES(?,?,?,'',?,?,'{}','new',?,?,'','',0)''',
          (source['id'], url, sha, title, json.dumps(source['tickers']), PUBLISHED, OBSERVED))
        self.db.execute('INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)',
                        (source['id'], url, sha, title, body, OBSERVED, OBSERVED))
        self.cache(cursor.lastrowid, sha, body)
        self.db.commit()
        return cursor.lastrowid

    def cache(self, event_id, sha, body=BODY):
        self.db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,NULL)',
                        (event_id, sha, digest(body), body, BODY_AT, NOW.timestamp() + 900))

    def primary(self, url=URL, *, published='2026-10-01', observed=OBSERVED, title=TITLE):
        sha = digest(BODY + 'primary proof')
        self.db.execute('INSERT INTO sources(url,ticker,title,published_on,discovered_at,sha256) VALUES(?,?,?,?,?,?)',
                        (url, 'MSFT', title, published, observed, sha))
        self.db.execute('INSERT INTO source_revisions(url,sha256,observed_at,extracted_text,extracted_chars) VALUES(?,?,?,?,?)',
                        (url, sha, BODY_AT, BODY, len(BODY)))
        event_sha = bridge.revision(title, sha, published)
        cursor = self.db.execute('''INSERT INTO signal_events(
          source_id,url,sha,previous_sha,title,tickers_json,matches_json,event_kind,
          published_on,observed_at,excerpt,diff,truncated) VALUES('primary-ir-MSFT',?,?,'',?,'["MSFT"]','{}','new',?,?,'','',0)''',
          (url, event_sha, title, published, observed))
        self.cache(cursor.lastrowid, event_sha)
        # Primary candidate body_sha is the primary revision digest.
        self.db.execute('UPDATE official_story_bodies SET body_sha=? WHERE event_id=?', (sha, cursor.lastrowid))
        self.db.commit()
        return cursor.lastrowid

    def save_copy(self, event_id):
        row = self.db.execute('SELECT e.*,b.body_sha FROM signal_events e JOIN official_story_bodies b ON b.event_id=e.id WHERE e.id=?', (event_id,)).fetchone()
        self.db.execute('INSERT INTO signal_headline_translations VALUES(?,?,?,?,?,?)',
                        (row['source_id'], row['url'], row['sha'], NOTE['title']['ja'], 'synthetic', BODY_AT))
        self.db.execute('INSERT INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                        (event_id, row['sha'], row['body_sha'], json.dumps(NOTE), '[]',
                         '2026-10-02T10:00:00+00:00', '2026-10-02T10:00:01+00:00', 1000))
        self.db.commit()

    def feed(self, **kwargs):
        return signals.public_official_updates(self.db, reference=NOW, read_only=True, **kwargs)

    def assert_unavailable(self):
        self.assertEqual(self.feed(), [])
        self.assertEqual(research.candidates(self.db, NOW, read_only=True), [])
        self.assertEqual(research.candidates(self.db, NOW, read_only=True, primary_only=True), [])
        self.assertIsNone(translation.claim(self.db, signals.SOURCES, 3, 'synthetic', NOW.timestamp()))
        self.assertIsNone(research.claim(self.db, NOW, 'synthetic', 3))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_only_microsoft_is_admitted_and_normal_missing_article_uses_own_identity(self):
        self.assertTrue(SOURCE['officialUpdates'])
        self.assertTrue(SOURCE['requireCurrentDocument'])
        for ident in ('skhynix-news', 'arm-blog'):
            self.assertIsNot(next(s for s in signals.SOURCES if s['id'] == ident).get('officialUpdates'), True)
        event_id = self.supplemental()
        item = self.feed()[0]
        self.assertEqual((item['id'], item['publisher'], item['publishedAt'], item['observedAt']),
                         (str(event_id), SOURCE['name'], PUBLISHED, OBSERVED))
        rows = research.candidates(self.db, NOW, read_only=True)
        self.assertEqual([(r['id'], r['source_id'], r['body_sha'], r['body_at']) for r in rows],
                         [(event_id, SOURCE['id'], digest(BODY), BODY_AT)])
        self.assertEqual(research.candidates(self.db, NOW, read_only=True, primary_only=True), [])
        self.assertEqual(translation.diagnostics(self.db, ENV, NOW.timestamp())['pending'], 1)

    def test_primary_full_copy_and_clocks_survive_newer_supplemental_clock(self):
        primary_id = self.primary()
        self.save_copy(primary_id)
        before = json.dumps({'headlines': self.feed(), 'research': research.feed(self.db, NOW)}, sort_keys=True)
        secondary_id = self.supplemental()
        self.save_copy(secondary_id)
        after = json.dumps({'headlines': self.feed(), 'research': research.feed(self.db, NOW)}, sort_keys=True)
        self.assertEqual(after, before)
        self.assertIn('bodyJa', self.feed()[0])
        self.assertEqual(self.feed()[0]['id'], str(primary_id))
        self.assertEqual(research.feed(self.db, NOW)[0]['id'], 'ir-result-' + str(primary_id))
        self.assertNotIn('publishedAt', self.feed()[0])
        for primary_only in (False, True):
            self.assertEqual([r['id'] for r in research.candidates(self.db, NOW, read_only=True, primary_only=primary_only)], [primary_id])
        self.assertEqual(self.feed(sources=[SOURCE]), [])
        self.assertEqual(translation.diagnostics(self.db, ENV, NOW.timestamp())['pending'], 0)
        self.assertIsNone(translation.claim(self.db, signals.SOURCES, 3, 'synthetic', NOW.timestamp()))
        self.assertIsNone(research.claim(self.db, NOW, 'synthetic', 3))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_primary_hold_rejection_and_stale_revision_never_fall_back(self):
        self.primary()
        self.supplemental()
        for column, value in [('status', 'held'), ('status', 'rejected'), ('sha256', 'new-unfetched-revision'),
                              ('title', 'Changed primary identity')]:
            with self.subTest(column=column, value=value):
                original = self.db.execute(f'SELECT {column} FROM sources').fetchone()[0]
                self.db.execute(f'UPDATE sources SET {column}=?', (value,))
                self.db.commit()
                self.assert_unavailable()
                self.db.execute(f'UPDATE sources SET {column}=?', (original,))
                self.db.commit()

    def test_primary_record_alone_owns_even_before_bridge_projection(self):
        self.primary()
        self.db.execute('DELETE FROM official_story_bodies')
        self.db.execute("DELETE FROM signal_events WHERE source_id='primary-ir-MSFT'")
        self.db.execute("UPDATE sources SET status='held'")
        self.db.commit()
        self.supplemental()
        self.assert_unavailable()

    def test_retained_primary_event_owns_after_primary_source_removed(self):
        self.primary()
        self.db.execute('DELETE FROM source_revisions')
        self.db.execute('DELETE FROM sources')
        self.db.commit()
        self.supplemental()
        self.assert_unavailable()

    def test_old_primary_outside_window_and_candidate_scan_still_owns(self):
        self.primary(published='2026-09-01', observed='2026-09-01T00:00:00+00:00')
        self.db.execute('DELETE FROM source_revisions')
        self.db.execute('DELETE FROM sources')
        for index in range(510):
            self.db.execute('''INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,observed_at,excerpt,diff,truncated)
              VALUES('nebius-blog',?,?,'Old retained update','["NBIS"]','{}','new','2026-09-01T00:00:00+00:00','','',0)''',
              (f'https://nebius.com/blog/old-{index}', str(index)))
        self.db.commit()
        self.supplemental()
        self.assert_unavailable()

    def test_ownership_rule_is_source_generic(self):
        source = next(s for s in signals.SOURCES if s['id'] == 'nebius-blog')
        url = 'https://nebius.com/newsroom/synthetic-leadership-update'
        self.supplemental(url=url, source=source)
        self.db.execute('INSERT INTO sources(url,ticker,discovered_at,status) VALUES(?,?,?,?)',
                        (url, 'NBIS', OBSERVED, 'held'))
        self.db.commit()
        self.assert_unavailable()

    def test_invalid_primary_provider_ticker_or_path_does_not_claim_ownership(self):
        self.supplemental()
        for source_id, tickers, url in [('primary-ir-UNKNOWN', '["MSFT"]', URL),
                                        ('primary-ir-NBIS', '["NBIS"]', URL),
                                        ('primary-ir-MSFT', '["NBIS"]', URL),
                                        ('primary-ir-MSFT', '["MSFT"]', 'https://blogs.microsoft.com/about/')]:
            self.db.execute('''INSERT INTO signal_events(source_id,url,sha,title,tickers_json,matches_json,event_kind,observed_at,excerpt,diff,truncated)
              VALUES(?,?,'invalid-owner','Unverified primary',?,'{}','new',?,'','',0)''', (source_id, url, tickers, OBSERVED))
        self.db.commit()
        self.assertEqual(bridge.primary_owned_urls(self.db, [URL, 'https://blogs.microsoft.com/about/']), set())
        self.assertEqual(len(self.feed(sources=[SOURCE])), 1)

    def test_document_identity_withdrawal_source_policy_and_truncation_fail_closed(self):
        event_id = self.supplemental()
        stale_visible = self.feed()
        retained = research.candidates(self.db, NOW, read_only=True)[0]
        for table, column, value in [('signal_documents', 'sha', 'changed'), ('signal_documents', 'title', 'Another title'),
                                     ('signal_events', 'truncated', 1), ('signal_events', 'tickers_json', '["NBIS"]')]:
            with self.subTest(table=table, column=column):
                old = self.db.execute(f'SELECT {column} FROM {table}').fetchone()[0]
                self.db.execute(f'UPDATE {table} SET {column}=?', (value,))
                self.db.commit()
                self.assert_unavailable()
                self.assertEqual(research.candidates(self.db, NOW, read_only=True, published_updates=stale_visible), [])
                self.db.execute(f'UPDATE {table} SET {column}=?', (old,))
                self.db.commit()
        for key, value in [('enabled', False), ('officialUpdates', False)]:
            with self.subTest(policy=key), patch.dict(SOURCE, {key: value}):
                self.assert_unavailable()
                self.assertFalse(research.current_revision(self.db, retained))
                self.assertEqual(research.public_story_body(self.db, retained), {})
        self.db.execute('DELETE FROM signal_documents')
        self.db.commit()
        self.assert_unavailable()
        self.assertFalse(research.current_revision(self.db, retained))

    def test_stale_dates_promotions_wrong_host_path_remain_excluded(self):
        self.supplemental()
        for column, value in [('published_at', '2026-09-01T00:00:00+00:00'),
                              ('published_at', '2026-10-05T00:00:00+00:00'),
                              ('published_at', 'invalid'), ('title', 'Register today for our free course'),
                              ('url', 'https://evil.example/blog/2026/10/01/fake/'),
                              ('url', 'https://blogs.microsoft.com/about/')]:
            with self.subTest(column=column):
                old = self.db.execute(f'SELECT {column} FROM signal_events').fetchone()[0]
                self.db.execute(f'UPDATE signal_events SET {column}=?', (value,))
                self.db.commit()
                self.assertEqual(self.feed(), [])
                self.db.execute(f'UPDATE signal_events SET {column}=?', (old,))
                self.db.commit()

    def test_owner_arriving_after_snapshot_invalidates_supplemental_and_keeps_clocks_separate(self):
        supplemental_id = self.supplemental()
        self.save_copy(supplemental_id)
        snapshot = self.feed()
        retained = research.candidates(self.db, NOW, read_only=True)[0]
        primary_id = self.primary()
        self.assertFalse(research.current_revision(self.db, retained))
        self.assertEqual(research.public_story_body(self.db, retained), {})
        self.assertEqual([r['id'] for r in research.candidates(self.db, NOW, read_only=True, published_updates=snapshot)], [])
        item = self.feed()[0]
        self.assertEqual(item['id'], str(primary_id))
        self.assertNotIn('bodyJa', item)
        self.assertNotIn('translationJa', item)
        self.assertEqual(item['publishedOn'], '2026-10-01')

    def test_unrelated_url_with_same_title_remains_independent(self):
        self.primary()
        second = self.supplemental(url=URL.replace('synthetic-', 'another-'))
        self.assertIn(str(second), {item['id'] for item in self.feed()})
        self.assertEqual(len(self.feed()), 2)

    def test_query_only_projection_does_not_mutate_or_cache_public_feed(self):
        self.primary()
        self.supplemental()
        self.db.commit()
        before = list(self.db.iterdump())
        self.db.execute('PRAGMA query_only=ON')
        self.assertEqual(len(self.feed()), 1)
        self.assertEqual(list(self.db.iterdump()), before)

    def test_signal_only_database_needs_no_primary_tables(self):
        with sqlite3.connect(':memory:') as db:
            db.row_factory = sqlite3.Row
            signals.schema(db)
            self.assertEqual(bridge.primary_owned_urls(db, [URL]), set())

    def test_ownership_lookup_is_batched_and_uses_existing_indexes(self):
        urls = [URL.replace('synthetic-', f'synthetic-{i}-') for i in range(500)]
        queries = []
        self.db.set_trace_callback(queries.append)
        try:
            self.assertEqual(bridge.primary_owned_urls(self.db, urls), set())
        finally:
            self.db.set_trace_callback(None)
        self.assertEqual(len(queries), 5)  # schema inventory + two URL batches per table
        for query in queries:
            if 'FROM signal_events' in query or 'FROM sources WHERE' in query:
                plans = [row[3] for row in self.db.execute('EXPLAIN QUERY PLAN ' + query)]
                self.assertTrue(any(plan.startswith('SEARCH ') and 'INDEX' in plan for plan in plans))
                self.assertFalse(any(plan.startswith(('SCAN sources', 'SCAN signal_events')) for plan in plans))

    def test_shared_claim_budget_and_disabled_approval_are_unchanged(self):
        event_id = self.supplemental()
        self.assertIsNone(research.claim(self.db, NOW, 'synthetic', 1))  # headline reservation
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)
        self.save_copy(event_id)
        self.db.execute('DELETE FROM official_research_publications')
        self.db.commit()
        job = research.claim(self.db, NOW, 'synthetic', 1)
        self.assertEqual(job[0]['id'], event_id)
        self.assertIsNone(research.claim(self.db, NOW, 'synthetic', 1))
        self.assertIsNone(translation.claim(self.db, signals.SOURCES, 1, 'synthetic', NOW.timestamp()))
        calls = self.db.execute('SELECT source_id,model,state FROM signal_headline_translation_calls').fetchall()
        self.assertEqual([tuple(r) for r in calls], [('research:microsoft-blog', 'synthetic', 'running')])
        for env in ({}, {**ENV, 'OFFICIAL_HEADLINE_TRANSLATION_APPROVED_ON': ''}):
            self.assertEqual(translation.run_once(self.path, lambda *_: self.fail('unapproved call'), env, NOW.timestamp()), 'disabled')
            self.assertEqual(research.run_once(self.path, lambda *_: self.fail('unapproved call'), env, NOW.timestamp()), 'disabled')
        self.assertEqual(translation.configuration(ENV, NOW.timestamp())[2], 3)

    def test_owner_arriving_between_projection_and_claim_reserves_no_call(self):
        self.supplemental()
        project = signals.public_official_updates
        def snapshot_then_hold(*args, **kwargs):
            items = project(*args, **kwargs)
            self.primary()
            self.db.execute("UPDATE sources SET status='held'")
            self.db.commit()
            return items
        with patch.object(signals, 'public_official_updates', side_effect=snapshot_then_hold):
            self.assertIsNone(translation.claim(self.db, signals.SOURCES, 3, 'synthetic', NOW.timestamp()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_event_identity_change_during_generation_is_stale(self):
        self.supplemental()
        def transport(*_):
            self.db.execute("UPDATE signal_events SET published_at='2026-10-02T00:00:00+00:00'")
            self.db.commit()
            return response()
        self.assertEqual(research.run_once(self.path, transport, ENV, NOW.timestamp()), 'stale')
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)

    def test_current_configuration_withdrawal_never_downgrades_to_legacy_policy(self):
        self.supplemental()
        snapshot = self.feed()
        retained = research.candidates(self.db, NOW, read_only=True)[0]
        for case in ('source-removed', 'flags-removed', 'hosts-removed', 'wrong-host', 'wrong-kind', 'disabled', 'wrong-ticker'):
            with self.subTest(case=case), withdrawn_configuration(case):
                self.assertFalse(research.current_revision(self.db, retained))
                self.assertEqual(self.feed(), [])
                self.assertEqual(research.candidates(self.db, NOW, read_only=True, published_updates=snapshot), [])
                self.assertEqual(research.public_story_body(self.db, retained), {})
                self.assertFalse(bridge.is_current(self.db, retained, source=SOURCE))

    def test_inflight_configuration_withdrawal_cannot_publish(self):
        self.supplemental()
        for case in ('source-removed', 'flags-removed', 'hosts-removed', 'wrong-kind'):
            with self.subTest(case=case):
                self.db.execute('DELETE FROM official_research_jobs')
                self.db.execute('DELETE FROM signal_headline_translation_calls')
                self.db.commit()
                active = []
                def transport(*_):
                    context = withdrawn_configuration(case)
                    context.__enter__()
                    active.append(context)
                    return response()
                try:
                    self.assertEqual(research.run_once(self.path, transport, ENV, NOW.timestamp()), 'stale')
                    self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
                    self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)
                finally:
                    for context in active:
                        context.__exit__(None, None, None)

    def test_changed_event_after_projection_never_binds_old_headline_to_new_revision(self):
        self.supplemental()
        project = signals.public_official_updates
        def snapshot_then_change(*args, **kwargs):
            items = project(*args, **kwargs)
            self.db.execute("UPDATE signal_events SET title='Microsoft announces a new product',sha='new-sha'")
            self.db.execute("UPDATE signal_documents SET title='Microsoft announces a new product',sha='new-sha'")
            self.db.commit()
            return items
        with patch.object(signals, 'public_official_updates', side_effect=snapshot_then_change):
            self.assertIsNone(translation.claim(self.db, signals.SOURCES, 3, 'synthetic', NOW.timestamp()))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_stale_public_list_cannot_authorize_newly_ineligible_metadata(self):
        self.supplemental()
        snapshot = self.feed()
        for column, value in [('published_at', '2026-09-01T00:00:00+00:00'),
                              ('published_at', '2026-10-08T00:00:00+00:00'),
                              ('title', 'Register today for our free course')]:
            with self.subTest(column=column, value=value):
                old = self.db.execute(f'SELECT {column} FROM signal_events').fetchone()[0]
                self.db.execute(f'UPDATE signal_events SET {column}=?', (value,))
                if column == 'title':
                    self.db.execute('UPDATE signal_documents SET title=?', (value,))
                self.db.commit()
                self.assertEqual(self.feed(), [])
                self.assertEqual(research.candidates(self.db, NOW, read_only=True, published_updates=snapshot), [])
                self.db.execute(f'UPDATE signal_events SET {column}=?', (old,))
                if column == 'title':
                    self.db.execute('UPDATE signal_documents SET title=?', (old,))
                self.db.commit()

    def test_changed_source_cannot_downgrade_a_stale_microsoft_snapshot_to_legacy(self):
        self.supplemental()
        snapshot = self.feed()
        retained = research.candidates(self.db, NOW, read_only=True)[0]
        self.db.execute("UPDATE signal_events SET source_id='nebius-blog'")
        self.db.execute("UPDATE signal_documents SET source_id='nebius-blog'")
        self.db.commit()
        self.assertEqual(self.feed(), [])
        self.assertEqual(research.candidates(self.db, NOW, read_only=True, published_updates=snapshot), [])
        self.assertFalse(research.current_revision(self.db, retained))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_source_event_validation_runs_without_writer_lock(self):
        event_id = self.supplemental()
        self.save_copy(event_id)
        self.db.execute('DELETE FROM official_research_publications')
        self.db.commit()
        original = research.validate_source_event
        calls = []
        def validate(*args, **kwargs):
            self.assertFalse(self.db.in_transaction)
            with sqlite3.connect(self.path, timeout=0) as peer:
                peer.execute('BEGIN IMMEDIATE')
                peer.rollback()
            calls.append(True)
            return original(*args, **kwargs)
        with patch.object(research, 'validate_source_event', side_effect=validate):
            self.assertIsNotNone(research.claim(self.db, NOW, 'synthetic', 3))
        self.assertTrue(calls)

    def test_research_claim_batches_fresh_ownership_once_inside_writer_transaction(self):
        for index in range(12):
            event_id = self.supplemental(url=URL.replace('synthetic-', f'synthetic-{index}-'))
            self.save_copy(event_id)
        original = bridge.primary_owned_urls
        batches = []
        def ownership(db, urls):
            if db.in_transaction:
                batches.append(list(urls))
            return original(db, urls)
        with patch.object(bridge, 'primary_owned_urls', side_effect=ownership):
            self.assertIsNone(research.claim(self.db, NOW, 'synthetic', 50))
        self.assertEqual([len(batch) for batch in batches], [12])

    def test_inflight_headline_owner_arrival_rejects_copy_without_extra_call(self):
        self.supplemental()
        def transport(*_):
            self.primary()
            return {'status': 'completed', 'output_text': json.dumps({'titleJa': NOTE['title']['ja']})}
        self.assertEqual(translation.run_once(self.path, transport, ENV, NOW.timestamp()), 'stale')
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translations').fetchone()[0], 0)
        self.assertEqual([r[0] for r in self.db.execute('SELECT state FROM signal_headline_translation_calls')], ['stale'])

    def test_inflight_body_owner_arrival_rejects_copy_without_extra_call(self):
        event_id = self.supplemental()
        def transport(*_):
            self.primary()
            return response()
        self.assertEqual(research.run_once(self.path, transport, ENV, NOW.timestamp()), 'stale')
        self.assertEqual(self.db.execute('SELECT count(*) FROM official_research_publications').fetchone()[0], 0)
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT event_id,state FROM official_research_jobs')], [(event_id, 'stale')])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 1)

    def test_numeric_guard_rejects_synthetic_bad_copy_then_valid_copy_uses_normal_lane(self):
        self.supplemental()
        bad = json.loads(json.dumps(NOTE))
        bad['facts'][0]['ja'] = 'Alex Leeが9999人の製品チームを率いる予定。'
        def invalid(*_):
            return {'status': 'completed', 'output_text': json.dumps(bad)}
        self.assertEqual(research.run_once(self.path, invalid, ENV, NOW.timestamp()), 'retry')
        self.assertNotIn('bodyJa', self.feed()[0])
        self.assertEqual(research.run_once(self.path, response, ENV, NOW.timestamp()+61), 'done')
        self.assertIn('bodyJa', self.feed()[0])
        self.assertIn('bodyEn', self.feed()[0])
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 2)

    def test_metadata_date_wins_visible_prior_day_and_network_runs_without_writer_lock(self):
        self.supplemental()
        self.db.execute('DELETE FROM official_story_bodies')
        self.db.commit()
        document = (f'<html><head><link rel="canonical" href="{URL}"><meta property="og:title" content="{TITLE}">'
                    f'<meta property="article:published_time" content="{PUBLISHED}"></head><body>'
                    f'<article><h1>{TITLE}</h1><time>September 30, 2026</time><p>{BODY}</p></article></body></html>').encode()
        def request(*_):
            with sqlite3.connect(self.path, timeout=0) as peer:
                peer.execute('BEGIN IMMEDIATE')
                peer.rollback()
            return {'body': document}
        self.assertEqual(research.prepare_story_body(self.path, NOW, request), 'ready')
        proof = self.db.execute('SELECT published_on,source_url,source_title FROM official_story_body_proofs').fetchone()
        self.assertEqual(tuple(proof), ('2026-10-01', URL, TITLE))

    def test_owner_arriving_during_body_fetch_cannot_save_supplemental_body(self):
        self.supplemental()
        self.db.execute('DELETE FROM official_story_bodies')
        self.db.commit()
        def request(*_):
            self.primary()
            return {'body': (f'<html><head><link rel="canonical" href="{URL}"></head>'
                             f'<body><article><h1>{TITLE}</h1><p>{BODY}</p></article></body></html>').encode()}
        self.assertEqual(research.prepare_story_body(self.path, NOW, request), 'stale')
        self.assertEqual(self.db.execute('''SELECT count(*) FROM official_story_bodies b JOIN signal_events e
          ON e.id=b.event_id WHERE e.source_id='microsoft-blog' ''').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
