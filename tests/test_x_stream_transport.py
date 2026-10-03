"""Transport contract tested with synthetic responses only; no live X calls."""
import asyncio
from datetime import datetime, timedelta, timezone
from email.utils import formatdate
import json
from pathlib import Path
import sys
import sqlite3
import unittest
from unittest.mock import Mock, patch

import aiohttp
from multidict import CIMultiDict

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import x_budget
import x_stream
import x_stream_transport as transport

TOKEN = 'synthetic-test-token'
PARAMS = {'query': 'from:synthetic', 'max_results': 30,
          'tweet.fields': 'created_at,author_id', 'expansions': 'author_id',
          'user.fields': 'username'}
EMPTY = {'meta': {'result_count': 0}}


class Content:
    def __init__(self, body=b'', error=None, block=False):
        self.body = body
        self.error = error
        self.block = block
        self.reads = []
        self.started = asyncio.Event()

    async def read(self, size):
        self.reads.append(size)
        self.started.set()
        if self.block:
            await asyncio.Event().wait()
        if self.error:
            raise self.error
        result, self.body = self.body[:size], self.body[size:]
        return result


class Response:
    def __init__(self, body=None, status=200, headers=None, **content_options):
        if body is None:
            body = json.dumps(EMPTY).encode()
        self.status = status
        self.headers = CIMultiDict({'Content-Type': 'application/json'})
        self.headers.update(headers or {})
        self.content = Content(body, **content_options)
        self.closed = False
        self.close_count = 0

    def close(self):
        self.closed = True
        self.close_count += 1


class Session:
    def __init__(self, response=None, error=None, block=False, close_wait=None):
        self.response = response if response is not None else Response()
        self.error = error
        self.block = block
        self.calls = []
        self.closed = False
        self._retry_connection = True
        self.started = asyncio.Event()
        self.closing = asyncio.Event()
        self.close_wait = close_wait

    async def get(self, url, **kwargs):
        # Copy synthetic request headers because production clears its local copy.
        self.calls.append((url, dict(kwargs, headers=dict(kwargs['headers']))))
        self.started.set()
        if self.block:
            await asyncio.Event().wait()
        if self.error:
            raise self.error
        return self.response

    async def close(self):
        self.closing.set()
        if self.close_wait is not None:
            await self.close_wait.wait()
        self.closed = True


class TransportTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        # Every test must inject a fake session. An accidental default path fails
        # before creating a real connector, socket, or environment token read.
        self.network_guard = patch.object(aiohttp, 'ClientSession', side_effect=AssertionError('live network forbidden'))
        self.real_session = self.network_guard.start()
        self.addCleanup(self.network_guard.stop)
        self.token_guard = patch.object(transport, 'service_token', side_effect=AssertionError('real token forbidden'))
        self.real_token = self.token_guard.start()
        self.addCleanup(self.token_guard.stop)
        self.session = Session()
        self.factory = Mock(return_value=self.session)
        self.admission = Mock(return_value=True)
        self.token = Mock(return_value=TOKEN)
        self.client = transport.AiohttpTransport(enabled=True, admission=self.admission,
                                               token_provider=self.token, session_factory=self.factory)

    def assert_closed(self):
        self.assertTrue(self.session.closed)
        self.assertTrue(self.session.response.closed)
        self.assertEqual(self.session.response.close_count, 1)

    async def search(self):
        return await self.client.search(transport.SEARCH_URL, PARAMS)

    async def test_construction_and_unentered_context_are_inert(self):
        client = transport.AiohttpTransport()
        client.stream_factory(transport.STREAM_URL, dict(x_stream.STREAM_PARAMS))
        self.client.stream_factory(transport.STREAM_URL, dict(x_stream.STREAM_PARAMS))
        self.real_session.assert_not_called()
        self.real_token.assert_not_called()
        self.factory.assert_not_called()
        self.token.assert_not_called()
        self.admission.assert_not_called()

    async def test_real_coordinator_commits_budget_before_transport_token(self):
        now = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        co = x_stream.Coordinator(db, [], clock=lambda: now)
        self.assertEqual(await co.run_once(self.client.stream_factory), 'off')
        self.token.assert_not_called()
        x_budget.install_policy(db, {
            'cycle_id': 'synthetic', 'cycle_start': (now-timedelta(days=1)).isoformat(),
            'cycle_end': (now+timedelta(days=1)).isoformat(), 'verified_at': now.isoformat(),
            'baseline_micros': 0, 'cycle_limit_micros': 18000000,
            'daily_limit_micros': 1000000, 'account_cap_micros': 20000000,
            'reserve_micros': 2000000, 'all_consumers_identified': True,
            'spend_reconciled': True, 'prices_verified': True}, now)
        co.enabled, co.offline = True, False
        co.activation = x_stream.Activation(co.fixture_inventory(), now.isoformat(),
                                             True, True, True, True, True)
        def admitted():
            self.assertFalse(db.in_transaction)
            row = db.execute('SELECT state FROM x_budget_reservations WHERE id=?',
                             (co.reservation,)).fetchone()
            self.assertEqual(row['state'], 'open')
            self.assertIsNotNone(db.execute('SELECT 1 FROM x_stream_owner').fetchone())
            return True
        self.admission.side_effect = admitted
        self.session.response = Response(b'\r\n')
        self.assertEqual(await co.run_once(self.client.stream_factory, allowance_micros=15000), 'retrying')
        self.admission.assert_called_once()
        self.token.assert_called_once()
        self.assert_closed()
        self.assertEqual(db.execute('SELECT COUNT(*) FROM x_stream_owner').fetchone()[0], 0)

    async def test_default_off_blocks_search_and_stream_before_admission(self):
        self.client.enabled = False
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'transport-disabled'):
            await self.search()
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'transport-disabled'):
            async with self.client.stream_factory(transport.STREAM_URL, {}):
                self.fail('disabled stream entered')
        self.admission.assert_not_called()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_admission_requires_exact_true_before_credentials(self):
        for value in (None, False, 0, 1, 'true'):
            with self.subTest(value=value):
                self.admission.return_value = value
                with self.assertRaisesRegex(x_stream.StreamBlocked, 'admission-required'):
                    await self.search()
        self.client.admission = None
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'admission-required'):
            await self.search()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_admission_exception_prevents_token_and_session(self):
        self.admission.side_effect = x_stream.StreamBlocked('reservation-not-committed')
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'reservation-not-committed'):
            await self.search()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_fixed_endpoints_only_and_no_rules_or_redirect_targets(self):
        for url in ('http://api.x.com/2/tweets/search/recent',
                    transport.SEARCH_URL + '?query=other', transport.SEARCH_URL + '#fragment',
                    'https://api.x.com/2/tweets/search/stream/rules',
                    'https://api.twitter.com/2/tweets/search/recent',
                    'https://api.x.com.evil.invalid/2/tweets/search/recent',
                    'https://user:pass@api.x.com/2/tweets/search/recent', transport.STREAM_URL):
            with self.subTest(url=url), self.assertRaisesRegex(x_stream.StreamBlocked, 'endpoint-invalid'):
                await self.client.search(url, PARAMS)
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'endpoint-invalid'):
            async with self.client.stream_factory(transport.SEARCH_URL, {}):
                self.fail('wrong endpoint entered')
        self.admission.assert_not_called()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_invalid_parameters_rejected_before_gate(self):
        for params in (None, [], {'query': True}, {'query': 'x' * 4097}, {'x': ['a']}, {1: 'x'}):
            with self.subTest(params=type(params)), self.assertRaises(x_stream.StreamBlocked):
                await self.client.search(transport.SEARCH_URL, params)
        self.admission.assert_not_called()
        self.token.assert_not_called()
        self.factory.assert_not_called()

    async def test_lazy_order_fixed_headers_tls_and_no_environment_auth(self):
        order = []
        self.admission.side_effect = lambda: order.append('admitted') or True
        self.token.side_effect = lambda: order.append('token') or TOKEN
        self.factory.side_effect = lambda **options: order.append('session') or self.session
        self.assertEqual(await self.search(), EMPTY)
        self.assertEqual(order, ['admitted', 'token', 'session'])
        options = self.factory.call_args.kwargs
        self.assertIs(options['trust_env'], False)
        self.assertIsNone(options['auth'])
        self.assertIs(options['auto_decompress'], False)
        self.assertIsInstance(options['cookie_jar'], aiohttp.DummyCookieJar)
        self.assertEqual(options['timeout'].connect, transport.CONNECT_SECONDS)
        self.assertFalse(self.session._retry_connection)
        self.assertEqual(len(self.session.calls), 1)
        url, request = self.session.calls[0]
        self.assertEqual(url, transport.SEARCH_URL)
        self.assertEqual(request['params'], PARAMS)
        self.assertIsNot(request['params'], PARAMS)
        self.assertEqual(request['headers'], {'Authorization': 'Bearer ' + TOKEN,
                         'Accept': 'application/json', 'Accept-Encoding': 'identity',
                         'User-Agent': 'TechPhaseResearch/1.0'})
        self.assertIs(request['allow_redirects'], False)
        self.assertIs(request['ssl'], True)
        self.assertIsNone(request['proxy'])
        self.assertIsNone(request['auth'])
        self.assert_closed()

    async def test_each_call_requires_fresh_admission_and_own_session(self):
        other = Session()
        self.factory.side_effect = [self.session, other]
        await self.search()
        await self.search()
        self.assertEqual(self.admission.call_count, 2)
        self.assertEqual(self.token.call_count, 2)
        self.assertTrue(self.session.closed)
        self.assertTrue(other.closed)
        self.admission.return_value = False
        with self.assertRaises(x_stream.StreamBlocked):
            await self.search()
        self.assertEqual(self.factory.call_count, 2)

    async def test_invalid_or_failing_token_provider_is_sanitized(self):
        for value in ('', 'a\r\nAuthorization: secret', 'bad token', '日本語', 'x' * 8193, None):
            self.token.return_value = value
            with self.assertRaisesRegex(x_stream.StreamBlocked, '^x-stream-token-unavailable$'):
                await self.search()
        self.token.side_effect = RuntimeError('provider-secret')
        with self.assertRaises(x_stream.StreamBlocked) as raised:
            await self.search()
        self.assertNotIn('provider-secret', str(raised.exception))
        self.assertTrue(raised.exception.__suppress_context__)
        self.factory.assert_not_called()

    async def test_stream_reads_65536_and_closes_only_its_session(self):
        self.session.response = Response(b'\r\n{"data":{}}\n', headers={'Content-Type': 'application/x-ndjson; charset=utf-8'})
        unrelated = Session()
        async with self.client.stream_factory(transport.STREAM_URL, dict(x_stream.STREAM_PARAMS)) as stream:
            self.assertEqual(await stream.read(65536), b'\r\n{"data":{}}\n')
            self.assertEqual(await stream.read(65536), b'')
            self.assertFalse(self.session.closed)
        self.assert_closed()
        self.assertFalse(unrelated.closed)
        self.assertEqual(self.session.calls[0][1]['params'], x_stream.STREAM_PARAMS)

    async def test_stream_read_size_and_network_exception_are_sanitized(self):
        self.session.response = Response(error=aiohttp.ClientPayloadError('secret response'))
        async with self.client.stream_factory(transport.STREAM_URL, {}) as stream:
            with self.assertRaises(x_stream.StreamBlocked):
                await stream.read(65537)
            with self.assertRaises(x_stream.TransportFailure) as raised:
                await stream.read(65536)
            self.assertIsNone(raised.exception.status)
            self.assertNotIn('secret response', str(raised.exception))
        self.assert_closed()

    async def test_redirect_is_not_followed_and_location_is_not_exposed(self):
        self.session.response = Response(status=302, headers={'Location': 'https://evil.invalid/private?secret=token'})
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        self.assertEqual(raised.exception.status, 302)
        self.assertNotIn('evil', str(raised.exception))
        self.assertEqual(len(self.session.calls), 1)
        self.assertFalse(self.session.calls[0][1]['allow_redirects'])
        self.assert_closed()

    async def test_http_status_mapping_is_sanitized(self):
        for status in (401, 402, 403, 409, 429, 500, 503):
            with self.subTest(status=status):
                self.session = Session(Response(b'{"detail":"private response"}', status=status))
                self.factory.return_value = self.session
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    await self.search()
                self.assertEqual(raised.exception.status, status)
                self.assertEqual(raised.exception.quota, status == 402)
                self.assertEqual(raised.exception.connection_conflict, status == 409)
                self.assertEqual(str(raised.exception), 'x-stream-transport-failure')
                self.assertNotIn('private', repr(vars(raised.exception)))
                self.assert_closed()

    async def test_quota_and_conflict_only_from_structured_identifiers(self):
        cases = [({'title': 'UsageCapExceeded'}, True, False),
                 ({'errors': [{'type': 'https://api.x.com/2/problems/credits-depleted'}]}, True, False),
                 ({'type': 'https://api.twitter.com/2/problems/usage-capped'}, True, False),
                 ({'title': 'TooManyConnections'}, False, True),
                 ({'detail': 'UsageCapExceeded credits-depleted TooManyConnections'}, False, False),
                 ({'title': ['UsageCapExceeded']}, False, False),
                 ({'type': 'https://evil.invalid/2/problems/usage-capped'}, False, False)]
        for body, quota, conflict in cases:
            with self.subTest(body=body):
                self.session = Session(Response(json.dumps(body).encode(), status=429))
                self.factory.return_value = self.session
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    await self.search()
                self.assertEqual(raised.exception.quota, quota)
                self.assertEqual(raised.exception.connection_conflict, conflict)

    async def test_error_json_has_small_bytes_and_time_limits(self):
        for response in (Response(b'{' + b'x' * (transport.MAX_ERROR_BYTES + 1), status=429),
                         Response(b'{bad json}', status=429),
                         Response(b'{"title":"UsageCapExceeded"}', status=429, headers={'Content-Type': 'text/plain'}),
                         Response(status=429, block=True)):
            self.session = Session(response)
            self.factory.return_value = self.session
            with patch.object(transport, 'ERROR_SECONDS', .01):
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    await self.search()
            self.assertFalse(raised.exception.quota)
            self.assertEqual(raised.exception.status, 429)
            self.assertTrue(all(size <= transport.MAX_ERROR_BYTES + 1 for size in response.content.reads))
            self.assert_closed()

    async def test_retry_after_seconds_date_and_rate_limit_reset_are_bounded(self):
        now = 1_700_000_000
        cases = [({'Retry-After': '40'}, 40),
                 ({'Retry-After': '30', 'x-rate-limit-reset': str(now + 80)}, 80),
                 ({'Retry-After': formatdate(now + 70, usegmt=True)}, 70),
                 ({'Retry-After': '900000'}, 86400),
                 ({'Retry-After': 'nan', 'x-rate-limit-reset': 'inf'}, 0),
                 ({'Retry-After': '-1'}, 0),
                 ({'Retry-After': 'private header'}, 0),
                 ({'Retry-After': '9' * 129}, 0)]
        for headers, expected in cases:
            self.session = Session(Response(status=429, headers=headers))
            self.factory.return_value = self.session
            with patch.object(transport.time, 'time', return_value=now):
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    await self.search()
            self.assertEqual(raised.exception.retry_after, expected)

    async def test_search_success_returns_json_without_transformation(self):
        payload = {'data': [{'id': '123', 'author_id': '44', 'text': 'Synthetic post'}],
                   'includes': {'users': [{'id': '44', 'username': 'synthetic'}]},
                   'meta': {'result_count': 1, 'next_token': 'synthetic-page'}}
        self.session.response = Response(json.dumps(payload).encode(), headers={'Content-Type': 'application/json; charset=utf-8'})
        self.assertEqual(await self.search(), payload)
        self.assert_closed()

    async def test_malformed_paid_search_is_ambiguous_billing(self):
        bodies = [b'invalid secret body', b'[]',
                  b'{"meta":{"result_count":0},"value":NaN}',
                  b'{"meta":{"result_count":1},"meta":{"result_count":0}}',
                  b'\xff', b'[' * 2000]
        for body in bodies:
            with self.subTest(body=body[:40]):
                self.session = Session(Response(body))
                self.factory.return_value = self.session
                with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
                    await self.search()
                self.assertIsInstance(raised.exception, x_stream.TransportFailure)
                self.assertTrue(raised.exception.ambiguous_billing)
                self.assertTrue(raised.exception.quota)
                self.assertEqual(raised.exception.status, 200)
                self.assertEqual(str(raised.exception), 'x-search-ambiguous-billing')
                self.assert_closed()

    async def test_parsed_search_objects_reach_caller_before_semantic_rejection(self):
        payloads = [{}, {'errors': [{'detail': 'synthetic error'}]},
                    {'data': {}, 'meta': {'result_count': 0}},
                    {'data': [1], 'meta': {'result_count': 1}},
                    {'meta': {'result_count': True}},
                    {'meta': {'result_count': 1}},
                    {'meta': {'result_count': 0}, 'includes': []}]
        for payload in payloads:
            with self.subTest(payload=payload):
                self.session = Session(Response(json.dumps(payload).encode()))
                self.factory.return_value = self.session
                self.assertEqual(await self.search(), payload)
                self.assert_closed()

    async def test_forty_post_response_reaches_accounting_caller(self):
        now = datetime(2026, 10, 2, 12, tzinfo=timezone.utc)
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        x_budget.schema(db)
        x_budget.install_policy(db, {
            'cycle_id': 'synthetic', 'cycle_start': (now-timedelta(days=1)).isoformat(),
            'cycle_end': (now+timedelta(days=1)).isoformat(), 'verified_at': now.isoformat(),
            'baseline_micros': 0, 'cycle_limit_micros': 18000000,
            'daily_limit_micros': 1000000, 'account_cap_micros': 20000000,
            'reserve_micros': 2000000, 'all_consumers_identified': True,
            'spend_reconciled': True, 'prices_verified': True}, now)
        reservation = x_budget.search_reservation(db, 30, now)
        payload = {'data': [{'id': str(index)} for index in range(40)],
                   'includes': {'users': [{'id': str(index + 100)} for index in range(40)]},
                   'meta': {'result_count': 40}}
        self.session.response = Response(json.dumps(payload).encode())
        returned = await self.search()
        self.assertEqual(returned, payload)
        with db:
            meter = x_budget.account_receipt(db, reservation, returned, now)
        self.assertEqual(meter['consumed_micros'], 40 * (x_budget.POST_MICROS + x_budget.USER_MICROS))
        self.assertTrue(meter['overshot'])
        self.assertIsNotNone(db.execute('SELECT 1 FROM x_budget_stop').fetchone())
        self.assert_closed()

    async def test_missing_retry_control_fails_closed_before_get(self):
        del self.session._retry_connection
        with self.assertRaisesRegex(x_stream.StreamBlocked, 'retry-control-unavailable'):
            await self.search()
        self.assertEqual(self.session.calls, [])
        self.assertTrue(self.session.closed)

    async def test_failed_or_ineffective_retry_control_fails_before_get(self):
        class BrokenRetrySession(Session):
            def __setattr__(self, name, value):
                if name == '_retry_connection' and hasattr(self, name):
                    raise AttributeError('synthetic private setter failure')
                super().__setattr__(name, value)
        class IgnoredRetrySession(Session):
            def __setattr__(self, name, value):
                if name == '_retry_connection' and value is False:
                    return
                super().__setattr__(name, value)
        for session in (BrokenRetrySession(), IgnoredRetrySession()):
            self.factory.return_value = session
            with self.assertRaisesRegex(x_stream.StreamBlocked, '^x-stream-retry-control-unavailable$'):
                await self.search()
            self.assertEqual(session.calls, [])
            self.assertTrue(session.closed)

    async def test_search_content_type_and_compression_are_fail_closed(self):
        for headers in ({'Content-Type': 'text/html'}, {'Content-Type': 'application/x-ndjson'},
                        {'Content-Type': ''}, {'Content-Encoding': 'gzip'}):
            self.session = Session(Response(headers=headers))
            self.factory.return_value = self.session
            with self.assertRaises(transport.AmbiguousSearchResponse):
                await self.search()
            self.assertEqual(self.session.response.content.reads, [])
            self.assert_closed()

    async def test_stream_content_type_is_restricted(self):
        self.session.response = Response(headers={'Content-Type': 'text/event-stream'})
        with self.assertRaises(x_stream.TransportFailure) as raised:
            async with self.client.stream_factory(transport.STREAM_URL, {}):
                self.fail('invalid stream entered')
        self.assertEqual(raised.exception.status, 400)
        self.assert_closed()

    async def test_search_byte_limit_and_read_timeout_are_ambiguous(self):
        for response in (Response(b'x' * 129), Response(block=True),
                         Response(error=aiohttp.ClientPayloadError('private body'))):
            self.session = Session(response)
            self.factory.return_value = self.session
            with patch.object(transport, 'MAX_SEARCH_BYTES', 128), patch.object(transport, 'SEARCH_SECONDS', .01):
                with self.assertRaises(transport.AmbiguousSearchResponse):
                    await self.search()
            self.assert_closed()

    async def test_search_exact_byte_limit_is_accepted(self):
        body = json.dumps(EMPTY).encode()
        self.session.response = Response(body)
        with patch.object(transport, 'MAX_SEARCH_BYTES', len(body)):
            self.assertEqual(await self.search(), EMPTY)
        self.assert_closed()

    async def test_connect_error_closes_session_without_retry(self):
        self.session.error = aiohttp.ClientConnectionError('secret url headers token')
        with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
            await self.search()
        self.assertIsNone(raised.exception.status)
        self.assertTrue(self.session.closed)
        self.assertEqual(len(self.session.calls), 1)
        self.assertNotIn('secret', str(raised.exception))

    async def test_unexpected_request_exception_is_also_sanitized(self):
        self.session.error = ValueError('private provider diagnostic')
        with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
            await self.search()
        self.assertNotIn('private', str(raised.exception))
        self.assertTrue(raised.exception.__suppress_context__)
        self.assertTrue(self.session.closed)

    async def test_owned_session_close_failure_is_sanitized_and_blocks_replacement(self):
        async def failed_close():
            raise RuntimeError('private connector diagnostic')
        self.session.close = failed_close
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        self.assertNotIn('private', str(raised.exception))
        self.assertTrue(raised.exception.connection_conflict)
        self.assertTrue(self.session.response.closed)
        db = sqlite3.connect(':memory:')
        db.row_factory = sqlite3.Row
        self.addCleanup(db.close)
        co = x_stream.Coordinator(db, [])
        self.assertEqual(co.fail(raised.exception.status,
                                 connection_conflict=raised.exception.connection_conflict), 'operator-blocked')
        self.assertIsNotNone(db.execute('SELECT 1 FROM x_budget_stop').fetchone())

    async def test_cleanup_failure_retains_known_paid_payload_without_exposing_text(self):
        payload = {'data': [{'id': str(index), 'text': 'synthetic-private-post'} for index in range(40)],
                   'includes': {'users': [{'id': str(index + 100)} for index in range(40)]},
                   'meta': {'result_count': 40}}
        self.session.response = Response(json.dumps(payload).encode())
        async def failed_close():
            raise RuntimeError('synthetic-private-connector')
        self.session.close = failed_close
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        failure = raised.exception
        self.assertEqual(failure.received_payload, payload)
        self.assertEqual(len(x_budget.payload_resources(failure.received_payload)), 80)
        self.assertTrue(failure.connection_conflict)
        self.assertEqual(str(failure), 'x-stream-transport-failure')
        self.assertNotIn('synthetic-private', repr(failure))
        self.assertNotIn('received_payload', repr(failure))

    async def test_cancellation_after_parsing_retains_payload_for_accounting(self):
        payload = {'data': [{'id': str(index), 'text': 'synthetic-private-post'} for index in range(40)],
                   'includes': {'users': [{'id': str(index + 100)} for index in range(40)]},
                   'meta': {'result_count': 40}}
        self.session.response = Response(json.dumps(payload).encode())
        release = asyncio.Event()
        self.session.close_wait = release
        task = asyncio.create_task(self.search())
        await self.session.closing.wait()
        task.cancel()
        await asyncio.sleep(0)
        release.set()
        with self.assertRaises(asyncio.CancelledError) as raised:
            await task
        failure = raised.exception
        self.assertEqual(failure.received_payload, payload)
        self.assertNotIn('synthetic-private', str(failure))
        self.assertNotIn('synthetic-private', repr(failure))
        self.assert_closed()

    async def test_response_close_failure_still_closes_session_and_blocks_replacement(self):
        self.session.response.close = Mock(side_effect=RuntimeError('private response diagnostic'))
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        self.assertTrue(raised.exception.connection_conflict)
        self.assertNotIn('private', str(raised.exception))
        self.assertTrue(self.session.closed)

    async def test_successful_return_without_confirmed_close_blocks_replacement(self):
        async def ineffective_close():
            pass
        self.session.close = ineffective_close
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        self.assertTrue(raised.exception.connection_conflict)
        self.assertFalse(self.session.closed)

    async def test_cancelled_cleanup_is_unknown_ownership_and_blocks_replacement(self):
        async def cancelled_close():
            raise asyncio.CancelledError
        self.session.close = cancelled_close
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self.search()
        self.assertTrue(raised.exception.connection_conflict)
        self.assertTrue(self.session.response.closed)

    async def test_stream_connect_timeout_is_sanitized_and_session_closed(self):
        self.session.block = True
        with patch.object(transport, 'CONNECT_SECONDS', .01):
            with self.assertRaises(x_stream.TransportFailure) as raised:
                async with self.client.stream_factory(transport.STREAM_URL, {}):
                    self.fail('timed-out stream entered')
        self.assertIsNone(raised.exception.status)
        self.assertTrue(self.session.closed)
        self.assertEqual(len(self.session.calls), 1)

    async def test_cancellation_during_connect_closes_session(self):
        self.session.block = True
        task = asyncio.create_task(self.search())
        await self.session.started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertTrue(self.session.closed)
        self.assertEqual(len(self.session.calls), 1)

    async def test_cancellation_during_search_body_closes_response_and_session(self):
        self.session.response = Response(block=True)
        task = asyncio.create_task(self.search())
        await self.session.response.content.started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assert_closed()

    async def test_stream_heartbeat_timeout_closes_response_and_session(self):
        self.session.response = Response(block=True)
        with self.assertRaises(asyncio.TimeoutError):
            async with self.client.stream_factory(transport.STREAM_URL, {}) as stream:
                await asyncio.wait_for(stream.read(65536), .01)
        self.assert_closed()

    async def test_stream_cancellation_closes_response_and_session(self):
        self.session.response = Response(block=True)
        async def consume():
            async with self.client.stream_factory(transport.STREAM_URL, {}) as stream:
                await stream.read(65536)
        task = asyncio.create_task(consume())
        await self.session.response.content.started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assert_closed()

    async def test_repeated_cancellation_waits_for_owned_session_cleanup(self):
        release = asyncio.Event()
        self.session.close_wait = release
        self.session.response = Response(block=True)
        task = asyncio.create_task(self.search())
        await self.session.response.content.started.wait()
        task.cancel()
        await self.session.closing.wait()
        task.cancel()
        await asyncio.sleep(0)
        self.assertFalse(task.done())
        self.assertTrue(self.session.response.closed)
        release.set()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assert_closed()

    async def test_caller_failure_preserved_and_owned_response_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'caller failed'):
            async with self.client.stream_factory(transport.STREAM_URL, {}):
                raise RuntimeError('caller failed')
        self.assert_closed()


if __name__ == '__main__':
    unittest.main()
