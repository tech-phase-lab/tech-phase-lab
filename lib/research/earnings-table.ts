import type { ResultFact } from "./market-results";
import { guidanceRevision, outlookName, type EpsConsensus } from "./x-post-copy.ts";

/** The results card as one scannable table (owner, Nov 23: "hard to read, unusable"): 項目 / 実績 / 前年比 / 市場予想との差, then the
 * company's own guidance. Every value is the brief's own figure (read from the company's release); a ratio shown here (operating
 * margin, change from a year ago) is computed only from two such figures. Nothing is estimated; a figure that is missing is omitted. */
export type TableRow = { key: string; label: { ja: string; en: string }; actual: { ja: string; en: string };
  yoy: { ja: string; en: string } | null;
  /** Under the actual, small and in parentheses (owner, Nov 28): 「（会社予想 540〜560億ドル）」 under revenue, 「（市場予想 8.10ドル）」 under
   * the EPS the consensus matched, 「従来予想を上方修正」 under an outlook. No verdict word on a result. */
  note: { ja: string; en: string } | null; tone: "up" | "down" | null };
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
/** "+1,097%" with a thousands separator, as the X copy writes it (Nov 28: MU's table read "+1097%"). */
const pct = (n: number, digits = 0) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

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
  // 「EPS」, and 「EPS（調整後）」 only for the adjusted figure (owner, Nov 28)
  eps: ["EPS", "EPS"],
  "adjusted-eps": ["EPS（調整後）", "EPS (adjusted)"],
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

/** "$1.5232B-$1.5292B" -> 15.23〜15.29億ドル; "$1.25-$1.26" -> 1.25〜1.26ドル; "$130.0B ± 3%" -> 1,300億ドル±3%;
 * "$61.5B ± $1.5B" -> 615億ドル±15億ドル (Micron's midpoint and dollar band, as the release writes it). */
export function guidanceValue(key: string, value: string): TableRow["actual"] | null {
  const band = /^(.+?) ± (\d+(?:\.\d+)?%)$/.exec(value);
  if (band) { const v = guidanceValue(key, band[1]); return v ? { ja: `${v.ja}±${band[2]}`, en: `${v.en} ± ${band[2]}` } : null; }
  const dollars = /^(.+?) ± ((?:\$|€|NT\$|₩)\d+(?:\.\d+)?[BMKT]?)$/.exec(value);
  if (dollars) {
    const v = guidanceValue(key, dollars[1]), w = guidanceValue(key, dollars[2]);
    return v && w ? { ja: `${v.ja}±${w.ja}`, en: `${v.en} ± ${w.en}` } : null;
  }
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

/** 「通期見通し 売上高」 -> 「通期売上」 (the section is already headed 「次の見通し」). */
const outlookLabel = (ja: string) => outlookName(ja).replace(/見通し(?=（[^（）]+）$|$)/, "");

/** The consensus (when attached) belongs to the EPS basis it matched: `consensusKey` is "adjusted-eps" or "eps". `revenueGuidance` is
 * the company's own outlook for this quarter, given in its previous release (earnings-guidance.ts); never estimated. */
export function earningsTable(facts: ResultFact[], consensus: EpsConsensus | null = null, consensusKey: string | null = null, revenueGuidance: string | null = null): EarningsTable {
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
        results.push({ key, label: { ja: "営業利益率", en: "Operating margin" }, actual: { ja: `${m < 0 ? "−" : ""}${Math.abs(m).toFixed(1)}%`, en: `${m < 0 ? "−" : ""}${Math.abs(m).toFixed(1)}%` }, yoy: null, note: null, tone: null });
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
    let note: TableRow["note"] = null;
    if (consensus && consensusKey === key && shown.parsed) {
      const e = perShare(consensus.estimate);
      note = { ja: `（市場予想 ${e.ja}）`, en: `(Consensus ${e.en})` };
    }
    if (key === "revenue" && revenueGuidance) {
      const g = guidanceValue("guidance-revenue", revenueGuidance);
      if (g) note = { ja: `（会社予想 ${g.ja}）`, en: `(Guidance ${g.en})` };
    }
    results.push({ key, label, actual: shown.actual, yoy: yearOnYear(fact, shown.parsed), note, tone: null });
  }
  const guidance: TableRow[] = [];
  for (const fact of facts) {
    if (!fact.key.startsWith("guidance-") && fact.key !== "capex-guidance") continue;
    const actual = guidanceValue(fact.key, fact.value);
    if (!actual) continue;
    // Against the company's previous outlook for the same period, when we hold it (owner, Nov 28): 上方修正 green, 下方修正 red.
    const revision = guidanceRevision(fact.value, (fact.comparisons as { priorGuidance?: string } | undefined)?.priorGuidance);
    const note = revision === "up" ? { ja: "従来予想を上方修正", en: "Raised from the previous outlook" } : revision === "down" ? { ja: "従来予想を下方修正", en: "Lowered from the previous outlook" }
      : revision === "same" ? { ja: "従来予想を据え置き", en: "Unchanged from the previous outlook" } : null;
    guidance.push({ key: fact.key, label: { ja: outlookLabel(fact.ja), en: fact.en.replace(/^Full-year guidance\s+/i, "Full-year ").replace(/^Next-quarter guidance\s+/i, "Next-quarter ").replace(/^Guidance\s+(\w)/i, (_, c: string) => c.toUpperCase()) }, actual, yoy: null, note,
      tone: revision === "down" ? "down" : revision ? "up" : null });
  }
  // next quarter first, then the full year
  guidance.sort((a, b) => Number(/fy-|通期|Full-year/i.test(a.label.ja + a.key)) - Number(/fy-|通期|Full-year/i.test(b.label.ja + b.key)));
  return { results, guidance };
}

/** The collapsed row keeps its EPS names (owner, Nov 28: the list rows stay as they are). */
const HEADLINE_NAMES: Record<string, { ja: string; en: string }> = { eps: { ja: "EPS（GAAP）", en: "EPS (GAAP)" }, "adjusted-eps": { ja: "調整後EPS", en: "Adjusted EPS" } };

/** One line for the collapsed row: revenue (with its change), the EPS (adjusted first), and the net result. */
export function headline(facts: ResultFact[], lang: "ja" | "en"): string | null {
  const { results } = earningsTable(facts);
  const pick = ["revenue", results.some(r => r.key === "adjusted-eps") ? "adjusted-eps" : "eps", "net-income"];
  const parts = pick.map(key => results.find(r => r.key === key)).filter((r): r is TableRow => !!r)
    .map(r => `${(HEADLINE_NAMES[r.key] ?? r.label)[lang]} ${r.actual[lang]}${r.yoy ? (lang === "ja" ? `（${r.yoy.ja}）` : ` (${r.yoy.en})`) : ""}`);
  return parts.length ? parts.join(lang === "ja" ? "・" : " · ") : null;
}

/** The X post button is shown only for a card that has revenue, an EPS and the company's guidance (owner, Nov 23). */
export function postable(facts: ResultFact[]): boolean {
  const keys = new Set(facts.map(f => f.key));
  return keys.has("revenue") && (keys.has("eps") || keys.has("adjusted-eps")) && facts.some(f => f.key.startsWith("guidance-"));
}
