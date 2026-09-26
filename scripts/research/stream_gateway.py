"""Async delivery of the shared, public price-target snapshot.

The existing authenticated monitor API stays on loopback. SSE clients share one
database reader; there are no per-viewer upstream/X requests or worker threads.
"""
import asyncio
import base64
import contextlib
import hashlib
import hmac
import json
import time

from aiohttp import ClientError, ClientSession, ClientTimeout, web


PURPOSE = "tech-phase-price-target-stream-v1"
STREAM_PATH = "/price-targets/events"


def verify_ticket(ticket, secret, origin, now=None):
    now = time.time() if now is None else now
    try:
        if not secret or not origin or len(ticket) > 2048:
            return None
        payload, signature = ticket.split(".")
        expected = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()
        actual = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
        if not hmac.compare_digest(expected, actual):
            return None
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if (data.get("purpose") != PURPOSE or data.get("origin") != origin or
                not isinstance(data.get("exp"), (float, int)) or
                not now < data["exp"] <= now + 840):
            return None
        return data
    except (ValueError, TypeError, AttributeError):
        return None


class SnapshotHub:
    def __init__(self, reader, interval=1):
        self.reader = reader
        self.interval = interval
        self.clients = set()
        self.wake = asyncio.Event()
        self.current = None
        self.revision = None
        self.reads = 0
        self.changes = 0
        self.bytes_sent = 0
        self.healthy = False

    def subscribe(self):
        queue = asyncio.Queue(maxsize=1)
        self.clients.add(queue)
        # Every connection receives the current full state on the next read.
        # Replacing the list also catches removals/expiry after a disconnect.
        self.wake.set()
        return queue

    def unsubscribe(self, queue):
        self.clients.discard(queue)

    async def run(self):
        while True:
            if not self.clients:
                self.wake.clear()
                await self.wake.wait()
            try:
                payload = await asyncio.to_thread(self.reader)
                self.reads += 1
                if not payload.get("ok") or not isinstance(payload.get("items"), list) or len(payload["items"]) > 30:
                    raise ValueError("invalid-snapshot")
                items = json.dumps(payload["items"], ensure_ascii=False, separators=(",", ":"))
                if len(items.encode()) > 100_000:
                    raise ValueError("snapshot-too-large")
                revision = hashlib.sha256(items.encode()).hexdigest()
                changed = revision != self.revision
                if changed or not self.healthy:
                    self.changes += int(changed)
                    self.revision = revision
                    self.current = ("snapshot", json.dumps({"ok": True, "items": payload["items"],
                                    "revision": revision}, ensure_ascii=False, separators=(",", ":")))
                    for queue in tuple(self.clients):
                        if queue.full():
                            queue.get_nowait()
                        queue.put_nowait(self.current)
                else:
                    for queue in tuple(self.clients):
                        if not getattr(queue, "initialized", False) and queue.empty():
                            queue.put_nowait(self.current)
                self.healthy = True
            except Exception:
                self.healthy = False
                for queue in tuple(self.clients):
                    if queue.full():
                        queue.get_nowait()
                    queue.put_nowait(("unavailable", "{}"))
            await asyncio.sleep(self.interval)


def create_gateway(reader, secret, upstream, *, interval=1, max_clients=3500, heartbeat=30):
    hub = SnapshotHub(reader, interval)
    app = web.Application(client_max_size=64 * 1024)
    # String keys keep the hub easy to inspect in standalone load tests.
    hub_key = web.AppKey("hub", SnapshotHub)
    session_key = web.AppKey("upstream_session", ClientSession)
    app[hub_key] = hub

    async def lifetime(_app):
        async with ClientSession(auto_decompress=False, timeout=ClientTimeout(total=120)) as session:
            _app[session_key] = session
            task = asyncio.create_task(hub.run())
            try:
                yield
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task
    app.cleanup_ctx.append(lifetime)

    def cors(request):
        return {"Access-Control-Allow-Origin": request.headers.get("Origin", "null"),
                "Vary": "Origin", "Cache-Control": "no-store"}

    async def events(request):
        headers = cors(request)
        if request.method == "OPTIONS":
            return web.Response(status=204, headers={**headers,
                "Access-Control-Allow-Methods": "GET", "Access-Control-Allow-Headers": "Authorization",
                "Access-Control-Max-Age": "600"})
        ticket = verify_ticket(request.headers.get("Authorization", "").removeprefix("Bearer "),
                               secret, request.headers.get("Origin"))
        if not ticket:
            return web.json_response({"ok": False}, status=401, headers=headers)
        if len(hub.clients) >= max_clients:
            return web.json_response({"ok": False}, status=503, headers={**headers, "Retry-After": "30"})
        queue = hub.subscribe()
        response = web.StreamResponse(headers={**headers, "Content-Type": "text/event-stream",
                                               "X-Accel-Buffering": "no"})
        try:
            await response.prepare(request)
            while time.time() < ticket["exp"]:
                try:
                    event, data = await asyncio.wait_for(queue.get(), min(heartbeat, ticket["exp"] - time.time()))
                    queue.initialized = True
                    frame = f"event: {event}\ndata: {data}\n\n".encode()
                except asyncio.TimeoutError:
                    if time.time() >= ticket["exp"]:
                        break
                    frame = b"event: ping\ndata: {}\n\n"
                await asyncio.wait_for(response.write(frame), timeout=5)
                hub.bytes_sent += len(frame)
        except (ConnectionError, asyncio.TimeoutError, RuntimeError):
            pass
        finally:
            hub.unsubscribe(queue)
        return response

    async def stats(request):
        if not secret or not hmac.compare_digest(request.headers.get("Authorization", ""), "Bearer " + secret):
            return web.json_response({"ok": False}, status=401)
        return web.json_response({"ok": True, "clients": len(hub.clients), "snapshotReads": hub.reads,
            "changes": hub.changes, "bytesSent": hub.bytes_sent, "healthy": hub.healthy},
            headers={"Cache-Control": "no-store"})

    async def proxy(request):
        # Preserve the existing Handler's authentication and response semantics.
        excluded = {"host", "connection", "transfer-encoding", "content-length", "upgrade"}
        headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}
        body = await request.read()
        try:
            async with app[session_key].request(request.method, upstream + request.rel_url.raw_path_qs,
                    headers=headers, data=body, allow_redirects=False) as upstream_response:
                response = web.StreamResponse(status=upstream_response.status, headers={
                    k: v for k, v in upstream_response.headers.items() if k.lower() not in {"connection", "transfer-encoding"}})
                await response.prepare(request)
                async for chunk in upstream_response.content.iter_chunked(65536):
                    await response.write(chunk)
                return response
        except (ClientError, ConnectionError, asyncio.TimeoutError):
            return web.json_response({"ok": False, "error": "monitor-unavailable"}, status=503)

    app.router.add_get(STREAM_PATH, events)
    app.router.add_options(STREAM_PATH, events)
    app.router.add_get("/price-targets/stream-status", stats)
    app.router.add_route("*", "/{path:.*}", proxy)
    return app, hub
