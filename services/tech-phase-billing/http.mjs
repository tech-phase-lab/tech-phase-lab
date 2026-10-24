import { sandboxMemberAllowed } from './access.mjs';
import { sandboxReadiness } from './readiness.mjs';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const response = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store',Vary:'Cookie'}});
export const sandboxEnabled = env => env.VERCEL_ENV === 'preview' && env.TECH_PHASE_BILLING_SANDBOX_ENABLED === 'true' && env.TECH_PHASE_PAYPAL_ENV === 'sandbox';
async function readBody(request,limit) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw Error('INVALID_INPUT');
  const reader=request.body?.getReader();if(!reader) throw Error('INVALID_INPUT');
  const chunks=[];let size=0;
  try {
    for(;;) { const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>limit) throw Error('INVALID_INPUT');chunks.push(value); }
    const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('INVALID_INPUT');
    return result;
  } catch { await reader.cancel().catch(()=>{});throw Error('INVALID_INPUT'); }
  finally { reader.releaseLock(); }
}
export function sandboxHandler({env,identity,ownerId,services}) {
  return async(request,action)=>{
    if(action==='readiness' && env.VERCEL_ENV === 'preview') {
      if(request.method!=='GET') return response({error:'method'},405);
      try {
        const userId=await identity();
        if(!userId) return response({error:'sign-in'},401);
        if(!sandboxMemberAllowed(env,ownerId,userId)) return response({error:'owner-only'},403);
        return response(sandboxReadiness(env));
      } catch { return response({error:'billing-unavailable'},503); }
    }
    const notificationsEnabled=action==='webhook' && env.VERCEL_ENV==='preview' &&
      env.TECH_PHASE_PAYPAL_ENV==='sandbox' && env.TECH_PHASE_BILLING_SANDBOX_WEBHOOK_ENABLED==='true';
    if(!sandboxEnabled(env)&&!notificationsEnabled) return response({error:'billing-disabled'},503);
    try {
      if(action==='webhook') {
        if(request.method!=='POST') return response({error:'method'},405);
        const event=await readBody(request,131072);
        return response(await (await services()).webhook(request.headers,event));
      }
      if(!['status','create','reconcile','cancel'].includes(action)) return response({error:'not-found'},404);
      if(request.method !== (action==='status'?'GET':'POST')) return response({error:'method'},405);
      if(request.method==='POST' && request.headers.get('origin')!==new URL(request.url).origin) return response({error:'origin'},403);
      const userId=await identity();
      if(!userId) return response({error:'sign-in'},401);
      if(!sandboxMemberAllowed(env,ownerId,userId)) return response({error:'owner-only'},403);
      if(action==='status') return response(await (await services()).store.summary(userId));
      const body=await readBody(request,2048);
      const keys=action==='create'?['currency','acceptedTerms']:['id'];
      if(Object.keys(body).length!==keys.length || keys.some(k=>!Object.hasOwn(body,k)) ||
        (action==='create' ? !['JPY','USD'].includes(body.currency) || typeof body.acceptedTerms!=='string' : !uuid.test(body.id ?? ''))) return response({error:'input'},400);
      const svc=await services();
      if(action==='create') return response(await svc.checkout.start(userId,body.currency,body.acceptedTerms));
      if(action==='cancel') return response(await svc.checkout.cancel(userId,body.id));
      return response(await svc.reconciliation.reconcile(userId,body.id));
    } catch(error) {
      const code=error instanceof Error?error.message:'';
      if(code==='INVALID_SIGNATURE') return response({error:'signature'},401);
      if(['INVALID_INPUT','INVALID_EVENT'].includes(code))return response({error:'input'},400);
      if(code==='SUBSCRIPTION_NOT_FOUND')return response({error:'not-found'},404);
      if(['TERMS_REQUIRED','EXISTING_SUBSCRIPTION','RECONCILIATION_REQUIRED','SUBSCRIPTION_NOT_CANCELLABLE','SETTLEMENT_REVIEW_REQUIRED'].includes(code))return response({error:code.toLowerCase().replaceAll('_','-')},409);
      return response({error:'billing-unavailable'},503); // Never leak SQL, credentials or payer responses.
    }
  };
}
