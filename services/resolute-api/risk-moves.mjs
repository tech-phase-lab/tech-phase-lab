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
  const latest=[...missing].sort().at(-1),collected=await collectThermometer({enabled:true,apiKey},latest,fetcher);
  const measured=await readSessionMoves({query:async()=>({rows:[{shock:collected.shock??null,stocks:collected.shockStocks??null}]})},missing);
  return {...measured,...stored,...Object.fromEntries(missing.filter(s=>measured[s]).map(s=>[s,measured[s]]))};
 };
 read.end=readMoves.end;return read;
}
