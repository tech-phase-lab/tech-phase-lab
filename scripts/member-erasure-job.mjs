// Member erasure job: Postgres steps for members whose Clerk account was deleted (owner-approved design, 2026-11-20).
// OFF unless MEMBER_ERASURE_ENABLED=true (erasure) / RESEARCH_RETENTION_PURGE_ENABLED=true (periodic purge).
// Reads the pending members from the research monitor (queued by the user.deleted webhook), runs
// tech_phase_billing_live.erase_member and resolute.erase_member (db/tech-phase/009, db/resolute/026) with
// dedicated EXECUTE-only logins, and acknowledges each finished step. Owner accounts are skipped here too.
// Logs carry counts and reason codes only: never a member id, a pseudonym, a URL with credentials or a key.
//
// Variables (all needed only once the owner approves turning it on):
//   MEMBER_ERASURE_ENABLED, RESEARCH_RETENTION_PURGE_ENABLED, RESEARCH_MONITOR_URL, RESEARCH_MONITOR_TOKEN,
//   MEMBER_ERASURE_BILLING_DATABASE_URL (login tech_phase_member_erasure), MEMBER_ERASURE_RESOLUTE_DATABASE_URL
//   (login resolute_member_erasure).
const OWNER_ACCOUNT_IDS = new Set(['user_3JulL4D07KtVl5Eg2zdY1iczKbC', 'user_3LHR1K8f8zwyDcVzMg7ud6KB9Wb']);
const MEMBER_ID = /^user_[A-Za-z0-9]{1,128}$/;
const BLOCKING = new Set(['open-contract', 'open-renewal', 'open-order']);
const STEPS = {
  billing: { db: 'billing', erase: 'SELECT tech_phase_billing_live.erase_member($1) AS result', purge: 'SELECT tech_phase_billing_live.purge_expired() AS result' },
  resolute: { db: 'resolute', erase: 'SELECT resolute.erase_member($1) AS result', purge: 'SELECT resolute.purge_expired() AS result' },
};

export const flag = (env, name) => (env[name] ?? '').trim().toLowerCase() === 'true';
export const ownerIds = () => [...OWNER_ACCOUNT_IDS];

function reasonOf(error) {
  const message = String(error?.message ?? '');
  return [...BLOCKING, 'owner-account', 'invalid-member'].find(code => message.includes(code)) ?? 'failed';
}

/** monitor: {pending(): [{memberId, pending:[step]}], acknowledge(memberId, step)}; databases: {billing, resolute} with query(). */
export async function runErasureJob({ env, monitor, databases, log = line => console.log(JSON.stringify(line)) }) {
  const summary = { event: 'member-erasure-job', erasure: 'disabled', purge: 'disabled', members: 0, steps: 0, blocked: {}, failed: 0, skippedOwner: 0 };
  if (flag(env, 'MEMBER_ERASURE_ENABLED')) {
    summary.erasure = 'ran';
    const requests = await monitor.pending();
    for (const request of Array.isArray(requests) ? requests.slice(0, 100) : []) {
      const member = request?.memberId;
      if (typeof member !== 'string' || !MEMBER_ID.test(member)) { summary.failed++; continue; }
      if (OWNER_ACCOUNT_IDS.has(member)) { summary.skippedOwner++; continue; }
      summary.members++;
      for (const step of Array.isArray(request.pending) ? request.pending : []) {
        const config = STEPS[step];
        if (!config) continue;
        try {
          await databases[config.db].query(config.erase, [member]);
          await monitor.acknowledge(member, step);
          summary.steps++;
        } catch (error) {
          const reason = reasonOf(error);
          if (BLOCKING.has(reason)) summary.blocked[`${step}:${reason}`] = (summary.blocked[`${step}:${reason}`] ?? 0) + 1;
          else summary.failed++;
        }
      }
    }
  }
  if (flag(env, 'RESEARCH_RETENTION_PURGE_ENABLED')) {
    summary.purge = {};
    for (const [step, config] of Object.entries(STEPS)) {
      try {
        const { rows } = await databases[config.db].query(config.purge);
        summary.purge[step] = rows?.[0]?.result ?? null;
      } catch { summary.purge[step] = 'failed'; summary.failed++; }
    }
  }
  log(summary);
  return summary;
}

export function monitorClient(env, fetchImpl = fetch) {
  const token = env.RESEARCH_MONITOR_TOKEN, base = env.RESEARCH_MONITOR_URL;
  if (!token || !base) throw new Error('monitor-unconfigured');
  const root = new URL(base);
  if (root.protocol !== 'https:' || root.username || root.password) throw new Error('monitor-unconfigured');
  const url = path => { const u = new URL(root.href); u.pathname = `${u.pathname.replace(/\/$/, '')}${path}`; u.search = ''; return u.href; };
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async pending() {
      const response = await fetchImpl(url('/member/erasure-requests'), { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const value = await response.json();
      if (response.status !== 200 || value?.ok !== true || !Array.isArray(value.requests)) throw new Error('monitor-unavailable');
      return value.requests;
    },
    async acknowledge(memberId, step) {
      const response = await fetchImpl(url('/member/erasure-requests/ack'), { method: 'POST', headers, redirect: 'error', body: JSON.stringify({ memberId, step }), signal: AbortSignal.timeout(15000) });
      if (response.status !== 200) throw new Error('monitor-ack-failed');
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env;
  if (!flag(env, 'MEMBER_ERASURE_ENABLED') && !flag(env, 'RESEARCH_RETENTION_PURGE_ENABLED')) {
    console.log(JSON.stringify({ event: 'member-erasure-job', erasure: 'disabled', purge: 'disabled' }));
    process.exit(0);
  }
  const { Pool } = await import('pg');
  const billing = new Pool({ connectionString: env.MEMBER_ERASURE_BILLING_DATABASE_URL, max: 1 });
  const resolute = new Pool({ connectionString: env.MEMBER_ERASURE_RESOLUTE_DATABASE_URL, max: 1 });
  try {
    const monitor = flag(env, 'MEMBER_ERASURE_ENABLED') ? monitorClient(env) : null;
    const summary = await runErasureJob({ env, monitor, databases: { billing, resolute } });
    process.exitCode = summary.failed ? 1 : 0;
  } catch (error) {
    console.error(JSON.stringify({ event: 'member-erasure-job-failed', error: error instanceof Error ? error.message.replace(/[^a-z-]/g, '').slice(0, 40) : 'unknown' }));
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([billing.end(), resolute.end()]);
  }
}
