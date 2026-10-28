/** Standalone worker, not attached to the approved morning job. Disabled by default.
 * Schedule after infrastructure acceptance; clock/session checks are inside the worker.
 */
import { Pool } from 'pg';
import { refreshThermometer } from '../../lib/resolute/thermometer-runtime.ts';
const env = process.env;
if (env.RESOLUTE_THERMOMETER_COLLECT_ENABLED !== '1') {
  console.log(JSON.stringify({status:'disabled'}));
} else if (!env.RESOLUTE_THERMOMETER_WRITE_DATABASE_URL || !env.TWELVE_DATA_API_KEY) {
  console.log(JSON.stringify({status:'not-configured'})); process.exitCode=1;
} else {
  const instrument = (name:string) => {
    const symbol=env[`RESOLUTE_THERMOMETER_${name}_SYMBOL`],exchange=env[`RESOLUTE_THERMOMETER_${name}_EXCHANGE`];
    return symbol && exchange ? {symbol,exchange} : undefined;
  };
  const pool = new Pool({connectionString:env.RESOLUTE_THERMOMETER_WRITE_DATABASE_URL,max:1,connectionTimeoutMillis:3000,statement_timeout:60000});
  try {
    const db = await pool.connect();
    try { console.log(JSON.stringify(await refreshThermometer(db,{enabled:true,apiKey:env.TWELVE_DATA_API_KEY,instruments:{nas100:instrument('NAS100'),sox:instrument('SOX'),vix:instrument('VIX')}},new Date(),fetch))); }
    finally { db.release(); }
  } catch { console.error('thermometer-refresh-failed'); process.exitCode=1; }
  finally { await pool.end(); }
}
