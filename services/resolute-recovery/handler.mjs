import { open } from 'node:fs/promises';
import { authenticate } from '../resolute-api/auth.mjs';
import { OWNER_ACCOUNT_ID } from '../../lib/membership/entitlements.ts';

const checks = ['isolatedDatabase', 'staleBackupVerified', 'independentReadback',
  'firstReplay', 'secondReplay', 'planErased', 'notificationsStopped', 'pendingQueueEmpty'];
const reply = (status, error) => Response.json({ error }, { status,
  headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });

/** One permit per prepared sandbox, including after process restart. Never remove
 * a consumed permit to retry an uncertain run. Provision a fresh sandbox instead.
 * The enclosing directory must be private and retained for the sandbox lifetime.
 */
export function filePermit(path) {
  return async requestId => {
    let file;
    try { file = await open(path, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') return false; throw error; }
    try { await file.writeFile(JSON.stringify({ requestId })); await file.sync(); }
    finally { await file.close(); }
    return true;
  };
}

/** Authenticated coordinator only. execute must be a fixed isolated acceptance
 * implementation, never a command or database URL supplied by the caller.
 */
export function createRecoveryHandler({ config, enabled = false, until, claim,
  execute, now = Date.now, verify = authenticate }) {
  let consumed = false;
  const deadline = Date.parse(until ?? '');
  const inWindow = () => enabled === true && Number.isFinite(deadline) &&
    deadline > now() && deadline <= now() + 3_600_000;
  return async request => {
    const url = new URL(request.url);
    if (url.pathname !== '/internal/v1/recovery-check' || url.search) return reply(404, 'NOT_FOUND');
    if (request.method !== 'POST') return reply(405, 'METHOD_NOT_ALLOWED');
    if (!inWindow()) return reply(404, 'CHECK_DISABLED');
    try {
      const userId = await verify(request.headers, config);
      if (!userId) return reply(401, 'AUTH_REQUIRED');
      if (userId !== OWNER_ACCOUNT_ID) return reply(403, 'CHECK_DENIED');
      if (request.headers.get('content-type') !== 'application/json') return reply(400, 'INVALID_REQUEST');
      const reader = request.body?.getReader();
      if (!reader) return reply(400, 'INVALID_REQUEST');
      const chunks = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 128) { await reader.cancel(); return reply(400, 'INVALID_REQUEST'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!input || Object.keys(input).length !== 1 ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.requestId))
        return reply(400, 'INVALID_REQUEST');
      if (!inWindow()) return reply(404, 'CHECK_DISABLED');
      if (consumed) return reply(409, 'CHECK_ALREADY_STARTED');
      // Set before the first await: concurrent calls cannot both claim execution.
      consumed = true;
      if (!await claim(input.requestId)) return reply(409, 'CHECK_ALREADY_STARTED');
      if (!inWindow()) return reply(503, 'RECOVERY_CHECK_UNAVAILABLE');
      const signal = AbortSignal.timeout(Math.min(50_000, deadline - now()));
      const evidence = await execute({ requestId: input.requestId, userId, signal });
      if (signal.aborted || !inWindow() || checks.some(name => evidence?.[name] !== true) ||
        ['productionTouched', 'mailSent', 'livePayment', 'aiCalled'].some(name => evidence?.[name] !== false))
        return reply(503, 'RECOVERY_CHECK_UNAVAILABLE');
      return Response.json({ state: 'verified', requestId: input.requestId,
        verifiedAt: new Date(now()).toISOString(),
        checks: { authenticatedSession: true, ...Object.fromEntries(checks.map(name => [name, true])) },
        productionTouched: false, mailSent: false, livePayment: false, aiCalled: false },
      { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch { return reply(503, 'RECOVERY_CHECK_UNAVAILABLE'); }
  };
}
