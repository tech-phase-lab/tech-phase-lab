"""Real aiohttp/TLS transport checks confined to one guarded loopback socket.

No provider, credentials, rule endpoint, production URL override, or deployment
is used. Only the injected session's get method maps the two approved public
URLs to the local fixture, retaining production authorization/request options.
"""
import asyncio
from contextlib import suppress
import json
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

import aiohttp
from aiohttp import web
from yarl import URL

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts/research'))
import x_stream
import x_stream_transport as transport

TOKEN = 'synthetic-loopback-token-never-a-real-credential'
PARAMS = {'query': 'from:synthetic', 'max_results': 30}
PUBLIC_PATHS = {
    'https://api.x.com/2/tweets/search/stream': '/2/tweets/search/stream',
    'https://api.x.com/2/tweets/search/recent': '/2/tweets/search/recent',
}


class LoopbackTransportTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        openssl = shutil.which('openssl')
        if openssl is None:
            raise RuntimeError('TLS loopback verification requires the system openssl executable')
        directory = tempfile.TemporaryDirectory(prefix='x-stream-loopback-')
        cls.addClassCleanup(directory.cleanup)
        cls.certificate = Path(directory.name) / 'certificate.pem'
        key = Path(directory.name) / 'fixture-key.pem'
        # A disposable fixture key, not an account credential. Do not inherit
        # credential-bearing environment values into the certificate generator.
        subprocess.run([
            openssl, 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
            '-keyout', str(key), '-out', str(cls.certificate), '-days', '1',
            '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
        ], check=True, capture_output=True, env={'PATH': '/usr/bin:/bin'}, timeout=15)
        cls.server_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        cls.server_ssl.load_cert_chain(str(cls.certificate), str(key))

    async def asyncSetUp(self):
        self.assertEqual(transport.STREAM_URL, next(iter(PUBLIC_PATHS)))
        self.assertEqual(transport.SEARCH_URL, list(PUBLIC_PATHS)[1])
        self.client_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.client_ssl.load_verify_locations(cafile=str(self.certificate))
        self.assertTrue(self.client_ssl.check_hostname)
        self.assertEqual(self.client_ssl.verify_mode, ssl.CERT_REQUIRED)
        self.sessions = []
        self.connectors = []
        self.responses = []
        self.server_requests = []
        self.server_transports = []
        self.calls = []
        self.connection_attempts = []
        self.server_errors = []
        self.guard_violations = []
        self.loop_errors = []
        self.expect_tls_rejection = False
        loop = asyncio.get_running_loop()
        original_handler = loop.get_exception_handler()

        def loop_exception_handler(_loop, context):
            # Certificate rejection intentionally resets the server handshake.
            if (self.expect_tls_rejection
                    and context.get('message') == 'Error on transport creation for incoming connection'
                    and isinstance(context.get('exception'), ConnectionResetError)):
                return
            self.loop_errors.append(context.get('message', 'unexpected loop error'))

        loop.set_exception_handler(loop_exception_handler)
        self.addCleanup(loop.set_exception_handler, original_handler)
        self.handler = None
        self.release = asyncio.Event()
        app = web.Application()
        app.router.add_route('*', '/{path:.*}', self._dispatch)
        self.runner = web.AppRunner(app, access_log=None, shutdown_timeout=.1,
                                    handler_cancellation=True)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, '127.0.0.1', 0, ssl_context=self.server_ssl)
        await self.site.start()
        self.port = self.site._server.sockets[0].getsockname()[1]
        self.base_url = URL(f'https://127.0.0.1:{self.port}')

        original_connect = socket.socket.connect
        original_connect_ex = socket.socket.connect_ex

        def allowed(sock, address):
            # Guard below aiohttp's resolver/connector, including its internal
            # retries: no external address or even another local port is allowed.
            if (sock.family != socket.AF_INET or not isinstance(address, tuple)
                    or address != ('127.0.0.1', self.port)):
                self.guard_violations.append('non-fixture socket connection')
                raise AssertionError('non-fixture socket connection forbidden')
            self.connection_attempts.append(address)

        def connect(sock, address):
            allowed(sock, address)
            return original_connect(sock, address)

        def connect_ex(sock, address):
            allowed(sock, address)
            return original_connect_ex(sock, address)

        def forbidden(kind):
            def reject(*_args, **_kwargs):
                self.guard_violations.append(kind)
                raise AssertionError(kind + ' forbidden')
            return reject

        for guard in (
            patch.object(socket.socket, 'connect', connect),
            patch.object(socket.socket, 'connect_ex', connect_ex),
            patch.object(socket, 'getaddrinfo', side_effect=forbidden('DNS lookup')),
            patch.object(transport, 'service_token', side_effect=forbidden('real token lookup')),
            patch.object(aiohttp.client, 'get_env_proxy_for_url',
                         side_effect=forbidden('environment proxy lookup')),
        ):
            guard.start()
            self.addCleanup(guard.stop)
        self.admission = Mock(return_value=True)
        self.token = Mock(return_value=TOKEN)
        self.client = transport.AiohttpTransport(
            enabled=True, admission=self.admission, token_provider=self.token,
            session_factory=self._session_factory)

    async def asyncTearDown(self):
        self.release.set()
        for response in self.responses:
            response.close()
        for session in self.sessions:
            await session.close()
        await self.runner.cleanup()
        self.assertFalse(self.server_errors, self.server_errors)
        self.assertFalse(self.guard_violations, self.guard_violations)
        self.assertFalse(self.loop_errors, self.loop_errors)
        self.assertTrue(all(session.closed for session in self.sessions))
        self.assertTrue(all(connector.closed for connector in self.connectors))
        self.assertEqual(transport.STREAM_URL, next(iter(PUBLIC_PATHS)))
        self.assertEqual(transport.SEARCH_URL, list(PUBLIC_PATHS)[1])

    async def _dispatch(self, request):
        self.server_transports.append(request.transport)
        self.server_requests.append({
            'method': request.method, 'path': request.path,
            'query': dict(request.query), 'headers': dict(request.headers),
            'tls': request.transport.get_extra_info('ssl_object') is not None,
        })
        try:
            self.assertEqual(request.method, 'GET')
            self.assertIn(request.path, PUBLIC_PATHS.values())
            self.assertIsNotNone(self.handler)
            return await self.handler(request)
        except (asyncio.CancelledError, ConnectionResetError):
            raise
        except Exception as exc:
            self.server_errors.append(repr(exc))
            raise

    def _session_factory(self, **options):
        self.assertIs(options['trust_env'], False)
        self.assertIsNone(options['auth'])
        self.assertIsInstance(options['cookie_jar'], aiohttp.DummyCookieJar)
        self.assertIs(options['auto_decompress'], False)
        return self._new_session(**options)

    def _new_session(self, **options):
        connector = aiohttp.TCPConnector(ssl=self.client_ssl, family=socket.AF_INET,
                                        use_dns_cache=False)
        session = aiohttp.ClientSession(connector=connector, **options)
        real_get = session.get
        self.connectors.append(connector)
        self.sessions.append(session)

        async def fixture_get(url, **kwargs):
            self.assertIn(url, PUBLIC_PATHS)
            self.assertIs(kwargs['ssl'], True)
            self.assertIs(kwargs['allow_redirects'], False)
            self.assertIsNone(kwargs['proxy'])
            self.assertIsNone(kwargs['auth'])
            self.calls.append((url, dict(kwargs, headers=dict(kwargs['headers']))))
            local_url = self.base_url.with_path(PUBLIC_PATHS[url])
            response = await real_get(local_url, **kwargs)
            self.responses.append(response)
            return response

        # Injection is confined to this test instance. _retry_connection is the
        # REAL ClientSession field consumed by aiohttp's real request machinery.
        session.get = fixture_get
        return session

    async def _closed(self):
        self.assertTrue(all(session.closed for session in self.sessions))
        self.assertTrue(all(connector.closed for connector in self.connectors))
        self.assertTrue(all(response.closed for response in self.responses))
        async with asyncio.timeout(2):
            while any(not peer.is_closing() for peer in self.server_transports):
                await asyncio.sleep(.005)

    async def _search(self):
        return await self.client.search(transport.SEARCH_URL, PARAMS)

    async def _stalled_body(self, request):
        response = web.StreamResponse(headers={'Content-Type': 'application/json'})
        await response.prepare(request)
        await self.release.wait()
        return response

    async def test_search_real_tls_success_retains_public_contract(self):
        payload = {'data': [{'id': '123', 'text': '合成テスト 🌱'}],
                   'meta': {'result_count': 1}}

        async def handler(request):
            return web.json_response(payload)

        self.handler = handler
        self.assertEqual(await self._search(), payload)
        self.admission.assert_called_once()
        self.token.assert_called_once()
        self.assertEqual(len(self.connection_attempts), 1)
        self.assertEqual(len(self.server_requests), 1)
        actual = self.server_requests[0]
        self.assertTrue(actual['tls'])
        self.assertEqual(actual['query'], {'query': 'from:synthetic', 'max_results': '30'})
        self.assertEqual(actual['headers']['Authorization'], 'Bearer ' + TOKEN)
        self.assertEqual(actual['headers']['Accept-Encoding'], 'identity')
        self.assertEqual(actual['headers']['Accept'], 'application/json')
        self.assertEqual(actual['headers']['User-Agent'], 'TechPhaseResearch/1.0')
        self.assertNotIn('Cookie', actual['headers'])
        self.assertEqual(self.calls[0][0], transport.SEARCH_URL)
        self.assertIs(self.sessions[0]._retry_connection, False)
        await self._closed()

    async def test_untrusted_certificate_fails_before_http_request(self):
        # The mapping never uses ssl=False or disables hostname verification.
        self.client_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        self.expect_tls_rejection = True
        self.handler = self._stalled_body
        with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
            await self._search()
        self.assertIsNone(raised.exception.status)
        self.assertEqual(self.server_requests, [])
        self.assertEqual(len(self.connection_attempts), 1)
        await self._closed()

    async def test_fragmented_utf8_ndjson_and_heartbeats_over_real_tls(self):
        first = {'data': {'id': '1', 'text': '株価 🌱'}}
        second = {'data': {'id': '2', 'text': 'second'}}
        encoded = json.dumps(first, ensure_ascii=False).encode()
        split = encoded.index('株'.encode()) + 1  # Inside a three-byte codepoint.
        pieces = [b'\r\n', encoded[:split], encoded[split:split + 1],
                  encoded[split + 1:] + b'\r', b'\n\n',
                  json.dumps(second).encode() + b'\n']
        consumed = asyncio.Queue()

        async def handler(request):
            response = web.StreamResponse(headers={'Content-Type': 'application/x-ndjson'})
            await response.prepare(request)
            for piece in pieces:
                await response.write(piece)
                await consumed.get()  # Force delivery across separate reads.
            await response.write_eof()
            return response

        self.handler = handler
        decoder, frames = x_stream.Decoder(), []
        async with asyncio.timeout(2):
            async with self.client.stream_factory(transport.STREAM_URL, dict(x_stream.STREAM_PARAMS)) as reader:
                for piece in pieces:
                    received = b''
                    while len(received) < len(piece):
                        chunk = await reader.read(len(piece) - len(received))
                        self.assertTrue(chunk)
                        received += chunk
                        frames.extend(decoder.feed(chunk))
                    self.assertEqual(received, piece)
                    consumed.put_nowait(True)
                self.assertEqual(await reader.read(65536), b'')
                decoder.finish()
        self.assertEqual(frames, [first, second])
        self.assertEqual(len(self.server_requests), 1)
        await self._closed()

    async def test_real_disconnect_retry_positive_control_and_transport_single_get(self):
        async def disconnect(request):
            request.transport.abort()  # Disconnect after receiving GET, before headers.
            return web.Response()

        self.handler = disconnect
        baseline = self._new_session(trust_env=False, timeout=aiohttp.ClientTimeout(total=2))
        self.assertIs(baseline._retry_connection, True)
        with self.assertRaises(aiohttp.ServerDisconnectedError):
            await baseline.get(transport.STREAM_URL, params={},
                               headers={'Authorization': 'Bearer ' + TOKEN},
                               allow_redirects=False, ssl=True, proxy=None, auth=None)
        await baseline.close()
        self.assertEqual(len(self.server_requests), 2, 'positive control must demonstrate aiohttp GET retry')
        for kind in ('stream', 'search'):
            with self.subTest(kind=kind):
                before = len(self.server_requests)
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    if kind == 'search':
                        await self._search()
                    else:
                        async with self.client.stream_factory(transport.STREAM_URL, {}):
                            self.fail('disconnected response cannot enter stream')
                self.assertEqual(len(self.server_requests) - before, 1,
                                 'one admission must create exactly one actual GET')
                self.assertIs(self.sessions[-1]._retry_connection, False)
                self.assertIsNone(raised.exception.status)
                self.assertEqual(isinstance(raised.exception, transport.AmbiguousSearchResponse), kind == 'search')
        self.assertEqual(self.admission.call_count, 2)
        await self._closed()

    async def test_cancellation_closes_owned_stream_without_closing_other_stream(self):
        self.handler = self._stalled_body
        entered = asyncio.Queue()

        async def consume():
            async with self.client.stream_factory(transport.STREAM_URL, {}) as reader:
                entered.put_nowait(True)
                await reader.read(65536)

        first = asyncio.create_task(consume())
        second = None
        try:
            await asyncio.wait_for(entered.get(), 2)
            second = asyncio.create_task(consume())
            await asyncio.wait_for(entered.get(), 2)
            first.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(first, 2)
            self.assertTrue(self.sessions[0].closed)
            self.assertTrue(self.connectors[0].closed)
            self.assertTrue(self.responses[0].closed)
            self.assertFalse(self.sessions[1].closed)
            self.assertFalse(self.connectors[1].closed)
            self.assertFalse(self.responses[1].closed)
            self.assertFalse(second.done())
            self.assertFalse(self.server_transports[1].is_closing())
        finally:
            for task in (first, second):
                if task is not None:
                    task.cancel()
                    with suppress(asyncio.CancelledError):
                        await task
        await self._closed()

    async def test_search_cancelled_while_waiting_for_headers_closes_socket(self):
        received = asyncio.Event()

        async def handler(request):
            received.set()
            await self.release.wait()
            return web.json_response({'meta': {'result_count': 0}})

        self.handler = handler
        task = asyncio.create_task(self._search())
        try:
            await asyncio.wait_for(received.wait(), 2)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, 2)
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        self.assertEqual(len(self.server_requests), 1)
        await self._closed()

    async def test_real_stream_socket_read_heartbeat_timeout_closes_socket(self):
        self.handler = self._stalled_body
        with patch.object(x_stream, 'HEARTBEAT_SECONDS', .1):
            async with asyncio.timeout(2):
                with self.assertRaises(x_stream.TransportFailure) as raised:
                    async with self.client.stream_factory(transport.STREAM_URL, {}) as reader:
                        await reader.read(65536)
        self.assertIsNone(raised.exception.status)
        self.assertEqual(self.sessions[0].timeout.sock_read, .1)
        self.assertEqual(str(raised.exception), 'x-stream-transport-failure')
        await self._closed()

    async def test_real_search_body_deadline_is_ambiguous_and_closes_socket(self):
        self.handler = self._stalled_body
        with patch.object(transport, 'SEARCH_SECONDS', .1), patch.object(x_stream, 'HEARTBEAT_SECONDS', 5):
            async with asyncio.timeout(2):
                with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
                    await self._search()
        self.assertEqual(raised.exception.status, 200)
        self.assertTrue(raised.exception.ambiguous_billing)
        self.assertEqual(self.sessions[0].timeout.sock_read, 5)
        self.assertEqual(str(raised.exception), 'x-search-ambiguous-billing')
        await self._closed()

    async def test_response_header_deadline_for_stream_and_search(self):
        async def handler(request):
            await self.release.wait()
            return web.json_response({'meta': {'result_count': 0}})

        self.handler = handler
        for kind in ('stream', 'search'):
            with self.subTest(kind=kind), patch.object(transport, 'CONNECT_SECONDS', .1):
                async with asyncio.timeout(2):
                    with self.assertRaises(x_stream.TransportFailure) as raised:
                        if kind == 'search':
                            await self._search()
                        else:
                            async with self.client.stream_factory(transport.STREAM_URL, {}):
                                self.fail('header timeout cannot enter stream')
                self.assertIsNone(raised.exception.status)
                self.assertEqual(isinstance(raised.exception, transport.AmbiguousSearchResponse), kind == 'search')
                self.assertEqual(self.sessions[-1].timeout.connect, .1)
        self.assertEqual(len(self.server_requests), 2)
        await self._closed()

    async def test_http_error_classification_is_structured_and_sanitized(self):
        marker = 'synthetic-provider-private-body'
        cases = [
            (429, {'title': 'CreditsDepleted', 'detail': marker + TOKEN}, True, False),
            (409, {'title': 'TooManyConnections', 'detail': marker + TOKEN}, False, True),
            (503, {'detail': 'CreditsDepleted ' + marker + TOKEN}, False, False),
        ]
        for status, body, quota, conflict in cases:
            async def handler(request, status=status, body=body):
                return web.json_response(body, status=status, headers={'Retry-After': '7'})

            self.handler = handler
            with self.subTest(status=status), self.assertRaises(x_stream.TransportFailure) as raised:
                await self._search()
            failure = raised.exception
            self.assertEqual(failure.status, status)
            self.assertEqual(failure.retry_after, 7)
            self.assertEqual(failure.quota, quota)
            self.assertEqual(failure.connection_conflict, conflict)
            self.assertNotIsInstance(failure, transport.AmbiguousSearchResponse)
            self.assertEqual(str(failure), 'x-stream-transport-failure')
            for secret in (marker, TOKEN):
                self.assertNotIn(secret, str(failure))
                self.assertNotIn(secret, repr(failure))
                self.assertNotIn(secret, repr(vars(failure)))
        await self._closed()

    async def test_redirect_is_not_followed_or_allowed_to_reach_dns(self):
        async def handler(request):
            return web.Response(status=302, headers={'Location': 'https://external.invalid/secret'},
                                text='synthetic-private-error-body')

        self.handler = handler
        with self.assertRaises(x_stream.TransportFailure) as raised:
            await self._search()
        self.assertEqual(raised.exception.status, 302)
        self.assertEqual(len(self.server_requests), 1)
        self.assertEqual(len(self.connection_attempts), 1)
        self.assertNotIn('external.invalid', repr(raised.exception))
        await self._closed()

    async def test_truncated_http_search_body_is_ambiguous(self):
        async def handler(request):
            response = web.StreamResponse(headers={'Content-Type': 'application/json',
                                                    'Content-Length': '1000'})
            await response.prepare(request)
            await response.write(b'{"data":[')
            request.transport.close()
            return response

        self.handler = handler
        async with asyncio.timeout(2):
            with self.assertRaises(transport.AmbiguousSearchResponse) as raised:
                await self._search()
        self.assertEqual(raised.exception.status, 200)
        self.assertTrue(raised.exception.ambiguous_billing)
        self.assertEqual(len(self.server_requests), 1)
        await self._closed()


if __name__ == '__main__':
    unittest.main()
