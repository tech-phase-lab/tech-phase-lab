#!/usr/bin/env node
// Comparison audit: every ticker the comparison accepts (the SEC's company list, as /api/research/stocks searches it), run through the
// comparison API's own server code (lib/research/comparison-server.ts: resolveComparisonCompany, loadComparisonFinancials) with
// the provider store replaced by a stub (stubs/provider.mjs). Reports, per ticker, which of the seven factors can be scored and why the others
// cannot. SEC requests go through a disk cache and a rate limiter (8 a second at most, the SEC's fair-access limit is 10).
// Never run from tests: it reads thousands of filings.
//
//   node --experimental-strip-types scripts/research/comparison-audit/audit.mjs --cache DIR --out audit.jsonl \
//     [--prices twelve-data-stocks.json] [--tickers MO,BTI] [--offline] [--rate 8] [--concurrency 6] [--root CHECKOUT]
//
// --prices: Twelve Data's reference list (GET /stocks, one request, no per-symbol credits); a ticker it lists gets a synthetic recent price
// series so the momentum and price-to-sales code runs. --root: run another checkout's lib/ (for a before/after comparison).
// The User-Agent is RESEARCH_USER_AGENT or a generic one; never put personal data in it.
import { register } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((out, a, i, all) => a.startsWith("--") ? [...out, [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]] : out, []));
if (!args.cache || !args.out) { console.error("usage: audit.mjs --cache DIR --out FILE [--prices FILE] [--tickers A,B] [--offline] [--root DIR]"); process.exit(2); }
if (args.root) process.env.COMPARISON_AUDIT_ROOT = path.resolve(args.root);
const root = path.resolve(process.env.COMPARISON_AUDIT_ROOT ?? new URL("../../..", import.meta.url).pathname);
register("./hooks.mjs", import.meta.url);

const UA = process.env.RESEARCH_USER_AGENT || "TechPhaseAudit/1.0 research@example.com";
const RATE = Number(args.rate ?? 8), CONCURRENCY = Number(args.concurrency ?? 6);
mkdirSync(args.cache, { recursive: true });
const keyFile = url => path.join(args.cache, createHash("sha1").update(url).digest("hex") + ".gz");
const stats = { network: 0, cached: 0, failed: 0, bytes: 0 };
let nextSlot = 0;
async function slot() { const now = Date.now(), at = Math.max(now, nextSlot); nextSlot = at + 1000 / RATE; if (at > now) await new Promise(r => setTimeout(r, at - now)); }
async function secFetch(url) {
  const file = keyFile(url);
  if (existsSync(file)) {
    stats.cached++;
    const raw = gunzipSync(readFileSync(file));
    const status = raw.readUInt16BE(0);
    return { status, body: raw.subarray(2) };
  }
  if (args.offline) return { status: 599, body: Buffer.alloc(0) };
  for (let attempt = 0; ; attempt++) {
    await slot();
    let response;
    try { response = await realFetch(url, { headers: { "User-Agent": UA, Accept: "application/json, text/html" }, signal: AbortSignal.timeout(120_000) }); }
    catch { if (attempt < 3) continue; stats.failed++; return { status: 598, body: Buffer.alloc(0) }; }
    if ((response.status === 429 || response.status === 503 || response.status === 403) && attempt < 4) { await new Promise(r => setTimeout(r, 5000 * (attempt + 1))); continue; }
    const body = Buffer.from(await response.arrayBuffer());
    stats.network++; stats.bytes += body.length;
    const status = Buffer.alloc(2); status.writeUInt16BE(response.status);
    // A 404 is a fact about the company (no XBRL facts); kept. Other failures are not cached.
    if (response.ok || response.status === 404) writeFileSync(file, gzipSync(Buffer.concat([status, body])));
    return { status: response.status, body };
  }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url ?? String(input);
  if (!/^https:\/\/(?:www|data)\.sec\.gov\//.test(url)) throw new Error(`audit: no network for ${new URL(url).host}`);
  init?.signal?.throwIfAborted?.();
  const { status, body } = await secFetch(url);
  return new Response(status >= 598 ? null : body, { status: status >= 598 ? 502 : status, headers: { "content-type": url.endsWith(".json") ? "application/json" : "text/html" } });
};

const prices = new Map();
if (args.prices) for (const row of JSON.parse(readFileSync(args.prices, "utf8")).data ?? []) if (row?.symbol && /^[A-Z]{3}$/.test(row.currency ?? "")) prices.set(String(row.symbol).toUpperCase(), row.currency);
// The symbol production sends to the provider (BRK-B is BRK.B there): the checkout's own mapping, or the ticker unchanged for a checkout
// without one (as production did before; the provider answered 404 for BRK-B).
const symbolFile = path.join(root, "lib/research/provider-symbol.ts");
const { providerSymbol } = existsSync(symbolFile) ? await import(symbolFile) : { providerSymbol: ticker => ticker };
globalThis.__comparisonAudit = { priceCurrency: ticker => prices.get(providerSymbol(ticker)) ?? null, providerSymbol };

const lib = rel => import(path.join(root, "lib/research", rel));
const server = await lib("comparison-server.ts");
const { comparisonScores, comparisonAvailability, comparisonMetric } = await lib("comparison-scorecard.ts");
const directory = (JSON.parse((await secFetch("https://www.sec.gov/files/company_tickers_exchange.json")).body.toString("utf8")));
const fields = directory.fields;
let rows = directory.data.map(r => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
if (args.tickers) { const wanted = new Set(String(args.tickers).split(",")); rows = rows.filter(r => wanted.has(r.ticker)); }
const done = new Set(existsSync(args.out) ? readFileSync(args.out, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l).ticker) : []);
rows = rows.filter(r => !done.has(r.ticker));
console.error(`audit: ${rows.length} tickers to check (${done.size} already in ${args.out}); lib from ${root}`);

/** Why a company has no usable figures at all, read from the cached SEC files (the comparison code itself only says "unsupported"). */
function diagnose(cik) {
  const facts = secCached(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`);
  const subs = secCached(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`);
  const recent = subs?.json?.filings?.recent ?? {};
  const forms = (recent.form ?? []).slice(0, 400);
  const annual = forms.find(f => /^(?:10-K|20-F|40-F)/.test(f)) ?? null;
  const out = { annualForm: annual, lastFiling: recent.filingDate?.[0] ?? null, entityType: subs?.json?.entityType ?? null, sic: subs?.json?.sicDescription ?? null };
  if (!facts) return { ...out, facts: "not-cached" };
  if (facts.status === 404) return { ...out, facts: "none" };
  if (facts.status !== 200) return { ...out, facts: `http-${facts.status}` };
  if (facts.size > 20_000_000) return { ...out, facts: "too-large", size: facts.size };
  const taxonomies = Object.keys(facts.json?.facts ?? {});
  const revenueTags = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "Revenue", "RevenueFromContractsWithCustomers"];
  const units = new Set(), latest = [];
  for (const ns of ["us-gaap", "ifrs-full"]) for (const tag of revenueTags) for (const [unit, values] of Object.entries(facts.json?.facts?.[ns]?.[tag]?.units ?? {})) { units.add(unit); for (const v of values) latest.push(v.end); }
  return { ...out, facts: "ok", taxonomies, revenueUnits: [...units], latestRevenueEnd: latest.sort().at(-1) ?? null };
}
function secCached(url) {
  const file = keyFile(url);
  if (!existsSync(file)) return null;
  const raw = gunzipSync(readFileSync(file)), status = raw.readUInt16BE(0), body = raw.subarray(2);
  if (status !== 200) return { status };
  try { return { status, size: body.length, json: JSON.parse(body.toString("utf8")) }; } catch { return { status: 0 }; }
}


const FACTORS = ["growth", "profitability", "financial", "cash", "stability", "momentum", "valuation"];
async function auditTicker(row) {
  let now = Date.now();
  const started = performance.now();
  const company = await server.resolveComparisonCompany(row.ticker);
  if (!company) return { ticker: row.ticker, cik: row.cik, exchange: row.exchange, outcome: "failing", cause: "not-resolved" };
  const c = { ...company, ...await server.loadComparisonFinancials(row.ticker) };
  now = Date.now();
  // Valuation on price-to-sales: what a comparison with a company lacking a forward P/E uses (forward P/E itself is the provider's statistics).
  const scored = comparisonScores({ ...c, valuationBasis: "ps" }, now);
  const scores = Object.fromEntries(FACTORS.map(id => [id, scored.find(s => s.id === id)?.value ?? null]));
  const have = FACTORS.filter(id => scores[id] !== null);
  const missing = Object.fromEntries(FACTORS.filter(id => scores[id] === null).map(id => [id, comparisonMetric({ ...c, valuationBasis: "ps" }, id, "en", now)]));
  const q = c.quarterRevenue;
  const result = {
    ticker: row.ticker, cik: row.cik, name: row.name, exchange: row.exchange ?? "", status: c.status, basis: q?.basis ?? c.revenue?.basis ?? null,
    unit: q?.unit ?? c.revenue?.unit ?? null, periodStart: q?.start ?? null, periodEnd: q?.end ?? null, periodMonths: c.periodMonths ?? (q ? 3 : null),
    annualEnd: c.revenue?.end ?? null,
    // The figures themselves, for a spot check against the filing (scripts/research/comparison-audit/spot-check.py).
    figures: q ? { revenue: q.value, tag: q.tag, accession: q.accession, previous: c.previousQuarterRevenue?.value ?? null, operating: c.quarterOperatingIncome?.value ?? null,
      operatingTag: c.quarterOperatingIncome?.tag ?? null, growth: c.quarterRevenueGrowth, margin: c.quarterOperatingMargin } : null, price: globalThis.__comparisonAudit.priceCurrency(row.ticker), scored: have.length, scores, missing,
    // The strengths and weaknesses the company card shows (kind:id), and the inputs their rules read, for the items audit (summarize-items.py).
    items: (c.preparedAnalysis?.items ?? []).map(i => `${i.kind === "strength" ? "S" : "W"}:${i.id}`),
    inputs: { growth: c.quarterRevenueGrowth ?? null, qoq: c.quarterRevenueQoq ?? null, margin: c.quarterOperatingMargin ?? null, fcf: c.quarterFcfMargin ?? null,
      shares: c.quarterDilutedSharesGrowth ?? null, currentRatio: c.balance?.currentRatio ?? null, supplemented: c.supplemented ?? [], source: c.quarterSourceUrl ?? null,
      balance: c.balance ? { end: c.balance.end, cash: c.balance.cash?.value ?? null, cashTag: c.balance.cash?.tag ?? null, currentAssets: c.balance.currentAssets?.value ?? null,
        currentLiabilities: c.balance.currentLiabilities?.value ?? null, debt: c.balance.debtTotal?.value ?? null, debtSource: c.balance.debtTotal?.source ?? null } : null },
    availability: comparisonAvailability(c, "en", now), warnings: (c.dataWarnings ?? []).map(w => w.en), ms: Math.round(performance.now() - started),
  };
  // Six of seven: valuation on the forward P/E comes from the provider's statistics, which the audit does not read.
  const core = have.filter(id => id !== "valuation").length;
  result.outcome = core === 6 ? "full" : have.length >= 3 ? "partial" : "failing";
  if (result.outcome !== "full") result.diagnosis = diagnose(row.cik);
  return result;
}

let index = 0, finished = 0;
const t0 = Date.now();
async function worker() {
  for (;;) {
    const row = rows[index++];
    if (!row) return;
    let out;
    try { out = await auditTicker(row); } catch (error) { out = { ticker: row.ticker, cik: row.cik, exchange: row.exchange ?? "", outcome: "failing", cause: "error", error: String(error?.message ?? error).slice(0, 200) }; }
    appendFileSync(args.out, JSON.stringify(out) + "\n");
    if (++finished % 100 === 0) console.error(`audit: ${finished}/${rows.length} in ${Math.round((Date.now() - t0) / 1000)}s; sec network ${stats.network} (${Math.round(stats.bytes / 1e6)} MB), cached ${stats.cached}, failed ${stats.failed}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.error(`audit: done ${finished} in ${Math.round((Date.now() - t0) / 1000)}s; sec network ${stats.network} (${Math.round(stats.bytes / 1e6)} MB), cached ${stats.cached}, failed ${stats.failed}`);
