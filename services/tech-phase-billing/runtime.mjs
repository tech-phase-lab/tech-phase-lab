import { sandboxMemberAllowed } from './access.mjs';
import { Pool } from 'pg';
import { sandboxConfig, createPaypal } from './paypal.mjs';
import { sandboxDatabaseConfig } from './database-config.mjs';
import { billingStore } from './store.mjs';
import { checkoutService } from './checkout.mjs';
import { reconciliationService } from './settlement.mjs';
import { webhookService } from './webhook.mjs';
export function billingRuntime(env,ownerId) {
  let cached,pool;
  return {
    services() {
      if(cached)return cached;
      const config=sandboxConfig(env);
      pool=new Pool(sandboxDatabaseConfig(env));
      const store=billingStore(pool),paypal=createPaypal(config);
      const reconciliation=reconciliationService({store,paypal,plans:config.plans});
      cached={store,reconciliation,checkout:checkoutService({store,paypal,termsVersion:'sandbox-v1'}),webhook:webhookService({store,paypal,reconciliation,ownerId,allowedUser:userId=>sandboxMemberAllowed(env,ownerId,userId)})};
      return cached;
    },
    async close(){await pool?.end();}
  };
}
