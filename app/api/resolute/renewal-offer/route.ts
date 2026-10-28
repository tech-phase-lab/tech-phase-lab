import {auth,clerkClient} from '@clerk/nextjs/server';
import {membershipConfigured} from '@/lib/membership/server';
import {resolvePlan} from '@/lib/membership/entitlements';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
// Display only. Never creates an order or grants access; checkout must reprice.
export async function GET(){try{
 if(!membershipConfigured())throw Error();
 const {userId}=await auth();if(!userId)return Response.json({error:'AUTH_REQUIRED'},{status:401,headers});
 const user=await(await clerkClient()).users.getUser(userId);
 const pro=resolvePlan(user.privateMetadata)==='pro';
 return Response.json({ja:pro?3980:5980,en:pro?29:39},{headers});
}catch{return Response.json({error:'UNAVAILABLE'},{status:503,headers});}}
