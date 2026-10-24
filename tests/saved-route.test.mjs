import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHmac } from 'node:crypto';
const source = readFileSync(new URL('../app/api/research/saved/route.ts', import.meta.url),'utf8')
  .replace('import { getMembership } from "@/lib/membership/server";', 'const getMembership = () => globalThis.__savedMember();')
  .replace('"@/lib/research/saved-document"', JSON.stringify(new URL('../lib/research/saved-document.ts',import.meta.url).href));
const { GET, POST } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('saved API authenticates owner, rejects account/CSRF/invalid payloads and bypasses caches', async () => {
  const old = { fetch: globalThis.fetch, url: process.env.RESEARCH_MONITOR_URL, token: process.env.RESEARCH_MONITOR_TOKEN };
  process.env.RESEARCH_MONITOR_URL = 'https://monitor.example'; process.env.RESEARCH_MONITOR_TOKEN = 'server-only-token';
  const calls=[]; globalThis.fetch=async (url, init) => {calls.push({url,init});return Response.json({ok:true,revision:0,document:{saved:[],notebooks:{}}});};
  const account=createHmac('sha256','server-only-token').update('saved-research:user_one').digest('hex');
  const body={account,revision:0,document:{saved:[],notebooks:{}}};
  const request=(value=body,origin='https://example.test')=>new Request('https://example.test/api/research/saved',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)});
  try {
    globalThis.__savedMember=async()=>({status:'signed-out'});
    assert.equal((await GET()).status,401);assert.equal(calls.length,0);
    globalThis.__savedMember=async()=>({status:'signed-in',userId:'user_one'});
    assert.equal((await POST(request(body,'https://other.test'))).status,403);
    assert.equal((await POST(request({...body,account:'b'.repeat(64)}))).status,409);
    assert.equal((await POST(request({...body,document:{saved:['x','x'],notebooks:{}}}))).status,400); assert.equal(calls.length,0);
    const response=await GET(); assert.equal(response.headers.get('cache-control'),'private, no-store'); assert.equal((await response.json()).account,account);
    assert.equal(calls[0].init.headers['X-Saved-Research-Owner'],account);assert.equal(calls[0].url.pathname,'/saved-research');assert.equal(calls[0].init.cache,'no-store');
    assert.equal((await POST(request())).status,200);
    assert.ok(readFileSync(new URL('../proxy.ts',import.meta.url),'utf8').includes('"/api/research/saved"'));
  } finally {
    globalThis.fetch=old.fetch; delete globalThis.__savedMember;
    for(const [key,value] of [['RESEARCH_MONITOR_URL',old.url],['RESEARCH_MONITOR_TOKEN',old.token]]) if(value===undefined) delete process.env[key]; else process.env[key]=value;
  }
});
