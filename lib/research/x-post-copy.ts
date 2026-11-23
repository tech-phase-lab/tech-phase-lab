import type { ResultBrief, ResultFact } from "./market-results";

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
const dollars = (n: number) => `${trim(n)}ドル`;

/** ○ above the forecast, △ in line (within ±1%), ✕ below. A figure without a forecast has no mark (owner, Nov 18: never from the year-ago
 * change). Today the only forecast is the EPS consensus (Twelve Data), attached when its basis matches the issuer's EPS. */
export type Mark = "○" | "△" | "✕";
export type XPostMode = "short" | "consensus";

export function forecastMark(actual: number, forecast: number): Mark {
  const gap = forecast === 0 ? actual : (actual - forecast) / Math.abs(forecast);
  if (Math.abs(gap) <= 0.01) return "△";
  return gap > 0 ? "○" : "✕";
}

/** The prior-year value as the issuer-flash facts carry it (comparisons.yearAgo; `previous` means the previous release, never a year-ago figure). */
const yearAgoOf = (fact: ResultFact): string | undefined => (fact.comparisons as { yearAgo?: string } | undefined)?.yearAgo;
/** Change from a prior-year value, when the fact carries one (shown as text, never as a mark). */
function growth(value: number, previousText: string | undefined): number | null {
  const prev = previousText ? parseAmount(previousText) : null;
  if (prev === null || prev === 0 || (value < 0) !== (prev < 0)) return null; // sign changes have no meaningful percentage
  return (value - prev) / Math.abs(prev) * 100;
}
const signed = (pct: number) => `${pct >= 0 ? "+" : "-"}${Math.abs(Math.round(pct)).toLocaleString("en-US")}％`;
const ORDER = ["revenue", "eps", "adjusted-eps", "net-income", "operating-income"];
const SECONDARY = new Set(["gross-margin", "operating-margin", "adjusted-net-income", "adjusted-ebitda", "operating-cash-flow", "free-cash-flow", "capex", "guidance-fy-adjusted-eps"]);
const rank = (key: string) => key.startsWith("guidance-") || key === "capex-guidance" ? 100 : ORDER.includes(key) ? ORDER.indexOf(key) : 50;

function line(fact: ResultFact, consensus: EpsConsensus | null, mode: XPostMode): { mark: Mark | null; text: string } | null {
  if (fact.key.startsWith("guidance-") || fact.key === "capex-guidance") {
    const perShare = /^\$(-?[\d.]+)(?:-\$(-?[\d.]+))?$/.exec(fact.value);
    if (fact.key.includes("eps") && perShare) return { mark: null, text: `${fact.ja}${perShare[2] ? `${perShare[1]}〜${perShare[2]}` : perShare[1]}ドル` };
    const now = span(fact.value);
    if (!now) return /^(?:NT\$|€|₩)[\d.]/.test(fact.value) ? { mark: null, text: `${fact.ja}${fact.value}` } : null;
    const text = `${fact.ja}${range(now.lo, now.hi)}`;
    const priorText = (fact.comparisons as { priorGuidance?: string } | undefined)?.priorGuidance;
    const prior = priorText ? span(priorText) : null;
    if (!prior) return { mark: null, text };
    const priorWords = range(prior.lo, prior.hi);
    const capex = fact.key === "capex-guidance";
    const dir = now.lo > prior.hi ? (capex ? "を上回る" : "を上方修正") : now.hi < prior.lo ? (capex ? "を下回る" : "を下方修正") : now.lo === prior.lo && now.hi === prior.hi ? "から据え置き" : "";
    return { mark: null, text: dir ? `${text}（従来予想${priorWords}${dir}）` : text };
  }
  const v = parseAmount(fact.value);
  // a figure in another currency (NT$, €, ₩) or unit is written as the issuer printed it
  if (v === null) return /^(?:NT\$|€|₩)-?[\d.]/.test(fact.value) ? { mark: null, text: `${fact.ja}${fact.value}` } : null;
  const stated = (fact.comparisons as { growth?: string } | undefined)?.growth;
  const g = growth(v, yearAgoOf(fact));
  const yoy = stated && /^[+-]\d/.test(stated) ? `前年比${stated.replace("%", "％")}` : g === null ? "" : `前年比${signed(g)}`;
  if (fact.key === "eps") {
    const parts = [mode === "consensus" && consensus ? `予想${dollars(consensus.estimate)}` : "", yoy].filter(Boolean);
    return { mark: consensus ? forecastMark(v, consensus.estimate) : null, text: `${fact.ja}${dollars(v)}${parts.length ? `（${parts.join("、")}）` : ""}` };
  }
  if (fact.key === "adjusted-eps") return { mark: null, text: `${fact.ja}${dollars(v)}${yoy ? `（${yoy}）` : ""}` };
  const name = fact.key === "net-income" ? (v < 0 ? "純損失" : "純利益") : fact.key === "operating-income" ? (v < 0 ? "営業損失" : "営業利益")
    : fact.key === "adjusted-net-income" ? (v < 0 ? "調整後純損失" : "調整後純利益") : fact.ja;
  return { mark: null, text: `${name}${oku(v)}${yoy ? `（${yoy}）` : ""}` };
}

/** The X post text, built only from the brief's own figures (and the consensus when attached): one figure per line, the same order
 * for every company. Returns null when no figure can be written. */
export function buildXPost(brief: Pick<ResultBrief, "ticker" | "period" | "facts">, consensus: EpsConsensus | null, mode: XPostMode): string | null {
  // the short form keeps the figures a reader needs first (revenue, EPS, the result, the key business figure, the guidance)
  const facts = brief.facts.filter(fact => mode !== "short" || !SECONDARY.has(fact.key)).map((fact, index) => ({ fact, index })).sort((a, b) => rank(a.fact.key) - rank(b.fact.key) || a.index - b.index).map(item => item.fact);
  const rows = facts.map(f => line(f, consensus, mode)).filter((r): r is { mark: Mark | null; text: string } => r !== null);
  if (!rows.length) return null;
  const body = rows.map(r => `${r.mark ?? ""}${r.text}`).join("\n");
  const attribution = mode === "consensus" && consensus ? "\n\n予想の提供: Twelve Data" : "";
  return `${brief.ticker} ${brief.period} 決算速報\n\n${body}${attribution}`;
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
