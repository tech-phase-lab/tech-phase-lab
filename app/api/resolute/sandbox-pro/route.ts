import { auth, clerkClient } from '@clerk/nextjs/server';
import { prepareSandboxPro } from '@/lib/resolute/sandbox-pro';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
 if (process.env.VERCEL_ENV !== 'preview') return Response.json({ ok: false }, { status: 404, headers });
 if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('x-resolute-test-setup') !== '1')
   return Response.json({ ok: false }, { status: 403, headers });
 try {
  const { userId } = await auth();
  const client = await clerkClient();
  const result = await prepareSandboxPro({ actor: userId, env: process.env,
   read: id => client.users.getUser(id),
   write: (id, privateMetadata) => client.users.updateUserMetadata(id, { privateMetadata }),
  });
  console.info(JSON.stringify({ event: 'RESOLUTE_SANDBOX_PRO_PREPARED', until: result.until, repeated: result.repeated }));
  return Response.json(result, { headers });
 } catch (error) {
  const code = error instanceof Error && ['SETUP_DENIED', 'TARGET_NOT_ELIGIBLE', 'EXISTING_MEMBERSHIP', 'VERIFY_FAILED'].includes(error.message) ? error.message : 'SETUP_UNAVAILABLE';
  console.warn(JSON.stringify({ event: 'RESOLUTE_SANDBOX_PRO_SETUP_FAILED', code }));
  return Response.json({ ok: false, code }, { status: code === 'SETUP_DENIED' ? 403 : 409, headers });
 }
}
