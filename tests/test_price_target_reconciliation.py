"""Retained targets remain visible even when strict publication has no work."""
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import os
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import price_target_reconciliation as reconciliation
import signals
reconciliation_report = reconciliation.report


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        signals.schema(self.db)
        self.now = datetime(2026, 10, 3, 6, tzinfo=timezone.utc)
        self.source = next(source for source in signals.SOURCES if source['id'] == 'x-wallstengine')

    def tearDown(self):
        self.db.close()

    def add(self, number, text='$MU PT raised to $110 from $100 at Citi', *, days=1,
            event=True, acquired=True, selected=True, url=None, sha=None, observed=None,
            published=None, truncated=False, kind='new', source=None):
        source = source or self.source['id']
        url = url or f'https://x.com/wallstengine/status/{number}'
        sha = sha or hashlib.sha256(text.encode()).hexdigest()
        published = published or (self.now-timedelta(days=days)).isoformat()
        observed = observed or (self.now-timedelta(days=days)+timedelta(seconds=2)).isoformat()
        title = ' '.join(text.split())[:500]
        if acquired:
            self.db.execute('INSERT INTO signal_x_acquisition VALUES(?,?,?,?,?,?,?,?,?,?)',
                            (source, url, sha, title, text, published, observed, observed, int(truncated), int(selected)))
        if event:
            self.db.execute('''INSERT INTO signal_events
                (id,source_id,url,sha,title,tickers_json,matches_json,event_kind,
                 published_at,observed_at,excerpt,diff,truncated)
                VALUES(?,?,?,?,?,'["MU"]','{}',?,?,?,'PRIVATE EXCERPT','PRIVATE DIFF',?)''',
                (number,source,url,sha,title,kind,published,observed,int(truncated)))
            self.db.execute('''INSERT INTO signal_documents VALUES(?,?,?,?,?,?,?)
                ON CONFLICT(source_id,url) DO UPDATE SET sha=excluded.sha,text=excluded.text''',
                (source,url,sha,title,text,observed,observed))
        return sha

    def report(self):
        return reconciliation.report(self.db, now=self.now)

    def test_broad_discovery_catches_unknown_broker_and_grammar_with_zero_eligible(self):
        self.add(1, '$MU PT raised to $110 from $100 at Unfamiliar Securities')
        self.add(2, '$MU price target rocketed to $120 from $100 at Citi')
        self.add(3, '$MU price objective lifted to $120 from $100 at New Bank')
        result = self.report()
        self.assertEqual(result['counts']['eligibleActions'], 0)
        self.assertEqual(result['counts']['rejectedPosts'], 3)
        self.assertEqual(result['reasons'], {'firm-not-recognized':1,'not-target':1,'unsupported-target-syntax':1})
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])

    def test_seven_day_publication_window_does_not_change_24_hour_summary(self):
        self.add(1, days=2)
        self.add(2, days=8)
        before = signals.price_target_publication_summary(self.db, now=self.now)
        result = self.report()
        self.assertEqual(result['counts']['publishedPosts'], 1)
        self.assertEqual(result['windowDays'], 7)
        self.assertEqual(result['windowBasis'], 'publishedAt')
        self.assertEqual(result['excludedRetainedReasons'], {'outside-publication-window':1})
        self.assertEqual(signals.price_target_publication_summary(self.db, now=self.now), before)
        self.assertEqual(before['candidatePosts'], 0)

    def test_exact_boundary_offsets_and_future_observation(self):
        boundary = (self.now-timedelta(days=7)).astimezone(timezone(timedelta(hours=9))).isoformat()
        self.add(1, published=boundary, days=7)
        self.add(2, published=(self.now+timedelta(seconds=1)).isoformat())
        self.add(3, observed=(self.now+timedelta(seconds=1)).isoformat())
        result = self.report()
        self.assertEqual(result['counts']['candidateRevisionRows'], 2)
        self.assertEqual(result['reasons']['future-observation'], 1)
        self.assertEqual(result['counts']['publishedPosts'], 1)

    def test_submillisecond_future_publication_is_not_reintroduced_by_sql_rounding(self):
        self.add(1, published=(self.now+timedelta(microseconds=1)).isoformat(), observed=self.now.isoformat())
        result = self.report()
        self.assertEqual(result['counts']['candidateRevisionRows'], 0)
        self.assertEqual(result['excludedRetainedReasons'], {'outside-publication-window': 1})

    def test_acquisition_only_selection_is_not_publication(self):
        self.add(1, event=False, selected=False)
        self.add(2, event=False, selected=True)
        result = self.report()
        self.assertEqual(result['counts']['unpublishedPosts'], 2)
        self.assertEqual(result['counts']['acquisitionOnlyGapRows'], 2)
        self.assertEqual(result['reasons'], {'selected-no-matching-event':1,'unselected-no-matching-event':1})
        self.assertEqual(result['counts']['eligibleActions'], 0)

    def test_missing_acquisition_provenance_does_not_hide_public_action(self):
        self.add(1, acquired=False)
        result = self.report()
        self.assertEqual(result['counts']['publishedPosts'], 1)
        self.assertEqual(result['counts']['eventWithoutRetainedAcquisitionRows'], 1)
        self.assertFalse(result['records'][0]['acquisitionRetained'])

    def test_correction_current_document_sha_supersedes_target_without_fake_event(self):
        sha = self.add(1)
        url = 'https://x.com/wallstengine/status/1'
        self.add(2, 'This report has been withdrawn.', url=url, event=False, days=0.5)
        self.db.execute("UPDATE signal_documents SET sha=?,text='This report has been withdrawn.'", ('b'*64,))
        result = self.report()
        self.assertEqual(result['counts']['candidateRevisionRows'], 1)
        self.assertEqual(result['counts']['supersededRevisionRows'], 1)
        self.assertEqual(result['counts']['rejectedPosts'], 1)
        self.assertEqual(result['records'][0]['sha'], sha)
        self.assertEqual(result['records'][0]['reason'], 'superseded-revision')

    def test_exact_revision_join_does_not_claim_new_acquisition_was_processed(self):
        url = 'https://x.com/wallstengine/status/1'
        self.add(1, url=url)
        self.add(2, '$MU PT raised to $120 from $100 at Citi', url=url, event=False, days=0.5)
        self.db.execute('DELETE FROM signal_documents')
        result = self.report()
        self.assertEqual(result['counts']['candidateRevisionRows'], 2)
        self.assertEqual(result['counts']['uniqueSourcePosts'], 1)
        self.assertEqual(result['counts']['unpublishedPosts'], 1)
        self.assertIn('selected-no-matching-event', result['reasons'])

    def test_newer_acquisition_with_old_document_is_a_gap_not_two_superseded_rows(self):
        url = 'https://x.com/wallstengine/status/1'
        self.add(1, url=url)
        self.add(2, '$MU PT raised to $120 from $100 at Citi', url=url, event=False, days=0.5)
        result = self.report()
        self.assertEqual(result['counts']['supersededRevisionRows'], 1)
        self.assertEqual(result['counts']['acquisitionOnlyGapRows'], 1)
        self.assertEqual(result['counts']['unpublishedPosts'], 1)
        self.assertEqual(result['reasons']['published-superseded-retained-revision'], 1)
        current = next(record for record in result['records'] if record['currentRevision'])
        self.assertEqual(current['reason'], 'selected-no-matching-event')

    def test_repeated_acquisition_reversion_uses_last_seen_not_original_first_seen(self):
        url = 'https://x.com/wallstengine/status/1'
        original = self.add(1, url=url)
        self.add(2, '$MU PT raised to $120 from $100 at Citi', url=url, days=0.5)
        recent = (self.now-timedelta(minutes=1)).isoformat()
        self.db.execute('UPDATE signal_x_acquisition SET last_seen_at=? WHERE sha=?', (recent,original))
        self.db.execute('UPDATE signal_documents SET sha=?,text=?,last_seen_at=?',
                        (original, '$MU PT raised to $110 from $100 at Citi',recent))
        result = self.report()
        restored = next(record for record in result['records'] if record['sha']==original)
        self.assertTrue(restored['currentRevision'])
        self.assertEqual(restored['disposition'], 'published')
        self.assertEqual(result['counts']['supersededRevisionRows'], 1)

    def test_duplicates_and_aliases_count_posts_revisions_and_actions_separately(self):
        self.add(1, '$MU PT raised to $110 from $100 at BofA')
        self.add(2, '$MU PT raised to $110 from $100 at Bank of America')
        self.add(3, '$MU PT raised to $110 from $100 at BofA', days=2)
        result = self.report()
        self.assertEqual(result['counts']['uniqueSourcePosts'], 3)
        self.assertEqual(result['counts']['candidateRevisionRows'], 3)
        self.assertEqual(result['counts']['eligibleActions'], 2)
        self.assertEqual(result['counts']['publishedPosts'], 3)

    def test_cross_route_duplicate_is_one_source_post(self):
        url = 'https://x.com/TipRanks/status/1'
        self.add(1, url=url)
        self.add(2, url=url, source='x-tipranks')
        result = self.report()
        self.assertEqual(result['counts']['uniqueSourcePosts'], 1)
        self.assertEqual(result['counts']['candidateRevisionRows'], 2)
        self.assertEqual(result['counts']['eligibleActions'], 1)
        self.assertEqual(result['counts']['publishedPosts'], 1)

    def test_feed_cap_and_record_cap_do_not_hide_aggregate_counts(self):
        for number in range(1, 56):
            self.add(number, f'$MU PT raised to ${100+number} from $100 at Citi')
        result = self.report()
        self.assertEqual(result['counts']['eligibleActions'], 55)
        self.assertEqual(result['counts']['returnedActions'], 20)
        self.assertEqual(result['counts']['actionsOutsideFeedLimit'], 35)
        self.assertEqual(result['counts']['publishedPosts'], 20)
        self.assertEqual(result['counts']['unpublishedPosts'], 35)
        self.assertEqual(len(result['records']), 50)
        self.assertTrue(result['recordsTruncated'])
        self.assertEqual(result['reasons']['public-feed-limit'], 35)
        self.assertEqual(len(signals.public_price_targets(self.db, now=self.now)['items']), 20)

    def test_safe_records_never_return_copy_arbitrary_errors_or_unsafe_urls(self):
        self.add(1, 'SECRET BODY $MU PT raised to $110 from $100 at Citi')
        self.add(2, event=False, url='https://x.com/wallstengine/status/2?secret=TOKEN')
        result = self.report()
        raw = json.dumps(result)
        for secret in ('SECRET BODY', 'PRIVATE EXCERPT', 'PRIVATE DIFF', 'TOKEN', '?secret=', 'Citi'):
            self.assertNotIn(secret, raw)
        self.assertIsNone(next(row for row in result['records'] if row['reason']=='source-url-not-approved')['url'])
        self.assertFalse(result['coverage']['browserDeliveryVerified'])
        self.assertFalse(result['coverage']['completeUpstreamCoverage'])
        self.assertEqual(result['coverage']['rowsPerSourceLimit'], 1000)

    def test_invalid_or_naive_timestamps_do_not_crash_or_become_public(self):
        self.add(1, published='2026-10-02T05:00:00')
        self.add(2, event=False, observed='not-a-time')
        result = self.report()
        self.assertIn('invalid-publication-timestamp', result['excludedRetainedReasons'])
        self.assertIn('invalid-timestamp', result['reasons'])
        self.assertIn('invalid-observation-timestamp', result['reasons'])
        self.assertEqual(result['counts']['publishedPosts'], 0)

    def test_report_is_read_only_and_does_not_initialize_schema(self):
        self.add(1)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'saved.sqlite'
            with sqlite3.connect(path) as target:
                self.db.commit()
                self.db.backup(target)
            with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
                db.row_factory=sqlite3.Row
                with patch.object(signals, 'schema', side_effect=AssertionError('unexpected-write')):
                    result = reconciliation.report(db, now=self.now)
                self.assertEqual(result['counts']['publishedPosts'], 1)
                self.assertEqual(db.total_changes, 0)

    def test_private_queue_summary_is_independent_of_empty_page_filters(self):
        import service
        self.add(1, '$MU PT raised to $110 from $100 at Unfamiliar Securities')
        app = SimpleNamespace(db_lock=threading.Lock(), db_path='unused',
                              signals_enabled=True, tickers=['MU'], signals_thread=Mock())
        with patch.object(service.monitor, 'connect', return_value=self.db), \
                patch.object(reconciliation, 'report', wraps=lambda db: reconciliation_report(db, now=self.now)):
            result = service.AutomaticMonitor.signal_queue(app, limit=1, view='changed', ticker='NVDA')
        self.assertEqual(result['items'], [])
        self.assertEqual(result['priceTargetReconciliation']['reasons'], {'firm-not-recognized': 1})

    def test_existing_signals_http_route_requires_editor_token(self):
        import service
        queue = Mock(return_value={'items': [], 'priceTargetReconciliation': self.report()})
        server = service.ThreadingHTTPServer(('127.0.0.1', 0), service.Handler)
        server.app = SimpleNamespace(signal_queue=queue)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}/admin/signals'
        try:
            with patch.dict(os.environ, {'RESEARCH_EDITOR_TOKEN': 'synthetic-editor-token',
                                         'RESEARCH_API_TOKEN': 'synthetic-api-token'}):
                for auth in [None, 'Bearer wrong', 'Bearer synthetic-api-token']:
                    with self.assertRaises(HTTPError) as error:
                        urlopen(Request(url, headers={'Authorization':auth} if auth else {}), timeout=2)
                    self.assertEqual(error.exception.code, 401)
                queue.assert_not_called()
                with urlopen(Request(url, headers={'Authorization':'Bearer synthetic-editor-token'}), timeout=2) as response:
                    payload = json.loads(response.read())
                    self.assertTrue(payload['priceTargetReconciliation']['readOnly'])
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                queue.assert_called_once_with(20, 'all', None)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_retention_cap_is_disclosed_without_claiming_complete_window(self):
        for number in range(1, 1001):
            self.add(number, text='Ordinary retained post', event=False)
        result = self.report()
        self.assertEqual(result['coverage']['acquisitionSourcesAtRetentionCap'], 1)
        self.assertEqual(result['counts']['retainedAcquisitionRevisionRows'], 1000)
        self.assertFalse(result['coverage']['completeUpstreamCoverage'])

    def test_service_addition_does_not_enter_public_state(self):
        service_source = (Path(__file__).resolve().parents[1]/'scripts/research/service.py').read_text()
        self.assertEqual(service_source.count('price_target_reconciliation.report(db)'), 1)
        private_method = service_source.split('    def signal_queue(',1)[1].split('    def public_price_targets(',1)[0]
        self.assertIn('price_target_reconciliation.report(db)', private_method)


if __name__ == '__main__':
    unittest.main()
