import asyncio
import base64
import hashlib
import hmac
import json
from pathlib import Path
import sys
import time
import unittest

from aiohttp import ClientSession, web

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts" / "research"))
from stream_gateway import NEWS_PURPOSE, PURPOSE, create_gateway, news_revision_reader

ORIGIN = "https://preview.example.com"


def ticket(purpose, secret="test-secret"):
    payload = base64.urlsafe_b64encode(json.dumps({"purpose": purpose, "origin": ORIGIN,
        "exp": time.time() + 780}).encode()).decode().rstrip("=")
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    return payload + "." + signature


class NewsStreamTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.news = {"ok": True, "officialUpdates": [{"id": "1", "title": "First"}]}
        reader = news_revision_reader(lambda max_age=None: self.news)
        self.app, _ = create_gateway(lambda: {"ok": True, "items": []}, "test-secret", "http://127.0.0.1:1",
                                     interval=.02, heartbeat=1, max_clients=20, news_reader=reader,
                                     news_interval=.02)
        self.runner = web.AppRunner(self.app, access_log=None, shutdown_timeout=.1)
        await self.runner.setup()
        self.site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await self.site.start()
        self.url = "http://127.0.0.1:" + str(self.site._server.sockets[0].getsockname()[1]) + "/news/events"
        self.client = ClientSession()

    async def asyncTearDown(self):
        await self.client.close()
        await self.runner.cleanup()

    async def frame(self, response):
        return (await asyncio.wait_for(response.content.readuntil(b"\n\n"), 2)).decode()

    async def test_change_signal_carries_only_a_revision(self):
        async with self.client.get(self.url, headers={"Origin": ORIGIN, "Authorization": "Bearer " + ticket(NEWS_PURPOSE)}) as response:
            self.assertEqual(response.status, 200)
            first = json.loads((await self.frame(response)).split("data: ", 1)[1])
            self.assertNotIn("First", json.dumps(first))  # No story content in the push.
            self.news = {"ok": True, "officialUpdates": [{"id": "2", "title": "Second"}]}
            second = json.loads((await self.frame(response)).split("data: ", 1)[1])
            self.assertNotEqual(first["items"], second["items"])

    async def test_price_target_ticket_cannot_open_news_stream(self):
        async with self.client.get(self.url, headers={"Origin": ORIGIN, "Authorization": "Bearer " + ticket(PURPOSE)}) as response:
            self.assertEqual(response.status, 401)


if __name__ == "__main__":
    unittest.main()
