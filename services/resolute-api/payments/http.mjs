import { PaymentError } from './policy.mjs';
import { readJson } from './paypal.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
export function paymentHttp({ engine, store, authenticate, enabled, allowedUsers, auditUsers = [] }) {
  let active=0; const windows=new Map();
  return async request=>{
    const url=new URL(request.url),path=url.pathname;
    if(!path.startsWith('/internal/v1/payments') && path !== '/webhooks/paypal') return null;
    if(url.search) return json({error:'INVALID_PAYMENT_INPUT'},400);
    const webhook=path === '/webhooks/paypal';
    if(webhook && request.method !== 'POST') return json({error:'METHOD_NOT_ALLOWED'},405);
    let user;
    try {
      if(!webhook) {
        if(!enabled) return json({error:'PAYMENT_DISABLED'},503);
        user=await authenticate(request.headers);
        if(!user) return json({error:'AUTH_REQUIRED'},401);
        const admitted = typeof allowedUsers === 'function' ? allowedUsers() : allowedUsers;
        if(!admitted.includes(user)) return json({error:'SANDBOX_ACCESS_DENIED'},403);
        if(path === '/internal/v1/payments/audit' && !auditUsers.includes(user)) return json({error:'SANDBOX_ACCESS_DENIED'},403);
      }
      const now=Date.now(),key=user ?? 'webhook';
      for(const [k,v] of windows) if(v.until<=now) windows.delete(k);
      const w=windows.get(key) ?? {until:now+60000,count:0};
      if(active>=4 || w.count>=60 || windows.size>=1000 && !windows.has(key)) return json({error:'RATE_LIMITED'},429);
      w.count++;windows.set(key,w);active++;
      try {
        if(webhook) return json(await engine.webhook(request.headers,await readJson(request)));
        if(path === '/internal/v1/payments/orders' && request.method === 'POST') return json(await engine.create(user,await readJson(request,2048)));
        if(path === '/internal/v1/payments/capture' && request.method === 'POST') return json(await engine.capture(user,await readJson(request,2048)));
        if(path === '/internal/v1/payments/access' && request.method === 'GET') return json(await store.access(user));
        if(path === '/internal/v1/payments/audit' && request.method === 'GET') return json({events:await store.auditList()});
        const match=path.match(/^\/internal\/v1\/payments\/orders\/([0-9a-f-]{36})$/i);
        if(match && request.method === 'GET') return json(await engine.status(user,match[1]));
        return json({error:'NOT_FOUND'},404);
      } finally {active--;}
    } catch(e) {
      try { await store.flag(null,e instanceof PaymentError ? e.code : 'PAYMENT_HANDLER_FAILED'); } catch { /* DB outage stays a retryable failure. */ }
      return json({error:e instanceof PaymentError ? e.code : 'PAYMENT_UNAVAILABLE'},e instanceof PaymentError ? e.status : 503);
    }
  };
}
