import {Pool} from 'pg';
import {createClerkClient} from '@clerk/backend';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createNotificationQueueRunner} from '../../lib/resolute/notification-queue-runner.ts';
import {createClerkNotificationRecipient} from '../../lib/resolute/notification-recipient.ts';
import {createCloseProvider} from '../../lib/resolute/notification-closes.ts';

// 通知候補をoutboxへ入れるだけ(メールは送らない)。明示的な起動のみ。既定は無効で、DB・提供元・Clerkに触れない。
// 有効化・スケジュール・変数の設定は、オーナーの承認が毎回必要。値は出力しない。
let pool;
try{
 const env=process.env;
 if(env.RESOLUTE_NOTIFICATION_QUEUE_ENABLED!=='true'){
  console.log(JSON.stringify({enabled:false}));process.exitCode=1;
 }else{
  if(env.RESOLUTE_ENTITLEMENT_SOURCE!=='live')throw Error('Live entitlement source required');
  if(!env.TWELVE_DATA_API_KEY||!env.RESOLUTE_MAIL_CLERK_SECRET_KEY)throw Error('Provider configuration required');
  const config=resoluteDatabaseConfig(env.RESOLUTE_NOTIFICATION_QUEUE_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_notification_queue')throw Error('Scoped queue role required');
  // Test guard: while set, only these accounts get candidates (owner-only test mail). Unset = all enabled members.
  const only=(env.RESOLUTE_NOTIFICATION_QUEUE_ONLY_USER_IDS??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(only.some(id=>!/^user_[A-Za-z0-9]{1,128}$/.test(id)))throw Error('Invalid test allowlist');
  pool=new Pool(config);pool.on('error',()=>{});
  const run=createNotificationQueueRunner(pool,{
   enabled:true,
   ...(only.length?{onlyUserIds:only}:{}),
   recipient:createClerkNotificationRecipient(createClerkClient({secretKey:env.RESOLUTE_MAIL_CLERK_SECRET_KEY}),env.RESOLUTE_MAIL_PUBLIC_ORIGIN==='https://techphase.app'),
   closes:createCloseProvider({apiKey:env.TWELVE_DATA_API_KEY}),
  });
  const report=await run();console.log(JSON.stringify(report));
  if(report.errors||report.incomplete)process.exitCode=1;
 }
}catch{console.log(JSON.stringify({error:'NOTIFICATION_QUEUE_UNAVAILABLE'}));process.exitCode=1;}
finally{await pool?.end();}
