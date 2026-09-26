import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import { GET } from "../app/api/research/price-targets/stream/route.ts";
import { EventStreamParser, abortableDelay } from "../lib/research/event-stream.ts";

test("SSE preserves chunk boundaries, multiple events and multiline data", () => {
  const parser = new EventStreamParser();
  assert.deepEqual(parser.push("event: snap"), []);
  assert.deepEqual(parser.push('shot\r\ndata: {"items":[]}\r\n\r'), []);
  assert.deepEqual(parser.push('\nevent: ping\ndata: one\ndata: two\n\n: comment\n\n'), [
    {event: "snapshot", data: '{"items":[]}'}, {event: "ping", data: "one\ntwo"},
  ]);
  assert.throws(() => parser.push("x".repeat(200001)), /too large/);
});

test("retry delay cancels immediately when the page stops watching", async () => {
  const controller = new AbortController();
  const waiting = abortableDelay(60000, controller.signal);
  controller.abort(new Error("stopped"));
  await assert.rejects(waiting, /stopped/);
});

test("stream tickets are scoped, expiring, uncached and never expose the monitor token", async () => {
  const saved = {url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN};
  process.env.RESEARCH_MONITOR_URL = "https://monitor.example.com";
  process.env.RESEARCH_MONITOR_TOKEN = "private-server-token-for-test";
  try {
    const response = await GET(new Request("https://preview.example.com/api/research/price-targets/stream"));
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.url, "https://monitor.example.com/price-targets/events");
    assert.ok(!JSON.stringify(body).includes(process.env.RESEARCH_MONITOR_TOKEN));
    const [payload, signature] = body.ticket.split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    assert.equal(claims.purpose, "tech-phase-price-target-stream-v1");
    assert.equal(claims.origin, "https://preview.example.com");
    assert.ok(claims.exp > Date.now()/1000 + 770 && claims.exp <= Date.now()/1000 + 780);
    assert.equal(signature, createHmac("sha256", process.env.RESEARCH_MONITOR_TOKEN).update(payload).digest("base64url"));
    const rejected = await GET(new Request("https://preview.example.com/api/research/price-targets/stream", {headers: {origin:"https://other.example.com"}}));
    assert.equal(rejected.status, 403);
  } finally {
    if (saved.url === undefined) delete process.env.RESEARCH_MONITOR_URL; else process.env.RESEARCH_MONITOR_URL = saved.url;
    if (saved.token === undefined) delete process.env.RESEARCH_MONITOR_TOKEN; else process.env.RESEARCH_MONITOR_TOKEN = saved.token;
  }
});
