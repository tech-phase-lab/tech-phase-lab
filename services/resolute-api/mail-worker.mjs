import {Pool} from 'pg';
import {createClerkClient} from '@clerk/backend';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createResendAlertDelivery} from '../../lib/resolute/notification-resend-delivery.ts';
import {createMailWorker} from '../../lib/resolute/notification-mail-worker.ts';

// No automatic startup, scheduler registration or environment changes.
let pool;
try{
 if(process.env.RESOLUTE_MAIL_DELIVERY_ENABLED!=='true'){
  console.log(JSON.stringify({enabled:false}));process.exitCode=1;
 }else{
  const env=process.env,key=env.RESOLUTE_MAIL_STOP_KEY_HEX;
  if(env.RESOLUTE_ENTITLEMENT_SOURCE!=='live')throw Error('Live entitlement source required');
  if(env.RESOLUTE_MAIL_STOP_ENABLED!=='true'||env.RESOLUTE_MAIL_FEEDBACK_ENABLED!=='true'||env.RESOLUTE_MAIL_MONITOR_ENABLED!=='true')throw Error('Mail prerequisites required');
  if(!key||!/^[a-f0-9]{64}$/.test(key)||key===env.RESOLUTE_PROTECTION_KEY_HEX||!env.RESOLUTE_MAIL_CLERK_SECRET_KEY)throw Error('Dedicated mail configuration required');
  const config=resoluteDatabaseConfig(env.RESOLUTE_NOTIFICATION_SENDER_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_notification_sender')throw Error('Scoped sender required');
  const origin=new URL(env.RESOLUTE_MAIL_PUBLIC_ORIGIN??'');
  if(origin.protocol!=='https:'||origin.origin!==env.RESOLUTE_MAIL_PUBLIC_ORIGIN||origin.username||origin.password)throw Error('Public origin required');
  pool=new Pool(config);pool.on('error',()=>{});
  const deliver=createResendAlertDelivery(pool,{enabled:true,apiKey:env.RESOLUTE_RESEND_API_KEY??'',from:env.RESOLUTE_MAIL_FROM??'',publicOrigin:origin.origin,stopKey:Buffer.from(key,'hex'),clerk:createClerkClient({secretKey:env.RESOLUTE_MAIL_CLERK_SECRET_KEY})});
  const report=await createMailWorker(pool,{enabled:true,deliver})();console.log(JSON.stringify(report));
  if(report.uncertain||report.errors||report.incomplete)process.exitCode=1;
 }
}catch{console.log(JSON.stringify({error:'MAIL_WORKER_UNAVAILABLE'}));process.exitCode=1;}
finally{await pool?.end();}
