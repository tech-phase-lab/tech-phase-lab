import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { membershipConfigured } from '@/lib/membership/server';
import { getResoluteEntitlementsForSession } from './server';
import { fetchThermometerSnapshot } from './thermometer-transport';
/** Read-only, disabled until explicit activation. Never calls the market provider.
 * The stored snapshot is read through resolute-api (the production database has no public proxy).
 * Authorize before requesting/serializing data, not merely inside the client shell;
 * resolute-api checks the same tool entitlement again before it opens storage.
 */
export async function loadThermometerSnapshot() {
  if (process.env.RESOLUTE_THERMOMETER_READ_ENABLED !== '1') return undefined;
  try {
    if (!membershipConfigured()) return undefined;
    const {userId,getToken} = await auth();
    if (!userId) return undefined;
    const token = await getToken();
    if (!token || !(await getResoluteEntitlementsForSession(token)).canUseTools) return undefined;
    return await fetchThermometerSnapshot(token, process.env.RESOLUTE_API_URL, process.env.RESOLUTE_API_SERVICE_TOKEN);
  } catch { return undefined; }
}
