import type { ResultBrief, ResultFact } from "./market-results";
import { guidanceValue } from "./earnings-table.ts";

/** EPS consensus read from Twelve Data. Only ever attached when the provider's own reported EPS equals the issuer's (same basis) and the dates match. */
export type EpsConsensus = { estimate: number; date: string };

const SCALE: Record<string, number> = { B: 1e9, M: 1e6, K: 1e3 };
/** "$3.661B" -> 3661000000, "$-709M" -> -709000000, "$-1.27" -> -1.27 (no suffix: left as is). Anything else: null (never guessed). */
export function parseAmount(text: string): number | null {
  const m = /^\$?\s*(-?)\$?([\d,]+(?:\.\d+)?)([BMK]?)$/.exec(text.trim());
  if (!m) return null;
  const n = Number(m[2].replaceAll(",", ""));
  return Number.isFinite(n) ? (m[1] ? -1 : 1) * n * (SCALE[m[3]] ?? 1) : null;
}
/** "$27B" -> {lo,hi}=27e9; "$20B-$25B" -> 20e9..25e9. Anything else: null. */
function span(text: string): { lo: number; hi: number } | null {
  const r = /^(\$[\d.,]+[BMK])\s*-\s*(\$[\d.,]+[BMK])$/.exec(text.trim());
  if (r) { const lo = parseAmount(r[1]), hi = parseAmount(r[2]); return lo === null || hi === null || lo > hi ? null : { lo, hi }; }
  const v = parseAmount(text); return v === null ? null : { lo: v, hi: v };
}
const trim = (n: number, digits = 2) => String(Number(n.toFixed(digits)));
/** USD amount in Japanese units: 3,661,000,000 -> "36.61億ドル" (1億ドル = 1e8); under 1億ドル in 万 (24,900,000 -> "2,490万ドル"),
 * the same units as the results table (owner, Nov 23: 「純損益2,490万ドル」 next to 「純利益0.25億ドル」 for one figure). */
export function oku(usd: number): string {
  const v = Math.abs(usd) / 1e8;
  if (v < 1) return `${Math.round(Math.abs(usd) / 1e4).toLocaleString("en-US")}万ドル`;
  return `${v >= 1000 ? Math.round(v).toLocaleString("en-US") : trim(v)}億ドル`;
}
const range = (lo: number, hi: number) => lo === hi ? oku(lo) : oku(lo).replace(/(億|万)ドル$/, "") + "〜" + oku(hi);

const perShareText = (n: number) => `${n < 0 ? "-" : ""}${Math.abs(n).toFixed(2)}ドル`;

/** The mark at the head of every line (owner, Nov 28; the rule of #435 with the market forecast added, replacing the Nov 18
 * "○△✕ only against a forecast"): ⭕️ EPS above the market forecast or the company's outlook raised, ❌ EPS below it or the outlook
 * lowered, ⚠️ a capital-spending outlook changed from the previous one (either way), ✅ everything else (a figure with its year-ago
 * change only, a new outlook, an EPS within ±1% of the forecast). Every line carries one of the four. */
export type Mark = "⭕️" | "❌" | "⚠️" | "✅";
export type XPostMode = "short" | "consensus";
const MARK_ORDER: Mark[] = ["⭕️", "❌", "⚠️", "✅"];

/** EPS against the market forecast: ⭕️ more than 1% above, ❌ more than 1% below, ✅ within ±1%. */
export function forecastMark(actual: number, forecast: number): Mark {
  const gap = forecast === 0 ? actual : (actual - forecast) / Math.abs(forecast);
  if (Math.abs(gap) <= 0.01) return "✅";
  return gap > 0 ? "⭕️" : "❌";
}

/** An outlook against the company's previous one for the same period: up / down by the midpoint, "same" for the same range.
 * Null when either cannot be read. */
export function guidanceRevision(value: string, prior: string | undefined): "up" | "down" | "same" | null {
  const now = span(value), before = prior ? span(prior) : null;
  if (!now || !before) return null;
  if (now.lo === before.lo && now.hi === before.hi) return "same";
  const mid = (now.lo + now.hi) / 2 - (before.lo + before.hi) / 2;
  return mid > 0 ? "up" : mid < 0 ? "down" : "same";
}

/** "通期見通し 売上高" -> "通期売上見通し", "次四半期見通し 売上高" -> "次四半期売上見通し", "会社予想 売上高（Q3 FY27）" ->
 * "売上高見通し（Q3 FY27）"; any other name as the release labels it. */
export function outlookName(ja: string) {
  const m = /^(通期|次四半期)見通し\s*(.+)$/.exec(ja);
  if (m) return `${m[1]}${m[2].replace(/^売上高$/, "売上")}見通し`;
  const company = /^会社(?:予想|見通し)\s*(.+?)(（[^（）]+）)?$/.exec(ja);
  return company ? `${company[1]}見通し${company[2] ?? ""}` : ja;
}

/** The prior-year value as the issuer-flash facts carry it (comparisons.yearAgo; `previous` means the previous release, never a year-ago figure). */
const yearAgoOf = (fact: ResultFact): string | undefined => (fact.comparisons as { yearAgo?: string } | undefined)?.yearAgo;
/** Change from a prior-year value, when the fact carries one (shown as text, never as a mark). */
function growth(value: number, previousText: string | undefined): number | null {
  const prev = previousText ? parseAmount(previousText) : null;
  if (prev === null || prev === 0 || (value < 0) !== (prev < 0)) return null; // sign changes have no meaningful percentage
  return (value - prev) / Math.abs(prev) * 100;
}
const signed = (pct: number) => `${pct >= 0 ? "+" : "-"}${Math.abs(Math.round(pct)).toLocaleString("en-US")}%`;
const ORDER = ["revenue", "eps", "adjusted-eps", "net-income", "operating-income"];
const SECONDARY = new Set(["gross-margin", "operating-margin", "adjusted-net-income", "adjusted-ebitda", "operating-cash-flow", "free-cash-flow", "capex", "guidance-fy-adjusted-eps"]);
const rank = (key: string) => key.startsWith("guidance-") || key === "capex-guidance" ? 100 : ORDER.includes(key) ? ORDER.indexOf(key) : 50;
/** The EPS names of the results table (owner, Nov 28): 「EPS」, and 「EPS（調整後）」 only for the adjusted figure. */
const EPS_NAME: Record<string, string> = { eps: "EPS", "adjusted-eps": "EPS（調整後）" };

type Line = { mark: Mark; text: string };
function line(fact: ResultFact, consensus: EpsConsensus | null, consensusKey: string): Line | null {
  if (fact.key.startsWith("guidance-") || fact.key === "capex-guidance") {
    const name = outlookName(fact.ja);
    const perShare = /^\$(-?[\d.]+)(?:-\$(-?[\d.]+))?$/.exec(fact.value);
    if (fact.key.includes("eps") && perShare) return { mark: "✅", text: `${name} ${perShare[2] ? `${perShare[1]}〜${perShare[2]}` : perShare[1]}ドル` };
    const now = span(fact.value);
    if (!now) {
      // "$130.0B ± 3%", or another currency: written as the table writes it
      const shown = guidanceValue(fact.key, fact.value);
      return shown ? { mark: "✅", text: `${name} ${shown.ja}` } : /^(?:NT\$|€|₩)[\d.]/.test(fact.value) ? { mark: "✅", text: `${name} ${fact.value}` } : null;
    }
    const text = `${name} ${range(now.lo, now.hi)}`;
    const priorText = (fact.comparisons as { priorGuidance?: string } | undefined)?.priorGuidance;
    const revision = guidanceRevision(fact.value, priorText);
    if (!revision || !priorText) return { mark: "✅", text };
    const prior = span(priorText)!;
    if (fact.key === "capex-guidance") {
      const words = range(prior.lo, prior.hi);
      return revision === "same" ? { mark: "✅", text: `${text}（従来予想${words}から据え置き）` }
        : { mark: "⚠️", text: `${text}（従来予想${words}を${revision === "up" ? "上回る" : "下回る"}）` };
    }
    return revision === "same" ? { mark: "✅", text: `${text}（据え置き）` } : { mark: revision === "up" ? "⭕️" : "❌", text: `${text}（${revision === "up" ? "上方修正" : "下方修正"}）` };
  }
  const v = parseAmount(fact.value);
  // a figure in another currency (NT$, €, ₩) or unit is written as the issuer printed it
  if (v === null) return /^(?:NT\$|€|₩)-?[\d.]/.test(fact.value) ? { mark: "✅", text: `${fact.ja} ${fact.value}` } : null;
  const stated = (fact.comparisons as { growth?: string } | undefined)?.growth;
  const g = growth(v, yearAgoOf(fact));
  const yoy = stated && /^[+-]\d/.test(stated) ? `前年比${stated.replace("％", "%")}` : g === null ? "" : `前年比${signed(g)}`;
  if (EPS_NAME[fact.key]) {
    const name = EPS_NAME[fact.key];
    if (consensus && consensusKey === fact.key) return { mark: forecastMark(v, consensus.estimate), text: `${name} ${perShareText(v)}（市場予想${perShareText(consensus.estimate)}）` };
    return { mark: "✅", text: `${name} ${perShareText(v)}${yoy ? `（${yoy}）` : ""}` };
  }
  const name = fact.key === "net-income" ? (v < 0 ? "純損失" : "純利益") : fact.key === "operating-income" ? (v < 0 ? "営業損失" : "営業利益")
    : fact.key === "adjusted-net-income" ? (v < 0 ? "調整後純損失" : "調整後純利益") : fact.ja;
  return { mark: "✅", text: `${name} ${oku(v)}${yoy ? `（${yoy}）` : ""}` };
}

/** The X post text (owner, Nov 28): 「【DELL 決算速報】」, a blank line, then one figure per line, each with its mark, ⭕️ first, then
 * ❌, ⚠️ and ✅ (the same figure order inside each). Built only from the brief's own figures, the company's previous outlook
 * (comparisons.priorGuidance) and the EPS consensus when its basis matches (`consensusKey`: "adjusted-eps" or "eps"). Returns null
 * when no figure can be written. */
export function buildXPost(brief: Pick<ResultBrief, "ticker" | "period" | "facts">, consensus: EpsConsensus | null, mode: XPostMode, consensusKey: string | null = null): string | null {
  // the short form keeps the figures a reader needs first (revenue, EPS, the result, the key business figure, the guidance)
  const facts = brief.facts.filter(fact => mode !== "short" || !SECONDARY.has(fact.key)).map((fact, index) => ({ fact, index })).sort((a, b) => rank(a.fact.key) - rank(b.fact.key) || a.index - b.index).map(item => item.fact);
  const key = consensusKey ?? "eps";
  const rows = facts.map(f => line(f, consensus, key)).filter((r): r is Line => r !== null)
    .map((row, index) => ({ row, index })).sort((a, b) => MARK_ORDER.indexOf(a.row.mark) - MARK_ORDER.indexOf(b.row.mark) || a.index - b.index).map(item => item.row);
  if (!rows.length) return null;
  const body = rows.map(r => `${r.mark}${r.text}`).join("\n");
  // the provider is credited whenever its forecast is in the text
  const attribution = consensus && facts.some(f => f.key === key) ? "\n\n予想の提供: Twelve Data" : "";
  return `【${brief.ticker} 決算速報】\n\n${body}${attribution}`;
}

/** Twelve Data /earnings -> the estimate for the report that matches this brief, or null. The provider's `surprise_prc` is ignored (wrong sign for losses). */
export function pickConsensus(raw: unknown, briefAt: string, issuerEps: number | null): EpsConsensus | null {
  const rows = (raw as { earnings?: unknown })?.earnings;
  if (!Array.isArray(rows) || issuerEps === null) return null;
  const at = Date.parse(briefAt);
  for (const row of rows as { date?: unknown; eps_estimate?: unknown; eps_actual?: unknown }[]) {
    if (typeof row?.date !== "string" || typeof row.eps_estimate !== "number" || typeof row.eps_actual !== "number") continue;
    const day = Date.parse(`${row.date}T12:00:00Z`);
    if (!Number.isFinite(at) || Math.abs(day - at) > 2 * 86_400_000) continue; // a different quarter's row is never used
    if (Math.abs(row.eps_actual - issuerEps) > 0.02) continue; // different EPS basis (GAAP vs adjusted): no comparison
    return { estimate: row.eps_estimate, date: row.date };
  }
  return null;
}
