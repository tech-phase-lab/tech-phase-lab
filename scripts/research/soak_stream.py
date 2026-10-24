"""Synthetic sustained SSE test, including real ticket expiry and reconnects.

Uses only loopback and synthetic data. RSS includes server AND client memory.
python3 scripts/research/soak_stream.py --clients 3000 --seconds 840
"""
import argparse
import asyncio
import base64
import hashlib
import hmac
import json
import resource
import time

from aiohttp import ClientSession, ClientTimeout, TCPConnector, web
from stream_gateway import PURPOSE, create_gateway


async def run(count, seconds, ttl):
    secret, origin = "synthetic-soak", "https://synthetic.example"
    version = 0
    items = [{"id": i, "ticker": "TEST", "firm": "Synthetic", "latest": 100,
              "summary": "Synthetic payload " * 30, "version": 0} for i in range(30)]
    app, hub = create_gateway(lambda: {"ok": True, "items": items}, secret, "http://127.0.0.1:1")
    runner = web.AppRunner(app, access_log=None, shutdown_timeout=.1)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0, backlog=4096)
    await site.start()
    url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/price-targets/events"
    seen = [-1] * count
    reconnects = [0] * count
    errors, latencies, issued = [], [], {}
    stop = asyncio.Event()
    sem = asyncio.Semaphore(100)
    def headers():
        payload = base64.urlsafe_b64encode(json.dumps({"purpose": PURPOSE, "origin": origin,
            "exp": time.time() + ttl}).encode()).decode().rstrip("=")
        sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
        return {"Origin": origin, "Authorization": "Bearer " + payload + "." + sig}
    try:
        async with ClientSession(connector=TCPConnector(limit=0), timeout=ClientTimeout(total=None, sock_read=60)) as client:
            async def consume(index):
                while not stop.is_set():
                    try:
                        async with sem:
                            response = await client.get(url, headers=headers())
                        async with response:
                            if response.status != 200:
                                raise RuntimeError(f"http-{response.status}")
                            while not stop.is_set():
                                frame = await response.content.readuntil(b"\n\n")
                                if not frame:
                                    break
                                if not frame.startswith(b"event: snapshot\n"):
                                    continue
                                data = json.loads(frame.split(b"data: ", 1)[1])
                                received = data["items"][0]["version"]
                                if received > seen[index] and received in issued:
                                    latencies.append((time.monotonic() - issued[received]) * 1000)
                                seen[index] = received
                        reconnects[index] += 1
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:
                        errors.append(type(exc).__name__)
                        await asyncio.sleep(1)
            tasks = [asyncio.create_task(consume(i)) for i in range(count)]
            try:
                async with asyncio.timeout(120):
                    while min(seen) < 0:
                        await asyncio.sleep(.2)
                start = time.monotonic()
                initial_bytes, initial_reads = hub.bytes_sent, hub.reads
                print(json.dumps({"phase": "connected", "clients": count, "seconds": seconds,
                                  "payloadItems": 30, "ticketSeconds": ttl}), flush=True)
                while time.monotonic() - start < seconds:
                    version += 1
                    issued[version] = time.monotonic()
                    for item in items:
                        item["version"] = version
                    async with asyncio.timeout(15):
                        while min(seen) < version:
                            await asyncio.sleep(.05)
                    print(json.dumps({"phase": "update", "elapsed": round(time.monotonic()-start),
                        "version": version, "delivered": count, "renewals": sum(reconnects),
                        "bytes": hub.bytes_sent-initial_bytes, "errors": len(errors)}), flush=True)
                    await asyncio.sleep(min(20, max(0, seconds - (time.monotonic()-start))))
                values = sorted(latencies)
                print(json.dumps({"phase": "complete", "clients": count, "seconds": round(time.monotonic()-start, 1),
                    "versions": version, "latestDelivered": sum(x == version for x in seen),
                    "ticketRenewals": sum(reconnects), "errors": len(errors), "errorTypes": sorted(set(errors)),
                    "p95Ms": round(values[int(len(values)*.95)], 1), "maxMs": round(max(values), 1),
                    "sseBytes": hub.bytes_sent-initial_bytes, "sharedReads": hub.reads-initial_reads,
                    "combinedPeakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}), flush=True)
            finally:
                stop.set()
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clients", type=int, default=100)
    parser.add_argument("--seconds", type=int, default=840)
    parser.add_argument("--ticket-seconds", type=int, default=780)
    args = parser.parse_args()
    if not 1 <= args.clients <= 3000 or not 20 <= args.seconds <= 86400 or not 5 <= args.ticket_seconds <= 780:
        parser.error("clients 1..3000, seconds 20..86400, ticket-seconds 5..780")
    asyncio.run(run(args.clients, args.seconds, args.ticket_seconds))
