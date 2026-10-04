"""Offline checks through the real service adapter and synthetic HTTP responses."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import format_datetime
from html import escape
import hashlib
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import feed_category_admission as gate
import official_research
import service

# test_research_service replaces sys.modules['signals'] during discovery. All
# patches and lazy imports here must use the actual research module graph.
signals = official_research.signals

URL = 'https://news.skhynix.com/en/synthetic-service-story/'
TITLE = 'SK hynix announces semiconductor research platform'
BODY = ('SK hynix announced a semiconductor research platform. '
        'The platform supports research by semiconductor companies. ') * 15
POLICY = {'version': 1, 'allowAny': ['STORY'], 'denyAny': ['Media'], 'maxAgeSeconds': 900}
LAST_MODIFIED = 'Sun, 04 Oct 2026 11:00:00 GMT'


class SyntheticResponse:
    def __init__(self, body, url, etag='"current-feed"'):
        self.content = io.BytesIO(body)
        self.url = url
        self.headers = Message()
        self.headers['Content-Type'] = 'application/rss+xml'
        self.headers['ETag'] = etag
        self.headers['Last-Modified'] = LAST_MODIFIED

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.content.close()

    def read(self, size):
        return self.content.read(size)

    def geturl(self):
        return self.url


class SkhynixServiceRoutingTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(sys.modules, {'signals': signals}))
        self.enterContext(patch.object(service, 'signals', signals))
        self.enterContext(patch.object(gate, 'signals', signals))
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'service.sqlite'
        self.db = official_research.connect(self.path)
        self.addCleanup(self.db.close)
        self.source = next(source for source in signals.SOURCES if source['id'] == 'skhynix-news')
        self.assertEqual(self.source['publisherArticleCategories'], POLICY)
        original_source = deepcopy(self.source)
        def restore_source():
            self.source.clear()
            self.source.update(original_source)
        self.addCleanup(restore_source)
        # Keep the original list identity: default reader arguments point to it.
        self.sources = signals.SOURCES
        original_sources = list(self.sources)
        self.addCleanup(self.sources.__setitem__, slice(None), original_sources)
        self.enterContext(patch.dict('os.environ', {'X_FILTERED_STREAM_ENABLED': '0',
                                                  'RESEARCH_AUTO_DRAFTS': '0',
                                                  'RESEARCH_TICKERS': ''}))
        self.app = service.AutomaticMonitor(self.path, Path(self.tmp.name) / 'snapshot.json')
        self.assertEqual(self.app.tickers, service.configured_tickers(''))
        self.assertEqual(len(self.app.tickers), 22)
        self.now = datetime.now(timezone.utc) - timedelta(seconds=5)
        self.original_check = signals.check
        self.enterContext(patch.object(signals, 'build_opener', side_effect=AssertionError('network forbidden')))

    def feed(self, categories=('STORY',), body=BODY):
        published = format_datetime(self.now - timedelta(hours=1))
        terms = ''.join('<category>' + escape(term) + '</category>' for term in categories)
        return (f'<rss><channel><item><title>{TITLE}</title><link>{URL}</link>'
                f'<pubDate>{published}</pubDate>{terms}<description>{escape(body)}</description>'
                '</item></channel></rss>').encode()

    def assert_unlocked(self):
        acquired = self.app.db_lock.acquire(blocking=False)
        if acquired:
            self.app.db_lock.release()
        self.assertTrue(acquired, 'network and parsing must not hold the service database lock')

    def poll(self, *, categories=('STORY',), body=None, at=None, opener=None, etag='"current-feed"'):
        requests, results = [], []
        test = self

        class Opener:
            def open(self, request, **kwargs):
                test.assert_unlocked()
                requests.append({key.lower(): value for key, value in request.header_items()})
                if opener:
                    return opener(request)
                return SyntheticResponse(body if body is not None else test.feed(categories), request.full_url, etag)

        def checked(*args, **kwargs):
            result = self.original_check(*args, **kwargs)
            results.append(result)
            return result

        with patch.object(signals, 'build_opener', return_value=Opener()), \
                patch.object(signals, 'stamp', return_value=(at or self.now).isoformat()), \
                patch.object(signals, 'check', side_effect=checked):
            self.app.check_signal_source(self.source)
        self.assertEqual(len(requests), 1, 'one service invocation must make one ordinary feed request')
        self.assertEqual(len(results), 1)
        return results[0], requests[0]

    def not_modified(self, request):
        raise HTTPError(request.full_url, 304, 'Not Modified', Message(), io.BytesIO())

    def row(self):
        row = self.db.execute('SELECT * FROM signal_events WHERE url=? ORDER BY id DESC', (URL,)).fetchone()
        return dict(row) if row else None

    def route(self):
        row = self.db.execute('SELECT * FROM signal_routes WHERE id=?', (self.source['id'],)).fetchone()
        return dict(row) if row else None

    def state(self):
        tables = ('signal_routes', 'signal_events', 'signal_documents',
                  'signal_feed_category_snapshots', 'signal_feed_category_heads',
                  'signal_category_evidence', 'signal_category_evidence_heads', 'signal_category_decisions',
                  'signal_route_transitions', 'signal_route_recoveries', 'signal_route_retry_attempts',
                  'official_story_bodies', 'official_research_attempt_failures')
        return {table: [dict(row) for row in self.db.execute('SELECT * FROM ' + table + ' ORDER BY rowid')]
                for table in tables}

    def public(self, at=None):
        return [item for item in signals.public_official_updates(self.db,
                reference=at or self.now, read_only=True, include_bodies=False) if item['url'] == URL]

    def seed_legacy(self, *, old_config=False):
        first = (self.now - timedelta(minutes=30)).isoformat()
        observed = (self.now - timedelta(minutes=20)).isoformat()
        with self.db:
            old = signals.parse(self.source, self.feed(body=BODY.replace('platform', 'earlier platform')), self.app.tickers)
            signals.save_evidence(self.db, self.source, old, {}, first, initial=True)
            self.db.execute('UPDATE signal_events SET id=1138')
            current = signals.parse(self.source, self.feed(), self.app.tickers)
            signals.save_evidence(self.db, self.source, current, {}, observed)
            self.db.execute('UPDATE signal_events SET id=1139 WHERE id<>1138')
            self.db.execute('''INSERT INTO signal_routes(id,initialized,checked_at,succeeded_at,
                next_check_at,etag,last_modified,config_sha,last_duration_ms,matched_items)
                VALUES(?,1,?,?,?,?,?,?,17,1)''',
                (self.source['id'], observed, observed, observed, '"legacy-feed"', LAST_MODIFIED,
                 'legacy-config-before-category-policy' if old_config else signals.fingerprint(self.source, self.app.tickers)))
            event = self.row()
            self.db.execute('INSERT INTO official_story_bodies VALUES(?,?,?,?,?,?,NULL)',
                (1139, event['sha'], hashlib.sha256(BODY.encode()).hexdigest(), BODY, observed,
                 (self.now + timedelta(hours=1)).timestamp()))
            self.db.execute('''INSERT INTO official_research_attempt_failures
                (lease,event_id,sha,failed_at,reason,detail,payload) VALUES(?,?,?,?,?,?,?)''',
                ('synthetic-previous-attempt', 1139, event['sha'], observed,
                 'synthetic-prior-failure', 'Retained test history', '{}'))
        return self.state()

    def assert_no_validators(self, headers):
        self.assertNotIn('if-none-match', headers)
        self.assertNotIn('if-modified-since', headers)

    def test_initialized_legacy_200_retains_event_1139_clocks_and_research_history(self):
        before = self.seed_legacy(old_config=True)
        self.assertEqual(self.public(), [])
        result, headers = self.poll()
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['events'], 0)
        self.assert_no_validators(headers)
        after = self.state()
        for table in ('signal_events', 'official_story_bodies', 'official_research_attempt_failures'):
            self.assertEqual(after[table], before[table], table)
        document_before, document_after = before['signal_documents'][0], after['signal_documents'][0]
        self.assertEqual(document_after, {**document_before, 'last_seen_at': self.now.isoformat()})
        self.assertEqual(self.row()['id'], 1139)
        self.assertEqual([item['id'] for item in self.public()], ['1139'])
        self.assertTrue(gate.decision(self.db, self.source, self.app.tickers, self.row(),
                                     self.now, require_fresh=True)['admitted'])
        rows = official_research.candidates(self.db, self.now)
        candidate = next(row for row in rows if row['id'] == 1139)
        self.assertTrue(official_research.current_revision(self.db, candidate,
                       reference=self.now, require_fresh_category=True))
        self.assertEqual(self.db.execute('SELECT count(*) FROM signal_headline_translation_calls').fetchone()[0], 0)

    def test_legacy_unexpected_304_then_normal_200_recovers_without_state_edits(self):
        before = self.seed_legacy()
        result, headers = self.poll(opener=self.not_modified)
        self.assertEqual(result['status'], 'error')
        self.assert_no_validators(headers)
        self.assertIsNone(gate.head(self.db, self.source['id']))
        self.assertEqual(self.public(), [])
        retry_at = datetime.fromisoformat(self.route()['next_check_at'])
        with patch.object(signals, 'stamp', return_value=(retry_at - timedelta(milliseconds=1)).isoformat()):
            self.assertNotIn(self.source['id'], [source['id'] for source in signals.due(self.db)])
        with patch.object(signals, 'stamp', return_value=retry_at.isoformat()):
            self.assertIn(self.source['id'], [source['id'] for source in signals.due(self.db)])
        # No DB/config repair or forced premature check: the next scheduled
        # service invocation establishes its own durable proof by a full poll.
        result, headers = self.poll(at=retry_at)
        self.assertEqual(result['status'], 'ok')
        self.assert_no_validators(headers)
        self.assertEqual(self.state()['signal_events'], before['signal_events'])
        self.assertEqual(self.route()['failures'], 0)
        self.assertIsNone(self.route()['error'])
        self.assertEqual([item['id'] for item in self.public(at=retry_at)], ['1139'])

    def test_same_config_missing_proof_does_not_send_legacy_validators(self):
        self.seed_legacy()
        result, headers = self.poll()
        self.assertEqual(result['status'], 'ok')
        self.assert_no_validators(headers)
        self.assertEqual(len(self.public()), 1)

    def test_parser_migration_forces_one_full_poll_then_bound_304(self):
        self.assertEqual(self.poll()[0]['status'], 'ok')
        event = self.row()
        with patch.object(gate, 'PARSER_VERSION', gate.PARSER_VERSION + 1):
            result, headers = self.poll(at=self.now + timedelta(seconds=1))
            self.assertEqual(result['status'], 'ok')
            self.assert_no_validators(headers)
            result, headers = self.poll(opener=self.not_modified, at=self.now + timedelta(seconds=2))
            self.assertEqual(result['status'], 'unchanged')
            self.assertEqual(headers['if-none-match'], '"current-feed"')
            self.assertEqual(headers['if-modified-since'], LAST_MODIFIED)
            self.assertEqual(self.row(), event)

    def test_valid_bound_304_renews_only_category_and_route_clocks(self):
        self.assertEqual(self.poll()[0]['status'], 'ok')
        before = self.state()
        head = gate.head(self.db, self.source['id'])
        later = self.now + timedelta(seconds=2)
        result, headers = self.poll(opener=self.not_modified, at=later)
        self.assertEqual(result['status'], 'unchanged')
        self.assertEqual(headers['if-none-match'], '"current-feed"')
        self.assertEqual(headers['if-modified-since'], LAST_MODIFIED)
        after = self.state()
        for table in ('signal_events', 'signal_documents', 'signal_feed_category_snapshots'):
            self.assertEqual(after[table], before[table], table)
        current = gate.head(self.db, self.source['id'])
        self.assertEqual(current, {**head, 'generation': head['generation'] + 1,
                                  'confirmed_at': later.isoformat()})
        self.assertEqual(self.route()['succeeded_at'], later.isoformat())

    def delayed_response(self, kind):
        self.assertEqual(self.poll()[0]['status'], 'ok')
        newer = []

        def delayed(request):
            self.assertEqual(self.poll(categories=('Media',), at=self.now + timedelta(seconds=1),
                                       etag='"newer-media"')[0]['status'], 'ok')
            newer.append(self.state())
            if kind == '304':
                return self.not_modified(request)
            if kind == 'transport':
                raise HTTPError(request.full_url, 403, 'Forbidden', Message(), io.BytesIO())
            body = b'<rss><broken>' if kind == 'xml' else self.feed()
            return SyntheticResponse(body, request.full_url, '"late-story"')

        result, _ = self.poll(opener=delayed, at=self.now + timedelta(seconds=2))
        self.assertEqual(result['status'], 'deferred')
        self.assertEqual(result['reason'], 'superseded-feed-response')
        self.assertEqual(self.state(), newer[0], 'late response changed newer success/history')
        self.assertEqual(self.public(at=self.now + timedelta(seconds=2)), [])
        self.assertEqual(gate.decision(self.db, self.source, self.app.tickers, self.row(),
                        self.now + timedelta(seconds=2))['reason'], 'publisher-excluded-category')

    def test_slower_story_200_cannot_restore_after_newer_media(self):
        self.delayed_response('200')

    def test_slower_304_cannot_renew_or_overwrite_newer_success(self):
        self.delayed_response('304')

    def test_slower_transport_failure_cannot_overwrite_newer_success(self):
        self.delayed_response('transport')

    def test_slower_xml_failure_cannot_overwrite_newer_success(self):
        self.delayed_response('xml')

    def changed_during_http(self, change):
        self.assertEqual(self.poll()[0]['status'], 'ok')
        before = self.state()
        frozen = []
        acquire = signals.acquire

        def acquiring(source, validators, tickers):
            frozen.append((source, tickers))
            return acquire(source, validators, tickers)

        def changed(request):
            change()
            self.assertIsNot(frozen[0][0], self.source)
            self.assertIsInstance(frozen[0][1], tuple)
            self.assertIn('SKHY', frozen[0][1])
            self.assertEqual(frozen[0][0]['publisherArticleCategories'], POLICY)
            return SyntheticResponse(self.feed(body=BODY + ' A changed synthetic body.'), request.full_url)

        with patch.object(signals, 'acquire', side_effect=acquiring):
            result, _ = self.poll(opener=changed, at=self.now + timedelta(seconds=1))
        self.assertEqual(result['status'], 'deferred')
        self.assertEqual(result['reason'], 'source-identity-changed')
        self.assertEqual(self.state(), before, 'changed request identity committed response or error state')

    def test_source_configuration_replacement_during_http_is_rejected(self):
        def replace():
            index = self.sources.index(self.source)
            self.sources[index] = {**deepcopy(self.source), 'url': self.source['url'] + '?edition=changed'}
        self.changed_during_http(replace)

    def test_source_disable_during_http_is_rejected(self):
        self.changed_during_http(lambda: self.source.update(enabled=False))

    def test_nested_policy_mutation_during_http_uses_frozen_source(self):
        self.changed_during_http(lambda: self.source['publisherArticleCategories']['allowAny'].append('OTHER'))

    def test_ticker_mutation_during_http_uses_frozen_tickers(self):
        self.changed_during_http(lambda: self.app.tickers.remove('SKHY'))

    def test_ticker_replacement_during_http_is_rejected(self):
        self.changed_during_http(lambda: setattr(self.app, 'tickers', ['NVDA']))

    def test_network_and_category_parse_are_unlocked_and_writer_is_locked(self):
        stages = []
        prepare, persist = gate.prepare, gate.persist_200

        def parsing(*args, **kwargs):
            self.assert_unlocked()
            self.assertIsInstance(args[1], bytes, 'taxonomy parser must receive the raw HTTP body')
            stages.append('parse')
            return prepare(*args, **kwargs)

        def writing(db, *args, **kwargs):
            self.assertTrue(self.app.db_lock.locked())
            self.assertTrue(db.in_transaction)
            stages.append('write')
            return persist(db, *args, **kwargs)

        with patch.object(gate, 'prepare', side_effect=parsing), \
                patch.object(gate, 'persist_200', side_effect=writing):
            result, _ = self.poll()
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(stages, ['parse', 'write'])
        self.assertFalse(self.app.db_lock.locked())
        self.assertEqual(len(self.public()), 1)


if __name__ == '__main__':
    unittest.main()
