import 'server-only';
import { Pool } from 'pg';
import { auth } from '@clerk/nextjs/server';
import { membershipConfigured } from '@/lib/membership/server';
import { getResoluteEntitlementsForSession } from './server';
import { readThermometer } from './thermometer-runtime';
/** Read-only, disabled until explicit activation. Never calls the market provider.
 * Authorize before querying/serializing data, not merely inside the client shell.
 */
export async function loadThermometerSnapshot() {
  if (process.env.RESOLUTE_THERMOMETER_READ_ENABLED !== '1' || !process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL) return undefined;
  try {
    if (!membershipConfigured()) return undefined;
    const {userId,getToken} = await auth();
    if (!userId) return undefined;
    const token = await getToken();
    if (!token || !(await getResoluteEntitlementsForSession(token)).canUseTools) return undefined;
    const pool = new Pool({connectionString:process.env.RESOLUTE_THERMOMETER_READ_DATABASE_URL,max:1,connectionTimeoutMillis:3000,query_timeout:5000,statement_timeout:5000});
    try { return await readThermometer(pool,new Date()); }
    finally { await pool.end(); }
  } catch { return undefined; }
}
