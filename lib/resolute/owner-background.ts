import {createClerkClient} from '@clerk/backend';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../membership/entitlements.ts';
import {OWNER_ORIGIN,ownerAccessFromVerifiedAccount} from './owner-access.ts';

/** No persisted grants: account lock/MFA changes are rechecked for each queue run. */
export async function readBackgroundOwnerAccess(userId:string) {
  if(userId!==PRODUCTION_OWNER_ACCOUNT_ID)return undefined;
  const secretKey=process.env.RESOLUTE_MAIL_CLERK_SECRET_KEY;
  if(process.env.RESOLUTE_MAIL_PUBLIC_ORIGIN!==OWNER_ORIGIN||!secretKey?.startsWith('sk_live_'))return undefined;
  const user=await createClerkClient({secretKey}).users.getUser(userId);
  return ownerAccessFromVerifiedAccount(user,true);
}
