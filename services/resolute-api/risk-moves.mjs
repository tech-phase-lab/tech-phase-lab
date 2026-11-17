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
