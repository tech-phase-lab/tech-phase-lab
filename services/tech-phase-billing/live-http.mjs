import {readBody} from './http.mjs';
import {liveConfig,liveReturnUrl} from './paypal.mjs';
import {liveDatabaseConfig} from './database-config.mjs';
export const liveMember=id=>typeof id==='string'&&/^user_[A-Za-z0-9]{1,120}$/.test(id);
export const liveEnabled=env=>env.VERCEL_ENV==='production'&&env.TECH_PHASE_PAYPAL_ENV==='live'&&env.TECH_PHASE_BILLING_LIVE_ENABLED==='true';
export const liveSalesEnabled=env=>liveEnabled(env)&&env.TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED==='true'&&env.TECH_PHASE_BILLING_LIVE_SALES_ENABLED==='true';
export const liveOrigin=env=>new URL(liveReturnUrl(env.TECH_PHASE_BILLING_LIVE_ORIGIN)).origin;
export function liveReadiness(env){
 let configurationReady=true;
 try{liveConfig(env);liveDatabaseConfig(env);liveOrigin(env);}catch{configurationReady=false;}
 return {environment:'live',enabled:liveEnabled(env),salesEnabled:liveSalesEnabled(env),configurationReady,connectionVerified:false};
}
const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function liveHandler({env,identity,services}){
 return async(request,action)=>{
  const notifications=action==='webhook'&&env.VERCEL_ENV==='production'&&env.TECH_PHASE_PAYPAL_ENV==='live'&&env.TECH_PHASE_BILLING_LIVE_WEBHOOK_ENABLED==='true';
  if(!liveEnabled(env)&&!notifications)return response({error:'billing-disabled'},503);
  let checkoutUser,checkoutServices;
  try{
   if(action==='webhook'){
    if(!notifications)return response({error:'billing-disabled'},503);
    if(request.method!=='POST')return response({error:'method'},405);
    return response(await(await services()).webhook(request.headers,await readBody(request,131072)));
   }
   if(!['readiness','account','deletion-check','status','entitlement','create','cancel','reconcile'].includes(action))return response({error:'not-found'},404);
   if(request.method!==(['readiness','account','deletion-check','status','entitlement'].includes(action)?'GET':'POST'))return response({error:'method'},405);
   if(request.method==='POST'&&request.headers.get('origin')!==liveOrigin(env))return response({error:'origin'},403);
   const userId=await identity();if(!liveMember(userId))return response({error:'sign-in'},401);
   if(action==='readiness')return response(liveReadiness(env));
   if(action==='create'&&!liveSalesEnabled(env))return response({error:'billing-disabled'},503);
   if(action==='deletion-check')return response(await(await services()).accountDeletionCheck(userId));
   if(action==='account')return response(await(await services()).accountContract(userId));
   if(action==='status')return response(await(await services()).store.summary(userId));
   if(action==='entitlement')return response(await(await services()).store.entitlement(userId));
   if(action==='create'){checkoutUser=userId;checkoutServices=await services();await checkoutServices.abuse?.attempt(userId);}
   const body=await readBody(request,2048),keys=action==='create'?['currency','acceptedTerms']:['id'];
   if(Object.keys(body).length!==keys.length||keys.some(key=>!Object.hasOwn(body,key))||
    (action==='create'?!['JPY','USD'].includes(body.currency)||body.acceptedTerms!=='pro-live-v1':!uuid.test(body.id??'')))return response({error:'input'},400);
   const svc=await services();
   if(action==='create')return response(await svc.checkout.start(userId,body.currency,body.acceptedTerms));
   if(action==='cancel')return response(await svc.checkout.cancel(userId,body.id));
   return response(await svc.reconciliation.reconcile(userId,body.id));
  }catch(error){
   const code=error?.message;
   if(code==='RATE_LIMITED')return new Response(JSON.stringify({error:'rate-limited'}),{status:429,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':String(Math.min(600,Math.max(1,error.retryAfter||600)))}});
   if(checkoutUser && checkoutServices?.abuse)try{await checkoutServices.abuse.failure(checkoutUser);}catch{ /* No raw exception, credentials or request body in logs. */ }

   if(code==='INVALID_SIGNATURE')return response({error:'signature'},401);
   if(['INVALID_INPUT','INVALID_EVENT'].includes(code))return response({error:'input'},400);
   if(code==='SUBSCRIPTION_NOT_FOUND')return response({error:'not-found'},404);
   if(['TERMS_REQUIRED','EXISTING_SUBSCRIPTION','RECONCILIATION_REQUIRED','SUBSCRIPTION_NOT_CANCELLABLE','SETTLEMENT_REVIEW_REQUIRED'].includes(code))return response({error:code.toLowerCase().replaceAll('_','-')},409);
   return response({error:'billing-unavailable'},503);
  }
 };
}
