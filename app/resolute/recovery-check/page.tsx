import { auth } from '@clerk/nextjs/server';
import { notFound } from 'next/navigation';
import { membershipConfigured } from '@/lib/membership/server';
import { canReviewResolute } from '@/lib/resolute/review-policy';
import Screen from './screen';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'RESOLUTE | 復元確認', robots: { index: false, follow: false } };

function requestWindowOpen() {
  const now = Date.now();
  const until = Date.parse(process.env.RESOLUTE_RECOVERY_CHECK_UNTIL ?? '');
  return process.env.RESOLUTE_RECOVERY_CHECK_ENABLED === 'true' &&
    Number.isFinite(until) && until > now && until <= now + 3_600_000;
}

export default async function Page() {
  if (process.env.VERCEL_ENV !== 'preview' || !membershipConfigured()) notFound();
  const { userId } = await auth();
  if (!canReviewResolute(userId, process.env.VERCEL_ENV)) notFound();
  return <Screen enabled={requestWindowOpen()} />;
}
