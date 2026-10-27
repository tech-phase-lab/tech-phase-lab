import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

test('guest proxy establishes an HttpOnly capability before orders, strips client credentials, and keeps claim authenticated',async()=>{
 const dir=await mkdtemp(join(process.cwd(),'.guest-proxy-'));
 const originalFetch=globalThis.fetch,previous={...process.env};
 const jar=new Map(),calls=[];let userId=null,options;
 globalThis.__guestProxyFixture={auth:async()=>({userId,getToken:async()=>userId?'trusted-clerk-jwt':null}),cookies:async()=>({
  get:name=>jar.has(name)?{value:jar.get(name)}:undefined,set:(name,value,opts)=>{jar.set(name,value);options=opts;},
 })};
 try {
  const outfile=join(dir,'route.cjs');
  await build({entryPoints:['app/api/resolute/live-payments/[...action]/route.ts'],outfile,bundle:true,platform:'node',format:'cjs',plugins:[{
   name:'identity-fixture',setup(b){b.onResolve({filter:/^(@clerk\/nextjs\/server|next\/headers)$/},a=>({path:a.path,namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth = (...args) => globalThis.__guestProxyFixture.auth(...args); export const cookies = (...args) => globalThis.__guestProxyFixture.cookies(...args);'}));},
  }]});
  const route=createRequire(import.meta.url)(outfile);
  Object.assign(process.env,{RESOLUTE_PAYPAL_LIVE_ENABLED:'true',RESOLUTE_LIVE_SALES_ENABLED:'true',RESOLUTE_GUEST_CHECKOUT_ENABLED:'true',RESOLUTE_API_URL:'https://fixture.up.railway.app',RESOLUTE_API_SERVICE_TOKEN:'s'.repeat(43)});
  globalThis.fetch=async(url,init)=>{calls.push({url:String(url),init});return Response.json({sandbox:false,state:'paid'});};
  const request=async(path,{method='POST',origin='https://site.test',body={},extra={}}={})=>route[method](
   new Request('https://site.test/api/resolute/live-payments/'+path,{method,headers:{origin,'content-type':'application/json',...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})}),
   {params:Promise.resolve({action:path.split('/')})});
  assert.equal((await request('guest/orders')).status,401);assert.equal(calls.length,0);
  assert.equal((await request('guest/session',{origin:'https://attacker.test'})).status,403);
  assert.equal(jar.size,0);
  assert.equal((await request('guest/session')).status,200);assert.equal(calls.length,0);
  const token=jar.get('__Host-resolute-guest');assert.match(token,/^[a-f0-9]{64}$/);
  assert.deepEqual(options,{httpOnly:true,secure:true,sameSite:'lax',path:'/',maxAge:30*86400});
  await request('guest/session');assert.equal(jar.get('__Host-resolute-guest'),token);
  assert.equal((await request('guest/orders',{extra:{'x-resolute-guest-token':'attacker','authorization':'Bearer attacker'}})).status,200);
  assert.equal(calls[0].init.headers['X-Resolute-Guest-Token'],token);assert.equal(calls[0].init.headers.Authorization,undefined);
  assert.equal(calls[0].init.headers['X-Resolute-Service-Token'],'s'.repeat(43));
  assert.equal((await request('guest/audit',{method:'GET'})).status,404);
  assert.equal((await request('claim')).status,401);
  userId='user_buyer';process.env.RESOLUTE_LIVE_SALES_ENABLED='false';
  assert.equal((await request('guest/capture')).status,503);
  assert.equal((await request('claim')).status,200);
  assert.equal(calls.at(-1).init.headers.Authorization,'Bearer trusted-clerk-jwt');
  assert.equal(calls.at(-1).init.headers['X-Resolute-Guest-Token'],token);
  process.env.RESOLUTE_GUEST_CHECKOUT_ENABLED='false';
  assert.equal((await request('guest/orders',{method:'GET'})).status,503);
 } finally {
  globalThis.fetch=originalFetch;delete globalThis.__guestProxyFixture;
  for(const key of Object.keys(process.env)) if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
  await rm(dir,{recursive:true,force:true});
 }
});
