import {Pool} from 'pg';
import {createClerkClient} from '@clerk/backend';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {createNotificationQueueRunner} from '../../lib/resolute/notification-queue-runner.ts';
import {createClerkNotificationRecipient} from '../../lib/resolute/notification-recipient.ts';
import {createCloseProvider} from '../../lib/resolute/notification-closes.ts';
import {createCachedSplitLoader,createDailyCloseStore} from '../../lib/resolute/twelve-cache.ts';
import {createSplitLoader} from '../../lib/research/stock-splits.ts';
import {leaseFromEnv} from '../../lib/resolute/twelve-lease.ts';

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
  // One lease for the step's closes and splits: critical (alerts), 300 credits a minute, stopped after 200 seconds.
  const lease=leaseFromEnv(env,{tier:'critical',perMinute:300,fallbackPerMinute:300,deadline:Date.now()+200000});
  const run=createNotificationQueueRunner(pool,{
   enabled:true,
   ...(only.length?{onlyUserIds:only}:{}),
   recipient:createClerkNotificationRecipient(createClerkClient({secretKey:env.RESOLUTE_MAIL_CLERK_SECRET_KEY}),env.RESOLUTE_MAIL_PUBLIC_ORIGIN==='https://techphase.app'),
   // Closes: the day's shared copy first (twelve-prefetch.mjs fills it before this step); only missing symbols are read, in batches,
   // leased from the monitor's allocator on the critical tier and paced (never more than 300 credits a minute, never retried).
   // Without the allocator (token not set yet) the alerts keep the full 300 a minute, so every member's close is read in this run.
   closes:createCloseProvider({apiKey:env.TWELVE_DATA_API_KEY,store:createDailyCloseStore(pool),lease,
    onUnread:symbols=>console.log(JSON.stringify({event:'RESOLUTE_CLOSES_UNREAD',count:symbols.length,symbols:symbols.slice(0,50)}))}),
   // Stock splits (SNDK 8-for-1, Nov 20 2026): reference prices saved before a split are judged on the split-adjusted basis of the closes.
   // The shared copy first (the prefetch refreshes it once a day); a symbol it lacks (or no table yet) is read from the provider,
   // leased with the closes, never the manual list alone while the provider can answer.
   splits:createCachedSplitLoader(pool,createSplitLoader({apiKey:env.TWELVE_DATA_API_KEY,lease})),
  });
  const report=await run();console.log(JSON.stringify(report));
  if(report.errors||report.incomplete)process.exitCode=1;
 }
}catch{console.log(JSON.stringify({error:'NOTIFICATION_QUEUE_UNAVAILABLE'}));process.exitCode=1;}
finally{await pool?.end();}
