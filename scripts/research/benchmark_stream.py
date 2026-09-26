"""Local synthetic SSE load test. Never reads X, production data or credentials.

python scripts/research/benchmark_stream.py --clients 3000
Both server and simulated browsers run in this process; memory is not a
production server-only measurement. This is a short load test, not a soak test.
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


async def benchmark(count):
    items = [{"id": 1, "ticker": "TEST", "firm": "Synthetic", "previous": 100, "latest": 120}]
    app, hub = create_gateway(lambda: {"ok": True, "items": items}, "local-test-secret", "http://127.0.0.1:1")
    runner = web.AppRunner(app, access_log=None, shutdown_timeout=.1)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0, backlog=4096)
    await site.start()
    url = f"http://127.0.0.1:{site._server.sockets[0].getsockname()[1]}/price-targets/events"
    origin = "https://local-benchmark.example"
    payload = base64.urlsafe_b64encode(json.dumps({"purpose": PURPOSE, "origin": origin, "exp": time.time()+780}).encode()).decode().rstrip("=")
    sig = base64.urlsafe_b64encode(hmac.new(b"local-test-secret", payload.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    headers = {"Origin": origin, "Authorization": "Bearer " + payload + "." + sig}
    responses = []
    try:
        async with ClientSession(connector=TCPConnector(limit=0), timeout=ClientTimeout(total=None, sock_read=60)) as client:
            semaphore = asyncio.Semaphore(100)
            async def connect():
                async with semaphore:
                    response = await client.get(url, headers=headers)
                    if response.status != 200:
                        raise RuntimeError(f"connection status {response.status}")
                    responses.append(response)
                    await response.content.readuntil(b"\n\n")
            await asyncio.gather(*(connect() for _ in range(count)))
            baseline = hub.bytes_sent
            reads = hub.reads
            await asyncio.sleep(3)
            idle_bytes = hub.bytes_sent - baseline
            shared_reads = hub.reads - reads
            started = time.perf_counter()
            items[0] = {**items[0], "latest": 125}
            async def changed(response):
                frame = await response.content.readuntil(b"\n\n")
                while frame.startswith(b"event: ping"):
                    frame = await response.content.readuntil(b"\n\n")
                if b'"latest":125' not in frame:
                    raise RuntimeError("change missing")
                return (time.perf_counter()-started)*1000
            latencies = sorted(await asyncio.gather(*(changed(r) for r in responses)))
            print(json.dumps({"clients": count, "idleSeconds": 3, "idleBytes": idle_bytes,
                "sharedReadsDuringIdle": shared_reads, "delivered": len(latencies),
                "changeToReceiveP50Ms": round(latencies[len(latencies)//2], 1),
                "changeToReceiveP95Ms": round(latencies[int(len(latencies)*.95)], 1),
                "changeToReceiveMaxMs": round(latencies[-1], 1),
                "combinedServerAndClientPeakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))
            for response in responses:
                response.close()
    finally:
        for response in responses:
            response.close()
        await runner.cleanup()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clients", type=int, default=100)
    args = parser.parse_args()
    if not 1 <= args.clients <= 3000:
        parser.error("clients must be between 1 and 3000")
    asyncio.run(benchmark(args.clients))
