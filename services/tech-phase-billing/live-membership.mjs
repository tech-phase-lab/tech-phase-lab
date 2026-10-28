import {liveGateway} from './live-transport.mjs';
import {liveMember,liveOrigin} from './live-http.mjs';
/** @returns {Promise<{plan: "pro" | "free", accessExpiresAt: number} | null>} */
export async function liveMembership(env,userId,fetcher=fetch,now=Date.now()){
 if(env.VERCEL_ENV!=='production'||env.TECH_PHASE_BILLING_LIVE_ENTITLEMENTS_ENABLED!=='true')return null;
 if(!liveMember(userId)||!Number.isFinite(now))throw Error('BILLING_ENTITLEMENT_UNAVAILABLE');
 try{
  const handler=liveGateway({env,identity:async()=>userId,fetcher});
  const response=await handler(new Request(`${liveOrigin(env)}/api/research/billing/live/entitlement`),'entitlement');
  if(!response.ok)throw Error();
  const result=await response.json();
  if(result?.environment!=='live'||!['free','pro'].includes(result.plan)||(result.plan==='free'?result.proExpiresAt!==null:typeof result.proExpiresAt!=='string'||!Number.isFinite(Date.parse(result.proExpiresAt))))throw Error();
  const until=result.plan==='pro'?Date.parse(result.proExpiresAt):0;
  return {plan:until>now?'pro':'free',accessExpiresAt:until>now?until:0};
 }catch{throw Error('BILLING_ENTITLEMENT_UNAVAILABLE');}
}
