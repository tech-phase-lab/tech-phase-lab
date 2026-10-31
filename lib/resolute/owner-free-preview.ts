import {PRODUCTION_OWNER_ACCOUNT_ID,previewPlan} from '../membership/entitlements.ts';

/** Only pass a Clerk-authenticated ID and private metadata read on the server.
 * This can only remove access for a preview, never grant owner or purchase access. */
export function isOwnerFreePreview(userId:string,metadata:Record<string,unknown>,environment:string|undefined,now=Date.now()) {
 return environment==='production'&&userId===PRODUCTION_OWNER_ACCOUNT_ID&&previewPlan(metadata,true,'preview',now)==='free';
}
