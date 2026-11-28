import {Pool} from 'pg';
import {resoluteDatabaseConfig} from '../../lib/resolute/database-config.ts';
import {readSessionMoves} from '../../lib/resolute/risk-market.ts';
/** Read-only access to the thermometer snapshots' daily TP index moves (Shock Gauge stars).
 * Uses the existing read-only thermometer role; without the variable, stories simply keep waiting. */
export function createMovesReader(url=process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL){
 if(!url)return null;
 const config=resoluteDatabaseConfig(url);
 if(new URL(config.connectionString).username!=='resolute_thermometer_reader')throw Error('SCOPE');
 const pool=new Pool({...config,max:1,application_name:'resolute-shock-gauge'});pool.on('error',()=>{});
 const read=sessions=>readSessionMoves(pool,sessions);
 read.end=()=>pool.end();
 return read;
}
/** One-off only (today's re-selection, Nov 25): sessions whose shock no stored snapshot carries yet (snapshots before Nov 25 have
 * no shock map) are measured with the thermometer's own calculation (collectThermometer, the same daily closes and formulas),
 * once, for the latest of them. It costs one thermometer read (about 13 provider requests, 121 symbols). Never used by the
 * daily run: needs TWELVE_DATA_API_KEY on this service, and the result is not stored. */
export function withThermometerFallback(readMoves,apiKey,fetcher=fetch){
 if(!readMoves||!apiKey)return readMoves;
 const read=async sessions=>{
  const stored=await readMoves(sessions),missing=sessions.filter(s=>!stored[s]?.nas100&&!stored[s]?.sox);
  if(!missing.length)return stored;
  const {collectThermometer}=await import('../../lib/resolute/thermometer-provider.ts');
  const {leaseFromEnv}=await import('../../lib/resolute/twelve-lease.ts');
  // Leased and paced like the thermometer itself (70 credits a minute), never one burst.
  const lease=leaseFromEnv(process.env,{tier:'warm',perMinute:70,deadline:Date.now()+300000});
  const latest=[...missing].sort().at(-1),collected=await collectThermometer({enabled:true,apiKey,lease},latest,fetcher);
  const measured=await readSessionMoves({query:async()=>({rows:[{shock:collected.shock??null,stocks:collected.shockStocks??null,intraday:collected.shockIntraday??null}]})},missing);
  return {...measured,...stored,...Object.fromEntries(missing.filter(s=>measured[s]).map(s=>[s,measured[s]]))};
 };
 read.end=readMoves.end;return read;
}
/** The Shock Gauge candidate and publish runs (owner, Nov 28): the latest closed session's moves must exist at 06:00 JST, but the
 * thermometer snapshot that stores them is written at 07:30 JST (and its job can fail). When the stored snapshots lack a session,
 * this run measures it itself with the thermometer's own calculation (collectThermometer: the same daily closes and formulas),
 * through the Twelve Data lease on the background tier, paced at `perMinute`, with a deadline; nothing is stored. At most one
 * provider read per process (the latest missing session; about 140 symbols). Works without the thermometer reader too. Never
 * throws: a failed read leaves the stories without numbers. `stats` (counts and fixed codes only) is for the run's log line. */
export const MOVES_FALLBACK={tier:'background',perMinute:60,deadlineMs:240000};
export function withSessionMovesFallback(readMoves,apiKey,{fetcher=fetch,env=process.env,collect=null,lease=null,now=()=>Date.now()}={}){
 if(!readMoves&&!apiKey)return null;
 const stats={stored:0,fetched:0,source:'none'};let done=null;
 const read=async sessions=>{
  let stored={};
  if(readMoves){try{stored=await readMoves(sessions)??{};}catch{stats.storedError=true;stored={};}}
  const have=s=>!!(stored[s]?.nas100||stored[s]?.sox),missing=sessions.filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!have(s));
  stats.stored=sessions.filter(have).length;
  if(stats.stored)stats.source='snapshot';
  if(!missing.length||!apiKey)return stored;
  done??=(async()=>{
   try{
    const run=collect??(await import('../../lib/resolute/thermometer-provider.ts')).collectThermometer;
    const l=lease??(await import('../../lib/resolute/twelve-lease.ts')).leaseFromEnv(env,{tier:MOVES_FALLBACK.tier,perMinute:MOVES_FALLBACK.perMinute,deadline:now()+MOVES_FALLBACK.deadlineMs});
    const latest=[...missing].sort().at(-1),collected=await run({enabled:true,apiKey,lease:l},latest,fetcher);
    stats.credits=l.report?.().credits??null;
    return await readSessionMoves({query:async()=>({rows:[{shock:collected?.shock??null,stocks:collected?.shockStocks??null,intraday:collected?.shockIntraday??null}]})},missing);
   }catch{stats.fetchError=true;return {};}
  })();
  const measured=await done,got=missing.filter(s=>measured[s]);
  stats.fetched=got.length;if(got.length)stats.source=stats.stored?'snapshot+provider':'provider';
  return {...stored,...Object.fromEntries(got.map(s=>[s,measured[s]]))};
 };
 read.stats=stats;read.end=async()=>{await readMoves?.end?.();};
 return read;
}
