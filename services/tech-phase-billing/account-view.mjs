import {assertSubscription, amountMinor} from './settlement.mjs';
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
export const unknownContract = () => ({accessPlan:null,verification:'unavailable',status:null,autoRenew:null,amount:null,currency:null,nextBillingAt:null,accessExpiresAt:null,unavailableFields:['status','amount','nextBillingAt','accessExpiresAt']});
/** Read-only projection. Never reconciles, creates, cancels or grants an entitlement. */
export async function accountContract({store,paypal,plans}, userId) {
 const summary=await store.summary(userId);
 if(!summary.subscription)return {accessPlan:'free',verification:'verified',status:'none',autoRenew:false,amount:null,currency:null,nextBillingAt:null,accessExpiresAt:null,unavailableFields:[]};
 const local=await store.get(userId,summary.subscription.id);
 if(!local?.paypal_id)return {...unknownContract(),verification:'pending',reason:'approval-pending'};
 let remote;
 try {remote=await paypal.getDetails(local.paypal_id);assertSubscription(local,remote,plans);}catch{return unknownContract();}
 const active=remote.status==='ACTIVE', stopped=remote.status==='CANCELLED', expired=remote.status==='EXPIRED';
 // Suspended/pending/review states must never masquerade as "no contract".
 const status=summary.reviewRequired ? null : active ? 'active' : stopped ? 'renewal-stopped' : expired ? 'none' : null;
 const cycles=remote.plan?.billing_cycles;
 const regular=Array.isArray(cycles) ? cycles.filter(c=>c.tenure_type==='REGULAR') : [];
 const money=regular.length===1 ? regular[0].pricing_scheme?.fixed_price : null;
 const minor=amountMinor(money,local.currency);
 const amount=minor===null ? null : money.value;
 const nextBillingAt=active ? date(remote.billing_info?.next_billing_time) : null;
 const accessExpiresAt=date(summary.proExpiresAt);
 return {accessPlan:summary.plan,verification:status ? 'verified':'unavailable',status,autoRenew:active ? true : stopped||expired ? false:null,
  amount,currency:local.currency,nextBillingAt,accessExpiresAt,
  unavailableFields:[...(!status?['status']:[]),...(amount===null?['amount']:[]),...(active&&!nextBillingAt?['nextBillingAt']:[]),...(!accessExpiresAt&&status!=='none'?['accessExpiresAt']:[])],
  reason:summary.reviewRequired?'review-required':status?null:'provider-state-unconfirmed'};
}
