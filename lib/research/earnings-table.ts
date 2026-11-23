import type { ResultFact } from "./market-results";
import type { EpsConsensus } from "./x-post-copy";

/** The results card as one scannable table (owner, Nov 23: "hard to read, unusable"): 項目 / 実績 / 前年比 / 市場予想との差, then the
 * company's own guidance. Every value is the brief's own figure (read from the company's release); a ratio shown here (operating
 * margin, change from a year ago) is computed only from two such figures. Nothing is estimated; a figure that is missing is omitted. */
export type TableRow = { key: string; label: { ja: string; en: string }; actual: { ja: string; en: string };
  yoy: { ja: string; en: string } | null; versus: { ja: string; en: string } | null; tone: "up" | "down" | null };
export type EarningsTable = { results: TableRow[]; guidance: TableRow[] };

const AMOUNT = /^(\$|€|NT\$|₩)?(-?)\$?(\d+(?:\.\d+)?)([BMKT]?)$/;
const SCALE: Record<string, number> = { T: 1e12, B: 1e9, M: 1e6, K: 1e3, "": 1 };
type Parsed = { currency: string; value: number; unit: string };
export function parseFigure(text: string): Parsed | null {
  const m = AMOUNT.exec(text.trim());
  if (!m) return null;
  const n = Number(m[3]);
  return Number.isFinite(n) ? { currency: m[1] ?? "", value: (m[2] ? -1 : 1) * n * SCALE[m[4]], unit: m[4] } : null;
}
const group = (n: number) => n.toLocaleString("en-US");
const fixed = (n: number, digits: number) => String(Number(n.toFixed(digits)));

/** Japanese money: 1億ドル and over in 億 (14.71億ドル, 1,158億ドル), under it in 万 (3,323万ドル). Always the magnitude: the sign is in the label. */
export function moneyJa(usd: number, currency = "$"): string {
  const unit = currency === "€" ? "ユーロ" : currency === "NT$" ? "台湾ドル" : currency === "₩" ? "ウォン" : "ドル";
  const v = Math.abs(usd);
  if (v >= 1e12) return `${fixed(v / 1e12, 2)}兆${unit}`;
  if (v >= 1e8) { const oku = v / 1e8; return `${oku >= 1000 ? group(Math.round(oku)) : fixed(oku, 2)}億${unit}`; }
  if (v >= 1e4) return `${group(Math.round(v / 1e4))}万${unit}`;
  return `${group(Math.round(v))}${unit}`;
}
export function moneyEn(usd: number, currency = "$"): string {
  const v = Math.abs(usd);
  const [n, u] = v >= 1e12 ? [v / 1e12, "T"] : v >= 1e9 ? [v / 1e9, "B"] : v >= 1e6 ? [v / 1e6, "M"] : [v, ""];
  return `${currency}${fixed(n, n < 10 ? 2 : n < 1000 ? 1 : 0)}${u}`;
}
const perShare = (v: number, currency = "$") => ({ ja: `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}${currency === "$" ? "ドル" : currency}`, en: `${v < 0 ? "−" : ""}${currency}${Math.abs(v).toFixed(2)}` });
const pct = (n: number, digits = 0) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}%`;

/** Keys whose value is per share; the rest of the money keys are totals. */
const PER_SHARE = new Set(["eps", "adjusted-eps"]);
/** Label for each key; a total that can be negative names the loss itself (純損失 / 営業損失), never 純損益. */
const NAMES: Record<string, [string, string, string?, string?]> = {
  revenue: ["売上高", "Revenue"],
  "data-center-revenue": ["データセンター売上高", "Data Center revenue"],
  arr: ["ARR", "ARR"],
  "gross-margin": ["粗利益率", "Gross margin"],
  "operating-income": ["営業利益", "Operating income", "営業損失", "Operating loss"],
  "operating-margin": ["営業利益率", "Operating margin"],
  "net-income": ["純利益", "Net income", "純損失", "Net loss"],
  "adjusted-net-income": ["調整後純利益", "Adjusted net income", "調整後純損失", "Adjusted net loss"],
  eps: ["EPS（GAAP）", "EPS (GAAP)"],
  "adjusted-eps": ["調整後EPS", "Adjusted EPS"],
  "adjusted-ebitda": ["調整後EBITDA", "Adjusted EBITDA"],
  "operating-cash-flow": ["営業CF", "Operating cash flow"],
  "free-cash-flow": ["フリーCF", "Free cash flow"],
  capex: ["設備投資", "Capital expenditures"],
};
const ORDER = ["revenue", "data-center-revenue", "arr", "gross-margin", "operating-income", "operating-margin", "net-income", "eps",
  "adjusted-net-income", "adjusted-eps", "adjusted-ebitda", "operating-cash-flow", "free-cash-flow", "capex"];

function yearOnYear(fact: ResultFact, now: Parsed | null): TableRow["yoy"] {
  const stated = (fact.comparisons as { growth?: string } | undefined)?.growth;
  if (stated && /^[+-]\d+(?:\.\d+)?%$/.test(stated)) { const n = Number(stated.slice(0, -1)); return { ja: pct(n, stated.includes(".") ? 1 : 0), en: pct(n, stated.includes(".") ? 1 : 0) }; }
  const before = fact.comparisons?.yearAgo;
  if (!before) return null;
  if (fact.value.endsWith("%") && before.endsWith("%")) {
    const d = Number(fact.value.slice(0, -1)) - Number(before.slice(0, -1));
    return Number.isFinite(d) ? { ja: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}pt`, en: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts` } : null;
  }
  const prior = parseFigure(before);
  if (!now || !prior || now.currency !== prior.currency) return null;
  const a = now.value, b = prior.value;
  if (b > 0 && a >= 0) return { ja: pct((a - b) / b * 100), en: pct((a - b) / b * 100) };
  // a loss on either side: no percentage, the direction in words (computed from the two printed figures)
  if (b < 0 && a >= 0) return { ja: "黒字転換", en: "Turned positive" };
  if (b >= 0 && a < 0) return { ja: "赤字転換", en: "Turned negative" };
  if (b < 0 && a < 0) return a > b ? { ja: "赤字縮小", en: "Loss narrowed" } : a < b ? { ja: "赤字拡大", en: "Loss widened" } : { ja: "横ばい", en: "Flat" };
  return null;
}

function valueOf(key: string, fact: ResultFact): { actual: TableRow["actual"]; parsed: Parsed | null } | null {
  if (fact.value.endsWith("%") && /^-?\d+(?:\.\d+)?%$/.test(fact.value)) return { actual: { ja: fact.value, en: fact.value }, parsed: null };
  const parsed = parseFigure(fact.value);
  if (!parsed) return null;
  if (PER_SHARE.has(key)) return { actual: perShare(parsed.value, parsed.currency || "$"), parsed };
  return { actual: { ja: moneyJa(parsed.value, parsed.currency || "$"), en: moneyEn(parsed.value, parsed.currency || "$") }, parsed };
}

/** "$1.5232B-$1.5292B" -> 15.23〜15.29億ドル; "$1.25-$1.26" -> 1.25〜1.26ドル; "$130.0B ± 3%" -> 1,300億ドル±3%. */
function guidanceValue(key: string, value: string): TableRow["actual"] | null {
  const band = /^(.+?) ± (\d+(?:\.\d+)?%)$/.exec(value);
  if (band) { const v = guidanceValue(key, band[1]); return v ? { ja: `${v.ja}±${band[2]}`, en: `${v.en} ± ${band[2]}` } : null; }
  const parts = value.split(/-(?=\$|€|NT\$|₩)/);
  const nums = parts.map(parseFigure);
  if (!parts.length || parts.length > 2 || nums.some(n => n === null)) return null;
  const [lo, hi] = [nums[0]!, nums[nums.length - 1]!];
  const cur = lo.currency || "$";
  if (/eps/.test(key)) {
    const a = perShare(lo.value, cur), b = perShare(hi.value, cur);
    return parts.length === 1 ? a : { ja: `${a.ja.replace(/ドル$/, "")}〜${b.ja}`, en: `${a.en}–${b.en}` };
  }
  if (parts.length === 1) return { ja: moneyJa(lo.value, cur), en: moneyEn(lo.value, cur) };
  const ja = moneyJa(lo.value, cur), jb = moneyJa(hi.value, cur);
  const unit = /[兆億万]?(?:ドル|ユーロ|台湾ドル|ウォン)$/.exec(ja)?.[0];
  return { ja: unit && jb.endsWith(unit) ? `${ja.slice(0, -unit.length)}〜${jb}` : `${ja}〜${jb}`, en: `${moneyEn(lo.value, cur)}–${moneyEn(hi.value, cur)}` };
}

/** The consensus (when attached) belongs to the EPS basis it matched: `consensusKey` is "adjusted-eps" or "eps". */
export function earningsTable(facts: ResultFact[], consensus: EpsConsensus | null = null, consensusKey: string | null = null): EarningsTable {
  const byKey = new Map<string, ResultFact>();
  for (const fact of facts) if (!byKey.has(fact.key)) byKey.set(fact.key, fact);
  const results: TableRow[] = [];
  const revenue = byKey.get("revenue"), revenueValue = revenue ? parseFigure(revenue.value) : null;
  const keys = [...ORDER, ...[...byKey.keys()].filter(key => !ORDER.includes(key) && !key.startsWith("guidance-") && key !== "capex-guidance")];
  for (const key of keys) {
    if (key === "operating-margin" && !byKey.has(key)) {
      // derived: operating income ÷ revenue, both the release's own figures
      const op = byKey.get("operating-income"), opValue = op ? parseFigure(op.value) : null;
      if (opValue && revenueValue && revenueValue.value > 0 && opValue.currency === revenueValue.currency) {
        const m = opValue.value / revenueValue.value * 100;
        results.push({ key, label: { ja: "営業利益率", en: "Operating margin" }, actual: { ja: `${m < 0 ? "−" : ""}${Math.abs(m).toFixed(1)}%`, en: `${m < 0 ? "−" : ""}${Math.abs(m).toFixed(1)}%` }, yoy: null, versus: null, tone: null });
      }
      continue;
    }
    const fact = byKey.get(key);
    if (!fact) continue;
    const shown = valueOf(key, fact);
    if (!shown) continue;
    const name = NAMES[key];
    const negative = (shown.parsed?.value ?? 0) < 0 && !PER_SHARE.has(key);
    const label = name ? (negative && name[2] ? { ja: name[2], en: name[3]! } : { ja: name[0], en: name[1] }) : { ja: fact.ja, en: fact.en };
    let versus: TableRow["versus"] = null, tone: TableRow["tone"] = null;
    if (consensus && consensusKey === key && shown.parsed) {
      const est = consensus.estimate, a = shown.parsed.value;
      const gap = est === 0 ? null : (a - est) / Math.abs(est) * 100;
      const word = Math.abs(a - est) < 0.005 ? { ja: "一致", en: "In line" } : a > est ? { ja: "上回る", en: "Beat" } : { ja: "下回る", en: "Missed" };
      const e = perShare(est);
      versus = { ja: `${word.ja}（予想${e.ja}${gap !== null && word.ja !== "一致" ? `・${pct(gap)}` : ""}）`, en: `${word.en} (est. ${e.en}${gap !== null && word.en !== "In line" ? `, ${pct(gap)}` : ""})` };
      tone = word.ja === "上回る" ? "up" : word.ja === "下回る" ? "down" : null;
    }
    results.push({ key, label, actual: shown.actual, yoy: yearOnYear(fact, shown.parsed), versus, tone });
  }
  const guidance: TableRow[] = [];
  for (const fact of facts) {
    if (!fact.key.startsWith("guidance-") && fact.key !== "capex-guidance") continue;
    const actual = guidanceValue(fact.key, fact.value);
    if (!actual) continue;
    guidance.push({ key: fact.key, label: { ja: fact.ja.replace(/^会社予想\s*/, ""), en: fact.en.replace(/^Full-year guidance\s+/i, "Full-year ").replace(/^Guidance\s+(\w)/i, (_, c: string) => c.toUpperCase()) }, actual, yoy: null, versus: null, tone: null });
  }
  // next quarter first, then the full year
  guidance.sort((a, b) => Number(/fy-|通期|Full-year/i.test(a.label.ja + a.key)) - Number(/fy-|通期|Full-year/i.test(b.label.ja + b.key)));
  return { results, guidance };
}

/** One line for the collapsed row: revenue (with its change), the EPS (adjusted first), and the net result. */
export function headline(facts: ResultFact[], lang: "ja" | "en"): string | null {
  const { results } = earningsTable(facts);
  const pick = ["revenue", results.some(r => r.key === "adjusted-eps") ? "adjusted-eps" : "eps", "net-income"];
  const parts = pick.map(key => results.find(r => r.key === key)).filter((r): r is TableRow => !!r)
    .map(r => `${r.label[lang]} ${r.actual[lang]}${r.yoy ? (lang === "ja" ? `（${r.yoy.ja}）` : ` (${r.yoy.en})`) : ""}`);
  return parts.length ? parts.join(lang === "ja" ? "・" : " · ") : null;
}

/** The X post button is shown only for a card that has revenue, an EPS and the company's guidance (owner, Nov 23). */
export function postable(facts: ResultFact[]): boolean {
  const keys = new Set(facts.map(f => f.key));
  return keys.has("revenue") && (keys.has("eps") || keys.has("adjusted-eps")) && facts.some(f => f.key.startsWith("guidance-"));
}
