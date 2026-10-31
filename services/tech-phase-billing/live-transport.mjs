import {timingSafeEqual} from 'node:crypto';
import {bounded} from './transport.mjs';
import {liveEnabled,liveSalesEnabled,liveMember,liveOrigin,liveHandler} from './live-http.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const actions=new Set(['readiness','account','deletion-check','status','entitlement','create','cancel','reconcile']);
const validToken=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,128}$/.test(value);
export function liveTransportConfig(env){
 const token=env.TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN;
 if(!validToken(token))throw Error('INVALID_TRANSPORT');
 let url;try{url=new URL(env.TECH_PHASE_BILLING_LIVE_SERVICE_URL);}catch{throw Error('INVALID_TRANSPORT');}
 if(url.protocol!=='https:'||!url.hostname.endsWith('.up.railway.app')||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.origin===env.TECH_PHASE_BILLING_SERVICE_URL?.replace(/\/$/,''))throw Error('INVALID_TRANSPORT');
 return {url:url.origin,token,origin:liveOrigin(env)};
}
export function liveGateway({env,identity,fetcher=fetch}){
 return async(request,action)=>{
  if(!liveEnabled(env))return reply({error:'billing-disabled'},503);
  if(!actions.has(action))return reply({error:'not-found'},404);
  if(request.method!==(['status','account','deletion-check','readiness','entitlement'].includes(action)?'GET':'POST'))return reply({error:'method'},405);
  try{
   const config=liveTransportConfig(env);
   if(new URL(request.url).origin!==config.origin||(request.method==='POST'&&request.headers.get('origin')!==config.origin))return reply({error:'origin'},403);
   const userId=await identity();if(!liveMember(userId))return reply({error:'sign-in'},401);
   if(action==='create'&&!liveSalesEnabled(env))return reply({error:'billing-disabled'},503);
   const body=await bounded(request.body,2048);
   const headers=new Headers({Authorization:`Bearer ${config.token}`,'X-Tech-Phase-User':userId,Origin:config.origin});
   const type=request.headers.get('content-type');if(type)headers.set('content-type',type);
   const upstream=await fetcher(`${config.url}/live/${action}`,{method:request.method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(action==='entitlement'?5000:55000)});
   if(upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'){await upstream.body?.cancel().catch(()=>{});return reply({error:'billing-unavailable'},503);}
   const bytes=await bounded(upstream.body,16384,'UPSTREAM_BODY_LIMIT');
   return reply(JSON.parse(bytes?.toString('utf8')||'null'),upstream.status);
  }catch(error){return reply({error:error?.message==='BODY_LIMIT'?'input':'billing-unavailable'},error?.message==='BODY_LIMIT'?400:503);}
 };
}
export function liveBackend({env,services}){
 return async request=>{
  const secret=env.TECH_PHASE_BILLING_LIVE_SERVICE_TOKEN;
  if(env.TECH_PHASE_BILLING_RUNTIME!=='railway-live'||!env.TECH_PHASE_BILLING_LIVE_BRANCH||env.RAILWAY_GIT_BRANCH!==env.TECH_PHASE_BILLING_LIVE_BRANCH||!validToken(secret))return reply({error:'billing-disabled'},503);
  try{
   const url=new URL(request.url),origin=liveOrigin(env);
   const handler=liveHandler({env:{...env,VERCEL_ENV:'production'},services,identity:async()=>request.headers.get('x-tech-phase-user')});
   if(url.pathname==='/webhooks/paypal/live'&&!url.search)return handler(request,'webhook');
   const received=Buffer.from(request.headers.get('authorization')||''),expected=Buffer.from(`Bearer ${secret}`);
   if(received.length!==expected.length||!timingSafeEqual(received,expected))return reply({error:'service-auth'},401);
   const action=url.pathname.split('/')[2];
   if(url.search||url.pathname!==`/live/${action}`||!actions.has(action))return reply({error:'not-found'},404);
   return handler(new Request(`${origin}/live/${action}`,{method:request.method,headers:request.headers,body:request.body,duplex:'half'}),action);
  }catch{return reply({error:'billing-unavailable'},503);}
 };
}
