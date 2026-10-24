import { auth } from '@clerk/nextjs/server';
import { createRecoveryCheck } from '@/lib/resolute/recovery-check';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const POST = createRecoveryCheck({ env: process.env, session: auth });
