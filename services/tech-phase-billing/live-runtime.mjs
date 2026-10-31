import {accountContract} from './account-view.mjs';
import {accountDeletionCheck} from './account-deletion-check.mjs';
import {billingAbuse} from './abuse.mjs';
import {liveRecoveryQueue} from './live-recovery.mjs';
import {Pool} from 'pg';
import {liveConfig,createPaypal} from './paypal.mjs';
import {liveDatabaseConfig} from './database-config.mjs';
import {liveMember} from './live-http.mjs';
import {billingStore} from './store.mjs';
import {checkoutService} from './checkout.mjs';
import {reconciliationService} from './settlement.mjs';
import {webhookService} from './webhook.mjs';
export function liveRuntime(env){
 let cached,pool;
 return {
  services(){
   if(cached)return cached;
   const config=liveConfig(env);pool=new Pool(liveDatabaseConfig(env));
   const store=billingStore(pool,'live'),paypal=createPaypal(config);
   const reconciliation=reconciliationService({store,paypal,plans:config.plans});
   cached={accountDeletionCheck:userId=>accountDeletionCheck({store,paypal,plans:config.plans},userId),accountContract:userId=>accountContract({store,paypal,plans:config.plans},userId),store,reconciliation,abuse:billingAbuse(pool),recoveryQueue:liveRecoveryQueue(pool),checkout:checkoutService({store,paypal,termsVersion:'pro-live-v1'}),webhook:webhookService({store,paypal,reconciliation,allowedUser:liveMember})};return cached;
  },
  async close(){await pool?.end();}
 };
}
