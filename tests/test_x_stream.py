"""Deterministic isolated fixtures. No X account, credentials or network needed."""
import asyncio
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import monitor
import signals
import x_api
import x_budget
import x_stream

NOW = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
TEXT = '$MU price target raised to $200 from $180 at Citi'


def policy(now=NOW, **overrides):
    return dict(cycle_id='synthetic-cycle', cycle_start='2026-09-25T00:00:00Z',
                cycle_end='2026-10-25T00:00:00Z', verified_at=now.isoformat(),
                baseline_micros=1_230_000, cycle_limit_micros=18_000_000,
                daily_limit_micros=1_000_000, account_cap_micros=20_000_000,
                reserve_micros=2_000_000, all_consumers_identified=True,
                spend_reconciled=True, prices_verified=True) | overrides


def envelope(identity='100', text=TEXT, username='TipRanks', rules=('1',), published=None):
    return {'data': {'id': identity, 'author_id': '10', 'text': text,
                     'created_at': (published or NOW-timedelta(seconds=10)).isoformat()},
            'includes': {'users': [{'id': '10', 'username': username}]},
            'matching_rules': [{'id': rule} for rule in rules]}


def search_payload(frame, next_token=None):
    result = {'data': [frame['data']], 'includes': frame['includes'], 'meta': {'result_count': 1}}
    if next_token:
        result['meta']['next_token'] = next_token
    return result


class FakeStream:
    def __init__(self, chunks, clock_hook=None, error=None):
        self.chunks, self.closed = iter(chunks), False
        self.clock_hook, self.error = clock_hook, error

    async def __aenter__(self):
        if self.error:
            raise self.error
        return self

    async def __aexit__(self, *_):
        self.closed = True

    async def read(self, _limit):
        if self.clock_hook:
            self.clock_hook()
        return next(self.chunks, b'')


class StreamTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.now = NOW
        self.wake = Mock()
        self.co = x_stream.Coordinator(self.db, list(monitor.PROVIDERS), wake=self.wake, clock=lambda: self.now)

    def tearDown(self):
        self.db.close()

    def scalar(self, sql, args=()):
        return self.db.execute(sql, args).fetchone()[0]

    def live(self):
        x_budget.install_policy(self.db, policy(self.now), self.now)
        self.co.enabled, self.co.offline = True, False
        self.co.activation = x_stream.Activation(self.co.fixture_inventory(), self.now.isoformat(), True, True, True, True, True)
        return self.co

    def test_default_off_and_offline_are_structural_zero_network(self):
        factory = Mock(side_effect=AssertionError('network forbidden'))
        with patch('urllib.request.build_opener', side_effect=AssertionError('network forbidden')):
            self.assertEqual(asyncio.run(self.co.run_once(factory)), 'off')
            self.co.enabled = True
            with self.assertRaisesRegex(x_stream.StreamBlocked, 'offline-network-forbidden'):
                asyncio.run(self.co.run_once(factory))
        factory.assert_not_called()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_budget_reservations'), 0)

    def test_missing_activation_and_budget_block_before_transport(self):
        factory = Mock(side_effect=AssertionError('network forbidden'))
        self.co.enabled, self.co.offline = True, False
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'activation-missing'):
            asyncio.run(self.co.run_once(factory, allowance_micros=15000))
        self.co.activation = x_stream.Activation(self.co.fixture_inventory(), NOW.isoformat(), True, True, True, True, True)
        with self.assertRaises(x_budget.BudgetBlocked):
            asyncio.run(self.co.run_once(factory, allowance_micros=15000))
        factory.assert_not_called()

    def test_manifest_is_exact_four_routes_and_queries(self):
        rules = x_stream.manifest()
        self.assertEqual([r['source_id'] for r in rules], list(x_stream.SOURCE_IDS))
        expected = {s['id']: s['query'] for s in signals.SOURCES if s['id'] in x_stream.SOURCE_IDS}
        self.assertEqual({r['source_id']: r['value'] for r in rules}, expected)
        self.assertTrue(all(len(r['value']) <= 1024 for r in rules))
        altered = deepcopy(signals.SOURCES)
        next(s for s in altered if s['id'] == 'x-wallstengine')['query'] += ' OR cats'
        with self.assertRaises(x_stream.StreamBlocked):
            x_stream.manifest(altered)
        with self.assertRaises(x_stream.StreamBlocked):
            x_stream.verified_rule_map(self.co.fixture_inventory() + [{'id': '9'}], rules)
        duplicated = self.co.fixture_inventory()
        duplicated[-1] = duplicated[0]
        with self.assertRaises(x_stream.StreamBlocked):
            x_stream.verified_rule_map(duplicated, rules)

    def test_decoder_fragmented_utf8_crlf_and_heartbeat(self):
        frame = envelope(text=TEXT + ' 日本語')
        wire = b'\r\n' + json.dumps(frame, ensure_ascii=False).encode() + b'\r\n\n'
        decoder, frames = x_stream.Decoder(), []
        for byte in wire:
            frames.extend(decoder.feed(bytes([byte])))
        decoder.finish()
        self.assertEqual(frames, [frame])
        self.assertEqual(list(x_stream.Decoder().feed(b'\n\r\n')), [])

    def test_decoder_yields_good_frame_before_malformed_tail(self):
        decoder = x_stream.Decoder()
        frames = decoder.feed(json.dumps(envelope()).encode() + b'\n{broken}\n')
        self.assertEqual(next(frames)['data']['id'], '100')
        with self.assertRaises(x_stream.StreamBlocked):
            next(frames)
        with self.assertRaises(x_stream.StreamBlocked):
            list(x_stream.Decoder().feed(b'"bad"\n'))
        decoder = x_stream.Decoder()
        list(decoder.feed(b'{'))
        with self.assertRaises(x_stream.StreamBlocked):
            decoder.finish()
        with patch.object(x_stream, 'MAX_FRAME_BYTES', 10):
            with self.assertRaises(x_stream.StreamBlocked):
                list(x_stream.Decoder().feed(b'a' * 11))

    def test_private_inbox_then_existing_publication_gate_and_committed_wake(self):
        self.co.ingest_fixture(envelope())
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 0)
        self.co.wake = lambda: self.assertFalse(self.db.in_transaction)
        self.assertEqual(self.co.drain(), 1)
        self.assertEqual(self.scalar('SELECT source_id FROM signal_events'), 'x-wallstengine')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_routes'), 0)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_index_state'), 0)
        result = signals.public_price_targets(self.db, now=NOW)['items']
        self.assertEqual(len(result), 1)
        self.assertEqual((result[0]['previous'], result[0]['latest']), (180, 200))

    def test_unknown_rules_authors_and_missing_expansion(self):
        for frame in (envelope(rules=('foreign',)), dict(envelope(), includes={})):
            with self.assertRaises(x_stream.StreamBlocked):
                self.co.ingest_fixture(frame)
        with self.assertRaises(x_stream.StreamBlocked):
            self.co.ingest_fixture(envelope(username='TheFlyNews'))
        self.co.drain()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 0)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_x_acquisition'), 0)
        self.co.ingest_fixture(envelope())
        self.co.drain()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 1)

    def test_long_note_variants_preserve_full_body(self):
        for note in ('note_tweet', 'note_post'):
            frame = envelope(identity='101' if note == 'note_tweet' else '102', text='short')
            body = TEXT + '\n' + 'Evidence ' * 100
            frame['data'][note] = {'text': body}
            self.co.ingest_fixture(frame)
        self.co.drain()
        self.assertEqual([r[0] for r in self.db.execute('SELECT text FROM signal_documents')], [body, body])

    def test_search_stream_duplicates_both_orders_and_case_canonicalization(self):
        source = self.co.sources['x-wallstengine']
        frame = envelope()
        payload = search_payload(frame)
        for stream_first in (False, True):
            with self.subTest(stream_first=stream_first):
                for table in ('signal_documents', 'signal_events', 'signal_x_acquisition', 'x_stream_inbox', 'x_stream_associations'):
                    self.db.execute(f'DELETE FROM {table}')
                self.db.commit()
                def search():
                    with self.db:
                        signals.save_evidence(self.db, source, x_api.parse_response(source, payload, self.co.tickers),
                                              {'_acquired_posts': x_api.acquired_posts(source, payload)}, NOW.isoformat())
                def stream():
                    self.co.ingest_fixture(frame)
                    self.co.drain()
                (stream if stream_first else search)()
                (search if stream_first else stream)()
                self.co.ingest_fixture(envelope(username='tipranks'))
                self.co.drain()
                self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 1)
                self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_documents'), 1)
                self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_x_acquisition'), 1)

    def test_correction_invalidates_publication_and_old_duplicate_does_not_restore(self):
        self.co.ingest_fixture(envelope())
        self.co.drain()
        self.now += timedelta(seconds=1)
        correction = 'Correction: the earlier figures were withdrawn.'
        self.co.ingest_fixture(envelope(text=correction))
        self.co.drain()
        self.assertEqual(signals.public_price_targets(self.db, now=self.now)['items'], [])
        self.now += timedelta(seconds=1)
        self.co.ingest_fixture(envelope())
        self.co.drain()
        self.assertEqual(self.scalar('SELECT text FROM signal_documents'), correction)

    def test_late_durable_receipt_cannot_overwrite_newer_search_revision(self):
        self.co.ingest_fixture(envelope())
        source = self.co.sources['x-wallstengine']
        payload = search_payload(envelope(text=TEXT.replace('200', '220')))
        with self.db:
            signals.save_evidence(self.db, source, x_api.parse_response(source, payload, self.co.tickers),
                                  {'_acquired_posts': x_api.acquired_posts(source, payload)}, (NOW+timedelta(seconds=2)).isoformat())
        self.co.drain()
        self.assertIn('$220', self.scalar('SELECT text FROM signal_documents'))

    def test_edit_chain_is_quarantined_including_late_older_member(self):
        self.co.ingest_fixture(envelope())
        self.co.drain()
        frame = envelope(identity='101', text=TEXT.replace('200', '210'))
        frame['data']['edit_history_tweet_ids'] = ['100', '101']
        self.co.ingest_fixture(frame)
        self.co.drain()
        self.co.ingest_fixture(envelope(text=TEXT + '.'))
        self.co.drain()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 1)
        self.assertEqual(signals.public_price_targets(self.db, now=NOW)['items'], [])
        import x_replay
        x_replay.replay_acquired(self.db, signals.SOURCES, self.co.tickers, now=NOW)
        self.assertEqual(signals.public_price_targets(self.db, now=NOW)['items'], [])

    def test_edit_quarantine_marks_prior_unselected_copies_handled_for_replay(self):
        import x_replay
        source = self.co.sources['x-wallstengine']
        for identity in ('100', '101'):
            payload = search_payload(envelope(identity=identity))
            with self.db:
                signals.save_evidence(self.db, source, [],
                                      {'_acquired_posts': x_api.acquired_posts(source, payload)}, NOW.isoformat())
        frame = envelope(identity='101')
        frame['data']['edit_history_post_ids'] = ['100', '101']
        self.co.ingest_fixture(frame)
        self.co.drain()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_x_acquisition WHERE selected_for_processing=0'), 0)
        replay = x_replay.replay_acquired(self.db, signals.SOURCES, self.co.tickers, now=NOW)
        self.assertEqual(replay['recovered'], 0)
        self.assertEqual(signals.public_price_targets(self.db, now=NOW)['items'], [])

    def test_financing_is_private_and_poison_does_not_block_other_receipts(self):
        self.co.ingest_fixture(envelope(text='$MU plans $500M convertible senior notes financing'))
        bad = envelope(identity='101')
        bad['data']['edit_history_tweet_ids'] = ['not-numeric']
        self.co.ingest_fixture(bad)
        self.co.ingest_fixture(envelope(identity='102'))
        self.assertEqual(self.co.drain(), 3)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_associations WHERE processed=-1'), 1)
        self.assertEqual(len(signals.public_price_targets(self.db, now=NOW)['items']), 1)
        private = self.db.execute("SELECT * FROM signal_events WHERE url LIKE '%/status/100'").fetchone()
        self.assertIn('financing', private['excerpt'])

    def test_heartbeat_never_changes_poll_or_acquisition_success(self):
        self.db.execute("INSERT INTO signal_routes(id,failures,error) VALUES('x-wallstengine',3,'http-403')")
        self.db.commit()
        self.co.heartbeat()
        self.assertEqual(self.scalar('SELECT failures FROM signal_routes'), 3)
        self.assertIsNone(self.co.health()['lastCommittedAt'])
        self.assertIsNotNone(self.co.health()['lastByteAt'])
        self.assertNotIn('payload', json.dumps(self.co.health()))

    def test_queue_overflow_preserves_checkpoint_and_no_partial_association(self):
        with patch.object(x_stream, 'MAX_INBOX', 1):
            self.co.ingest_fixture(envelope())
            with self.assertRaisesRegex(x_stream.StreamBlocked, 'inbox-full'):
                self.co.ingest_fixture(envelope(identity='101'))
        self.assertEqual(self.scalar('SELECT last_post_id FROM x_stream_state'), '100')
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_inbox'), 1)

    def test_multiple_matches_one_delivery_metered_once(self):
        self.live()
        self.co.rule_map = x_stream.verified_rule_map(self.co.fixture_inventory(), self.co.rules)
        reservation = x_budget.reserve(self.db, 'stream', 100000, NOW)
        self.co._receive(envelope(rules=('1', '2', '1')), NOW, reservation)
        self.assertEqual(self.scalar('SELECT consumed FROM x_budget_reservations'), 15000)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_associations'), 2)
        self.co.drain()
        # Only the matching configured author is editorially admitted.
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 1)

    def test_every_frame_in_paid_chunk_counted_after_threshold(self):
        self.live()
        wire = b''.join(json.dumps(envelope(identity=str(v))).encode()+b'\n' for v in (100, 101, 102))
        transport = FakeStream([wire])
        result = asyncio.run(self.co.run_once(lambda *_: transport, allowance_micros=15000))
        self.assertEqual(result, 'budget-paused')
        self.assertTrue(transport.closed)
        self.assertEqual(self.scalar('SELECT consumed FROM x_budget_reservations'), 45000)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_inbox'), 3)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.search_reservation(self.db, 10, NOW)

    def test_incomplete_paid_frame_at_eof_freezes_shared_ledger(self):
        self.live()
        transport = FakeStream([b'{"data":{"id":"100"'])
        asyncio.run(self.co.run_once(lambda *_: transport, allowance_micros=100000))
        self.assertTrue(transport.closed)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_budget_stop'), 1)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.search_reservation(self.db, 30, NOW)

    def test_good_then_malformed_paid_chunk_freezes_all_read_types(self):
        self.live()
        wire = json.dumps(envelope()).encode()+b'\nnot-json\n'
        transport = FakeStream([wire])
        asyncio.run(self.co.run_once(lambda *_: transport, allowance_micros=100000))
        self.assertTrue(transport.closed)
        self.assertEqual(self.scalar('SELECT consumed FROM x_budget_reservations'), 15000)
        for purpose in ('search', 'recovery', 'control', 'stream'):
            with self.assertRaises(x_budget.BudgetBlocked):
                x_budget.reserve(self.db, purpose, 1, NOW)

    def test_unknown_rule_is_metered_and_unpriced_resource_freezes_shared_ledger(self):
        self.live()
        self.co.rule_map = x_stream.verified_rule_map(self.co.fixture_inventory(), self.co.rules)
        reservation = x_budget.reserve(self.db, 'stream', 100000, NOW)
        with self.assertRaises(x_stream.StreamBlocked):
            self.co._receive(envelope(rules=('999',)), NOW, reservation)
        self.assertEqual(self.scalar('SELECT consumed FROM x_budget_reservations'), 15000)
        frame = envelope()
        frame['includes']['media'] = [{'media_key': 'abc'}]
        with self.assertRaises(x_budget.BudgetBlocked):
            self.co._receive(frame, NOW, reservation)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.db, 'control', 1, NOW)

    def test_failed_inbox_storage_never_advances_checkpoint(self):
        self.db.execute("CREATE TRIGGER refuse_inbox BEFORE INSERT ON x_stream_inbox BEGIN SELECT RAISE(ABORT,'fixture'); END")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.co.ingest_fixture(envelope())
        self.assertIsNone(self.scalar('SELECT last_post_id FROM x_stream_state'))

    def test_recovery_pages_and_stream_ids_are_independent(self):
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        self.co.ingest_fixture(envelope(identity='9999'))
        self.co.drain()
        old = envelope(identity='50', published=NOW-timedelta(minutes=9))
        self.co.commit_recovery_page(1, search_payload(old, 'page-two'))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_search_checkpoint'), 0)
        self.assertEqual(self.co.recovery_request(1)['next_token'], 'page-two')
        self.assertEqual(self.co.recovery_request(1)['end_time'], x_stream.stamp(NOW))
        self.co.commit_recovery_page(1, search_payload(envelope(identity='40', published=NOW-timedelta(minutes=8))), expected_token='page-two')
        self.assertEqual(self.scalar('SELECT last_post_id FROM x_stream_state'), '9999')
        self.assertEqual(self.scalar('SELECT completed_through FROM x_stream_search_checkpoint'), x_stream.stamp(NOW))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_index_state'), 0)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 3)

    def test_recovery_bad_schema_outside_window_and_stale_page_do_not_advance(self):
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        for payload in ({}, {'data': [], 'meta': {}}, {'meta': {'result_count': 1}},
                        search_payload(envelope(published=NOW+timedelta(seconds=1)))):
            with self.assertRaises((x_stream.StreamBlocked, x_budget.BudgetBlocked)):
                self.co.commit_recovery_page(1, payload)
        self.assertEqual(self.scalar('SELECT page_count FROM x_stream_gaps WHERE id=1'), 0)
        with self.assertRaises(x_stream.StreamBlocked):
            self.co.commit_recovery_page(1, {'meta': {'result_count': 0}}, expected_token='wrong')
        self.now += timedelta(days=8)
        with self.assertRaises(x_stream.StreamBlocked):
            self.co.recovery_request(1)
        self.assertEqual(self.scalar('SELECT status FROM x_stream_gaps WHERE id=1'), 'unrecoverable')

    def test_recovery_crash_rolls_back_acquisition_and_token(self):
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        self.db.execute("CREATE TRIGGER refuse_acquisition BEFORE INSERT ON signal_x_acquisition BEGIN SELECT RAISE(ABORT,'fixture'); END")
        self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.co.commit_recovery_page(1, search_payload(envelope(), 'second'))
        self.assertEqual(self.scalar('SELECT page_count FROM x_stream_gaps WHERE id=1'), 0)
        self.assertIsNone(self.scalar('SELECT next_token FROM x_stream_gaps WHERE id=1'))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 0)

    def test_completed_gap_history_compacts_without_erasing_pending_or_checkpoint(self):
        self.now = NOW + timedelta(days=2)
        source_id = x_stream.SOURCE_IDS[0]
        with self.db:
            for number in range(1001):
                start = NOW + timedelta(seconds=number * 30)
                self.db.execute('INSERT INTO x_stream_gaps(source_id,start_at,end_at,status) VALUES(?,?,?,?)',
                                (source_id, x_stream.stamp(start), x_stream.stamp(start+timedelta(seconds=20)), 'complete'))
            boundary = NOW + timedelta(seconds=30020)
            self.db.execute('INSERT INTO x_stream_search_checkpoint VALUES(?,?)', (source_id, x_stream.stamp(boundary)))
            self.db.execute('INSERT INTO x_stream_gaps(source_id,start_at,end_at) VALUES(?,?,?)',
                            (source_id, x_stream.stamp(boundary), x_stream.stamp(boundary+timedelta(minutes=1))))
        self.co.open_gap(boundary+timedelta(minutes=2), boundary+timedelta(minutes=3))
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM x_stream_gaps WHERE status='complete'"), 100)
        self.assertEqual(self.scalar("SELECT COUNT(*) FROM x_stream_gaps WHERE status='pending'"), 5)
        self.assertEqual(self.scalar('SELECT completed_through FROM x_stream_search_checkpoint'), x_stream.stamp(boundary))

    def test_newer_finished_gap_cannot_skip_older_unfinished_gap(self):
        self.co.open_gap(NOW-timedelta(minutes=10), NOW-timedelta(minutes=5))
        self.co.open_gap(NOW-timedelta(minutes=4), NOW)
        empty = {'meta': {'result_count': 0}}
        self.co.commit_recovery_page(5, empty)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_search_checkpoint'), 0)
        self.co.commit_recovery_page(1, empty)
        self.assertEqual(self.scalar('SELECT completed_through FROM x_stream_search_checkpoint'), x_stream.stamp(NOW))

    def test_disconnect_gap_covers_backoff_between_attempts(self):
        self.live()
        first = FakeStream([b'\r\n'])
        asyncio.run(self.co.run_once(lambda *_: first, allowance_micros=100000))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_gaps'), 0)
        self.assertIsNotNone(self.scalar('SELECT disconnected_since FROM x_stream_state'))
        self.now += timedelta(minutes=5)
        second = FakeStream([])
        asyncio.run(self.co.run_once(lambda *_: second, allowance_micros=100000))
        gap = self.db.execute('SELECT * FROM x_stream_gaps WHERE id=1').fetchone()
        self.assertLess(x_budget.utc(gap['start_at']), NOW)
        self.assertEqual(x_budget.utc(gap['end_at']), NOW+timedelta(minutes=5))
        self.co.offline = True
        self.co.commit_recovery_page(1, search_payload(envelope(published=NOW+timedelta(minutes=3))))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 1)

    def test_persisted_inbox_and_search_compatible_result_survive_restart(self):
        import market_results
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'intake.sqlite'
            db = monitor.connect(path)
            co = x_stream.Coordinator(db, list(monitor.PROVIDERS), clock=lambda: NOW)
            frame = envelope(text='US NONFARM PAYROLLS (SEP) ACTUAL: +90K; EST +85K')
            co.ingest_fixture(frame)
            db.close()  # Crash after durable receipt, before projection.
            db = monitor.connect(path)
            co = x_stream.Coordinator(db, list(monitor.PROVIDERS), clock=lambda: NOW)
            self.assertEqual(co.drain(), 1)
            co.ingest_fixture(frame)
            self.assertEqual(co.drain(), 0)
            db.close()
            market_results.run_once(path, signals.SOURCES, reference=NOW)
            db = monitor.connect(path)
            row = db.execute('SELECT source_id,payload FROM market_result_publications').fetchone()
            self.assertEqual(row['source_id'], 'x-wallstengine')
            self.assertIn('TipRanks', row['payload'])
            db.close()

    def test_paid_invalid_recovery_is_metered_before_rejection_and_blocks_all_reads(self):
        self.live()
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        reservation = x_budget.search_reservation(self.db, 30, NOW, purpose='recovery')
        payload = search_payload(envelope())
        payload['data'] = [dict(payload['data'][0], id=str(i)) for i in range(40)]
        payload['meta']['result_count'] = 40
        with self.assertRaises(x_stream.StreamBlocked):
            self.co.commit_recovery_page(1, payload, reservation=reservation)
        row = self.db.execute('SELECT * FROM x_budget_reservations').fetchone()
        self.assertEqual((row['consumed'], row['reserved']), (210000, 450000))
        self.assertEqual(self.scalar('SELECT page_count FROM x_stream_gaps WHERE id=1'), 0)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.db, 'stream', 1, NOW)

    def test_recovery_missing_author_or_body_does_not_claim_coverage(self):
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        missing_author = search_payload(envelope())
        missing_author['includes'] = {}
        empty_text = search_payload(envelope(text=''))
        for payload in (missing_author, empty_text):
            with self.assertRaisesRegex(x_stream.StreamBlocked, 'evidence-incomplete'):
                self.co.commit_recovery_page(1, payload)
        self.assertEqual(self.scalar('SELECT page_count FROM x_stream_gaps WHERE id=1'), 0)

    def test_paid_projection_failure_keeps_cost_and_blocks_retry_without_partial_evidence(self):
        self.live()
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        reservation = x_budget.search_reservation(self.db, 30, NOW, purpose='recovery')
        frame = envelope()
        frame['data']['edit_history_tweet_ids'] = 'malformed'
        with self.assertRaises(x_stream.StreamBlocked):
            self.co.commit_recovery_page(1, search_payload(frame), reservation=reservation)
        row = self.db.execute('SELECT * FROM x_budget_reservations').fetchone()
        self.assertEqual((row['reserved'], row['consumed']), (450000, 15000))
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 0)
        self.assertEqual(self.scalar('SELECT page_count FROM x_stream_gaps WHERE id=1'), 0)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.db, 'recovery', 1, NOW)

    def test_paid_valid_recovery_settles_only_after_evidence_and_cursor_commit(self):
        self.live()
        self.co.open_gap(NOW-timedelta(minutes=10), NOW)
        reservation = x_budget.search_reservation(self.db, 30, NOW, purpose='recovery')
        self.co.commit_recovery_page(1, search_payload(envelope()), reservation=reservation)
        row = self.db.execute('SELECT * FROM x_budget_reservations').fetchone()
        self.assertEqual((row['consumed'], row['reserved'], row['state']), (15000, 15000, 'closed'))
        self.assertEqual(self.scalar('SELECT status FROM x_stream_gaps WHERE id=1'), 'complete')

    def test_post_named_edit_lineage_and_conflicting_variants_are_private(self):
        frame = envelope()
        frame['data']['edit_history_post_ids'] = ['99', '100']
        self.co.ingest_fixture(frame)
        conflict = envelope(identity='101')
        conflict['data']['edit_history_tweet_ids'] = ['100', '101']
        conflict['data']['edit_history_post_ids'] = ['98', '101']
        self.co.ingest_fixture(conflict)
        self.co.drain()
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM signal_events'), 0)
        self.assertEqual(self.scalar('SELECT COUNT(*) FROM x_stream_associations WHERE processed=-1'), 1)

    def test_activation_requires_all_search_to_use_stream_aware_projection(self):
        self.live()
        self.co.activation = x_stream.Activation(self.co.fixture_inventory(), NOW.isoformat(), True, True, True, True)
        factory = Mock()
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'activation-unverified'):
            asyncio.run(self.co.run_once(factory, allowance_micros=15000))
        factory.assert_not_called()

    def test_retry_and_terminal_states_survive_new_coordinator(self):
        self.co.fail(429, retry_after=120)
        retry = self.scalar('SELECT retry_at FROM x_stream_state')
        self.assertEqual(x_budget.utc(retry), NOW+timedelta(seconds=120))
        other = x_stream.Coordinator(self.db, [], clock=lambda: NOW)
        other.fail(503)
        self.assertEqual(self.scalar('SELECT failures FROM x_stream_state'), 2)
        self.assertEqual(other.fail(403), 'entitlement-blocked')
        self.assertEqual(other.fail(402), 'budget-paused')
        self.assertEqual(other.fail(connection_conflict=True), 'operator-blocked')

    def test_auth_failure_never_spends_through_search_fallback(self):
        self.live()
        factory = lambda *_: FakeStream([], error=x_stream.TransportFailure(403))
        self.assertEqual(asyncio.run(self.co.run_once(factory, allowance_micros=100000)), 'entitlement-blocked')
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.search_reservation(self.db, 10, NOW)

    def test_owner_prevents_second_connection_without_network(self):
        self.live()
        self.assertTrue(self.co.begin('first', 100000))
        factory = Mock()
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'owner-already-active'):
            asyncio.run(self.co.run_once(factory, owner='second', allowance_micros=100000))
        factory.assert_not_called()


class BudgetTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        x_budget.schema(self.db)
        x_budget.install_policy(self.db, policy(), NOW)

    def tearDown(self):
        self.db.close()

    def test_counts_every_delivery_but_expected_soft_dedup_is_separate(self):
        identity = x_budget.reserve(self.db, 'stream', 100000, NOW)
        with self.db:
            x_budget.account_receipt(self.db, identity, envelope(), NOW)
            x_budget.account_receipt(self.db, identity, envelope(), NOW)
        row = self.db.execute('SELECT * FROM x_budget_reservations').fetchone()
        self.assertEqual((row['reserved'], row['consumed'], row['expected']), (100000, 30000, 15000))
        with self.db:
            x_budget.close_reservation(self.db, identity)
        self.assertEqual(self.db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 100000)

    def test_search_prereserves_users_and_ambiguous_failures_never_free_money(self):
        identity = x_budget.search_reservation(self.db, 30, NOW)
        self.assertEqual(self.db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 450000)
        with self.db:
            x_budget.account_receipt(self.db, identity, search_payload(envelope()), NOW, final=True)
        self.assertEqual(self.db.execute('SELECT reserved FROM x_budget_reservations').fetchone()[0], 15000)
        x_budget.search_reservation(self.db, 30, NOW)
        self.assertEqual(self.db.execute('SELECT SUM(reserved) FROM x_budget_reservations').fetchone()[0], 465000)

    def test_cycle_daily_and_stale_snapshot_fail_closed(self):
        x_budget.reserve(self.db, 'control', 1_000_000, NOW)
        for purpose in ('stream', 'search', 'recovery', 'control'):
            with self.assertRaises(x_budget.BudgetBlocked):
                x_budget.reserve(self.db, purpose, 1, NOW)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.db, 'stream', 1, NOW+timedelta(minutes=16))
        for override in ({'cycle_id': 'new-cycle'}, {'baseline_micros': 0},
                         {'all_consumers_identified': False}, {'daily_limit_micros': True}):
            with self.assertRaises(x_budget.BudgetBlocked):
                x_budget.install_policy(self.db, policy(**override), NOW)

    def test_fresh_policy_revokes_existing_allowance_when_exposure_exceeds_new_limit(self):
        identity = x_budget.reserve(self.db, 'stream', 450000, NOW)
        x_budget.install_policy(self.db, policy(baseline_micros=17_900_000), NOW)
        with self.assertRaisesRegex(x_budget.BudgetBlocked, 'outstanding-exposure'):
            x_budget.policy_for(self.db, NOW)
        # Already-delivered data is still metered despite revoked admission.
        with self.db:
            result = x_budget.account_receipt(self.db, identity, envelope(), NOW)
        self.assertTrue(result['close_required'])
        self.assertEqual(self.db.execute('SELECT consumed FROM x_budget_reservations').fetchone()[0], 15000)

    def test_utc_day_boundary_is_charged_and_blocks_new_reads(self):
        late = NOW.replace(hour=23, minute=59, second=59)
        x_budget.install_policy(self.db, policy(late), late)
        identity = x_budget.reserve(self.db, 'stream', 100000, late)
        with self.db:
            meter = x_budget.account_receipt(self.db, identity, envelope(), late+timedelta(seconds=2))
        self.assertTrue(meter['close_required'])
        self.assertEqual(self.db.execute('SELECT consumed FROM x_budget_reservations').fetchone()[0], 15000)
        with self.assertRaises(x_budget.BudgetBlocked):
            x_budget.reserve(self.db, 'recovery', 1, late+timedelta(seconds=2))

    def test_shared_ledger_atomic_across_connections_and_restart(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / 'ledger.sqlite'
            db = sqlite3.connect(path)
            db.row_factory = sqlite3.Row
            x_budget.schema(db)
            x_budget.install_policy(db, policy(daily_limit_micros=150000), NOW)
            db.close()
            barrier, outcomes = threading.Barrier(2), []
            def reserve():
                connection = sqlite3.connect(path, timeout=5)
                connection.row_factory = sqlite3.Row
                barrier.wait()
                try:
                    x_budget.reserve(connection, 'search', 100000, NOW)
                    outcomes.append('reserved')
                except x_budget.BudgetBlocked:
                    outcomes.append('blocked')
                finally:
                    connection.close()
            threads = [threading.Thread(target=reserve) for _ in range(2)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertCountEqual(outcomes, ['reserved', 'blocked'])
            db = sqlite3.connect(path)
            db.row_factory = sqlite3.Row
            with self.assertRaises(x_budget.BudgetBlocked):
                x_budget.reserve(db, 'stream', 100000, NOW)
            db.close()


if __name__ == '__main__':
    unittest.main()
