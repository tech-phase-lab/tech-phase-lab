import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { randomBytes, createHash } from 'node:crypto';
import pg from 'pg';
import { runIsolatedProcess } from './process.mjs';
import { createHandler } from '../resolute-api/handler.mjs';
import { createApiServer } from '../resolute-api/http-server.mjs';
import { createWriter } from '../resolute-protection/server.mjs';
import { createPlanStore } from '../../lib/resolute/plan-database.ts';
import { createNotificationStore } from '../../lib/resolute/notification-database.ts';
import { createProtectionPublisher, decryptProtection } from '../../lib/resolute/protection-ledger.ts';
import { protectionGatewayObjects } from '../../lib/resolute/protection-runtime.ts';
import { createProtectionBarrier } from '../../lib/resolute/protection-outbox.ts';
import { emptyPlanAnswers } from '../../lib/resolute/plan-answers.ts';
import { OWNER_ACCOUNT_ID } from '../../lib/membership/entitlements.ts';

const migrations=['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql','005_notification_outbox.sql','017_notification_suppressions.sql','018_protection_outbox.sql','019_storage_permissions.sql'];
const ensure = condition => { if(!condition)throw Error('RECOVERY_ACCEPTANCE_FAILED'); };
const plan={schemaVersion:1,answersVersion:1,answers:emptyPlanAnswers(),fx:{thresholdYen:null,usdJpy:null,note:'synthetic'},currency:'JPY',monthlyLivingCost:250000,savingsMonths:12,reserveMonths:6,nearTermExpense:0,financialAssets:10000000,investedAmount:3000000,investable:8500000,tolerancePct:20,toleranceDrop:600000,perStockCapPct:20,buyMode:'steps',buyLines:[{dropPct:10,amount:100000},{dropPct:20,amount:100000}],buyBudgetPct:10,allocation:'equal',noBuyConditions:[],haltConditions:[],ruleType:'undecided'};
const enabled={deliveryHourJst:7,alertsEnabled:true,morningEnabled:true,watchItems:[{symbol:'MU',referencePrice:100}],surgeCapPct:null};
const stopped={...enabled,alertsEnabled:false,morningEnabled:false};

export function assertIsolatedEnvironment(env){
 if(env.RESOLUTE_RECOVERY_ACCEPTANCE_ONLY!=='true')throw Error('ISOLATED_ACCEPTANCE_REQUIRED');
 for(const [name,value] of Object.entries(env))if(value&&(
  /^(?:PG|DATABASE_)/.test(name)||/(?:_DB_URL|DATABASE_URL)$/.test(name)||
  /(?:OPENAI|PAYPAL|MAIL_API|RESEND|WRITER_KEY_HEX|PROTECTION_KEY_HEX)/.test(name)))throw Error('PRODUCTION_CREDENTIAL_FORBIDDEN');
}

/** objects is a fixed, isolated storage namespace supplied at startup, not by HTTP.
 * Uses the actual owner's signed session only against a disposable local API/DB.
 */
export function createRecoveryExecutor({config,objects,pgBin='/usr/lib/postgresql/18/bin',python='/usr/bin/python3',env=process.env,onStage=()=>{}}){
 assertIsolatedEnvironment(env);
 const cwd=resolve(new URL('../..',import.meta.url).pathname);
 return async({userId,authorization,signal})=>{
  ensure(userId===OWNER_ACCOUNT_ID&&/^Bearer [A-Za-z0-9_.-]+$/.test(authorization??''));
  signal.throwIfAborted();
  const root=await mkdtemp(join(tmpdir(),'resolute-recovery-'));
  const cluster=join(root,'cluster'),key=randomBytes(32),writerToken=randomBytes(48).toString('base64url');
  const pools=[],servers=[];let clusterStarted=false;
  const command=(name,args,activeSignal=signal)=>runIsolatedProcess({executable:join(pgBin,name),args,cwd,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},signal:activeSignal});
  const closeServer=server=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  try{
   onStage('cluster');await command('initdb',['-D',cluster,'-A','trust','--no-locale','--encoding=UTF8','-U','postgres']);
   // No TCP listener. The private temporary directory owns the only socket.
   clusterStarted=true;await command('pg_ctl',['-D',cluster,'-l',join(root,'pg.log'),'-o',`-c listen_addresses='' -k ${root}`,'-w','start']);
   const pool=database=>{const p=new pg.Pool({host:root,user:'postgres',database,max:2,connectionTimeoutMillis:3000,query_timeout:5000,statement_timeout:5000});pools.push(p);return p;};
   const admin=pool('postgres');
   await admin.query('CREATE DATABASE resolute');await admin.query('CREATE DATABASE resolute_restore_test');
   await admin.query('CREATE ROLE resolute_plan_writer NOLOGIN NOINHERIT;CREATE ROLE resolute_notification_writer NOLOGIN NOINHERIT');
   const source=pool('resolute'),restored=pool('resolute_restore_test');
   onStage('migrations');for(const migration of migrations){signal.throwIfAborted();await source.query(await readFile(join(cwd,'db/resolute',migration),'utf8'));}
   const scoped=role=>({async connect(){signal.throwIfAborted();const client=await source.connect();try{await client.query(`SET ROLE ${role}`);}catch(e){client.release(true);throw e;}return {query:(...args)=>client.query(...args),release(){client.release(true);}};}});
   const names=new Set();
   const writer=createWriter({key,token:writerToken,objects:{async putIfAbsent(name,body){signal.throwIfAborted();await objects.putIfAbsent(name,body);names.add(name);},read:name=>objects.read(name)}});
   writer.listen(0,'127.0.0.1');servers.push(writer);await once(writer,'listening');
   const barrier=createProtectionBarrier(createProtectionPublisher(protectionGatewayObjects(`http://127.0.0.1:${writer.address().port}`,writerToken),key));
   const handler=createHandler(config,async()=>{throw Error('UNEXPECTED_ROUTE');},undefined,createPlanStore(scoped('resolute_plan_writer'),'legacy',barrier),createNotificationStore(scoped('resolute_notification_writer'),'legacy',barrier));
   const api=createApiServer(handler);api.listen(0,'127.0.0.1');servers.push(api);await once(api,'listening');
   const call=async(path,method,value)=>{
    signal.throwIfAborted();
    const response=await fetch(`http://127.0.0.1:${api.address().port}/internal/v1/${path}`,{method,signal,redirect:'error',headers:{authorization,'x-resolute-service-token':config.serviceToken,'content-type':'application/json'},...(value?{body:JSON.stringify(value)}:{})});
    ensure(response.status===200);return response.json();
   };
   await source.query("INSERT INTO resolute.entitlements(clerk_user_id,product_id,kind,starts_at,source) VALUES($1,'resolute_v1','use','2020-01-01','purchase')",[userId]);
   onStage('api-save');await call('plan','PUT',{baseRevision:0,plan});await call('notification-settings','PUT',{baseRevision:0,settings:enabled});
   await source.query("INSERT INTO resolute.notification_outbox(idempotency_key,clerk_user_id,kind,delivery_date_jst,payload) VALUES('synthetic-pending',$1,'alerts','2026-10-19','{}')",[userId]);
   const dump=join(root,'before.dump');
   onStage('backup');await command('pg_dump',['-h',root,'-U','postgres','-d','resolute','-Fc','--no-owner','--no-acl','-f',dump]);
   onStage('api-delete-stop');await call('plan','DELETE',{baseRevision:1});await call('notification-settings','PUT',{baseRevision:1,settings:stopped});
   ensure((await call('plan','GET')).plan===null&&names.size===3);
   const receipts=(await source.query('SELECT kind,receipt_sha256,published_at FROM resolute.protection_outbox')).rows;
   ensure(receipts.length===3&&receipts.every(r=>r.receipt_sha256&&r.published_at));
   // Fence the API/writer before independent readback and restore.
   for(const server of servers.splice(0))await closeServer(server);
   onStage('independent-readback');const ledger={version:1,deletions:[],suppressions:[]};
   for(const name of names){signal.throwIfAborted();const body=await objects.read(name);const event=decryptProtection(body,key,name);ensure(receipts.some(r=>r.kind===event.kind&&r.receipt_sha256===createHash('sha256').update(body).digest('hex')));ensure(event.userId===userId&&event.revision===2);const marker={userId:event.userId,revision:event.revision,at:event.at};if(event.kind==='delete')ledger.deletions.push(marker);else ledger.suppressions.push({...marker,kind:event.kind.replace('_off','')});}
   ensure(ledger.deletions.length===1&&ledger.suppressions.length===2);
   const ledgerPath=join(root,'ledger.json');await writeFile(ledgerPath,JSON.stringify(ledger),{mode:0o600});
   const sql=await runIsolatedProcess({executable:python,args:[join(cwd,'services/resolute-recovery/replay-sql.py'),ledgerPath],cwd,env:{PATH:'/usr/bin:/bin'},signal});
   onStage('restore');await command('pg_restore',['-h',root,'-U','postgres','-d','resolute_restore_test','--exit-on-error','--no-owner','--no-acl',dump]);
   const verify=async protectedState=>{
    signal.throwIfAborted();
    const p=(await restored.query('SELECT plan,revision FROM resolute.plans WHERE clerk_user_id=$1',[userId])).rows[0];
    const s=(await restored.query('SELECT settings,revision FROM resolute.notification_settings WHERE clerk_user_id=$1',[userId])).rows[0];
    const pending=(await restored.query('SELECT count(*)::int n FROM resolute.notification_outbox WHERE accepted_at IS NULL')).rows[0].n;
    ensure(Number(p?.revision)===(protectedState?2:1)&&Number(s?.revision)===(protectedState?2:1));
    ensure(protectedState?p.plan===null:p.plan?.fx?.note==='synthetic');
    ensure(s.settings.alertsEnabled===!protectedState&&s.settings.morningEnabled===!protectedState&&pending===(protectedState?0:1));
   };
   onStage('stale-check');await verify(false);
   onStage('replay');for(let i=0;i<2;i++){await restored.query(sql);await verify(true);}
   signal.throwIfAborted();
   return {isolatedDatabase:true,staleBackupVerified:true,independentReadback:true,firstReplay:true,secondReplay:true,planErased:true,notificationsStopped:true,pendingQueueEmpty:true,productionTouched:false,mailSent:false,livePayment:false,aiCalled:false};
  }finally{
   onStage('cleanup');
   await Promise.allSettled(servers.map(closeServer));
   await Promise.allSettled(pools.map(p=>p.end()));
   key.fill(0);
   if(clusterStarted)await command('pg_ctl',['-D',cluster,'-m','immediate','-w','stop'],AbortSignal.timeout(5000));
   await rm(root,{recursive:true,force:true});
  }
 };
}
