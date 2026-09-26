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
