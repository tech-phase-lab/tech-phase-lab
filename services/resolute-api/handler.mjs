import {PRODUCTION_OWNER_ACCOUNT_ID} from '../../lib/membership/entitlements.ts';
import {hasOwnerAccess} from '../../lib/resolute/owner-access.ts';
import { NotificationInputError } from '../../lib/resolute/notification-settings.ts';
import { NotificationHttpError, readNotificationMutation } from '../../lib/resolute/notification-http.ts';
import { NotificationAccessDenied, NotificationConflict } from '../../lib/resolute/notification-database.ts';
import { authenticatePrincipal, serviceTokenMatches } from './auth.mjs';
import { readPlanMutation, PlanBodyError } from '../../lib/resolute/plan-http.ts';
import { PlanInputError } from '../../lib/resolute/plan-data.ts';
import { PlanAccessDenied, PlanConflict } from '../../lib/resolute/plan-database.ts';

const headers={'Cache-Control':'private, no-store','Content-Type':'application/json',
  'X-Content-Type-Options':'nosniff'};
const json=(value,status=200,extra={})=>Response.json(value,{status,headers:{...headers,...extra}});
export function createHandler(config, read, verify=authenticatePrincipal, plans, notifications, risk, rizel, aiCheck, mailStop) {
  const windows=new Map(); let active=0;
  return async request => {
    const url=new URL(request.url);
    // This capability only turns mail OFF. Its encrypted bearer token replaces
    // the browser session, but the frontend service credential is still required.
    if(url.pathname==='/internal/v1/notification-stop') {
      if(request.method!=='POST'||url.search)return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:'POST'});
      if(!serviceTokenMatches(request.headers.get('x-resolute-service-token'),config.serviceToken)&&!serviceTokenMatches(request.headers.get('x-resolute-service-token'),config.production?.serviceToken))return json({error:'AUTH_REQUIRED'},401);
      if(!mailStop)return json({error:'STOP_UNAVAILABLE'},503);
      if(active>=8)return json({error:'RATE_LIMITED'},429,{'Retry-After':'60'});
      active++;
      try{return await mailStop(request);}catch{return json({error:'STOP_UNAVAILABLE'},503);}finally{active--;}
    }
    const isAiCheck=url.pathname==='/internal/v1/ai-check';
    const isRizel=url.pathname==='/internal/v1/rizel/owner';
    const isRisk=['/internal/v1/risk','/internal/v1/risk/owner'].includes(url.pathname);
    const isPlan=url.pathname==='/internal/v1/plan';
    const isNotification=url.pathname==='/internal/v1/notification-settings';
    if(!((isRisk || isRizel || isAiCheck ? ['GET','POST'] : isPlan ? ['GET','PUT','DELETE'] : isNotification ? ['GET','PUT'] : ['GET']).includes(request.method)))
      return json({error:'METHOD_NOT_ALLOWED'},405,{Allow:isPlan?'GET, PUT, DELETE':isNotification?'GET, PUT':'GET'});
    if(url.pathname==='/healthz' && !url.search)return json({status:'ok'});
    if((url.pathname!=='/internal/v1/entitlements' && !isPlan && !isNotification && !isRisk && !isRizel && !isAiCheck) || url.search)return json({error:'NOT_FOUND'},404);
    const principal=await verify(request.headers,config);
    const userId=typeof principal==='string'?principal:principal?.userId;
    const ownerAccess=typeof principal==='object'?principal?.ownerAccess:undefined;
    const readAccess=id=>read(id,ownerAccess);
    if(!userId)return json({error:'AUTH_REQUIRED'},401);
    if(userId===PRODUCTION_OWNER_ACCOUNT_ID&&!hasOwnerAccess(ownerAccess,userId))return json({error:'OWNER_MFA_REQUIRED'},403);
    const now=Date.now();
    // At most 1,000 identity windows; no growing cache or external paid limiter.
    for(const [id,w] of windows)if(w.until<=now)windows.delete(id);
    const w=windows.get(userId) ?? {count:0,until:now+60000};
    if(active>=8 || w.count>=60 || (!windows.has(userId) && windows.size>=1000))
      return json({error:'RATE_LIMITED'},429,{'Retry-After':'60'});
    w.count++;windows.set(userId,w);active++;
    try{
      if(isAiCheck){if(!aiCheck)return json({error:'CHECK_UNAVAILABLE'},503);return await aiCheck(request,userId);}
      if(isRizel){if(!rizel)return json({error:'RIZEL_UNAVAILABLE'},503);return await rizel(request,userId,readAccess);}
      if(isRisk){if(!risk)return json({error:"RISK_UNAVAILABLE"},503);return await risk(request,userId,readAccess);}
      if(isNotification){
        if(!notifications)return json({error:'NOTIFICATION_UNAVAILABLE'},503);
        const mutation=request.method==='PUT'?await readNotificationMutation(request):undefined;
        return json(await notifications(userId,request.method,mutation,ownerAccess));
      }
      if(!isPlan)return json(await readAccess(userId));
      if(!plans)return json({error:'PLAN_UNAVAILABLE'},503);
      const mutation=request.method==='GET'?undefined:await readPlanMutation(request,request.method);
      return json(await plans(userId,request.method,mutation,ownerAccess));
    } catch(error){
      if(isRisk)return json({error:error?.message?.startsWith("INVALID_")?"INVALID_RISK_INPUT":"RISK_UNAVAILABLE"},error?.message?.startsWith("INVALID_")?400:503);
      if(isNotification){
        if(error instanceof NotificationConflict)return json(error.snapshot,409);
        if(error instanceof NotificationAccessDenied)return json({error:'NOTIFICATION_ACCESS_DENIED'},403);
        if(error instanceof NotificationInputError)return json({error:'INVALID_NOTIFICATION_SETTINGS'},400);
        if(error instanceof NotificationHttpError)return json({error:error.status===413?'BODY_TOO_LARGE':error.status===415?'JSON_REQUIRED':'INVALID_NOTIFICATION_SETTINGS'},error.status);
        return json({error:'NOTIFICATION_UNAVAILABLE'},503);
      }
      if(isPlan && error instanceof PlanConflict)return json(error.snapshot,409);
      if(isPlan && error instanceof PlanAccessDenied)return json({error:'PLAN_ACCESS_DENIED'},403);
      if(isPlan && error instanceof PlanBodyError)return json({error:error.message},error.status);
      if(isPlan && error instanceof PlanInputError)return json({error:'INVALID_PLAN'},400);
      return json({error:isPlan?'PLAN_UNAVAILABLE':'ENTITLEMENT_UNAVAILABLE'},503);
    }
    finally{active--;}
  };
}
