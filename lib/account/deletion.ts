import 'server-only';
import {liveTransportConfig} from '@/services/tech-phase-billing/live-transport.mjs';
import {bounded} from '@/services/tech-phase-billing/transport.mjs';
import {unknownDeletionCheck} from '@/services/tech-phase-billing/account-deletion-check.mjs';

export async function readDeletionCheck(userId:string){
 try{
  const config=liveTransportConfig(process.env);
  const response=await fetch(`${config.url}/live/deletion-check`,{headers:{Authorization:`Bearer ${config.token}`,'X-Tech-Phase-User':userId,Origin:config.origin},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('application/json')){await response.body?.cancel();return unknownDeletionCheck();}
  const value=JSON.parse((await bounded(response.body,4096,'UPSTREAM_BODY_LIMIT'))?.toString('utf8')||'null');
  if(value?.verification!=='verified'||typeof value.autoRenew!=='boolean'||value.reason!==(value.autoRenew?'auto-renew-active':'no-renewing-contract'))return unknownDeletionCheck();
  return {verification:'verified',autoRenew:value.autoRenew,reason:value.reason,
   proAccessLostAtDeletion:typeof value.proAccessLostAtDeletion==='string'&&Number.isFinite(Date.parse(value.proAccessLostAtDeletion))?new Date(value.proAccessLostAtDeletion).toISOString():null};
 }catch{return unknownDeletionCheck();}
}
