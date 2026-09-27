import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, POST } from '../app/api/research/notifications/route.ts';
test('push registration fails closed and rejects cross-site requests', async () => {
  const saved=process.env.WEB_PUSH_PILOT_CODE;
  delete process.env.WEB_PUSH_PILOT_CODE;
  try {
    assert.equal((await (await GET()).json()).enabled,false);
    const request=(origin,code='wrong')=>new Request('https://preview.example/api/research/notifications',{
      method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code,action:'register'})});
    assert.equal((await POST(request('https://other.example'))).status,403);
    assert.equal((await POST(request('https://preview.example'))).status,503);
    process.env.WEB_PUSH_PILOT_CODE='a'.repeat(32);
    assert.equal((await POST(request('https://preview.example'))).status,403);
  } finally { if(saved===undefined)delete process.env.WEB_PUSH_PILOT_CODE;else process.env.WEB_PUSH_PILOT_CODE=saved; }
});
test('status and test actions require the pilot code and proxy only fixed routes', async () => {
  const saved = { code: process.env.WEB_PUSH_PILOT_CODE, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN, fetch: globalThis.fetch };
  process.env.WEB_PUSH_PILOT_CODE = 'b'.repeat(32);
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example';
  process.env.RESEARCH_MONITOR_TOKEN = 'server-only';
  const calls=[];
  globalThis.fetch=async (url, options) => { calls.push([String(url),JSON.parse(options.body)]);return Response.json({ok:true,accepted:true,registered:true}); };
  try {
    for (const action of ['status','test']) {
      const request=code=>new Request('https://preview.example/api/research/notifications',{method:'POST',headers:{origin:'https://preview.example','content-type':'application/json'},body:JSON.stringify({action,code,subscription:{endpoint:'device'},language:'ja'})});
      assert.equal((await POST(request('wrong'))).status,403);
      assert.equal((await POST(request('b'.repeat(32)))).status,200);
    }
    assert.deepEqual(calls.map(c=>c[0]),['https://monitor.example/push/status','https://monitor.example/push/test']);
    assert.ok(calls.every(c=>!('code' in c[1])));
  } finally {
    globalThis.fetch=saved.fetch;
    for (const [key,value] of [['WEB_PUSH_PILOT_CODE',saved.code],['RESEARCH_MONITOR_URL',saved.url],['RESEARCH_MONITOR_TOKEN',saved.token]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
