import test from 'node:test';
import assert from 'node:assert/strict';
import { newsPollDelay, NEWS_POLL_INTERVAL_MS, NEWS_PUSH_SAFETY_INTERVAL_MS } from '../lib/research/news-poller.ts';
import { isNewsStreamLive, subscribeNewsChanges } from '../lib/research/news-stream.ts';

test('push keeps polling only as a safety net while connected; failures still back off', () => {
  assert.equal(newsPollDelay(0, false), NEWS_POLL_INTERVAL_MS);
  assert.equal(newsPollDelay(0, true), NEWS_PUSH_SAFETY_INTERVAL_MS);
  assert.equal(newsPollDelay(2, true), newsPollDelay(2, false));
});

test('a news change signal wakes subscribers once per new revision', async () => {
  const saved = { window: globalThis.window, fetch: globalThis.fetch };
  globalThis.window = {};
  const encoder = new TextEncoder();
  let push;
  globalThis.fetch = async (url) => {
    if (url === '/api/research/news/stream') {
      return new Response(JSON.stringify({ ok: true, url: 'https://monitor.example/news/events', ticket: 't', expiresAt: Date.now() / 1000 + 600 }));
    }
    const body = new ReadableStream({ start(controller) { push = text => controller.enqueue(encoder.encode(text)); } });
    return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
  };
  let woken = 0;
  const unsubscribe = subscribeNewsChanges(() => { woken += 1; });
  try {
    for (let i = 0; i < 20 && !push; i++) await new Promise(resolve => setTimeout(resolve, 5));
    const frame = rev => `event: snapshot\ndata: {"ok":true,"items":["${rev}"],"revision":"x"}\n\n`;
    push(frame('a'));
    await new Promise(resolve => setTimeout(resolve, 10));
    push(frame('a') + 'event: ping\ndata: {}\n\n');
    await new Promise(resolve => setTimeout(resolve, 10));
    push(frame('b'));
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(woken, 2);
    assert.equal(isNewsStreamLive(), true);
  } finally {
    unsubscribe();
    Object.assign(globalThis, saved);
  }
  assert.equal(isNewsStreamLive(), false);
});
