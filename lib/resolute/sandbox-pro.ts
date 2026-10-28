import { OWNER_ACCOUNT_ID } from '../membership/entitlements.ts';
import { sandboxTester } from './sandbox-access.ts';

type User = { id: string; banned: boolean; locked: boolean; primaryEmailAddressId: string | null;
 emailAddresses: { id: string; verification: { status: string } | null }[]; privateMetadata: Record<string, unknown> };
export async function prepareSandboxPro({ actor, env, read, write, now = Date.now() }: {
 actor: string | null; env: Record<string, string | undefined>; now?: number;
 read: (id: string) => Promise<User>;
 write: (id: string, metadata: Record<string, unknown>) => Promise<unknown>;
}) {
 const target = sandboxTester(env, now), until = env.RESOLUTE_SANDBOX_TEST_UNTIL;
 if (env.VERCEL_ENV !== 'preview' || actor !== OWNER_ACCOUNT_ID || !target || target === OWNER_ACCOUNT_ID ||
     !until || Date.parse(until) - now > 7 * 86400000) throw Error('SETUP_DENIED');
 const user = await read(target), meta = user.privateMetadata;
 if (user.id !== target || user.banned || user.locked || meta.role === 'admin' ||
     !user.emailAddresses.some(e => e.id === user.primaryEmailAddressId && e.verification?.status === 'verified')) throw Error('TARGET_NOT_ELIGIBLE');
 const marker = meta.resoluteSandboxProSetup as Record<string, unknown> | undefined;
 const repeated = marker?.until === until && meta.plan === 'pro' && meta.proExpiresAt === until;
 // Never overwrite an existing membership. Only the explicitly configured test identity is mutable.
 if (!repeated && ((meta.plan !== undefined && meta.plan !== 'free') ||
     (typeof meta.proExpiresAt === 'string' && Date.parse(meta.proExpiresAt) > now))) throw Error('EXISTING_MEMBERSHIP');
 if (!repeated) await write(target, { plan: 'pro', proExpiresAt: until,
   resoluteSandboxProSetup: { until, preparedAt: new Date(now).toISOString(), preparedBy: actor, previousPlan: meta.plan ?? null } });
 const checked = await read(target);
 if (checked.id !== target || checked.privateMetadata.plan !== 'pro' || checked.privateMetadata.proExpiresAt !== until) throw Error('VERIFY_FAILED');
 return { ok: true, until, repeated };
}
