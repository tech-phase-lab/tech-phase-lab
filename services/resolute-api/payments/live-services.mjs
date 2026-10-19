/** Dormant factory. Not imported by the public HTTP runtime or API startup. */
import { Pool } from 'pg';
import { createClerkClient } from '@clerk/backend';
import { resoluteDatabaseConfig } from '../../../lib/resolute/database-config.ts';
import { livePaypalConfig, createPaypal } from './paypal.mjs';
import { paymentStore } from './store.mjs';
import { paymentEngine } from './engine.mjs';
import { createLiveEntitlementReader } from './live-entitlements.mjs';

export function livePaymentConfiguration(env) {
  const paypal=livePaypalConfig(env);
  const db=resoluteDatabaseConfig(env.RESOLUTE_PAYMENT_LIVE_DB_URL);
  if (new URL(db.connectionString).username !== 'resolute_payment_live_writer' ||
      env.RESOLUTE_ENTITLEMENT_SOURCE !== 'live' || !env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY) throw Error('Live payment configuration unavailable');
  return {paypal,db};
}
export function createLivePaymentServices(env) {
  const config=livePaymentConfiguration(env);
  const pool=new Pool({...config.db,max:4,application_name:'resolute-payment-live'});
  pool.on('error',()=>{});
  const store=paymentStore(pool,{environment:'live'}), paypal=createPaypal(config.paypal);
  const clerk=createClerkClient({secretKey:env.RESOLUTE_PAYMENT_CLERK_SECRET_KEY});
  return {store, access:createLiveEntitlementReader(pool), close:()=>pool.end(),
    engine:paymentEngine({store,paypal,environment:'live',merchantId:config.paypal.merchantId,
      getUser:id=>clerk.users.getUser(id), canCharge:()=>env.RESOLUTE_LIVE_SALES_ENABLED === 'true'})};
}
