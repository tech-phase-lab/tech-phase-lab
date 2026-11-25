/** Downloads the logo candidates for scripts/logos/normalize_logos.py: <dir>/fmp/<TICKER>, <dir>/td/<TICKER> and <dir>/tickers.json. */
import { LOGO_DOMAINS } from "../../lib/research/stock-logo-domains.ts";
import { providers } from "../../lib/research/intake.ts";
import { THEME_TICKERS } from "../../lib/research/theme-definitions.ts";
import { writeFileSync } from "node:fs";
const out = process.argv[2];
const tickers = [...new Set([...providers.map(p => p.ticker), ...THEME_TICKERS, ...Object.keys(LOGO_DOMAINS)])];
writeFileSync(`${out}/tickers.json`, JSON.stringify(tickers));
let i = 0;
async function get(url: string, path: string) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); const ty = r.headers.get("content-type") ?? "";
    if (r.ok && ty.startsWith("image/")) writeFileSync(path, Buffer.from(await r.arrayBuffer())); } catch {}
}
async function worker() { while (i < tickers.length) { const t = tickers[i++];
  if (LOGO_DOMAINS[t]) await get(`https://api.twelvedata.com/logo/${LOGO_DOMAINS[t]}`, `${out}/td/${t}`);
  await get(`https://financialmodelingprep.com/image-stock/${t}.png`, `${out}/fmp/${t}`); } }
await Promise.all(Array.from({ length: 8 }, worker));
console.log(tickers.length);
