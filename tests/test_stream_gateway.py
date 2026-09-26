import asyncio
import base64
import hashlib
import gzip
import hmac
import json
from pathlib import Path
import sys
import time
import unittest

from aiohttp import ClientSession, TCPConnector, web

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "research"))
from stream_gateway import PURPOSE, create_gateway, verify_ticket


def ticket(secret="test-secret", origin="https://preview.example.com", exp=None):
    payload = base64.urlsafe_b64encode(json.dumps({"purpose": PURPOSE, "origin": origin,
        "exp": exp or time.time() + 780}).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return payload + "." + signature


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.items = []
        self.fail = False
        def read():
            if self.fail:
                raise RuntimeError("database unavailable")
            return {"ok": True, "items": self.items, "generatedAt": str(time.time())}
        self.app, self.hub = create_gateway(read, "test-secret", "http://127.0.0.1:1", interval=.02, heartbeat=1, max_clients=20)
        self.runner = web.AppRunner(self.app, access_log=None, shutdown_timeout=.1)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        self.url = "http://127.0.0.1:" + str(self.site._server.sockets[0].getsockname()[1])
        self.client = ClientSession(connector=TCPConnector(limit=0))
        self.connections = []

    async def asyncTearDown(self):
        for response in self.connections:
            response.close()
        await self.client.close()
        await self.runner.cleanup()

    async def connect(self, **kwargs):
        response = await self.client.get(self.url + "/price-targets/events", headers={
            "Origin": "https://preview.example.com", "Authorization": "Bearer " + ticket(**kwargs)})
        self.connections.append(response)
        return response

    async def frame(self, response):
        return (await asyncio.wait_for(response.content.readuntil(b"\n\n"), 2)).decode()

    async def test_auth_scope_and_expiry(self):
        self.assertIsNone(verify_ticket(ticket(), "test-secret", "https://evil.example.com"))
        self.assertIsNone(verify_ticket(ticket() + "x", "test-secret", "https://preview.example.com"))
        self.assertIsNone(verify_ticket(ticket(exp=time.time()-1), "test-secret", "https://preview.example.com"))
        self.assertIsNone(verify_ticket(ticket(exp=time.time()+9000), "test-secret", "https://preview.example.com"))
        rejected = await self.connect(secret="wrong-secret")
        self.assertEqual(rejected.status, 401)
        self.assertEqual(len(self.hub.clients), 0)
        stats = await self.client.get(self.url + "/price-targets/stream-status")
        self.assertEqual(stats.status, 401)

    async def test_shared_reader_changes_only_and_reconnect_catches_up(self):
        streams = await asyncio.gather(*(self.connect() for _ in range(10)))
        first = await asyncio.gather(*(self.frame(response) for response in streams))
        self.assertTrue(all('"items":[]' in frame for frame in first))
        before = self.hub.reads
        await asyncio.sleep(.11)
        self.assertLess(self.hub.reads - before, 9)  # shared reads, not 10 per tick
        self.assertEqual(self.hub.changes, 1)  # generatedAt alone never broadcasts
        self.items = [{"id": 1, "ticker": "AMD"}]
        changed = await asyncio.gather(*(self.frame(response) for response in streams))
        self.assertTrue(all('"ticker":"AMD"' in frame for frame in changed))
        streams[0].close()
        self.items = [{"id": 2, "ticker": "MU"}]
        restored = await self.connect()
        self.assertIn('"ticker":"MU"', await self.frame(restored))
        self.items = []
        self.assertIn('"items":[]', await self.frame(restored))

    async def test_failure_is_not_silently_presented_as_fresh(self):
        response = await self.connect()
        await self.frame(response)
        self.fail = True
        self.assertIn("event: unavailable", await self.frame(response))
        failed = await self.client.get(self.url + "/price-targets/stream-status", headers={
            "Authorization": "Bearer test-secret"})
        failed_payload = await failed.json()
        self.assertTrue(failed_payload["active"])
        self.assertGreaterEqual(failed_payload["readFailures"], 1)
        self.assertGreaterEqual(failed_payload["consecutiveFailures"], 1)
        self.assertIsNotNone(failed_payload["lastFailureAt"])
        self.assertNotIn("error", failed_payload)
        self.fail = False
        self.assertIn("event: snapshot", await self.frame(response))
        recovered = await self.client.get(self.url + "/price-targets/stream-status", headers={
            "Authorization": "Bearer test-secret"})
        recovered_payload = await recovered.json()
        self.assertTrue(recovered_payload["healthy"])
        self.assertEqual(recovered_payload["consecutiveFailures"], 0)
        self.assertGreaterEqual(recovered_payload["recoveries"], 1)
        self.assertIsNotNone(recovered_payload["lastSuccessAt"])

    async def test_ticket_rotation_and_connection_limit(self):
        response = await self.connect(exp=time.time()+.1)
        await self.frame(response)
        await asyncio.wait_for(response.read(), 1)
        self.assertEqual(len(self.hub.clients), 0)
        streams = await asyncio.gather(*(self.connect() for _ in range(20)))
        self.assertTrue(all(s.status == 200 for s in streams))
        rejected = await self.connect()
        self.assertEqual(rejected.status, 503)
        stats = await self.client.get(self.url + "/price-targets/stream-status", headers={
            "Authorization": "Bearer test-secret"})
        payload = await stats.json()
        self.assertEqual(payload["connectionsAccepted"], 21)
        self.assertEqual(payload["connectionsRejected"], 1)
        self.assertEqual(payload["maxClients"], 20)
        self.assertNotIn("ticket", payload)
        self.assertNotIn("url", payload)

    async def test_existing_api_proxy_preserves_auth_post_and_gzip(self):
        upstream = web.Application()
        async def echo(request):
            if request.headers.get("Authorization") != "Bearer private-token":
                return web.Response(status=401)
            return web.Response(body=gzip.compress(await request.read()), headers={"Content-Encoding": "gzip"})
        upstream.router.add_post("/admin/test", echo)
        async def health(_request):
            return web.json_response({"ready": True})
        async def live(_request):
            return web.json_response({"ok": True, "mode": "automatic", "monitor": {"ready": True},
                                      "snapshot": {"sources": []}})
        upstream.router.add_get("/health", health)
        upstream.router.add_get("/live", live)
        upstream_runner = web.AppRunner(upstream, access_log=None)
        await upstream_runner.setup()
        upstream_site = web.TCPSite(upstream_runner, "127.0.0.1", 0)
        await upstream_site.start()
        port = upstream_site._server.sockets[0].getsockname()[1]
        gateway, _ = create_gateway(lambda: {"ok": True, "items": []}, "secret", f"http://127.0.0.1:{port}")
        gateway_runner = web.AppRunner(gateway, access_log=None)
        await gateway_runner.setup()
        gateway_site = web.TCPSite(gateway_runner, "127.0.0.1", 0)
        await gateway_site.start()
        gateway_port = gateway_site._server.sockets[0].getsockname()[1]
        try:
            url = f"http://127.0.0.1:{gateway_port}/admin/test"
            rejected = await self.client.post(url, data=b'{}')
            self.assertEqual(rejected.status, 401)
            response = await self.client.post(url, data=b'{"test":"preserved"}', headers={"Authorization": "Bearer private-token"})
            self.assertEqual(response.status, 200)
            self.assertEqual(await response.json(content_type=None), {"test": "preserved"})
            health_response = await self.client.get(f"http://127.0.0.1:{gateway_port}/health")
            health_payload = await health_response.json()
            self.assertFalse(health_payload["priceTargetStream"]["active"])
            self.assertFalse(health_payload["priceTargetStream"]["checkedSinceStart"])
            self.assertFalse(health_payload["priceTargetStream"]["healthy"])
            self.assertEqual(health_payload["priceTargetStream"]["clients"], 0)
            self.assertEqual(health_payload["priceTargetStream"]["maxClients"], 3500)
            live_response = await self.client.get(f"http://127.0.0.1:{gateway_port}/live")
            live_payload = await live_response.json()
            self.assertIn("priceTargetStream", live_payload["monitor"])
            self.assertNotIn("priceTargetStream", live_payload["snapshot"])
        finally:
            await gateway_runner.cleanup()
            await upstream_runner.cleanup()


if __name__ == "__main__":
    unittest.main()
