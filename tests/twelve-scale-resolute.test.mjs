import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {createTwelveLease,unpacedLease,FALLBACK_PER_MINUTE} from '../lib/resolute/twelve-lease.ts';
import {fetchDailyBatch,BATCH_SYMBOLS} from '../lib/resolute/twelve-daily.ts';
import {createCachedSplitLoader,createDailyCloseStore} from '../lib/resolute/twelve-cache.ts';
import {createCloseProvider} from '../lib/resolute/notification-closes.ts';
import {collectThermometer,THERMOMETER_ROSTERS} from '../lib/resolute/thermometer-provider.ts';
import {prefetchCloses,prefetchSplits} from '../services/resolute-api/twelve-prefetch.mjs';
import {createDailyBars} from '../services/resolute-api/today-plan-job.mjs';

// Owner, Nov 26: Twelve Data use must never grow with members (plan: 610 credits a minute). RESOLUTE's jobs read each symbol once a
// day for everyone (shared copies), in batches, leased from the monitor's allocator and paced, and never retry a 429.

const sql=name=>readFileSync(new URL('../db/resolute/'+name,import.meta.url),'utf8');
const RUN=new Date('2026-11-12T22:00:00Z'); // 07:00 JST, Nov 12's close settled
const DATE='2026-11-12';
function fakeClock(start=Date.parse('2026-11-12T22:00:00Z')){
 const c={t:start,now:()=>c.t,sleep:async ms=>{c.t+=ms;}};return c;
}
const series=(symbol,rows)=>({meta:{symbol,currency:'USD',interval:'1day'},values:rows.map(([datetime,close])=>({datetime,open:close,high:close,low:close,close:String(close),volume:'1'})),status:'ok'});
/** A provider that answers every asked symbol with closes for Nov 11 and 12 and counts requests and credits. */
function provider(){
 const p={requests:0,credits:0,urls:[],fetcher:async url=>{p.requests++;const asked=url.searchParams.get('symbol').split(',');p.credits+=asked.length;p.urls.push(url);
  if(url.pathname.endsWith('/splits'))return Response.json({meta:{symbol:asked[0]},splits:asked[0]==='NVDA'?[{date:'2024-06-10',from_factor:10,to_factor:1}]:[]});
  const body=Object.fromEntries(asked.map(s=>[s,series(s,[[DATE,100],['2026-11-11',99]])]));
  return Response.json(asked.length===1?body[asked[0]]:body);}};
 return p;
}
async function database(t){
 const boot=new PGlite();await boot.exec('CREATE DATABASE resolute');const data=await boot.dumpDataDir();await boot.close();
 const db=new PGlite({database:'resolute',loadDataDir:data});t.after(()=>db.close());
 for(const f of ['001_entitlements.sql','002_plans.sql','003_plan_answers_fx.sql','004_notification_settings.sql'])await db.exec(sql(f));
 await db.exec(sql('029_twelve_cache.sql'));await db.exec(sql('029_twelve_cache.sql')); // re-applying is harmless
 return db;
}
async function members(db,count,symbolsOf){
 for(let i=0;i<count;i++)await db.query("INSERT INTO resolute.notification_settings(clerk_user_id,settings,revision,updated_at) VALUES($1,$2::jsonb,1,now())",
  [`user_m${i}`,JSON.stringify({deliveryHourJst:7+(i%4),alertsEnabled:true,morningEnabled:false,watchItems:symbolsOf(i).map(symbol=>({symbol,referencePrice:100,priceDay:'2026-11-01'})),surgeCapPct:null})]);
}

test('lease: paced (never a burst), waits out a refusal without sending, pauses after a 429, falls back to its own pace without the allocator',async()=>{
 // Pace: 140 credits in requests of 10 at 70 a minute (the thermometer) take two minutes, never more than 11 credits in any ten seconds.
 let c=fakeClock(),times=[];
 let lease=createTwelveLease({tier:'warm',perMinute:70,now:c.now,sleep:c.sleep});
 for(let i=0;i<14;i++){assert.equal(await lease.take(10,'resolute-thermometer'),true);times.push(c.t);}
 assert.ok(times.at(-1)-times[0]>=110_000,'spread over about two minutes');
 for(const t of times)assert.ok(times.filter(x=>x>t-10_000&&x<=t).length*10<=11);
 for(const t of times)assert.ok(times.filter(x=>x>t-60_000&&x<=t).length*10<=70);
 // The allocator refuses twice, then grants: no credit is taken (and nothing would be sent) until it grants.
 c=fakeClock();const answers=[false,false,true],asked=[];
 lease=createTwelveLease({tier:'critical',perMinute:300,url:'https://monitor.example',token:'t'.repeat(40),now:c.now,sleep:c.sleep,
  fetcher:async(url,init)=>{asked.push(JSON.parse(init.body));assert.equal(url.pathname,'/twelve/lease');assert.equal(init.headers.Authorization,'Bearer '+'t'.repeat(40));return Response.json({ok:true,granted:answers.shift()??true});}});
 assert.equal(await lease.take(50,'resolute-closes'),true);
 assert.deepEqual(asked.map(a=>[a.cost,a.tier,a.caller]),[[50,'critical','resolute-closes'],[50,'critical','resolute-closes'],[50,'critical','resolute-closes']]);
 assert.deepEqual(lease.report(),{credits:50,leases:1,refused:2,mode:'allocator'});
 // After a 429 nothing is taken before the next minute.
 lease.limited();const before=c.t;assert.equal(await lease.take(10,'x'),true);assert.ok(Math.floor(c.t/60000)>Math.floor(before/60000));
 // A deadline ends the wait: false, never a call.
 c=fakeClock();lease=createTwelveLease({tier:'critical',perMinute:300,url:'https://monitor.example',token:'t'.repeat(40),deadline:c.t+5000,now:c.now,sleep:c.sleep,fetcher:async()=>Response.json({ok:true,granted:false})});
 assert.equal(await lease.take(10,'x'),false);
 // No allocator configured (or unreachable): its own pace, at most FALLBACK_PER_MINUTE.
 c=fakeClock();lease=createTwelveLease({tier:'critical',perMinute:300,now:c.now,sleep:c.sleep});
 let taken=0;const start=c.t;while(c.t-start<60_000){assert.equal(await lease.take(10,'x'),true);if(c.t-start<60_000)taken+=10;}
 assert.ok(taken<=FALLBACK_PER_MINUTE,`${taken} credits in a minute`);assert.equal(lease.report().mode,'local');
 c=fakeClock();lease=createTwelveLease({tier:'critical',perMinute:300,url:'https://monitor.example',token:'t'.repeat(40),now:c.now,sleep:c.sleep,fetcher:async()=>{throw new Error('down');}});
 assert.equal(await lease.take(10,'x'),true);assert.equal(lease.report().mode,'local');
 // An http (non-local) address or a short token is never used.
 assert.equal(createTwelveLease({tier:'critical',perMinute:300,url:'http://monitor.example',token:'t'.repeat(40)}).report().mode,'local');
 assert.equal(createTwelveLease({tier:'critical',perMinute:300,url:'https://monitor.example',token:'short'}).report().mode,'local');
});

test('batching: up to 50 symbols a request; a 429 (status or body) is never retried and pauses the lease',async()=>{
 const p=provider(),symbols=Array.from({length:120},(_,i)=>'S'+i);
 const got=await fetchDailyBatch(symbols,{apiKey:'secret-key',lease:unpacedLease(),caller:'resolute-closes',fetcher:p.fetcher,endDate:'2026-11-13'});
 assert.equal(BATCH_SYMBOLS,50);assert.equal(p.requests,3);assert.equal(p.credits,120);
 assert.deepEqual(p.urls.map(u=>u.searchParams.get('symbol').split(',').length),[50,50,20]);
 assert.ok(symbols.every(s=>got.get(s)?.at(-1)?.close===100));
 for(const answer of [()=>new Response('{}',{status:429}),()=>Response.json({status:'error',code:429,message:'credits'})]){
  let requests=0,limited=0;
  const lease={...unpacedLease(),limited(){limited++;}};
  const r=await fetchDailyBatch(['A','B'],{apiKey:'k',lease,caller:'x',fetcher:async()=>{requests++;return answer();}});
  assert.equal(requests,1,'no retry');assert.equal(limited,1);assert.equal(r.get('A'),null);assert.equal(r.get('B'),null);
 }
 // A request the lease does not grant is never sent.
 let sent=0;const none=await fetchDailyBatch(['A'],{apiKey:'k',lease:{...unpacedLease(),take:async()=>false},caller:'x',fetcher:async()=>{sent++;return Response.json({});}});
 assert.equal(sent,0);assert.equal(none.get('A'),null);
});

test('closes: once per symbol and market date for everyone (shared copy), so 1,000 members cost what one does',async t=>{
 const db=await database(t),p=provider();
 const close=()=>createCloseProvider({apiKey:'secret-key',now:()=>RUN,request:p.fetcher,store:createDailyCloseStore(db),lease:unpacedLease()});
 // Run 1 (07:00 JST): two members share NVDA.
 const run1=close();
 assert.deepEqual((await run1(['NVDA','AMD'])).closes.map(c=>c.close),[100,100]);
 await run1(['NVDA','MU']);
 assert.equal(p.credits,3);
 // Run 2 (08:00 JST) and 「今日やること」 read the shared copy: no provider call.
 assert.deepEqual((await close()(['NVDA','AMD','MU'])).closes.map(c=>c.symbol),['NVDA','AMD','MU']);
 assert.equal(p.credits,3);
 // The daily prefetch: 1 member or 1,000 members watching the same 30 symbols cost the same 30 credits, in one request.
 for(const count of [1,1000]){
  const fresh=await database(t),q=provider();
  await members(fresh,count,i=>Array.from({length:5},(_,k)=>'T'+((i+k)%30)));
  const r=await prefetchCloses(fresh,{apiKey:'k',fetcher:q.fetcher,now:RUN});
  assert.equal(r.symbols,Math.min(30,count*5));assert.equal(q.credits,r.symbols);assert.equal(q.requests,1);
  const again=await prefetchCloses(fresh,{apiKey:'k',fetcher:q.fetcher,now:RUN});
  assert.equal(again.cached,r.symbols);assert.equal(q.requests,1,'the second run of the day reads nothing');
 }
});

test('splits: refreshed at most once a day by the prefetch; readers only read the shared copy and fall back to the manual list',async t=>{
 const db=await database(t),p=provider();
 await members(db,3,i=>[['NVDA','SNDK','AMD'][i]]);
 const clock=()=>Date.parse('2026-11-12T22:00:00Z');
 const load=createCachedSplitLoader(db);
 // Nothing stored yet: the manual list (SNDK 8-for-1) and no `through`, exactly as after a failed provider read.
 let answer=await load(['NVDA','SNDK']);assert.deepEqual(answer.splits.NVDA,[]);assert.deepEqual(answer.splits.SNDK.map(s=>s.ratio),[8]);assert.deepEqual(answer.through,{});
 const first=await prefetchSplits(db,{apiKey:'k',fetcher:p.fetcher,now:clock});
 assert.deepEqual([first.due,first.stored,p.requests],[3,3,3]);
 const again=await prefetchSplits(db,{apiKey:'k',fetcher:p.fetcher,now:clock});
 assert.deepEqual([again.due,p.requests],[0,3],'one read per symbol per ET day');
 answer=await load(['NVDA','SNDK']);
 assert.deepEqual(answer.splits.NVDA.map(s=>[s.date,s.ratio]),[['2024-06-10',10]]);assert.equal(answer.through.NVDA,'2026-11-11');
 // The lease decides: a request it does not grant is not sent, and the rest waits for the next run.
 const next=()=>Date.parse('2026-11-13T22:00:00Z');
 const stopped=await prefetchSplits(db,{apiKey:'k',fetcher:p.fetcher,now:next,lease:{...unpacedLease(),take:async()=>false}});
 assert.deepEqual([stopped.stored,stopped.stopped,p.requests],[0,3,3]);
 // An unreadable table (not applied yet) is "nothing known", never an error.
 const broken=createCachedSplitLoader({query:async()=>{throw new Error('relation does not exist');}});
 assert.deepEqual((await broken(['SNDK'])).splits.SNDK.map(s=>s.ratio),[8]);
});

test('「今日やること」: every watched symbol in one batched read for the run, from the shared copy first',async t=>{
 const db=await database(t),p=provider();
 await createDailyCloseStore(db).write([['NVDA',[{date:'2026-11-11',close:99},{date:DATE,close:100}]]],DATE);
 const bars=createDailyBars({apiKey:'k',fetcher:p.fetcher,store:createDailyCloseStore(db)});
 await bars.prime(['NVDA','AMD','MU','AMD'],{outputsize:5,endDate:'2026-11-13'});
 assert.equal(p.requests,1);assert.equal(p.urls[0].searchParams.get('symbol'),'AMD,MU');
 for(const s of ['NVDA','AMD','MU'])assert.equal((await bars(s,{outputsize:5,endDate:'2026-11-13'})).at(-1).close,100);
 assert.equal(p.requests,1);
});

test('thermometer: every request is leased (14 of 10 symbols) and a request the lease does not grant is not sent',async()=>{
 const p=provider(),takes=[];
 const lease={...unpacedLease(),take:async(cost,caller)=>{takes.push([cost,caller]);return true;}};
 await collectThermometer({enabled:true,apiKey:'k',lease},'2026-11-12',p.fetcher);
 const symbols=THERMOMETER_ROSTERS.nasdaq100.length+THERMOMETER_ROSTERS.semiconductors.length;
 assert.equal(takes.reduce((s,[c])=>s+c,0),symbols);assert.equal(p.credits,symbols);assert.ok(takes.every(([c,caller])=>c<=10&&caller==='resolute-thermometer'));
 const q=provider();
 const refused=await collectThermometer({enabled:true,apiKey:'k',lease:{...unpacedLease(),take:async()=>false}},'2026-11-12',q.fetcher);
 assert.equal(q.requests,0);assert.equal(refused.nas100.reason,'provider-error');
});

test('the 029 cache migration grants writes to the prefetch role only',()=>{
 const text=sql('029_twelve_cache.sql');
 assert.match(text,/GRANT SELECT, INSERT, UPDATE, DELETE ON resolute\.twelve_daily_closes TO resolute_notification_queue/);
 assert.match(text,/GRANT SELECT ON resolute\.twelve_daily_closes, resolute\.twelve_splits TO resolute_today_plan_writer/);
 assert.match(text,/GRANT SELECT ON resolute\.twelve_splits TO resolute_notification_writer/);
 assert.doesNotMatch(text,/GRANT[^;]*(INSERT|UPDATE)[^;]*TO resolute_(today_plan_writer|notification_writer)/);
});
