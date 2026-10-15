import { Pool } from 'pg';
import { createClerkClient } from '@clerk/backend';
import { resoluteDatabaseConfig } from '../../../lib/resolute/database-config.ts';
import { authenticate } from '../auth.mjs';
import { OWNER_ACCOUNT_ID } from '../../../lib/membership/entitlements.ts';
import { paypalConfig, createPaypal } from './paypal.mjs';
import { paymentStore } from './store.mjs';
import { paymentEngine } from './engine.mjs';
import { paymentHttp } from './http.mjs';
export function paymentRuntime(env,authConfig) {
  let handler;
  return async request=>{
    const path=new URL(request.url).pathname;
    if(!path.startsWith('/internal/v1/payments') && path !== '/webhooks/paypal') return null;
    // Even when purchases are disabled, signed refund/dispute notifications must remain processable.
    if(path !== '/webhooks/paypal' && env.RESOLUTE_PAYMENTS_ENABLED !== 'true')
      return Response.json({error:'PAYMENT_DISABLED'},{status:503,headers:{'Cache-Control':'private, no-store'}});
    try {
      if(!handler) {
        const config=paypalConfig(env);
        const db=resoluteDatabaseConfig(env.RESOLUTE_PAYMENT_DB_URL);
        if(new URL(db.connectionString).username !== 'resolute_payment_sandbox_writer' || !env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY) throw Error('Unavailable');
        const pool=new Pool({...db,max:4,application_name:'resolute-payment-sandbox'});pool.on('error',()=>{});
        const store=paymentStore(pool),paypal=createPaypal(config);
        const clerk=createClerkClient({secretKey:env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY});
        const engine=paymentEngine({store,paypal,merchantId:config.merchantId,getUser:id=>clerk.users.getUser(id)});
        handler=paymentHttp({engine,store,authenticate:headers=>authenticate(headers,authConfig),
          enabled:env.RESOLUTE_PAYMENTS_ENABLED === 'true',allowedUsers:[OWNER_ACCOUNT_ID]});
      }
      return await handler(request);
    } catch { return Response.json({error:'PAYMENT_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'private, no-store'}}); }
  };
}
