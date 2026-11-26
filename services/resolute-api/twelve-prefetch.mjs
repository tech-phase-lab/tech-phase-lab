import {Pool} from 'pg';
import {pathToFileURL} from 'node:url';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {latestSettledSession} from '../../lib/resolute/notification-closes.ts';
import {createDailyCloseStore,splitsDue,writeSplits} from '../../lib/resolute/twelve-cache.ts';
import {dayAfter,fetchDailyBatch,SYMBOL} from '../../lib/resolute/twelve-daily.ts';
import {leaseFromEnv,unpacedLease} from '../../lib/resolute/twelve-lease.ts';
import {etDay,parseTwelveSplits} from '../../lib/research/stock-splits.ts';

/** RESOLUTE's daily Twelve Data prefetch (owner, Nov 26: Twelve Data use must never grow with members).
 * Reads each watched symbol's closes once per U.S. market date, and its split history at most once per ET day, into the shared copies
 * (db/resolute/029_twelve_cache.sql) that the alert runs, 「今日やること」 and the settings API read. Members only add symbols: the
 * credits are one per symbol per day for closes (50 symbols to a request) and 20 per symbol per refresh for splits, every request leased
 * from the monitor's allocator and paced, never retried, stopped at the deadline (what is left is read by the next run).
 * Runs as the first step (closes) and the last step (splits) of every resolute-notifications cron run; idempotent, so later runs of the
 * day only fill what is missing. Off unless RESOLUTE_NOTIFICATION_QUEUE_ENABLED=true; a database without the cache tables reports
 * {"enabled":false}. Output: counts only. */
export const PREFETCH_MAX_SYMBOLS=5000;
export const SPLIT_CREDITS=20;

export async function watchedSymbols(db,limit=PREFETCH_MAX_SYMBOLS){
 const rows=(await db.query(`SELECT DISTINCT upper(item->>'symbol') AS symbol FROM resolute.notification_settings s,
  jsonb_array_elements(CASE WHEN jsonb_typeof(s.settings->'watchItems')='array' THEN s.settings->'watchItems' ELSE '[]'::jsonb END) item
  ORDER BY 1 LIMIT $1`,[limit])).rows;
 return rows.map(r=>r.symbol).filter(s=>typeof s==='string'&&SYMBOL.test(s));
}

/** Closes for the latest settled market date, for every watched symbol the shared copy lacks. */
export async function prefetchCloses(db,{apiKey,lease=unpacedLease(),now=new Date(),fetcher,baseUrl}={}){
 const date=latestSettledSession(now);
 if(!date)return {state:'calendar-unavailable'};
 const store=createDailyCloseStore(db),symbols=await watchedSymbols(db);
 const have=await store.read(symbols,date),missing=symbols.filter(s=>!have.has(s));
 const read=missing.length?await fetchDailyBatch(missing,{apiKey,lease,caller:'resolute-closes',fetcher,baseUrl,outputsize:5,endDate:dayAfter(date)}):new Map();
 const answered=[...read].filter(([,bars])=>bars&&(!bars.length||bars.some(b=>b.date===date)));
 const stored=await store.write(answered,date);
 // Two weeks of closes are kept; older market dates are not read by anyone.
 await db.query("DELETE FROM resolute.twelve_daily_closes WHERE market_date < $1::date - 14",[date]).catch(()=>{});
 return {state:'done',marketDate:date,symbols:symbols.length,cached:have.size,stored,unread:missing.length-stored};
}

/** Split histories not read today (ET): never read first, then the oldest, until the lease's deadline. */
export async function prefetchSplits(db,{apiKey,lease=unpacedLease(),now=()=>Date.now(),fetcher=fetch,baseUrl='https://api.twelvedata.com'}={}){
 if(!apiKey)return {state:'not-configured'};
 const due=await splitsDue(db,await watchedSymbols(db),etDay(now()));
 let stored=0,failed=0,stopped=0;
 for(const [i,ticker] of due.entries()){
  if(!await lease.take(SPLIT_CREDITS,'resolute-splits')){stopped=due.length-i;break;}
  try{
   const url=new URL(`${baseUrl}/splits`);
   url.searchParams.set('symbol',ticker);url.searchParams.set('range','full');url.searchParams.set('apikey',apiKey);
   const response=await fetcher(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
   if(response.status===429){lease.limited();await response.body?.cancel();failed++;continue;}
   if(response.status!==200){await response.body?.cancel();failed++;continue;}
   const body=await response.json();
   if(body?.code===429)lease.limited();
   // An answer we could not read (an error body, another symbol) is never "no splits": not stored, read again next run.
   await writeSplits(db,ticker,parseTwelveSplits(body,ticker),now());stored++;
  }catch{failed++;}
 }
 return {state:'done',due:due.length,stored,failed,stopped};
}

async function tablesReady(db){
 const r=(await db.query("SELECT to_regclass('resolute.twelve_daily_closes') IS NOT NULL AND to_regclass('resolute.twelve_splits') IS NOT NULL AS ready")).rows[0];
 return r?.ready===true;
}

async function main(){
 const env=process.env,part=process.argv.includes('--splits')?'splits':'closes';
 if(env.RESOLUTE_NOTIFICATION_QUEUE_ENABLED!=='true'||!env.TWELVE_DATA_API_KEY){console.log(JSON.stringify({enabled:false}));process.exitCode=1;return;}
 let pool;
 try{
  const config=resoluteDatabaseConfig(env.RESOLUTE_NOTIFICATION_QUEUE_DB_URL);
  if(new URL(config.connectionString).username!=='resolute_notification_queue')throw Error('SCOPE');
  pool=new Pool({...config,application_name:'resolute-twelve-prefetch'});pool.on('error',()=>{});
  if(!await tablesReady(pool)){console.log(JSON.stringify({enabled:false}));process.exitCode=1;return;}
  // The step's own deadline (run.mjs passes what is left of the cron run); each request is leased before it is sent.
  const budget=Math.max(0,Math.min(Number(env.RESOLUTE_TWELVE_PREFETCH_DEADLINE_MS)||90000,240000)),deadline=Date.now()+budget;
  const lease=part==='closes'?leaseFromEnv(env,{tier:'critical',perMinute:300,deadline}):leaseFromEnv(env,{tier:'background',perMinute:240,deadline});
  const result=part==='closes'?await prefetchCloses(pool,{apiKey:env.TWELVE_DATA_API_KEY,lease}):await prefetchSplits(pool,{apiKey:env.TWELVE_DATA_API_KEY,lease});
  console.log(JSON.stringify({event:'RESOLUTE_TWELVE_PREFETCH',part,...result,lease:lease.report()}));
 }catch(error){
  console.log(JSON.stringify({event:'RESOLUTE_TWELVE_PREFETCH',part,state:'failed',code:error?.message==='SCOPE'?'SCOPE':'UNAVAILABLE'}));process.exitCode=1;
 }finally{await pool?.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
