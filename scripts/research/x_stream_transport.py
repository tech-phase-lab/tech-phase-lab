"""Lazy, default-off X GET transport; no rule operations or shared sessions.

The caller must commit a shared-ledger reservation before admission() returns
exactly True. Constructing this object, or its stream context, performs no I/O
and reads no credentials. Inject both the token provider and session in tests.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import timezone
from email.utils import parsedate_to_datetime
import json
import math
import os
import time

import aiohttp

import x_stream

STREAM_URL = 'https://api.x.com/2/tweets/search/stream'
SEARCH_URL = 'https://api.x.com/2/tweets/search/recent'
MAX_SEARCH_BYTES = 2 * 1024 * 1024
MAX_ERROR_BYTES = 16 * 1024
CONNECT_SECONDS = 15
SEARCH_SECONDS = 20
ERROR_SECONDS = 2
CLOSE_SECONDS = 5
MAX_RETRY_SECONDS = 86400
JSON_TYPES = {'application/json'}
STREAM_TYPES = JSON_TYPES | {'application/x-ndjson'}


class AmbiguousSearchResponse(x_stream.TransportFailure):
    """A paid request may have delivered unmeterable data: freeze the ledger."""
    def __init__(self, status=200, *, category='transport-error', http_status=None):
        super().__init__(status, quota=True, category=category, http_status=http_status)
        self.args = ('x-search-ambiguous-billing',)
        self.ambiguous_billing = True


def _failure_category(error, *, body=False, connection_established=False):
    """Pinned aiohttp classes, never class names/messages from untrusted errors.

    The outer deadline covers the entire GET, including DNS/TLS/connect.
    Only connection_create_end proves local connection setup completed; even
    then request write/response-header acceptance is unresolved. aiohttp's
    connection timeout can include pool wait and TLS, not just TCP.
    SocketTimeoutError before acceptance concerns headers; afterwards, the body.
    """
    if isinstance(error, aiohttp.ClientConnectorDNSError):
        return 'dns-error'
    if isinstance(error, aiohttp.ClientSSLError):
        return 'tls-error'
    if isinstance(error, aiohttp.ConnectionTimeoutError):
        return 'connection-timeout'
    if isinstance(error, aiohttp.ClientConnectorError):
        return 'socket-connect-error'
    if isinstance(error, aiohttp.SocketTimeoutError):
        return 'body-read-idle-timeout' if body else 'response-header-read-idle-timeout'
    if isinstance(error, asyncio.TimeoutError) and not body:
        return 'post-connect-header-deadline' if connection_established else 'preaccept-deadline'
    return 'body-read-error' if body else 'transport-error'


def service_token():
    """Called only after committed-budget admission; never cache credentials."""
    return os.environ.get('X_BEARER_TOKEN', '')


def _retry_hint(headers):
    hints = []
    for key in ('Retry-After', 'x-rate-limit-reset'):
        value = headers.get(key)
        if not isinstance(value, str) or len(value) > 128:
            continue
        try:
            seconds = float(value)
            if key == 'x-rate-limit-reset':
                seconds -= time.time()
        except ValueError:
            if key != 'Retry-After':
                continue
            try:
                date = parsedate_to_datetime(value)
                if date.tzinfo is None:
                    date = date.replace(tzinfo=timezone.utc)
                seconds = date.timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                continue
        if math.isfinite(seconds) and seconds >= 0:
            hints.append(min(seconds, MAX_RETRY_SECONDS))
    return max(hints, default=0)


def _json(body):
    # Reject nonstandard JSON constants, which json.loads otherwise permits.
    def invalid_constant(_value):
        raise ValueError
    def unique_keys(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError
            result[key] = value
        return result
    return json.loads(body, parse_constant=invalid_constant, object_pairs_hook=unique_keys)


async def _bounded_body(response, limit):
    body = bytearray()
    while True:
        block = await response.content.read(min(65536, limit + 1 - len(body)))
        if not isinstance(block, bytes):
            raise ValueError
        if not block:
            return bytes(body)
        body.extend(block)
        if len(body) > limit:
            raise ValueError


def _content_type(response):
    return response.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()


async def _http_failure(response):
    """Only bounded structured identifiers classify quota; never free text."""
    status = response.status
    quota, conflict = status == 402, status == 409
    try:
        if (_content_type(response) == 'application/json'
                and response.headers.get('Content-Encoding', 'identity').lower() == 'identity'):
            body = await asyncio.wait_for(_bounded_body(response, MAX_ERROR_BYTES), ERROR_SECONDS)
            payload = _json(body)
            entries = [payload] if isinstance(payload, dict) else []
            nested = payload.get('errors') if isinstance(payload, dict) else None
            if isinstance(nested, list) and len(nested) <= 32:
                entries += [entry for entry in nested if isinstance(entry, dict)]
            quota_types = {origin + suffix for origin in ('https://api.x.com/2/problems/',
                                                          'https://api.twitter.com/2/problems/')
                           for suffix in ('usage-capped', 'credits-depleted')}
            conflict_types = {origin + 'too-many-connections' for origin in
                              ('https://api.x.com/2/problems/', 'https://api.twitter.com/2/problems/')}
            for entry in entries:
                title, kind = entry.get('title'), entry.get('type')
                quota |= (isinstance(title, str) and title in {'UsageCapExceeded', 'CreditsDepleted'})
                quota |= isinstance(kind, str) and kind in quota_types
                conflict |= (isinstance(title, str) and title in {'ConnectionLimitExceeded', 'TooManyConnections'})
                conflict |= isinstance(kind, str) and kind in conflict_types
    except (ValueError, TypeError, RecursionError, aiohttp.ClientError, OSError, asyncio.TimeoutError):
        pass  # Untrusted error bodies are neither retained nor surfaced.
    return x_stream.TransportFailure(status, retry_after=_retry_hint(response.headers),
                                     quota=quota, connection_conflict=conflict,
                                     category='http-status', http_status=status)


async def _close_owned(response, session):
    """Finite owned cleanup; uncertain closure prevents replacement/recovery."""
    failed = False
    try:
        if response is not None:
            response.close()
    except Exception:
        failed = True
    try:
        closing = asyncio.create_task(session.close())
    except Exception:
        raise x_stream.TransportFailure(None, connection_conflict=True,
                                        category='owned-close-unconfirmed') from None
    deadline = asyncio.get_running_loop().time() + CLOSE_SECONDS
    cancelled = False
    while not closing.done():
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            closing.cancel()
            raise x_stream.TransportFailure(None, connection_conflict=True,
                                        category='owned-close-unconfirmed') from None
        try:
            await asyncio.wait_for(asyncio.shield(closing), remaining)
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            failed = True
            break
    try:
        failed |= closing.cancelled() or not closing.done() or closing.exception() is not None
        failed |= session.closed is not True or (response is not None and response.closed is not True)
    except Exception:
        failed = True
    if failed:
        if not closing.done():
            closing.cancel()
        raise x_stream.TransportFailure(None, connection_conflict=True,
                                        category='owned-close-unconfirmed') from None
    if cancelled:
        raise asyncio.CancelledError


class _StreamReader:
    def __init__(self, response):
        self.response = response

    async def read(self, size):
        if type(size) is not int or not 1 <= size <= 65536:
            raise x_stream.StreamBlocked('x-stream-read-size-invalid')
        try:
            value = await self.response.content.read(size)
            if not isinstance(value, bytes) or len(value) > size:
                raise ValueError
            return value
        except (ValueError, aiohttp.ClientError, OSError, asyncio.TimeoutError) as exc:
            raise x_stream.TransportFailure(None, category=_failure_category(exc, body=True),
                                            http_status=self.response.status) from None


class AiohttpTransport:
    def __init__(self, *, enabled=False, admission=None, token_provider=None, session_factory=None):
        self.enabled = enabled
        self.admission = admission
        self.token_provider = token_provider if token_provider is not None else service_token
        self.session_factory = session_factory

    def _authorize(self, url, params, expected):
        if self.enabled is not True:
            raise x_stream.StreamBlocked('x-stream-transport-disabled')
        if type(url) is not str or url != expected:
            raise x_stream.StreamBlocked('x-stream-endpoint-invalid')
        if (type(params) is not dict or len(params) > 16
                or any(type(k) is not str or not 1 <= len(k) <= 64
                       or type(v) not in (str, int) or len(str(v)) > 4096
                       for k, v in params.items())):
            raise x_stream.StreamBlocked('x-stream-params-invalid')
        # This callback must verify the COMMITTED reservation, not reserve later.
        if not callable(self.admission) or self.admission() is not True:
            raise x_stream.StreamBlocked('x-stream-budget-admission-required')
        try:
            token = self.token_provider()
            if (not isinstance(token, str) or not 1 <= len(token) <= 8192
                    or not token.isascii() or any(ord(char) <= 32 or ord(char) >= 127 for char in token)):
                raise ValueError
        except Exception:
            raise x_stream.StreamBlocked('x-stream-token-unavailable') from None
        return token

    @asynccontextmanager
    async def _response(self, url, params, expected):
        token = self._authorize(url, params, expected)
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json',
                   'Accept-Encoding': 'identity', 'User-Agent': 'TechPhaseResearch/1.0'}
        token = None
        factory = self.session_factory if self.session_factory is not None else aiohttp.ClientSession
        response, session = None, None
        connection_established = False

        async def connected(_session, _context, _params):
            nonlocal connection_established
            connection_established = True  # No trace parameters are read or retained.

        trace = aiohttp.TraceConfig()
        trace.on_connection_create_end.append(connected)
        try:
            try:
                session = factory(trace_configs=[trace], trust_env=False, auth=None, cookie_jar=aiohttp.DummyCookieJar(),
                                  auto_decompress=False, raise_for_status=False,
                                  timeout=aiohttp.ClientTimeout(total=None, connect=CONNECT_SECONDS,
                                                                sock_read=x_stream.HEARTBEAT_SECONDS))
                # aiohttp automatically retries some GET disconnects. An admitted
                # paid request must never silently become two upstream requests.
                try:
                    if not hasattr(session, '_retry_connection'):
                        raise ValueError
                    session._retry_connection = False
                    if session._retry_connection is not False:
                        raise ValueError
                except Exception:
                    raise x_stream.StreamBlocked('x-stream-retry-control-unavailable') from None
                response = await asyncio.wait_for(session.get(
                    url, params=dict(params), headers=headers, allow_redirects=False,
                    ssl=True, proxy=None, auth=None), CONNECT_SECONDS)
            except x_stream.StreamBlocked:
                raise
            except Exception as exc:
                category = _failure_category(exc, connection_established=connection_established)
                if expected == SEARCH_URL:
                    raise AmbiguousSearchResponse(status=None, category=category) from None
                raise x_stream.TransportFailure(None, category=category) from None
            finally:
                headers.clear()
            if response.status != 200:
                raise await _http_failure(response)
            allowed = STREAM_TYPES if expected == STREAM_URL else JSON_TYPES
            category = None
            if _content_type(response) not in allowed:
                category = 'content-type-rejected'
            elif response.headers.get('Content-Encoding', 'identity').lower() != 'identity':
                category = 'content-encoding-rejected'
            if category:
                if expected == SEARCH_URL:
                    raise AmbiguousSearchResponse(category=category, http_status=response.status)
                # Keep synthetic 400 for the established failure policy; record
                # the actual HTTP 200 separately, without any header values.
                raise x_stream.TransportFailure(400, category=category, http_status=response.status)
            yield response
        finally:
            if session is not None:
                await _close_owned(response, session)

    @asynccontextmanager
    async def stream_factory(self, url, params):
        async with self._response(url, params, STREAM_URL) as response:
            yield _StreamReader(response)

    async def search(self, url, params):
        received_payload = None
        try:
            async with self._response(url, params, SEARCH_URL) as response:
                try:
                    body = await asyncio.wait_for(_bounded_body(response, MAX_SEARCH_BYTES), SEARCH_SECONDS)
                    payload = _json(body)
                    if not isinstance(payload, dict):
                        raise ValueError
                    # Keep every parsed object for metering BEFORE semantic
                    # rejection, even if cleanup subsequently prevents return.
                    received_payload = payload
                except (ValueError, TypeError, RecursionError, aiohttp.ClientError, OSError, asyncio.TimeoutError):
                    raise AmbiguousSearchResponse() from None
        except (x_stream.TransportFailure, asyncio.CancelledError) as exc:
            if received_payload is not None:
                # Private, in-memory accounting handoff only. Never serialize the
                # exception's attributes into logs/health or project this page.
                # Exception args/str/repr remain sanitized and contain no body.
                exc.received_payload = received_payload
            raise
        return received_payload
