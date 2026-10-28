import {runLiveRecovery} from './live-recovery.mjs';

export async function recoveryPing(url, phase, send = fetch) {
 if (!url) return 'disabled';
 if (!/^https:\/\/hc-ping\.com\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(url) || !['start','success','fail'].includes(phase)) return 'failed';
 try {
  const response = await send(url + (phase === 'success' ? '' : '/' + phase), {
   method:'POST', redirect:'error', signal:AbortSignal.timeout(10000), body:''
  });
  await response.body?.cancel();
  return response.ok ? 'sent' : 'failed';
 } catch { return 'failed'; }
}

export async function runRecoveryJob({env, runtime, signal, run = runLiveRecovery, ping = recoveryPing, log = console.log}) {
 // Never mark a check healthy from a disabled or wrong-environment deployment.
 const active = env.TECH_PHASE_BILLING_LIVE_RECOVERY_ENABLED === 'true' &&
  env.TECH_PHASE_PAYPAL_ENV === 'live' && env.TECH_PHASE_BILLING_RUNTIME === 'railway-live' &&
  env.TECH_PHASE_BILLING_LIVE_BRANCH && env.RAILWAY_GIT_BRANCH === env.TECH_PHASE_BILLING_LIVE_BRANCH;
 const url = active ? env.TECH_PHASE_BILLING_LIVE_RECOVERY_MONITOR_PING_URL : '';
 const start = await ping(url, 'start');
 let failed = false, result;
 try {
  result = await run({env, services:runtime.services, signal});
  log(JSON.stringify({event:'TECH_PHASE_LIVE_RECOVERY', ...result}));
  failed = result.outcome === 'partial-failure' || Boolean(signal?.aborted);
 } catch { failed = true; log(JSON.stringify({event:'TECH_PHASE_LIVE_RECOVERY_FAILED'})); }
 try { await runtime.close(); } catch { failed = true; }
 // A disabled job must not refresh the external heartbeat.
 const finish = active ? await ping(url, failed ? 'fail' : 'success') : 'disabled';
 log(JSON.stringify({event:'TECH_PHASE_LIVE_RECOVERY_MONITOR', monitor_start:start, monitor_finish:finish}));
 return failed || start === 'failed' || finish === 'failed' ? 1 : 0;
}
