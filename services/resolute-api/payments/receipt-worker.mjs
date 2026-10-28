import { Pool } from 'pg';
import { resoluteDatabaseConfig } from '../../../lib/resolute/database-config.ts';
import { createPaypal, livePaypalConfig } from './paypal.mjs';
import { recoveryTokens } from './recovery.mjs';
import { receiptProvider, receiptWorker } from './receipt-mail.mjs';

// Explicit operator command only. Never run by app startup or a configured cron here.
let pool;
try {
  const env=process.env;
  if(env.RESOLUTE_GUEST_RECEIPT_DELIVERY_ENABLED!=='true') {
    console.log(JSON.stringify({enabled:false}));process.exitCode=1;
  }else{
    if(env.RESOLUTE_PAYPAL_LIVE_ENABLED!=='true'||env.RESOLUTE_GUEST_CHECKOUT_ENABLED!=='true')throw Error('Receipt prerequisites required');
    const key=env.RESOLUTE_GUEST_RECOVERY_KEY_HEX;
    if([env.RESOLUTE_PROTECTION_KEY_HEX,env.RESOLUTE_MAIL_STOP_KEY_HEX,env.RESOLUTE_API_SERVICE_TOKEN].includes(key))throw Error('Dedicated key required');
    const tokens=recoveryTokens(key),paypalConfig=livePaypalConfig(env);
    const config=resoluteDatabaseConfig(env.RESOLUTE_GUEST_RECEIPT_DB_URL);
    if(new URL(config.connectionString).username!=='resolute_guest_mail_sender')throw Error('Scoped sender required');
    const origin=new URL(env.RESOLUTE_MAIL_PUBLIC_ORIGIN??'');
    if(origin.protocol!=='https:'||origin.origin!==env.RESOLUTE_MAIL_PUBLIC_ORIGIN)throw Error('Public origin required');
    const provider=receiptProvider({apiKey:env.RESOLUTE_RESEND_API_KEY,from:env.RESOLUTE_MAIL_FROM});
    pool=new Pool({...config,max:2});pool.on('error',()=>{});
    const report=await receiptWorker({pool,paypal:createPaypal(paypalConfig),provider,tokens,origin:origin.origin,merchantId:paypalConfig.merchantId,enabled:true})();
    console.log(JSON.stringify(report));if(report.errors||report.uncertain||report.needsReview)process.exitCode=1;
  }
}catch{console.log(JSON.stringify({error:'RECEIPT_WORKER_UNAVAILABLE'}));process.exitCode=1;}
finally{await pool?.end();}
