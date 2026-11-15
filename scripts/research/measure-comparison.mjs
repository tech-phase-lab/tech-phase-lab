// Times one stock comparison end to end through the same server code as /api/research/compare (minus sign-in), cold and warm, and counts
// the provider credits it spent. Next's data cache is replaced by an in-memory one; the SEC and Twelve Data are called for real.
//
//   node scripts/research/measure-comparison.mjs MU,TSM,VST            cold run, then warm run (user path only: series ≤ 1 credit each)
//   node scripts/research/measure-comparison.mjs MU,TSM,VST --prefill  also stores statistics/statements for these tickers first, paced
//                                                                      (one expensive call at a time, only while the minute is under 100)
// Needs TWELVE_DATA_API_KEY (a dummy works behind a proxy that injects the key: set TWELVE_DATA_AUTH_HEADER=1 to send it as a header).
// Keep live runs tiny: the plan's 610 credits a minute are shared with the production site.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("../..", import.meta.url).pathname);
const tickers = (process.argv[2] || "MU,TSM,VST").split(",").map(t => t.trim().toUpperCase()).filter(Boolean);
const prefill = process.argv.includes("--prefill");
const dir = mkdtempSync(join(tmpdir(), "measure-comparison-"));

const entry = join(dir, "entry.ts");
writeFileSync(entry, `
export { loadComparisonFinancials, resolveComparisonCompany, statementsNeeded } from "@/lib/research/comparison-server";
export { applyValuationBasis, comparisonScores } from "@/lib/research/comparison-scorecard";
export { buildComparison } from "@/lib/research/comparison";
export { warmStatistics, warmStatements, minuteUsage } from "@/lib/research/twelve-store";
`);
const shims = {
  "server-only": "export {};",
  "next/cache": `const store = new Map();
export function unstable_cache(fn, parts) { return async (...args) => { const k = String(fn) + parts.join() + JSON.stringify(args);
  if (store.has(k)) return structuredClone(store.get(k)); const v = await fn(...args); store.set(k, structuredClone(v)); return v; }; }`,
  "next/server": "export const after = job => { (globalThis.__after ??= []).push(job); };",
};
await build({
  entryPoints: [entry], bundle: true, platform: "node", format: "esm", outfile: join(dir, "bundle.mjs"), tsconfig: join(root, "tsconfig.json"),
  absWorkingDir: root, logLevel: "error",
  plugins: [{ name: "shims", setup(b) {
    b.onResolve({ filter: /^(server-only|next\/cache|next\/server)$/ }, a => ({ path: a.path, namespace: "shim" }));
    b.onLoad({ filter: /.*/, namespace: "shim" }, a => ({ contents: shims[a.path], loader: "js" }));
  } }],
});

// Count every provider call by its documented credit cost; optionally move the key to the Authorization header for a key-injecting proxy.
const COSTS = { statistics: 50, income_statement: 100, cash_flow: 100, time_series: 1, api_usage: 1 };
const spent = { credits: 0, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
  if (url.hostname === "api.twelvedata.com") {
    const path = url.pathname.slice(1);
    spent.credits += COSTS[path] ?? 0; spent.calls.push(`${path}:${url.searchParams.get("symbol") ?? ""}`);
    if (process.env.TWELVE_DATA_AUTH_HEADER === "1") { url.searchParams.delete("apikey"); init = { ...init, headers: { ...init.headers, Authorization: `apikey ${process.env.TWELVE_DATA_API_KEY}` } }; }
    return realFetch(url, init);
  }
  return realFetch(input, init);
};

const m = await import(pathToFileURL(join(dir, "bundle.mjs")).href);
async function compare(label) {
  const before = spent.credits, calls = spent.calls.length, started = performance.now();
  const selected = await Promise.all(tickers.map(m.resolveComparisonCompany));
  const companies = m.applyValuationBasis(await Promise.all(selected.map(async c => ({ ...c, ...await m.loadComparisonFinancials(c.ticker) }))));
  const result = m.buildComparison(companies);
  const ms = Math.round(performance.now() - started);
  const factors = Object.fromEntries(result.companies.map(c => [c.ticker, m.comparisonScores(c).filter(s => s.value !== null).map(s => s.id).join(",")]));
  const valuation = Object.fromEntries(result.companies.map(c => [c.ticker, { basis: c.valuationBasis ?? "pe", forwardPE: c.twelveData?.statistics?.forwardPE ?? null, priceToSales: c.twelveData?.statistics?.priceToSales ?? null }]));
  console.log(JSON.stringify({ run: label, ms, credits: spent.credits - before, calls: spent.calls.slice(calls), factors, valuation, backgroundJobsScheduled: (globalThis.__after ?? []).length }));
  globalThis.__after = [];
}
try {
  if (prefill) {
    for (const t of tickers) {
      const need = await m.statementsNeeded(t).catch(() => ({ needs: false }));
      for (const [kind, run] of [["statistics", () => m.warmStatistics(t)], ...(need.needs ? [["statements", () => m.warmStatements(t)]] : [])]) {
        for (let i = 0; i < 12 && ((await m.minuteUsage(0)) ?? 999) > 100; i++) await new Promise(r => setTimeout(r, 5_000));
        await run(); console.log(JSON.stringify({ prefill: t, kind }));
      }
    }
  }
  await compare(prefill ? "cold (statistics/statements stored, SEC and series not)" : "cold");
  await compare("warm");
} finally { rmSync(dir, { recursive: true, force: true }); }
