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
/** USD amount in the Japanese 億ドル notation: 3,661,000,000 -> "36.61億ドル" (1億ドル = 1e8). Under 1e7: plain dollars. */
export function oku(usd: number): string {
  const v = Math.abs(usd) / 1e8;
  return `${v >= 1000 ? Math.round(v).toLocaleString("en-US") : trim(v)}億ドル`;
}
const dollars = (n: number) => `${trim(n)}ドル`;

type Mark = "⭕️" | "❌" | "⚠️" | "・" | "✅";
export type XPostMode = "short" | "consensus";

/** The prior-year value as the issuer-flash facts carry it (comparisons.yearAgo; `previous` means the previous release, never a year-ago figure). */
const yearAgoOf = (fact: ResultFact): string | undefined => (fact.comparisons as { yearAgo?: string } | undefined)?.yearAgo;
/** Direction from a prior-year value, when the fact carries one. */
function growth(value: number, previousText: string | undefined): { pct: number; up: boolean } | null {
  const prev = previousText ? parseAmount(previousText) : null;
  if (prev === null || prev === 0 || (value < 0) !== (prev < 0)) return null; // sign changes have no meaningful percentage
  const pct = (value - prev) / Math.abs(prev) * 100;
  return { pct, up: pct >= 0 };
}
const signed = (pct: number) => `${pct >= 0 ? "+" : "-"}${Math.abs(Math.round(pct)).toLocaleString("en-US")}％`;

function line(fact: ResultFact, consensus: EpsConsensus | null, mode: XPostMode): { mark: Mark; text: string } | null {
  if (fact.key.startsWith("guidance-") || fact.key === "capex-guidance") {
    const now = span(fact.value);
    if (!now) return null;
    const text = `${fact.ja}${now.lo === now.hi ? oku(now.lo) : `${trim(now.lo / 1e8)}〜${trim(now.hi / 1e8)}億ドル`}`;
    const priorText = (fact.comparisons as { priorGuidance?: string } | undefined)?.priorGuidance;
    const prior = priorText ? span(priorText) : null;
    const dir = prior ? (now.lo > prior.hi ? "up" : now.hi < prior.lo ? "down" : now.lo === prior.lo && now.hi === prior.hi ? "same" : "mixed") : null;
    const priorWords = prior ? `${prior.lo === prior.hi ? oku(prior.lo) : `${trim(prior.lo / 1e8)}〜${trim(prior.hi / 1e8)}億ドル`}` : "";
    if (!dir || dir === "mixed") return { mark: "✅", text };
    const word = dir === "up" ? "上回る" : dir === "down" ? "下回る" : "据え置き";
    const detail = dir === "same" ? `（従来予想${priorWords}から据え置き）` : `（従来予想${priorWords}を${word}）`;
    // Capex above or below the old outlook is neither good nor bad by itself: caution. Revenue-type guidance has a direction.
    if (fact.key === "capex-guidance") return { mark: dir === "same" ? "✅" : "⚠️", text: text + detail };
    return { mark: dir === "up" ? "⭕️" : dir === "down" ? "❌" : "✅", text: text + (dir === "up" ? "（従来予想" + priorWords + "を上方修正）" : dir === "down" ? "（従来予想" + priorWords + "を下方修正）" : detail) };
  }
  const v = parseAmount(fact.value);
  if (v === null) return null;
  const g = growth(v, yearAgoOf(fact));
  const yoy = g ? `前年比${signed(g.pct)}` : "";
  if (fact.key === "eps") {
    const withForecast = mode === "consensus" && consensus ? consensus : null;
    const parts = [withForecast ? `予想${dollars(withForecast.estimate)}` : "", yoy].filter(Boolean);
    const text = `${fact.ja}${dollars(v)}${parts.length ? `（${parts.join("、")}）` : ""}`;
    // Beat/miss is decided from the consensus whenever one is attached to the facts of this post; otherwise only a loss or a known YoY direction decides.
    if (consensus) return { mark: v >= consensus.estimate ? "⭕️" : "❌", text };
    return { mark: g ? (g.up ? "⭕️" : "❌") : v < 0 ? "❌" : "・", text };
  }
  if (fact.key === "net-income" || fact.key === "operating-income") {
    const name = fact.key === "net-income" ? (v < 0 ? "純損失" : "純利益") : (v < 0 ? "営業損失" : "営業利益");
    const text = `${name}${oku(v)}${yoy ? `（${yoy}）` : ""}`;
    return { mark: v < 0 ? "❌" : g ? (g.up ? "⭕️" : "❌") : "・", text };
  }
  const text = `${fact.ja}${oku(v)}${yoy ? `（${yoy}）` : ""}`;
  return { mark: g ? (g.up ? "⭕️" : "❌") : v < 0 ? "❌" : "・", text };
}

/** The X post text, built only from the brief's own figures (and the consensus when attached). Returns null when no figure can be written. */
export function buildXPost(brief: Pick<ResultBrief, "ticker" | "period" | "facts">, consensus: EpsConsensus | null, mode: XPostMode): string | null {
  const rows = brief.facts.map(f => line(f, consensus, mode)).filter((r): r is { mark: Mark; text: string } => r !== null);
  if (!rows.length) return null;
  const groups = (["⭕️", "❌", "⚠️", "・", "✅"] as Mark[]).map(mark => rows.filter(r => r.mark === mark).map(r => `${mark === "・" ? "・" : mark}${r.text}`)).filter(g => g.length);
  const body = groups.map(g => g.join("\n")).join("\n\n");
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
