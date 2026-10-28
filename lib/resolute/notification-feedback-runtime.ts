import { Pool } from 'pg';
import { resoluteDatabaseConfig } from './database-config.ts';
import { createMailFeedbackRoute, createMailFeedbackStore } from './notification-feedback.ts';

export function createMailFeedbackRuntime(env:NodeJS.ProcessEnv) {
 let pool:Pool|undefined;
 return createMailFeedbackRoute({enabled:()=>env.RESOLUTE_MAIL_FEEDBACK_ENABLED==='true',
  secret:env.RESOLUTE_RESEND_WEBHOOK_SECRET??'',from:env.RESOLUTE_MAIL_FROM??'',
  consume:async event=>{
   if(!pool){
    const config=resoluteDatabaseConfig(env.RESOLUTE_NOTIFICATION_SENDER_DB_URL);
    if(new URL(config.connectionString).username!=='resolute_notification_sender')throw Error('Scoped sender required');
    pool=new Pool(config);pool.on('error',()=>{});
   }
   return createMailFeedbackStore(pool)(event);
  }});
}
