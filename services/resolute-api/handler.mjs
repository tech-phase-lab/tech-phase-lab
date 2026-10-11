import { authenticate } from './auth.mjs';
import { readPlanMutation, PlanBodyError } from '../../lib/resolute/plan-http.ts';
import { PlanInputError } from '../../lib/resolute/plan-data.ts';
import { PlanAccessDenied, PlanConflict } from '../../lib/resolute/plan-database.ts';

const headers={'Cache-Control':'private, no-store','Content-Type':'application/json',
  'X-Content-Type-Options':'nosniff'};
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{...headers,...extra}});
export function createHandler(config, read, verify=authenticate, plans) {
  const windows=new Map(); let active=0;
  return async request => {
    const url=new URL(request.url);
    const isPlan=url.pathname==='/internal/v1/plan';
    if(!((isPlan ? ['GET','PUT','DELETE'] : ['GET']).includes(request.method)))
      return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:isPlan?'GET, PUT, DELETE':'GET'});
    if(url.pathname==='/healthz' && !url.search)return json({status:'ok'});
    if((url.pathname!=='/internal/v1/entitlements' && !isPlan) || url.search)return json({error:'NOT_FOUND'},404);
    const userId=await verify(request.headers,config);
    if(!userId)return json({error:'AUTH_REQUIRED'},401);
    const now=Date.now();
    // At most 1,000 identity windows; no growing cache or external paid limiter.
    for(const [id,w] of windows)if(w.until<=now)windows.delete(id);
    const w=windows.get(userId) ?? {count:0,until:now+60000};
    if(active>=8 || w.count>=60 || (!windows.has(userId) && windows.size>=1000))
      return json({error:'RATE_LIMITED'},429,{'Retry-After':'60'});
    w.count++;windows.set(userId,w);active++;
    try{
      if(!isPlan)return json(await read(userId));
      if(!plans)return json({error:'PLAN_UNAVAILABLE'},503);
      const mutation=request.method==='GET'?undefined:await readPlanMutation(request,request.method);
      return json(await plans(userId,request.method,mutation));
    } catch(error){
      if(isPlan && error instanceof PlanConflict)return json(error.snapshot,409);
      if(isPlan && error instanceof PlanAccessDenied)return json({error:'PLAN_ACCESS_DENIED'},403);
      if(isPlan && error instanceof PlanBodyError)return json({error:error.message},error.status);
      if(isPlan && error instanceof PlanInputError)return json({error:'INVALID_PLAN'},400);
      return json({error:isPlan?'PLAN_UNAVAILABLE':'ENTITLEMENT_UNAVAILABLE'},503);
    }
    finally{active--;}
  };
}
