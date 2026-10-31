import {assertSubscription} from './settlement.mjs';

export const unknownDeletionCheck = () => ({verification:'unavailable',autoRenew:null,reason:'contract-unverified',proAccessLostAtDeletion:null});
const fingerprint = rows => JSON.stringify(rows.map(r=>[r.id,r.user_id,r.paypal_id,r.currency,r.state,r.updated_at]));

/** Read-only evidence for the deletion workflow, NOT permission to delete.
 * Examine historical contracts too: the account card intentionally selects one.
 * A future deletion worker must fence new checkouts and repeat this check.
 */
export async function accountDeletionCheck({store,paypal,plans}, userId) {
 try {
  const rows=await store.deletionContracts(userId);
  if(!Array.isArray(rows)||rows.length>20||rows.some(r=>r.user_id!==userId))return unknownDeletionCheck();
  let active=false,unconfirmed=false;
  // Bounded concurrency; never include provider data or IDs in the response.
  for(let start=0;start<rows.length;start+=5){
   const states=await Promise.all(rows.slice(start,start+5).map(async local=>{
    if(!local.paypal_id)return 'unknown';
    try{const remote=await paypal.get(local.paypal_id);assertSubscription(local,remote,plans);return remote.status;}catch{return 'unknown';}
   }));
   active ||= states.includes('ACTIVE');
   unconfirmed ||= states.some(state=>!['ACTIVE','CANCELLED','EXPIRED'].includes(state));
  }
  const summary=await store.summary(userId);
  const latest=await store.deletionContracts(userId);
  if(fingerprint(rows)!==fingerprint(latest))return unknownDeletionCheck();
  const until=summary.proExpiresAt;
  const expiry=typeof until==='string'&&Number.isFinite(Date.parse(until))?new Date(until).toISOString():null;
  if(active)return {verification:'verified',autoRenew:true,reason:'auto-renew-active',proAccessLostAtDeletion:expiry};
  if(unconfirmed||summary.reviewRequired===true)return unknownDeletionCheck();
  return {verification:'verified',autoRenew:false,reason:'no-renewing-contract',proAccessLostAtDeletion:expiry};
 }catch{return unknownDeletionCheck();}
}
