import { PRODUCTION_OWNER_ACCOUNT_ID } from '../membership/entitlements.ts';

export const OWNER_ISSUER = 'https://clerk.techphase.app';
export const OWNER_ORIGIN = 'https://techphase.app';
export type OwnerAccess = Readonly<{userId:string; until:number}>;
const issued = new WeakSet<object>();
function issue(userId:string, until:number):OwnerAccess {
  const grant=Object.freeze({userId,until}); issued.add(grant); return grant;
}
/** Claims must already be signature/issuer/audience/time verified by the backend. */
export function ownerAccessFromVerifiedSession(claims:Record<string,unknown>,now=Date.now()):OwnerAccess|undefined {
  const fva=claims.fva;
  if(claims.sub!==PRODUCTION_OWNER_ACCOUNT_ID || claims.iss!==OWNER_ISSUER || claims.azp!==OWNER_ORIGIN ||
    !Array.isArray(fva)||fva.length!==2||typeof fva[1]!=='number'||!Number.isFinite(fva[1])||fva[1]<0||
    typeof claims.exp!=='number'||!Number.isFinite(claims.exp)||claims.exp*1000<=now)return undefined;
  return issue(PRODUCTION_OWNER_ACCOUNT_ID,Math.min(claims.exp*1000,now+60000));
}
/** Background jobs have no browser session. Re-read the production Clerk user on each run/send. */
export function ownerAccessFromVerifiedAccount(user:unknown,production:boolean,now=Date.now()):OwnerAccess|undefined {
  if(!production||!user||typeof user!=='object')return undefined;
  const u=user as {id?:unknown;twoFactorEnabled?:unknown;banned?:unknown;locked?:unknown};
  if(u.id!==PRODUCTION_OWNER_ACCOUNT_ID||u.twoFactorEnabled!==true||u.banned!==false||u.locked!==false)return undefined;
  return issue(PRODUCTION_OWNER_ACCOUNT_ID,now+60000);
}
export function hasOwnerAccess(grant:OwnerAccess|undefined,userId:string,now=Date.now()):boolean {
  return !!grant&&issued.has(grant)&&grant.userId===userId&&userId===PRODUCTION_OWNER_ACCOUNT_ID&&grant.until>now;
}
/** This is an access exception, not a purchase or a synthetic subscription. */
export function ownerAccessSnapshot(grant:OwnerAccess|undefined,userId:string) {
  if(!hasOwnerAccess(grant,userId))throw new Error('Owner access unavailable');
  return {productId:'resolute_v1' as const,asOf:new Date().toISOString(),accessBasis:'owner' as const,
    use:{status:'owner' as const,startsAt:null,expiresAt:null},
    alerts:{status:'owner' as const,startsAt:null,expiresAt:null},
    canUseTools:true,canReceiveNotifications:true};
}
