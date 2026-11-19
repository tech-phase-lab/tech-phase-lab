import { Pool } from 'pg';
import { createClerkClient } from '@clerk/backend';
import { livePaymentConfiguration } from './live-services.mjs';
import { createPaypal } from './paypal.mjs';
import { paymentStore } from './store.mjs';
import { renewalStore } from './renewal-store.mjs';
import { renewalJob, renewalMailProvider } from './renewal.mjs';

// RESOLUTE automatic renewal, one run (charges due renewals, settles pending ones, sends the 30-days-before email).
// Explicit command only: nothing schedules it. Off unless RESOLUTE_AUTO_RENEWAL_ENABLED=true (owner approval);
// then prints {"enabled":false} and exits 1 like the other disabled RESOLUTE jobs. Never prints values.
let pool;
try {
  const env = process.env;
  if (env.RESOLUTE_AUTO_RENEWAL_ENABLED !== 'true') {
    console.log(JSON.stringify({ enabled: false })); process.exitCode = 1;
  } else {
    if (env.RESOLUTE_PAYPAL_LIVE_ENABLED !== 'true') throw Error('Live payments required');
    const config = livePaymentConfiguration(env);
    pool = new Pool({ ...config.db, max: 2, application_name: 'resolute-auto-renewal' }); pool.on('error', () => {});
    const store = paymentStore(pool, { environment: 'live' });
    const clerk = createClerkClient({ secretKey: env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY });
    const report = await renewalJob({ store, renewals: renewalStore(pool, store, { environment: 'live' }), paypal: createPaypal(config.paypal),
      merchantId: config.paypal.merchantId, getUser: id => clerk.users.getUser(id), enabled: true,
      mail: renewalMailProvider({ apiKey: env.RESOLUTE_RESEND_API_KEY, from: env.RESOLUTE_MAIL_FROM }) })();
    console.log(JSON.stringify({ event: 'RESOLUTE_AUTO_RENEWAL', ...report }));
    if (report.errors || report.uncertain || report.review || report.noticeErrors) process.exitCode = 1;
  }
} catch { console.log(JSON.stringify({ error: 'AUTO_RENEWAL_UNAVAILABLE' })); process.exitCode = 1; }
finally { await pool?.end(); }
