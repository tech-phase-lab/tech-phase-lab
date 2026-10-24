import { sandboxMemberAllowed } from './access.mjs';
import { timingSafeEqual } from 'node:crypto';
import { RETURN_URL } from './paypal.mjs';
import { sandboxHandler, sandboxEnabled } from './http.mjs';
const origin = new URL(RETURN_URL).origin;
const reply = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
const actions = new Set(['readiness','status','create','cancel','reconcile','webhook']);
export function transportConfig(env) {
  const token=env.TECH_PHASE_BILLING_SERVICE_TOKEN;
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw Error('INVALID_TRANSPORT');
  const url=new URL(env.TECH_PHASE_BILLING_SERVICE_URL);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.up.railway.app')||url.port||url.username||url.password||url.search||url.hash||url.pathname!=='/') throw Error('INVALID_TRANSPORT');
  return {url:url.origin,token};
}
async function bounded(body,limit,code='BODY_LIMIT') {
  if(!body)return undefined;
  const reader=body.getReader(),chunks=[];let length=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw Error(code);chunks.push(value);}return Buffer.concat(chunks);}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}
export function billingGateway({env,identity,ownerId,fetcher=fetch}) {
  return async(request,action)=>{
    if(env.VERCEL_ENV!=='preview'||(action!=='readiness'&&!sandboxEnabled(env)))return reply({error:'billing-disabled'},503);
    if(!actions.has(action))return reply({error:'not-found'},404);
    if(request.method!==(['status','readiness'].includes(action)?'GET':'POST'))return reply({error:'method'},405);
    try {
      let userId='';
      if(action!=='webhook') {
        userId=await identity();
        if(!userId)return reply({error:'sign-in'},401);
        if(!sandboxMemberAllowed(env,ownerId,userId))return reply({error:'owner-only'},403);
        if(request.method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)return reply({error:'origin'},403);
      }
      let config;try{config=transportConfig(env);}catch{
        return action==='readiness'?reply({environment:'sandbox',configurationReady:false,connectionVerified:false,problems:['billing-service-not-configured']}):reply({error:'billing-unavailable'},503);
      }
      const body=await bounded(request.body,action==='webhook'?131072:2048);
      // Never forward cookies, browser Authorization or caller-supplied identity.
      const headers=new Headers({'Authorization':`Bearer ${config.token}`,'X-Tech-Phase-User':userId,'Origin':origin});
      for(const name of ['content-type','paypal-transmission-id','paypal-transmission-time','paypal-cert-url','paypal-auth-algo','paypal-transmission-sig']) {
        const value=request.headers.get(name);if(value)headers.set(name,value);
      }
      const upstream=await fetcher(`${config.url}/sandbox/${action}`,{method:request.method,headers,body,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(55000)});
      if(upstream.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json') {
        await upstream.body?.cancel().catch(()=>{});
        return reply({error:'billing-unavailable'},503);
      }
      const bytes=await bounded(upstream.body,16384,'UPSTREAM_BODY_LIMIT');
      const result=JSON.parse(bytes?.toString('utf8')||'null');
      return reply(result,upstream.status);
    }catch(error){return reply({error:error?.message==='BODY_LIMIT'?'input':'billing-unavailable'},error?.message==='BODY_LIMIT'?400:503);}
  };
}
export function billingBackend({env,ownerId,services}) {
  return async request=>{
    const url=new URL(request.url),action=url.pathname.split('/')[2];
    const secret=env.TECH_PHASE_BILLING_SERVICE_TOKEN;
    if(env.TECH_PHASE_BILLING_RUNTIME!=='railway-sandbox'||env.RAILWAY_GIT_BRANCH!=='codex/research-preview'||typeof secret!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(secret))return reply({error:'billing-disabled'},503);
    // PayPal cannot supply the private gateway credential. Only this exact
    // notification route is public; sandboxHandler verifies PayPal signatures
    // before webhookService touches any persisted billing state.
    if(url.pathname==='/webhooks/paypal/sandbox'&&!url.search) {
      const handler=sandboxHandler({env:{...env,VERCEL_ENV:'preview'},ownerId,services,identity:async()=>null});
      return handler(request,'webhook');
    }
    const received=Buffer.from(request.headers.get('authorization')||''),expected=Buffer.from(`Bearer ${secret}`);
    if(received.length!==expected.length||!timingSafeEqual(received,expected))return reply({error:'service-auth'},401);
    if(url.search||url.pathname!==`/sandbox/${action}`||!actions.has(action))return reply({error:'not-found'},404);
    // The authenticated gateway alone supplies the verified Clerk identity.
    const handler=sandboxHandler({env:{...env,VERCEL_ENV:'preview'},ownerId,services,identity:async()=>request.headers.get('x-tech-phase-user')});
    return handler(new Request(`${origin}/sandbox/${action}`,{method:request.method,headers:request.headers,body:request.body,duplex:'half'}),action);
  };
}
