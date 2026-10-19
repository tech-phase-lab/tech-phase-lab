import { randomUUID } from 'node:crypto';
import { canReviewResolute } from './review-policy.ts';

type Env = Record<string, string | undefined>;
type Session = { userId: string | null; getToken: () => Promise<string | null> };
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff' };
const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
const checks = ['authenticatedSession', 'isolatedDatabase', 'staleBackupVerified', 'independentReadback',
  'firstReplay', 'secondReplay', 'planErased', 'notificationsStopped', 'pendingQueueEmpty'] as const;

function configuration(env: Env, now: number) {
  const until = Date.parse(env.RESOLUTE_RECOVERY_CHECK_UNTIL ?? '');
  if (env.VERCEL_ENV !== 'preview' || env.RESOLUTE_RECOVERY_CHECK_ENABLED !== 'true' ||
    !Number.isFinite(until) || until <= now || until > now + 3_600_000) return null;
  const endpoint = new URL(env.RESOLUTE_RECOVERY_CHECK_URL ?? '');
  if (endpoint.protocol !== 'https:' || endpoint.port || endpoint.username || endpoint.password ||
    endpoint.pathname !== '/' || endpoint.search || endpoint.hash ||
    !endpoint.hostname.endsWith('.up.railway.app') ||
    endpoint.origin === new URL(env.RESOLUTE_API_URL ?? '').origin) throw Error('Invalid isolation');
  const secret = env.RESOLUTE_RECOVERY_CHECK_SERVICE_TOKEN;
  if (!secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret) || secret === env.RESOLUTE_API_SERVICE_TOKEN)
    throw Error('Separate credential required');
  endpoint.pathname = '/internal/v1/recovery-check';
  return { endpoint, secret, until };
}

/** Disabled unless explicitly configured. Never changes ordinary save destinations. */
export function createRecoveryCheck(services: { env: Env; session: () => Promise<Session>;
  request?: typeof fetch; now?: () => number; id?: () => string }) {
  const request = services.request ?? fetch;
  const clock = services.now ?? Date.now;
  return async (incoming: Request) => {
    if (incoming.method !== 'POST') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    const url = new URL(incoming.url);
    if (url.search || incoming.headers.get('origin') !== url.origin ||
      incoming.headers.get('x-resolute-recovery-check') !== '1') return reply(403, { error: 'CHECK_DENIED' });
    try {
      const config = configuration(services.env, clock());
      if (!config) return reply(404, { error: 'CHECK_DISABLED' });
      // No caller-supplied IDs, URLs, SQL, fixtures or operations are accepted.
      const reader = incoming.body?.getReader();
      if (reader) {
        try { for (;;) { const part = await reader.read(); if (part.done) break;
          if (part.value.byteLength) { await reader.cancel(); return reply(400, { error: 'EMPTY_BODY_REQUIRED' }); }
        } } finally { reader.releaseLock(); }
      }
      const session = await services.session();
      if (!session.userId) return reply(401, { error: 'AUTH_REQUIRED' });
      if (!canReviewResolute(session.userId, services.env.VERCEL_ENV)) return reply(403, { error: 'CHECK_DENIED' });
      const token = await session.getToken();
      if (!token || token.length > 16384 || !/^[A-Za-z0-9_.-]+$/.test(token)) throw Error('Session unavailable');
      const started = clock();
      if (started >= config.until) throw Error('Expired');
      const requestId = (services.id ?? randomUUID)();
      // A lost response must not trigger another acceptance run automatically.
      const response = await request(config.endpoint, { method: 'POST', cache: 'no-store', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'X-Resolute-Service-Token': config.secret,
          'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ requestId }), signal: AbortSignal.timeout(Math.min(55_000, config.until - started)) });
      if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('application/json')) {
        await response.body?.cancel(); throw Error('Unavailable');
      }
      const stream = response.body?.getReader();
      if (!stream) throw Error('Empty response');
      const parts: Uint8Array[] = []; let size = 0;
      try { for (;;) { const part = await stream.read(); if (part.done) break;
        size += part.value.byteLength; if (size > 4096) { await stream.cancel(); throw Error('Oversize'); }
        parts.push(part.value);
      } } finally { stream.releaseLock(); }
      const report = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const completed = clock(), at = Date.parse(report?.verifiedAt);
      if (completed >= config.until || report?.requestId !== requestId || report?.state !== 'verified' ||
        !Number.isFinite(at) || at < started - 5000 || at > completed + 5000 ||
        checks.some(name => report?.checks?.[name] !== true) || report?.productionTouched !== false ||
        report?.mailSent !== false || report?.livePayment !== false || report?.aiCalled !== false)
        throw Error('Incomplete evidence');
      // Only the reviewed evidence fields can reach the browser; never relay raw logs.
      return reply(200, { state: 'verified', requestId, verifiedAt: new Date(at).toISOString(),
        checks: Object.fromEntries(checks.map(name => [name, true])),
        productionTouched: false, mailSent: false, livePayment: false, aiCalled: false });
    } catch { return reply(503, { error: 'RECOVERY_CHECK_UNAVAILABLE' }); }
  };
}
