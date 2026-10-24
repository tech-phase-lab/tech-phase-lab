import { clerkClient } from '@clerk/nextjs/server';
import { resolvePlan } from '@/lib/membership/entitlements';
import { validSyncToken } from '@/lib/membership/sync-auth';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const headers = {'Cache-Control':'private, no-store'};
  if (!validSyncToken(request.headers.get('authorization'), process.env.MEMBER_SHEET_SYNC_TOKEN)) return new Response('Unauthorized', {status:401,headers});
  try {
    const client = await clerkClient();
    const members = new Map();
    let total: number | undefined;
    for (let offset=0; ; offset+=100) {
      const page = await client.users.getUserList({limit:100,offset,orderBy:'+created_at'});
      if (total !== undefined && total !== page.totalCount) throw new Error('Membership changed during snapshot');
      total = page.totalCount;
      for (const user of page.data) {
        const email = user.emailAddresses.find(item=>item.id===user.primaryEmailAddressId);
        members.set(user.id, {id:user.id,kind:user.id==='user_3JulL4D07KtVl5Eg2zdY1iczKbC'?'運営':'一般',name:[user.firstName,user.lastName].filter(Boolean).join(' '),email:email?.emailAddress??'',verified:email?.verification?.status==='verified',plan:resolvePlan(user.privateMetadata).toUpperCase(),createdAt:new Date(user.createdAt).toISOString(),lastSignInAt:user.lastSignInAt?new Date(user.lastSignInAt).toISOString():null,proExpiresAt:typeof user.privateMetadata.proExpiresAt==='string'?user.privateMetadata.proExpiresAt:null});
      }
      if (offset+page.data.length>=total) break;
      if (!page.data.length) throw new Error('Incomplete snapshot');
    }
    if (members.size!==total) throw new Error('Incomplete snapshot');
    return Response.json({version:1,complete:true,total,generatedAt:new Date().toISOString(),members:[...members.values()]},{headers});
  } catch {return new Response('Sync unavailable',{status:503,headers});}
}
