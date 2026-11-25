import fs from "node:fs";
import path from "node:path";
import { DIVE_TICKERS, validateCompanyDive, type CompanyDive } from "./company-dive.ts";

/** Where the per-ticker files live. next.config.ts traces this folder into the company page's server bundle. */
export const DIVES_DIR = path.join(process.cwd(), "lib", "research", "dives");

type Options = { dir?: string; log?: (message: string) => void };
const cache = new Map<string, CompanyDive | null>();

/**
 * lib/research/dives/<TICKER>.json, checked by validateCompanyDive. No file: null (the page keeps the legacy view). A file that does
 * not read or does not pass: null for that ticker only, and the server log names the ticker and the reason. The result is kept for
 * the life of the process (the files change only with a deploy); a custom `dir` (tests) is never cached.
 */
export function loadCompanyDive(ticker: string, options: Options = {}): CompanyDive | null {
  if (!(DIVE_TICKERS as readonly string[]).includes(ticker)) return null;
  const useCache = !options.dir;
  if (useCache && cache.has(ticker)) return cache.get(ticker)!;
  const log = options.log ?? ((message: string) => console.error(message));
  const file = path.join(options.dir ?? DIVES_DIR, `${ticker}.json`);
  let result: CompanyDive | null = null;
  let raw: string | null = null;
  try { raw = fs.readFileSync(file, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") log(`[company-dive] ${ticker}: dropped, the file could not be read (${(error as Error).message})`);
  }
  if (raw !== null) {
    try { result = validateCompanyDive(JSON.parse(raw), ticker); } catch (error) {
      log(`[company-dive] ${ticker}: dropped, falling back to the legacy view (${(error as Error).message})`);
    }
  }
  if (useCache) cache.set(ticker, result);
  return result;
}
