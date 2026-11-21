import { validSessionDate } from './thermometer.ts';
import { safeThermometerSnapshot } from './thermometer-runtime.ts';
import type { ThermometerSnapshot } from './thermometer-view.ts';

const MAX_BYTES = 16384, MAX_AHEAD_MS = 11 * 86400000;
/** Re-validate resolute-api's answer; anything unexpected is dropped (the page shows 準備中). */
export function parseThermometerResponse(raw: unknown, now: number): ThermometerSnapshot | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const source = raw as {asOf?: unknown; validUntil?: unknown};
  const validUntil = source.validUntil;
  if (!validSessionDate(source.asOf) || typeof validUntil !== 'number' || !Number.isFinite(validUntil) ||
      validUntil <= now || validUntil > now + MAX_AHEAD_MS) return undefined;
  return {...safeThermometerSnapshot(raw, source.asOf), validUntil};
}
/** Read the stored daily snapshot through resolute-api (the database has no public proxy).
 * Same fixed-endpoint rules as the entitlement transport; never retries, never throws. */
export async function fetchThermometerSnapshot(token: string, base: string | undefined, secret: string | undefined,
  request: typeof fetch = fetch, now: () => number = Date.now): Promise<ThermometerSnapshot | undefined> {
  try {
    if (!base || !secret || secret.length < 43 || !token || token.length > 16384) return undefined;
    const url = new URL(base);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || !url.hostname.endsWith('.up.railway.app')) return undefined;
    url.pathname = '/internal/v1/thermometer';
    const res = await request(url, {method: 'GET', cache: 'no-store', redirect: 'error',
      headers: {Authorization: `Bearer ${token}`, 'X-Resolute-Service-Token': secret, Accept: 'application/json'},
      signal: AbortSignal.timeout(5000)});
    if (res.status !== 200 || !res.headers.get('content-type')?.startsWith('application/json')) {
      await res.body?.cancel(); return undefined;
    }
    const reader = res.body?.getReader();
    if (!reader) return undefined;
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return undefined; }
      chunks.push(value);
    }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return parseThermometerResponse(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(body)), now());
  } catch { return undefined; }
}
