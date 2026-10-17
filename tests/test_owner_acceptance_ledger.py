"""Owner ledger pages remain bounded, live, source-bound and strictly read-only."""
from datetime import timedelta
import hashlib
import json
import sqlite3
import unittest
from unittest.mock import patch

import test_official_research_diagnostics as existing_tests
from test_official_research import NOW, NOTE
import official_research as research
import official_research_diagnostics as diagnostics


class OwnerAcceptanceLedgerTests(unittest.TestCase):
    setUp = existing_tests.OfficialResearchDiagnosticsTests.setUp
    queue = existing_tests.OfficialResearchDiagnosticsTests.queue

    def save_publication(self, row=None, at=None):
        row, at = row or self.row, at or NOW
        payload = json.dumps(NOTE)
        with research.connect(self.path) as db:
            db.execute('INSERT OR REPLACE INTO official_research_publications VALUES(?,?,?,?,?,?,?,?)',
                (row['id'], row['sha'], row['body_sha'], payload, 'private-evidence',
                 NOW.isoformat(), at.isoformat(), 1))
        return payload

    def test_static_candidate_set_pages_without_omissions_or_duplicates(self):
        rows = [{**self.row, 'id': index} for index in range(1, 108)]
        for row in rows[::2]:
            self.save_publication(row)
        with patch.object(research, 'candidates', return_value=rows):
            for view, expected in [('all', list(range(107, 0, -1))), ('pending', list(range(106, 0, -2)))]:
                ids, cursor = [], None
                while True:
                    page = self.queue(view=view, limit=20, before_event_id=cursor)
                    self.assertEqual(page['counts'], {'candidates': 107, 'validatedPublications': 54, 'pending': 53})
                    self.assertEqual(page['filteredTotal'], len(expected))
                    self.assertLessEqual(len(page['items']), 20)
                    meta = page['pagination']
                    self.assertEqual(meta['omitted'], len(expected) - len(page['items']))
                    self.assertEqual(meta['consistency'], 'fresh-read-per-page')
                    ids.extend(item['eventId'] for item in page['items'])
                    cursor = meta['nextBeforeEventId']
                    if cursor is None:
                        break
                self.assertEqual(ids, expected)
                self.assertEqual(len(ids), len(set(ids)))
                self.assertFalse(page['coverage']['completeSourceCoverage'])
                self.assertIsNone(page['coverage']['omittedOutsideWorkerSelection'])

    def test_status_and_retraction_are_rechecked_without_claiming_a_snapshot(self):
        first = self.queue(view='all', limit=1)
        self.assertEqual(first['items'][0]['status'], 'pending')
        self.save_publication()
        second = self.queue(view='all', limit=1)
        self.assertEqual(second['items'][0]['status'], 'validated-publication')
        self.assertEqual(self.queue()['items'], [])
        # The same continuation can now be empty after a source is held.
        cursor = self.row['id'] + 1
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE sources SET status='held'")
        third = self.queue(view='all', before_event_id=cursor)
        self.assertEqual(third['items'], [])
        self.assertEqual(third['counts']['candidates'], 0)
        self.assertEqual(third['pagination']['consistency'], 'fresh-read-per-page')

    def test_keyset_does_not_repeat_new_head_rows_and_shows_current_revision(self):
        rows = [{**self.row, 'id': index} for index in range(1, 5)]
        with patch.object(research, 'candidates', side_effect=lambda *_args, **_kwargs: list(rows)):
            page = self.queue(view='all', limit=2)
            self.assertEqual([i['eventId'] for i in page['items']], [4, 3])
            rows[:] = [{**rows[0], 'sha': 'updated-source', 'body_sha': 'updated-body'}, rows[2], rows[3], {**self.row, 'id': 5}]
            next_page = self.queue(view='all', limit=2, before_event_id=page['pagination']['nextBeforeEventId'])
            self.assertEqual([i['eventId'] for i in next_page['items']], [1])
            self.assertEqual(next_page['items'][0]['currentSha'], 'updated-source')
            self.assertEqual(next_page['items'][0]['bodySha'], 'updated-body')
            self.assertEqual(next_page['pagination']['outsideCursor'], 3)
            self.assertIsNone(next_page['pagination']['nextBeforeEventId'])

    def test_cursor_types_and_bounds_fail_closed(self):
        for key in ('before_event_id', 'terminal_before_event_id'):
            for value in (0, -1, True, 1.5, '2', diagnostics.MAX_EVENT_ID + 1):
                with self.subTest(key=key, value=value), self.assertRaisesRegex(ValueError, 'invalid-request'):
                    self.queue(**{key: value})
        self.assertEqual(self.queue(before_event_id=1)['items'], [])

    def test_source_date_is_not_fabricated_midnight_and_current_clock_is_not_first_time(self):
        self.save_publication()
        item = self.queue(view='all')['items'][0]
        self.assertEqual(item['sourceClock'], {'value': '2026-10-01', 'precision': 'date', 'basis': 'stored-source-date'})
        publication = item['publication']
        self.assertEqual(publication['publicAt'], NOW.isoformat())
        self.assertEqual(publication['publicId'], str(self.row['id']))
        self.assertEqual(publication['researchId'], 'ir-result-' + str(self.row['id']))
        self.assertEqual(publication['publicFeedPresence'], 'not-checked')
        self.assertEqual(publication['clockBasis'], 'current-validated-revision')
        for key in ('firstValidatedAt', 'firstRenderedAt', 'earliestAuditedPublicationAt', 'currentPayloadAuditedAt'):
            self.assertIsNone(publication[key])
        self.assertFalse(publication['historyComplete'])
        precise = {**self.row, 'source_id': 'x-fixture', 'published_on': None, 'published_at': NOW.isoformat()}
        self.assertEqual(diagnostics.source_clock(precise)['precision'], 'timestamp')
        for value in ('2026-10-01', '2026-10-01T14:00:00', 'invalid', None):
            self.assertEqual(diagnostics.source_clock({**precise, 'published_at': value})['precision'], 'unknown')
        for value in ('2026-02-30', '2026-10-01T00:00:00Z'):
            self.assertEqual(diagnostics.source_clock({**self.row, 'published_on': value})['precision'], 'unknown')
        # Even a populated bridge midnight is not a source timestamp.
        self.assertEqual(diagnostics.source_clock({**self.row, 'published_on': None, 'published_at': NOW.isoformat()})['precision'], 'unknown')

    def test_authoritative_old_audit_stays_distinct_from_current_corrected_publication(self):
        current = NOW + timedelta(minutes=15)
        payload = self.save_publication(at=current)
        with research.connect(self.path) as db:
            for lease, at, payload_sha, body_sha in (
                ('earlier', NOW, 'previous-validated-payload', self.row['body_sha']),
                ('current', current, hashlib.sha256(payload.encode()).hexdigest(), self.row['body_sha']),
                ('stale', NOW - timedelta(days=1), 'unrelated', 'old-body'),
            ):
                db.execute('INSERT INTO business_news_revalidations VALUES(?,?,?,?,?,?,?,?)',
                  (self.row['id'], self.row['sha'], body_sha, lease, 'original-failed-copy', payload_sha, '[]', at.isoformat()))
        publication = diagnostics.queue(self.path, view='all', reference=current)['items'][0]['publication']
        self.assertEqual(publication['publicAt'], current.isoformat())
        self.assertEqual(publication['earliestAuditedPublicationAt'], NOW.isoformat())
        self.assertEqual(publication['currentPayloadAuditedAt'], current.isoformat())
        self.assertIsNone(publication['firstValidatedAt'])
        self.assertIsNone(publication['firstRenderedAt'])
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE business_news_revalidations SET validated_payload_sha='wrong' WHERE failure_lease='current'")
        publication = diagnostics.queue(self.path, view='all', reference=current)['items'][0]['publication']
        self.assertIsNone(publication['currentPayloadAuditedAt'])
        self.assertEqual(publication['earliestAuditedPublicationAt'], NOW.isoformat())
        with research.connect(self.path) as db:
            saved = db.execute('SELECT * FROM official_research_publications').fetchone()
            later_body = {**self.row, 'body_at': (current + timedelta(minutes=5)).isoformat()}
            historical = diagnostics.publication_history(db,later_body,saved,True,current + timedelta(minutes=10))
        self.assertEqual(historical['earliestAuditedPublicationAt'], NOW.isoformat())
        self.assertIsNone(historical['firstValidatedAt'])

    def test_invalid_current_or_future_publication_never_gets_public_identity_or_clock(self):
        self.save_publication(at=NOW + timedelta(minutes=1))
        # Exercise the existing precise-clock business lane without changing
        # the legacy primary lane's publication/pending classification.
        with patch.object(research, 'candidates', return_value=[{**self.row, 'general_source': True}]), \
             patch.object(diagnostics, 'validation_report', return_value={'status': 'valid', 'issues': []}):
            item = self.queue(view='all')['items'][0]
        self.assertEqual(item['status'], 'pending')
        self.assertIsNone(item['publication']['publicAt'])
        self.assertIsNone(item['publication']['publicId'])
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE official_research_publications SET sha='stale'")
        self.assertFalse(self.queue(view='all')['items'][0]['publication']['currentRevision'])

    def test_every_page_is_read_only_with_no_generation_network_or_schema_calls(self):
        self.save_publication()
        with sqlite3.connect(self.path) as db:
            before = list(db.iterdump())
        with patch.object(research, 'run_once', side_effect=AssertionError('generation')), \
             patch.object(research.signals, 'fetch', side_effect=AssertionError('network')), \
             patch.object(research.brief_generator, 'request_response', side_effect=AssertionError('model')), \
             patch.object(research, 'schema', side_effect=AssertionError('schema')), \
             patch.object(research.bridge, 'sync', side_effect=AssertionError('sync')):
            self.queue(view='all', before_event_id=self.row['id'] + 1)
            self.queue(view='all', before_event_id=self.row['id'], terminal_before_event_id=self.row['id'])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(list(db.iterdump()), before)

    def test_legacy_clock_presentation_fails_closed_without_changing_pending_counts(self):
        for value in ('invalid', '2026-02-30T12:00:00Z', '2026-10-01',
                      '2026-10-01T14:00:00', '2026-10-01T15:39:00+00:99',
                      '20261001T140000Z', '2026-10-01T14Z',
                      (NOW + timedelta(minutes=1)).isoformat()):
            with self.subTest(value=value):
                self.save_publication()
                with sqlite3.connect(self.path) as db:
                    db.execute('UPDATE official_research_publications SET public_at=?',(value,))
                result=self.queue(view='all')
                item=result['items'][0]
                self.assertEqual(result['counts']['pending'],0)
                self.assertEqual(item['status'],'validated-publication')
                self.assertIsNone(item['publication']['publicAt'])
                self.assertEqual(item['publication']['clockBasis'],'unavailable')
                self.assertIsNone(item['publication']['earliestAuditedPublicationAt'])

    def test_stored_clock_grammar_rejects_normalized_offsets_and_noncanonical_iso(self):
        invalid = ('2026-10-01T15:39:00+00:99', '2026-10-01T15:00:00+00:60',
                   '2026-10-01T14:00:00-00:99', '2026-10-01T14:00:00+24:00',
                   '2026-10-01T14:00:00+99:00', '2026-10-01T14:00:00+0000',
                   '20261001T140000Z', '2026-10-01T14Z', '2026-10-01T14:00Z',
                   '2026-10-01T140000Z', '2026-10-01 14:00:00Z',
                   '2026-10-01T24:00:00Z', '2026-10-01T14:00:60Z',
                   '2026-02-30T14:00:00Z', '2026-10-01T14:00:00Z\n')
        for value in invalid:
            with self.subTest(value=value):
                self.assertIsNone(diagnostics.parse_stored_clock(value))
                source={**self.row,'source_id':'x-fixture','published_on':None,'published_at':value}
                self.assertEqual(diagnostics.source_clock(source)['precision'],'unknown')
                saved={'started_at':NOW.isoformat(),'public_at':value}
                self.assertIsNone(diagnostics.stored_publication_clock(saved,self.row,True,NOW))
        for value in ('2026-10-01T14:00:00Z', '2026-10-01T14:00:00+00:00',
                      '2026-10-01T23:00:00+09:00', '2026-10-01T07:00:00-07:00',
                      '2026-10-01T14:00:00.000000Z'):
            with self.subTest(value=value):
                self.assertEqual(diagnostics.parse_stored_clock(value),NOW)
                saved={'started_at':NOW.isoformat(),'public_at':value}
                self.assertEqual(diagnostics.stored_publication_clock(saved,self.row,True,NOW),value)
