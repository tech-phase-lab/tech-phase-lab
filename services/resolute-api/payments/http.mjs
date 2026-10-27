import { PaymentError } from './policy.mjs';
import { readJson } from './paypal.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function paymentHttp({ engine, store, authenticate, enabled, allowedUsers, auditUsers = [], environment = 'sandbox', access = user => store.access(user), authenticateGuest = () => null, guestEnabled = () => false }) {
  if (!['sandbox','live'].includes(environment)) throw Error('Invalid payment environment');
  const base=environment === 'live' ? '/internal/v1/live-payments' : '/internal/v1/payments';
  const webhookPath=environment === 'live' ? '/webhooks/paypal-live' : '/webhooks/paypal';
  const denied=environment === 'live' ? 'PAYMENT_ACCESS_DENIED' : 'SANDBOX_ACCESS_DENIED';
  let active=0; const windows=new Map();
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(path !== base && !path.startsWith(base+'/') && path !== webhookPath) return null;
    if(url.search) return json({error:'INVALID_PAYMENT_INPUT'},400);
    const webhook=path === webhookPath;
    const guestPath=environment === 'live' && path.startsWith(base+'/guest/');
    const route=guestPath ? base+path.slice((base+'/guest').length) : path;
    if(guestPath && !guestEnabled()) return json({error:'PAYMENT_DISABLED'},503);
    if(guestPath && !(route === base+'/orders' && request.method === 'POST') &&
       !(route === base+'/capture' && request.method === 'POST') &&
       !(new RegExp('^'+base+'/orders/[0-9a-f-]{36}$','i').test(route) && request.method === 'GET'))
      return json({error:'NOT_FOUND'},404);
    if(webhook && request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    let user;
    try {
      if(!webhook) {
        if(!(typeof enabled === 'function' ? enabled() : enabled)) return json({error:'PAYMENT_DISABLED'},503);
        user=await (guestPath ? authenticateGuest(request.headers) : authenticate(request.headers));
        if(!user) return json({error:'AUTH_REQUIRED'},401);
        const admitted = typeof allowedUsers === 'function' ? allowedUsers() : allowedUsers;
        if(!(environment === 'live' && admitted === null) && !admitted?.includes(user)) return json({error:denied},403);
        if(path === base+'/audit' && !auditUsers.includes(user)) return json({error:denied},403);
      }
      const now=Date.now(),key=user ?? 'webhook';
      for(const [k,v] of windows) if(v.until<=now) windows.delete(k);
      const w=windows.get(key) ?? {until:now+60000,count:0};
      if(active>=4 || w.count>=60 || windows.size>=1000 && !windows.has(key)) return json({error:'RATE_LIMITED'},429);
      w.count++;windows.set(key,w);active++;
      try {
        if(webhook) return json(await engine.webhook(request.headers,await readJson(request)));
        if(route === base+'/orders' && request.method === 'POST') return json(await engine.create(user,await readJson(request,2048)));
        if(route === base+'/capture' && request.method === 'POST') return json(await engine.capture(user,await readJson(request,2048)));
        if(path === base+'/claim' && request.method === 'POST') {
          if(!guestEnabled()) return json({error:'PAYMENT_DISABLED'},503);
          return json(await engine.claim(user,await authenticateGuest(request.headers),await readJson(request,2048)));
        }
        if(path === base+'/access' && request.method === 'GET') return json(await access(user));
        if(path === base+'/audit' && request.method === 'GET') return json({events:await store.auditList()});
        const match=route.slice(base.length).match(/^\/orders\/([0-9a-f-]{36})$/i);
        if(match && request.method === 'GET') return json(await engine.status(user,match[1]));
        return json({error:'NOT_FOUND'},404);
      } finally {active--;}
    } catch(e) {
      try { await store.flag(null,e instanceof PaymentError ? e.code : 'PAYMENT_HANDLER_FAILED'); } catch { /* DB outage stays a retryable failure. */ }
      return json({error:e instanceof PaymentError ? e.code : 'PAYMENT_UNAVAILABLE'},e instanceof PaymentError ? e.status : 503);
    }
  };
}
