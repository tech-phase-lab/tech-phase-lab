import {ownerIdentity,reply,accountError} from '@/lib/account/server';
import {deliveryView} from '@/lib/account/delivery';
import {bounded} from '@/services/tech-phase-billing/transport.mjs';
export const dynamic='force-dynamic';
export async function GET(){try{
 await ownerIdentity();
 try{
  const url=new URL(process.env.RESEARCH_MONITOR_URL??'');
  if(url.protocol!=='https:'||url.username||url.password)throw Error();
  url.pathname=url.pathname.replace(/\/$/,'')+'/health';url.search='';url.hash='';
  const result=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!result.ok){await result.body?.cancel();throw Error();}
  const state=JSON.parse((await bounded(result.body,524288,'UPSTREAM_BODY_LIMIT'))?.toString('utf8')||'null');
  if(!state||typeof state!=='object')throw Error();
  return reply(deliveryView(state));
 }catch{return reply({...deliveryView({}),verification:'unavailable'});}
}catch(e){return accountError(e);}}
