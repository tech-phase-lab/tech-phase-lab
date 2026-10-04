import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { events } from '../lib/research/content.ts';
import { publicEvent, isPublicSample } from '../lib/research/access.ts';

test('public records omit all premium analysis, including future fields, while preserving the approved MU sample', () => {
  for (const event of events) {
    const exposed = publicEvent({ ...event, futurePremiumField: 'private' });
    if (isPublicSample(event.id)) {
      assert.equal(exposed.locked, false);
      assert.deepEqual(exposed.analysis, event.analysis);
      continue;
    }
    assert.equal(exposed.locked, true);
    for (const field of ['interpretation', 'unknown', 'next']) assert.deepEqual(exposed[field], { ja: '', en: '' });
    for (const field of ['analysis', 'scenarios', 'valuation', 'futurePremiumField']) assert.equal(field in exposed, false);
    assert.deepEqual(exposed.facts, event.facts);
    assert.deepEqual(exposed.sources, event.sources);
  }
});

const source = readFileSync(new URL('../app/api/research/articles/[id]/route.ts', import.meta.url), 'utf8')
  .replace('import { loadLiveResultEvents } from "@/lib/research/live-result-events";', 'const loadLiveResultEvents = async () => globalThis.__articleTest.liveEvents ?? [];')
  .replace('import { events } from "@/lib/research/content-server";', 'const events = globalThis.__articleTest.events;')
  .replace('import { isPublicSample } from "@/lib/research/access";', 'const isPublicSample = globalThis.__articleTest.isPublicSample;')
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = async () => { if (globalThis.__articleTest.error) throw Error("offline"); return globalThis.__articleTest.member; };');

test('article API rejects anonymous, Free, expired and unavailable identities without exposing the body', async () => {
  globalThis.__articleTest = { events, isPublicSample };
  try {
    const { GET } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
    const protectedEvent = events.find(event => !isPublicSample(event.id));
    assert.ok(protectedEvent);
    const get = (id = protectedEvent.id) => GET(new Request('https://example.test'), { params: Promise.resolve({ id }) });
    for (const [member, status] of [
      [{ status: 'signed-out' }, 401],
      [{ status: 'unavailable' }, 503],
      [{ status: 'signed-in', plan: 'free' }, 403],
      [{ status: 'signed-in', plan: 'pro', accessExpiresAt: Date.now() - 1 }, 403],
      [{ status: 'signed-in', plan: 'pro' }, 403],
    ]) {
      globalThis.__articleTest.member = member;
      const response = await get();
      assert.equal(response.status, status);
      assert.equal((await response.json()).event, undefined);
      assert.match(response.headers.get('cache-control'), /private, no-store/);
    }
    globalThis.__articleTest.member = { status: 'signed-in', plan: 'pro', accessExpiresAt: Date.now() + 60_000 };
    const response = await get();
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).event.interpretation, protectedEvent.interpretation);
    globalThis.__articleTest.error = true;
    assert.equal((await get()).status, 503);
    assert.equal((await get('mu-q3-2026')).status, 200);
    assert.equal((await get('nonexistent')).status, 404);
  } finally { delete globalThis.__articleTest; }
});

test('automatically generated X articles keep server-side membership protection', async () => {
  const event={...events.find(e=>!isPublicSample(e.id)),id:'x-result-12345'};
  globalThis.__articleTest={events,isPublicSample,liveEvents:[event]};
  try {
    const {GET}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
    const get=()=>GET(new Request('https://example.test'),{params:Promise.resolve({id:event.id})});
    for(const member of [{status:'signed-out'},{status:'signed-in',plan:'free'},{status:'signed-in',plan:'pro',accessExpiresAt:Date.now()-1}]){
      globalThis.__articleTest.member=member;
      const response=await get();assert.ok([401,403].includes(response.status));assert.equal((await response.json()).event,undefined);
    }
    globalThis.__articleTest.member={status:'signed-in',plan:'pro',accessExpiresAt:Date.now()+60000};
    assert.equal((await get()).status,200);
  } finally {delete globalThis.__articleTest;}
});
