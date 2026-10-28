import { resoluteDatabaseConfig } from './database-config.ts';
import { protectionGatewayConfig } from './protection-runtime.ts';

/** Offline configuration inspection only. Never opens sockets or enables features.
 * A passing report cannot prove DNS, credentials, database grants or delivery. */
export function inspectMailConfiguration(env: NodeJS.ProcessEnv) {
 const checks: {name:string; valid:boolean}[]=[];
 const check=(name:string,validate:()=>unknown)=>{
  try { checks.push({name,valid:validate()===true}); }
  catch { checks.push({name,valid:false}); }
 };
 for(const name of ['RESOLUTE_MAIL_DELIVERY_ENABLED','RESOLUTE_MAIL_STOP_ENABLED','RESOLUTE_MAIL_FEEDBACK_ENABLED','RESOLUTE_MAIL_MONITOR_ENABLED'])
  check(name,()=>env[name]==='true');
 check('RESOLUTE_ENTITLEMENT_SOURCE',()=>env.RESOLUTE_ENTITLEMENT_SOURCE==='live');
 for(const [name,role] of [['RESOLUTE_NOTIFICATION_SENDER_DB_URL','resolute_notification_sender'],['RESOLUTE_NOTIFICATION_DB_URL','resolute_notification_writer']])
  check(name,()=>new URL(resoluteDatabaseConfig(env[name]).connectionString).username===role);
 check('RESOLUTE_MAIL_PUBLIC_ORIGIN',()=>{
  const url=new URL(env.RESOLUTE_MAIL_PUBLIC_ORIGIN??'');
  return url.protocol==='https:'&&url.origin===env.RESOLUTE_MAIL_PUBLIC_ORIGIN&&!url.username&&!url.password;
 });
 check('RESOLUTE_MAIL_STOP_KEY_HEX',()=>/^[a-f0-9]{64}$/.test(env.RESOLUTE_MAIL_STOP_KEY_HEX??'')&&env.RESOLUTE_MAIL_STOP_KEY_HEX!==env.RESOLUTE_PROTECTION_KEY_HEX);
 check('RESOLUTE_RESEND_API_KEY',()=>/^re_[A-Za-z0-9_-]{10,200}$/.test(env.RESOLUTE_RESEND_API_KEY??''));
 check('RESOLUTE_MAIL_FROM',()=>{
  const from=env.RESOLUTE_MAIL_FROM??'';
  return from.length<=320&&/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(from);
 });
 check('RESOLUTE_MAIL_CLERK_SECRET_KEY',()=>Boolean(env.RESOLUTE_MAIL_CLERK_SECRET_KEY?.trim()));
 check('RESOLUTE_RESEND_WEBHOOK_SECRET',()=>{
  const secret=env.RESOLUTE_RESEND_WEBHOOK_SECRET??'';
  if(secret.length>200||!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))return false;
  const key=Buffer.from(secret.slice(6),'base64');
  return key.length>=16&&key.toString('base64').replace(/=+$/,'')===secret.slice(6).replace(/=+$/,'');
 });
 check('STOP_PROTECTION_GATEWAY',()=>{protectionGatewayConfig(env);return true;});
 return {mode:'offline' as const,configurationValid:checks.every(c=>c.valid),productionReady:false as const,checks,
  unverified:['sending-domain-authentication','credential-validity','database-migrations-and-grants','recovery-inventory','public-stop-and-webhook-routes','worker-and-monitor-scheduling','operator-failure-alerts','ja-en-mailbox-acceptance']};
}
