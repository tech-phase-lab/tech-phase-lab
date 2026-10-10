import { authenticate } from './auth.mjs';

const headers={'Cache-Control':'private, no-store','Content-Type':'application/json',
  'X-Content-Type-Options':'nosniff'};
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{...headers,...extra}});
export function createHandler(config, read, verify=authenticate) {
  const windows=new Map(); let active=0;
  return async request => {
    const url=new URL(request.url);
    if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:'GET'});
    if(url.pathname==='/healthz' && !url.search)return json({status:'ok'});
    if(url.pathname!=='/internal/v1/entitlements' || url.search)return json({error:'NOT_FOUND'},404);
    const userId=await verify(request.headers,config);
    if(!userId)return json({error:'AUTH_REQUIRED'},401);
    const now=Date.now();
    // At most 1,000 identity windows; no growing cache or external paid limiter.
    for(const [id,w] of windows)if(w.until<=now)windows.delete(id);
    const w=windows.get(userId) ?? {count:0,until:now+60000};
    if(active>=8 || w.count>=60 || (!windows.has(userId) && windows.size>=1000))
      return json({error:'RATE_LIMITED'},429,{'Retry-After':'60'});
    w.count++;windows.set(userId,w);active++;
    try{return json(await read(userId));}
    catch{return json({error:'ENTITLEMENT_UNAVAILABLE'},503);}
    finally{active--;}
  };
}
