import {accountIdentity,reply,accountError,input} from '@/lib/account/server';
import {readDeletionCheck} from '@/lib/account/deletion';
import {isOwnerAccount} from '@/lib/membership/entitlements';
export const dynamic='force-dynamic';
async function eligibility(){
 const id=await accountIdentity(),owner=isOwnerAccount(id);
 const contract=owner?null:await readDeletionCheck(id);
 const reason=owner?'owner-account':contract?.autoRenew===true?'auto-renew-active':contract?.verification!=='verified'||contract?.autoRenew!==false?'contract-unverified':'deletion-orchestration-unavailable';
 return {canDelete:false,reason,proAccessLostAtDeletion:contract?.proAccessLostAtDeletion??null,
  affectedData:['profile','saved-research-and-notes','watchlists','notification-subscriptions','resolute-personal-settings'],
  retainedData:['necessary-payment-and-security-records'],
  message:'削除すると会員データと残りのPRO利用権が失われます。現在は一括削除機能の準備中です。'};
}
export async function GET(){try{return reply(await eligibility());}catch(e){return accountError(e);}}
export async function DELETE(request:Request){try{await input(request);return reply(await eligibility(),409);}catch(e){return accountError(e);}}
