import "server-only";
import {auth,clerkClient} from '@clerk/nextjs/server';
import {PRODUCTION_OWNER_ACCOUNT_ID} from '../membership/entitlements';
import {isOwnerFreePreview} from './owner-free-preview';
import {resolveResoluteEntitlements} from './entitlements';
import { fetchResoluteEntitlements } from "./transport";

/** Vercel forwards a server-obtained session JWT, never a browser-selected ID. */
export async function getResoluteEntitlementsForSession(token: string) {
  if(process.env.VERCEL_ENV==='production') {
    const session=await auth();
    if(session.userId===PRODUCTION_OWNER_ACCOUNT_ID) {
      const user=await (await clerkClient()).users.getUser(session.userId);
      if(isOwnerFreePreview(session.userId,user.privateMetadata,process.env.VERCEL_ENV))
        return resolveResoluteEntitlements([],new Date().toISOString());
    }
  }
  return fetchResoluteEntitlements(token, process.env.RESOLUTE_API_URL,
    process.env.RESOLUTE_API_SERVICE_TOKEN);
}
