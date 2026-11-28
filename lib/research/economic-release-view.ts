/**
 * What an economic-results row shows (owner, Nov 24: "+で開いても有益な情報がない。リンクばっかり。もっと見やすく").
 * Pure helpers: the headline number read from the stored result text, the previous release of the same indicator, the market
 * expectation when we hold one, a short history, the next scheduled date and one official link. Nothing here makes up a number:
 * every value is read from a stored result; a value we cannot read is simply left out.
 */
import { shiftMonth, shiftQuarter, shiftWeek, type Backfill } from "./economic-history.ts";

type Lang = "ja" | "en";
type Copy = { ja: string; en: string };
export type ReleaseRow = { id: string; title: Copy; releasedAt: string; result: Copy; detail: Copy; sourceName: string; sourceUrl: string; sourceNameEn?: string };
export type Expectation = { id: string; resultJa: string; resultEn: string };
/** A scheduled release; `dateOnly` when only the day is announced (the FOMC meeting days). */
export type Scheduled = { id: string; at: string; dateOnly?: boolean };

type Unit = "pct" | "jobs" | "index" | "rate" | "count";
/** `revised`: the result states its change from the previous figure as revised (jobless claims), so that figure is read from it. */
type Spec = { unit: Unit; label: Copy; en: RegExp; ja: RegExp; about: Copy; official: { host: RegExp; url: string; name: Copy }; revised?: { en: RegExp; ja: RegExp } };

const num = "([+\\-−]?\\d[\\d,]*(?:\\.\\d+)?)";
const monthly = { en: new RegExp(`${num}% (?:month over month|from the previous month|MoM)`, "i"), ja: new RegExp(`前月比\\s*${num}%`) };
const bls = { host: /(^|\.)bls\.gov$/, url: "https://www.bls.gov/", name: { ja: "米労働統計局", en: "U.S. Bureau of Labor Statistics" } };
const bea = { host: /(^|\.)bea\.gov$/, url: "https://www.bea.gov/", name: { ja: "米経済分析局", en: "U.S. Bureau of Economic Analysis" } };

/** One spec per indicator, keyed by the id's leading word (retail-2026-10, adp-2026-10, jobs-2026-09…). */
export const INDICATORS: Record<string, Spec> = {
  retail: { unit: "pct", label: { ja: "前月比", en: "MoM" }, ...monthly,
    about: { ja: "お店やネット通販の売上の合計です。米国の景気の約7割を占める個人消費の強さが分かり、金利の見通しにも影響します。", en: "Total sales at stores and online. It shows the strength of consumer spending, about 70% of the U.S. economy, and moves rate expectations." },
    official: { host: /(^|\.)census\.gov$/, url: "https://www.census.gov/retail/sales.html", name: { ja: "米国勢調査局", en: "U.S. Census Bureau" } } },
  adp: { unit: "jobs", label: { ja: "民間雇用者数", en: "Private payrolls" }, en: new RegExp(`employment\\s*${num}(K)?\\b`, "i"), ja: new RegExp(`${num}(万)?人`),
    about: { ja: "民間企業の雇用者数の増減（ADP社の集計）です。2日後に出る政府の雇用統計の前触れとして注目されます。", en: "The change in private-sector jobs, counted by ADP. Markets watch it as a preview of the government jobs report two days later." },
    official: { host: /(^|\.)(adp\.com|adpemploymentreport\.com|prnewswire\.com)$/, url: "https://adpemploymentreport.com/", name: { ja: "ADP", en: "ADP" } } },
  jobs: { unit: "jobs", label: { ja: "非農業部門雇用者数", en: "Nonfarm payrolls" }, en: new RegExp(`nonfarm payrolls\\s*${num}(K)?\\b`, "i"), ja: new RegExp(`非農業部門雇用者数\\s*${num}(万)?人`),
    about: { ja: "働く人の増減と失業率です。景気の強さと、FRBの利下げ・利上げの判断を左右する最も重要な指標の一つです。", en: "Hiring and the unemployment rate. One of the most important reports for the economy and for the Fed's rate decisions." },
    official: bls },
  cpi: { unit: "pct", label: { ja: "前月比", en: "MoM" }, ...monthly,
    about: { ja: "消費者が買うモノやサービスの値段の変化です。インフレの代表的な指標で、金利の見通しに直結します。", en: "The change in prices consumers pay. The headline inflation gauge, and it feeds straight into rate expectations." },
    official: bls },
  ppi: { unit: "pct", label: { ja: "前月比", en: "MoM" }, ...monthly,
    about: { ja: "企業が受け取る販売価格の変化です。消費者物価の先行きを占う手がかりになります。", en: "The change in prices producers receive. A hint of where consumer prices may go next." },
    official: bls },
  pce: { unit: "pct", label: { ja: "前月比", en: "MoM" }, ...monthly,
    about: { ja: "個人消費の値段の変化です。FRBが物価目標（2%）の判断で最も重視するインフレ指標です。", en: "The change in prices of personal consumption. The inflation gauge the Fed relies on most for its 2% target." },
    official: bea },
  gdp: { unit: "pct", label: { ja: "前期比年率", en: "Annualized" }, en: new RegExp(`${num}% annualized`, "i"), ja: new RegExp(`年率\\s*${num}%`),
    about: { ja: "国内で生み出されたモノやサービスの合計です。景気全体がどれだけの速さで成長しているかを示します。", en: "The total output of goods and services. It shows how fast the whole economy is growing." },
    official: bea },
  fomc: { unit: "rate", label: { ja: "政策金利", en: "Policy rate" }, en: /(\d+(?:\.\d+)?)%?\s*(?:to|-|–|〜)\s*(\d+(?:\.\d+)?)%/, ja: /(\d+(?:\.\d+)?)%?\s*(?:〜|～|-)\s*(\d+(?:\.\d+)?)%/,
    about: { ja: "FRBが決める政策金利です。株価・ドル・債券の利回りのすべてに影響します。", en: "The policy rate set by the Fed. It moves stocks, the dollar and bond yields alike." },
    official: { host: /(^|\.)federalreserve\.gov$/, url: "https://www.federalreserve.gov/newsevents/pressreleases.htm", name: { ja: "FRB", en: "Federal Reserve" } } },
  ism: { unit: "index", label: { ja: "景況指数", en: "PMI" }, en: /PMI\s*(\d+(?:\.\d+)?)/, ja: /指数\s*(\d+(?:\.\d+)?)/,
    about: { ja: "製造業の購買担当者へのアンケートから作る景況感です。50を上回ると拡大、下回ると縮小を示します。", en: "Business conditions from a survey of factory purchasing managers. Above 50 means expansion, below 50 contraction." },
    official: { host: /(^|\.)ismworld\.org$/, url: "https://www.ismworld.org/supply-management-news-and-reports/reports/ism-report-on-business/", name: { ja: "ISM", en: "ISM" } } },
  claims: { unit: "count", label: { ja: "新規申請件数", en: "Initial claims" }, en: new RegExp(`^${num} \\(`), ja: new RegExp(`^${num}件`),
    revised: { en: /(?:(up|down) ([\d,]+)|(unchanged)) from the previous week's revised level/i, ja: /前週改定値から(?:([\d,]+)件(増|減)|(変わらず))/ },
    about: { ja: "失業保険を新たに申請した人の数で、毎週発表されます。雇用の変化をいちばん早く映す指標で、増えると雇用の冷え込みを示します。", en: "The number of people filing new claims for unemployment benefits, released every week. The most timely read on the job market; a rise points to cooling hiring." },
    official: { host: /(^|\.)dol\.gov$/, url: "https://www.dol.gov/ui/data.pdf", name: { ja: "米労働省", en: "U.S. Department of Labor" } } },
};

export const indicatorKey = (id: string) => /^[a-z]+/.exec(id)?.[0] ?? id;
const specOf = (id: string) => INDICATORS[indicatorKey(id)];

export type Value = { value: number; decimals: number; low?: number; action?: "hold" | "cut" | "hike" };
const toNumber = (text: string) => Number(text.replace(/,/g, "").replace("−", "-"));
const decimalsOf = (text: string) => /\.(\d+)/.exec(text)?.[1].length ?? 0;

/** The headline value of a result, read from the English text first, then the Japanese. */
export function readValue(id: string, text: Copy): Value | null {
  const spec = specOf(id);
  if (!spec) return null;
  for (const [pattern, source] of [[spec.en, text.en], [spec.ja, text.ja]] as const) {
    const match = pattern.exec(cleanResult(source));
    if (!match) continue;
    if (spec.unit === "rate") {
      const action = /据え置|held|hold|unchanged/i.test(source) ? "hold" : /引き下げ|利下げ|\bcut|lower/i.test(source) ? "cut" : /引き上げ|利上げ|rais|hike/i.test(source) ? "hike" : undefined;
      return { value: toNumber(match[2]), low: toNumber(match[1]), decimals: Math.max(2, decimalsOf(match[2])), action };
    }
    const value = toNumber(match[1]) * (match[2] === "万" ? 10_000 : match[2] === "K" ? 1_000 : 1);
    if (!Number.isFinite(value)) continue;
    return { value, decimals: match[2] ? 0 : decimalsOf(match[1]) };
  }
  return null;
}

/** The result without the outlet count and the appended consensus: the reader sees those as their own lines. */
export function cleanResult(text: string) {
  return text.replace(/（\d+社が[^）]*）/g, "").replace(/ \((?:the same figure from|called by) \d+ outlets\)/gi, "")
    .replace(/／市場予想.*$/, "").replace(/ \/ consensus .*$/i, "")
    // "748.2十億ドル" reads as "7,482億ドル" in Japanese.
    .replace(/(\d+(?:\.\d+)?)十億ドル/g, (_, n: string) => `${Number((Number(n) * 10).toFixed(1)).toLocaleString("en-US")}億ドル`).trim();
}

export function formatValue(id: string, v: Value, lang: Lang) {
  const spec = specOf(id);
  const fixed = (n: number, d = v.decimals) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const sign = (n: number) => n > 0 ? "+" : n < 0 ? "−" : "";
  if (!spec) return fixed(v.value);
  if (spec.unit === "rate") {
    const range = `${fixed(v.low ?? v.value)}${lang === "ja" ? "〜" : "–"}${fixed(v.value)}%`;
    const action = v.action && (lang === "ja" ? { hold: "据え置き", cut: "利下げ", hike: "利上げ" } : { hold: "Hold", cut: "Cut", hike: "Hike" })[v.action];
    return action ? `${action} ${range}` : range;
  }
  if (spec.unit === "index") return fixed(v.value);
  // Counts in 万 (owner, Nov 28: 189,000件 → 18.9万件, 86,000人 → 8.6万人); K / M in English.
  if (spec.unit === "count") return `${countText(v.value, lang)}${lang === "ja" ? "件" : ""}`;
  if (spec.unit === "jobs") return `${sign(v.value)}${countText(v.value, lang)}${lang === "ja" ? "人" : ""}`;
  return `${sign(v.value)}${fixed(v.value)}%`;
}

export type Comparison = "above" | "below" | "inline";
export const compare = (actual: Value, other: Value): Comparison => {
  const d = Math.max(actual.decimals, other.decimals);
  const diff = Number((actual.value - other.value).toFixed(d));
  return diff > 0 ? "above" : diff < 0 ? "below" : "inline";
};

/** Extra stated figures worth a line: "売上高 748.2十億ドル", "失業率 4.2%", "前年比+3.4%". Comments about sources are dropped. */
export function extraFacts(text: string, lang: Lang) {
  const clean = cleanResult(text);
  const out: string[] = [];
  const parens = lang === "ja" ? /（([^（）]+)）/g : /\(([^()]+)\)/g;
  for (const match of clean.matchAll(parens)) if (!/社が|outlets|境目|separates|前週改定値|revised level|\d+%?\s*(?:〜|to)\s*\d/.test(match[1])) out.push(match[1].trim());
  for (const part of clean.split(lang === "ja" ? /／|｜/ : /; | \/ | \| /).slice(1)) out.push(part.replace(/[（(][^）)]*[）)]/g, "").trim());
  const yoy = lang === "ja" ? new RegExp(`前年比\\s*${num}%`).exec(clean) : new RegExp(`${num}% (?:year over year|YoY)`, "i").exec(clean);
  if (yoy && !out.some(item => item.includes(yoy[0]))) out.push(lang === "ja" ? `前年比 ${yoy[1]}%` : `${yoy[1]}% year over year`);
  return [...new Set(out.filter(Boolean))];
}

/** Sentences of the stored detail that carry facts (dissents, revisions, core inflation), not where the number came from. */
export function factSentences(detail: string, lang: Lang) {
  const drop = lang === "ja"
    ? /取得|見出し|報道|報じ|照合|確認|掲載|市場予想|出どころ|Wikipedia|読んで|読み取/
    : /headline|outlet|press report|reported by|from (?:the )?[\w .,'’()-]*release|release \(|checked against|confirmed|consensus|read from|wikipedia|anyone can edit|official release|not yet checked/i;
  const sentences = lang === "ja" ? detail.split(/(?<=。)|\n/) : detail.split(/(?<=\.)\s+|\n/);
  return sentences.map(sentence => sentence.trim()).filter(sentence => sentence && !drop.test(sentence));
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "10月" / "7〜9月期" / "Oct" / "Q3" from the row's title: the target period. A weekly release (jobless claims) has none: its bars
 * are named by their release date and its name never carries the week (owner, Nov 28). */
export function periodLabel(title: Copy, lang: Lang) {
  if (/終了週|week ending/i.test(lang === "ja" ? title.ja : title.en)) return null;
  if (lang === "ja") return /（(\d+(?:〜\d+)?月期?)/.exec(title.ja)?.[1] ?? null;
  const month = new RegExp(`\\((${MONTHS_EN.join("|")})\\b`).exec(title.en)?.[1];
  if (month) return month.slice(0, 3);
  const iso = /\(20\d\d-(\d\d)\)/.exec(title.en);
  if (iso) return MONTHS_EN[Number(iso[1]) - 1]?.slice(0, 3) ?? null;
  return /\((Q\d)/.exec(title.en)?.[1] ?? null;
}

/** The indicator's name on screen (owner, Nov 28): the target month in the name's parentheses (「PCE物価指数（10月）」), no week. */
const NAMES: Record<string, Copy> = {
  retail: { ja: "小売売上高", en: "Retail sales" }, adp: { ja: "ADP雇用統計", en: "ADP payrolls" }, jobs: { ja: "雇用統計", en: "Jobs report" },
  cpi: { ja: "消費者物価指数", en: "CPI" }, ppi: { ja: "生産者物価指数", en: "PPI" }, pce: { ja: "PCE物価指数", en: "PCE prices" },
  gdp: { ja: "GDP", en: "GDP" }, fomc: { ja: "FOMC政策金利", en: "FOMC rate decision" }, ism: { ja: "ISM製造業景況指数", en: "ISM manufacturing" },
  claims: { ja: "新規失業保険申請", en: "Initial jobless claims" },
};
export function releaseName(row: Pick<ReleaseRow, "id" | "title">, lang: Lang) {
  const key = indicatorKey(row.id), name = NAMES[key];
  if (!name) return row.title[lang];
  const period = periodLabel(row.title, lang);
  // GDP keeps which estimate it is (速報 / 改定): the same quarter is released three times.
  const estimate = key === "gdp" ? (lang === "ja" ? /・(速報|改定|確定)/.exec(row.title.ja)?.[1] : /\b(advance|second|third)\b/i.exec(row.title.en)?.[1]?.toLowerCase()) : null;
  const inside = [period, estimate].filter(Boolean).join(lang === "ja" ? "・" : ", ");
  return inside ? (lang === "ja" ? `${name.ja}（${inside}）` : `${name.en} (${inside})`) : name[lang];
}

/** Which way is good for the indicator (owner, Nov 28): fewer claims, more jobs and sales, lower prices. FOMC has no good side. */
const GOOD_WHEN_UP: Record<string, boolean | null> = { claims: false, cpi: false, ppi: false, pce: false, retail: true, adp: true, jobs: true, gdp: true, ism: true, fomc: null };
export type Move = { direction: "up" | "down" | "same"; size: string | null; tone: "good" | "bad" | "neutral" };

type FigureUnit = "pct" | "level" | "persons" | "billion";
/** A stated change from the previous figure ("前週比95,000人減" / "down 95,000 from the previous week"): the signed amount, 0 for unchanged. */
type Stated = number | null;
type Read = { value: Value; stated: Stated } | null;
type Figure = { key: string; label: Copy; unit: FigureUnit; read: (text: Copy) => Read };

const pctRe = "([+\\-−]?\\d+(?:\\.\\d+)?)";
const plain = (match: RegExpExecArray | null): Read => match ? { value: { value: toNumber(match[1]), decimals: decimalsOf(match[1]) }, stated: null } : null;
/** The English text first, then the Japanese. */
const either = (en: (text: string) => Read, ja: (text: string) => Read) => (text: Copy) => en(text.en) ?? ja(text.ja);
/** The headline part of an inflation result (before "core" / "コア") and the core part. */
const coreAt = (text: string) => text.search(/\bcore\b|コア/i);
const headPart = (text: string) => coreAt(text) < 0 ? text : text.slice(0, coreAt(text));
const corePart = (text: string) => coreAt(text) < 0 ? "" : text.slice(coreAt(text));
const momEn = new RegExp(`${pctRe}% (?:MoM|month over month|from the previous month)`, "i"), momJa = new RegExp(`前月比\\s*${pctRe}%`);
const yoyEn = new RegExp(`${pctRe}% (?:YoY|year over year)`, "i"), yoyJa = new RegExp(`前年比\\s*${pctRe}%`);
const statedEn = (dir?: string, size?: string, same?: string): Stated => same ? 0 : dir && size ? toNumber(size) * (dir.toLowerCase() === "up" ? 1 : -1) : null;
const statedJa = (size?: string, dir?: string, same?: string): Stated => same ? 0 : size && dir ? toNumber(size) * (dir === "増" ? 1 : -1) : null;
const counted = (match: RegExpExecArray | null, stated: (m: RegExpExecArray) => Stated): Read => match ? { value: { value: toNumber(match[1]), decimals: 0 }, stated: stated(match) } : null;

const inflation: Figure[] = [
  { key: "yoy", label: { ja: "前年比", en: "YoY" }, unit: "pct", read: either(t => plain(yoyEn.exec(headPart(t))), t => plain(yoyJa.exec(headPart(t)))) },
  { key: "core-mom", label: { ja: "コア前月比", en: "Core MoM" }, unit: "pct", read: either(t => plain(momEn.exec(corePart(t))), t => plain(momJa.exec(corePart(t)))) },
  { key: "core-yoy", label: { ja: "コア前年比", en: "Core YoY" }, unit: "pct", read: either(t => plain(yoyEn.exec(corePart(t))), t => plain(yoyJa.exec(corePart(t)))) },
];
/** The figures after the headline, per indicator, read from the stored result and detail. A figure we cannot read is left out.
 * The 4-week average of claims is not shown (owner, Nov 28: it repeats the headline). */
const FIGURES: Record<string, Figure[]> = {
  pce: inflation, cpi: inflation, ppi: inflation,
  retail: [{ key: "sales", label: { ja: "売上高", en: "Sales" }, unit: "billion",
    read: either(t => plain(/\(\$(\d[\d,]*(?:\.\d+)?) billion\)/.exec(t)),
      t => { const m = /売上高\s*(\d[\d,]*(?:\.\d+)?)億ドル/.exec(t); return m ? { value: { value: toNumber(m[1]) / 10, decimals: decimalsOf(m[1]) + 1 }, stated: null } : null; }) }],
  claims: [
    { key: "continuing", label: { ja: "継続受給者", en: "Continuing claims" }, unit: "persons",
      read: either(t => counted(new RegExp(`Continuing claims: ${num} \\(week ending [A-Za-z]+ \\d+(?:, (?:(up|down) ([\\d,]+)|(unchanged)) from the previous week)?\\)`, "i").exec(t), m => statedEn(m[2], m[3], m[4])),
        t => counted(new RegExp(`継続受給者数：${num}人（\\d+月\\d+日終了週(?:・(?:前週比([\\d,]+)人(増|減)|前週から(変わらず)))?）`).exec(t), m => statedJa(m[2], m[3], m[4]))) },
  ],
  jobs: [
    { key: "unemployment", label: { ja: "失業率", en: "Unemployment" }, unit: "level",
      read: either(t => plain(/unemployment rate (\d+(?:\.\d+)?)%/i.exec(t)), t => plain(/失業率\s*(\d+(?:\.\d+)?)%/.exec(t))) },
    { key: "wages-mom", label: { ja: "平均時給 前月比", en: "Hourly pay MoM" }, unit: "pct",
      read: either(t => plain(new RegExp(`average hourly earnings:? ${pctRe}% (?:m/m|MoM|month over month)`, "i").exec(t)), t => plain(new RegExp(`平均時給[：\\s]*前月比\\s*${pctRe}%`).exec(t))) },
    { key: "wages-yoy", label: { ja: "平均時給 前年比", en: "Hourly pay YoY" }, unit: "pct",
      read: either(t => plain(new RegExp(`average hourly earnings(?:(?!\\. )[^;\\n])*?${pctRe}% \\(?(?:y/y|YoY|year over year)`, "i").exec(t)), t => plain(new RegExp(`平均時給[^。／\\n]*?前年比\\s*${pctRe}%`).exec(t))) },
  ],
};

const textOf = (row: ReleaseRow): Copy => ({ ja: `${cleanResult(row.result.ja)}\n${row.detail.ja}`, en: `${cleanResult(row.result.en)}\n${row.detail.en}` });
const trimmed = (n: number, digits: number) => Number(n.toFixed(digits)).toLocaleString("en-US", { maximumFractionDigits: digits });

/** A person or claim count: 18.9万 / 8,600 in Japanese, 189K / 1.7M in English (owner, Nov 28: 189,000件 → 18.9万件). No sign, no unit. */
export function countText(n: number, lang: Lang) {
  const v = Math.abs(n);
  if (lang === "ja") return v >= 10_000 ? `${trimmed(v / 10_000, 1)}万` : trimmed(v, 0);
  return v >= 1_000_000 ? `${trimmed(v / 1_000_000, 2)}M` : v >= 10_000 ? `${trimmed(v / 1_000, 0)}K` : trimmed(v, 0);
}

function formatFigure(unit: FigureUnit, v: Value, lang: Lang) {
  const fixed = (n: number, d = v.decimals) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (unit === "billion") return lang === "ja" ? `${fixed(v.value * 10, Math.max(0, v.decimals - 1))}億ドル` : `$${fixed(v.value)}B`;
  if (unit === "persons") return `${countText(v.value, lang)}${lang === "ja" ? "人" : ""}`;
  if (unit === "level") return `${fixed(v.value)}%`;
  return `${v.value > 0 ? "+" : v.value < 0 ? "−" : ""}${fixed(v.value)}%`;
}

/** The difference from the previous figure, rounded to the figures' own decimals: its direction and its size without a sign. */
function difference(unit: Unit | FigureUnit, now: Value, before: Value, lang: Lang): { direction: Move["direction"]; size: string | null } {
  const decimals = Math.max(now.decimals, before.decimals);
  const diff = Number((now.value - before.value).toFixed(decimals));
  if (diff === 0) return { direction: "same", size: null };
  const size = Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const text = unit === "count" ? `${countText(diff, lang)}${lang === "ja" ? "件" : ""}`
    : unit === "persons" || unit === "jobs" ? `${countText(diff, lang)}${lang === "ja" ? "人" : ""}`
    : unit === "billion" ? (lang === "ja" ? `${(Math.abs(diff) * 10).toLocaleString("en-US", { maximumFractionDigits: Math.max(0, decimals - 1) })}億ドル` : `$${size}B`)
    : unit === "index" ? size
    : lang === "ja" ? `${size}pt` : `${size} pt`;
  return { direction: diff > 0 ? "up" : "down", size: text };
}

/** The indicator's other figures, one line (owner, Nov 28: 「継続受給者 169.7万人（−9.5万）」「前年比 +3.8%　コア前月比 +0.3%」).
 * A count carries its change from the previous figure as the release states it, or from the previous release's own figure. */
export type OtherFigure = { label: string; value: string; note: string | null };
function otherFigures(row: ReleaseRow, previousRow: ReleaseRow | undefined, lang: Lang): OtherFigure[] {
  const out: OtherFigure[] = [];
  const before = previousRow ? textOf(previousRow) : null;
  for (const figure of FIGURES[indicatorKey(row.id)] ?? []) {
    const read = figure.read(textOf(row));
    if (!read) continue;
    let note: string | null = null;
    if (figure.unit === "persons") {
      const previous = read.stated !== null ? { value: read.value.value - read.stated, decimals: 0 } : before ? figure.read(before)?.value ?? null : null;
      if (previous) {
        const diff = read.value.value - previous.value;
        const change = diff === 0 ? (lang === "ja" ? "変わらず" : "unchanged") : `${diff > 0 ? "+" : "−"}${countText(diff, lang)}`;
        note = lang === "ja" ? `（${change}）` : ` (${change})`;
      }
    }
    out.push({ label: figure.label[lang], value: formatFigure(figure.unit, read.value, lang), note });
  }
  return out;
}

/** A bar's own value: 18.9 (万件) / 189K, 0.3%, 55.5. */
function barText(id: string, v: Value, lang: Lang) {
  const unit = specOf(id)?.unit;
  if (unit === "count" || unit === "jobs") return `${v.value < 0 ? "−" : ""}${lang === "ja" ? trimmed(Math.abs(v.value) / 10_000, 1) : countText(v.value, lang)}`;
  if (unit === "pct") return `${v.value < 0 ? "−" : ""}${Math.abs(v.value).toFixed(v.decimals)}%`;
  if (unit === "rate") return `${v.value.toFixed(v.decimals)}%`;
  return v.value.toFixed(v.decimals);
}

/** What one indicator is, in one sentence of about 40 characters (owner, Nov 28). */
const ABOUT: Record<string, Copy> = {
  claims: { ja: "失業保険を新しく申請した人の数。増えると雇用が冷えてきたサインです。", en: "People filing new unemployment claims. A rise is a sign that hiring is cooling." },
  pce: { ja: "FRBが物価目標（2%）を見るときに一番重視するインフレの数字です。", en: "The inflation gauge the Fed watches most closely against its 2% target." },
  cpi: { ja: "消費者が買うモノやサービスの値段の変化。代表的なインフレの数字です。", en: "The change in prices consumers pay. The best-known inflation gauge." },
  ppi: { ja: "企業が売るときの値段の変化。消費者物価の先行きの手がかりになります。", en: "The change in prices producers receive. A hint of where consumer prices go." },
  retail: { ja: "お店とネット通販の売上の合計。個人消費の強さがいちばん早く分かります。", en: "Total sales at stores and online. The earliest read on consumer spending." },
  adp: { ja: "民間企業で働く人の増減。政府の雇用統計の前触れとして見られます。", en: "The change in private-sector jobs. Watched as a preview of the jobs report." },
  jobs: { ja: "働く人の増減と失業率。FRBの金利の判断を左右する一番大事な数字です。", en: "Hiring and the unemployment rate. The report that moves Fed decisions most." },
  gdp: { ja: "国内で生み出したモノやサービスの合計。景気が育つ速さを示します。", en: "The total output of goods and services. How fast the economy is growing." },
  fomc: { ja: "FRBが決める政策金利。株・ドル・債券の利回りのすべてに影響します。", en: "The policy rate set by the Fed. It moves stocks, the dollar and bond yields." },
  ism: { ja: "工場の購買担当者へのアンケート。50を上回ると景気の拡大を示します。", en: "A survey of factory purchasing managers. Above 50 means expansion." },
};

export type ReleaseView = {
  key: string; known: boolean; unit: Unit | null; name: string; summary: string; value: Value | null; display: string | null;
  /** 「前月比」 / 「前期比年率」 next to a percentage; null for a count, an index or a rate. */
  label: string | null;
  /** The period before this one: a stored result (`row`), or FRED's figure (`row` null) when that period was not stored. */
  previous: { row: ReleaseRow | null; value: Value; display: string; revised?: boolean } | null;
  /** The arrow against the previous figure, green when it moved the good way for this indicator, red the bad way (owner, Nov 28). */
  move: Move | null;
  forecast: { value: Value; display: string; vs: Comparison } | null;
  /** Six consecutive periods (weeks, months or quarters) ending with this release, oldest first (owner, Nov 28). A period neither stored
   * nor on FRED is an empty slot (value null) that keeps its label. Empty unless at least four periods have a value. `label` is the
   * target period; null for a weekly release, whose bar is named by `releasedAt`'s date. */
  history: HistoryBar[];
  /** The other figures, each 「名前 数字（変化）」, shown in one line. */
  others: OtherFigure[];
  /** Lines of a row that is not an indicator (an election): the rest of its result. */
  facts: string[];
  about: string | null; next: Scheduled | null; link: { url: string; name: string; official: boolean } | null;
  /** False when opening the row would show nothing but a link: the row is then not expandable (owner, Nov 26). */
  expandable: boolean;
};

/** The previous figure as revised, worked out from the stated change ("189,000件（前週改定値から13,000件減）" → 202,000). */
function revisedPrevious(row: ReleaseRow, value: Value | null): Value | null {
  const spec = specOf(row.id);
  if (!spec?.revised || !value) return null;
  const en = spec.revised.en.exec(cleanResult(row.result.en));
  if (en) return { value: en[3] ? value.value : value.value - toNumber(en[2]) * (en[1].toLowerCase() === "up" ? 1 : -1), decimals: value.decimals };
  const ja = spec.revised.ja.exec(cleanResult(row.result.ja));
  if (ja) return { value: ja[3] ? value.value : value.value - toNumber(ja[1]) * (ja[2] === "増" ? 1 : -1), decimals: value.decimals };
  return null;
}

export type HistoryBar = { id: string; label: string | null; releasedAt: string; display: string | null; value: number | null; current: boolean; source: "stored" | "fred" | null };

const MONTH_LABEL_EN = MONTHS_EN.map(month => month.slice(0, 3));
/** The period a stored result is for: the week-ending day of jobless claims, the quarter of GDP, else the month (ISM's id carries the
 * month it is released in, one after the month it covers). Null for FOMC (meetings, not periods). */
export function periodOfRow(id: string): { frequency: "week" | "month" | "quarter"; period: string } | null {
  const key = indicatorKey(id);
  if (key === "fomc") return null;
  if (key === "claims") { const m = /^claims-(\d{4}-\d{2}-\d{2})/.exec(id); return m ? { frequency: "week", period: m[1] } : null; }
  if (key === "gdp") { const m = /^gdp-(\d{4})-q([1-4])/.exec(id); return m ? { frequency: "quarter", period: `${m[1]}-Q${m[2]}` } : null; }
  const m = /^[a-z]+-(\d{4}-\d{2})$/.exec(id);
  if (!m) return null;
  return { frequency: "month", period: key === "ism" ? shiftMonth(m[1], -1) : m[1] };
}
const shiftPeriod = (frequency: "week" | "month" | "quarter", period: string, n: number) => frequency === "week" ? shiftWeek(period, n) : frequency === "month" ? shiftMonth(period, n) : shiftQuarter(period, n);
function periodText(frequency: "week" | "month" | "quarter", period: string, lang: Lang) {
  if (frequency === "week") return null;
  if (frequency === "quarter") { const q = Number(period.slice(6)); return lang === "ja" ? `${q * 3 - 2}〜${q * 3}月期` : `Q${q}`; }
  const month = Number(period.slice(5, 7));
  return lang === "ja" ? `${month}月` : MONTH_LABEL_EN[month - 1];
}

/** The bars (owner, Nov 28): six consecutive periods ending with this release. Each earlier period is the site's stored result when it
 * has one, else FRED's figure, else an empty slot. This release is always the site's own result. */
function historyBars(row: ReleaseRow, value: Value, stored: ReleaseRow[], backfill: Backfill, lang: Lang): HistoryBar[] {
  const key = indicatorKey(row.id), at = periodOfRow(row.id);
  if (!at) {
    // FOMC: the last meetings stored, no periods to fill.
    return [...stored, row].map(item => ({ item, v: readValue(item.id, item.result) })).filter(entry => entry.v).slice(-6)
      .map(({ item, v }) => ({ id: item.id, label: periodLabel(item.title, lang), releasedAt: item.releasedAt, display: barText(item.id, v!, lang), value: v!.value, current: item.id === row.id, source: "stored" as const }));
  }
  const fred = new Map((backfill[key] ?? []).map(point => [point.period, point]));
  return [-5, -4, -3, -2, -1, 0].map(n => {
    const period = shiftPeriod(at.frequency, at.period, n);
    const label = periodText(at.frequency, period, lang);
    // a weekly bar is named by its release day: the stored one's, else the usual Thursday after the week ends (Saturday + 5 days)
    const usual = at.frequency === "week" ? new Date(Date.parse(`${period}T12:30:00Z`) + 5 * 86_400_000).toISOString() : row.releasedAt;
    if (n === 0) return { id: row.id, label, releasedAt: row.releasedAt, display: barText(row.id, value, lang), value: value.value, current: true, source: "stored" as const };
    const own = stored.find(other => periodOfRow(other.id)?.period === period && readValue(other.id, other.result));
    const ownValue = own ? readValue(own.id, own.result) : null;
    if (own && ownValue) return { id: own.id, label, releasedAt: own.releasedAt, display: barText(own.id, ownValue, lang), value: ownValue.value, current: false, source: "stored" as const };
    const point = fred.get(period);
    if (point) return { id: `${key}-${period}-fred`, label, releasedAt: usual, display: barText(row.id, { value: point.value, decimals: point.decimals }, lang), value: point.value, current: false, source: "fred" as const };
    return { id: `${key}-${period}-none`, label, releasedAt: usual, display: null, value: null, current: false, source: null };
  });
}

export function releaseView(row: ReleaseRow, all: ReleaseRow[], expectations: Expectation[], schedule: Scheduled[], now: number, lang: Lang, backfill: Backfill = {}): ReleaseView {
  const key = indicatorKey(row.id), spec = INDICATORS[key];
  const value = readValue(row.id, row.result);
  const at = Date.parse(row.releasedAt);
  const sameIndicator = spec ? all.filter(other => indicatorKey(other.id) === key).toSorted((a, b) => Date.parse(a.releasedAt) - Date.parse(b.releasedAt)) : [];
  const earlier = sameIndicator.filter(other => Date.parse(other.releasedAt) < at);
  const lastRead = earlier.toReversed().find(other => readValue(other.id, other.result));
  const revised = revisedPrevious(row, value);
  // 前回 is the period just before this one (owner, Nov 28: no skipped month): the stated revision for claims, else the stored result of
  // that period, else FRED's figure for it; a row without periods (FOMC) takes the last stored result.
  const at0 = periodOfRow(row.id);
  const before = at0 ? shiftPeriod(at0.frequency, at0.period, -1) : null;
  const storedBefore = before ? earlier.find(other => periodOfRow(other.id)?.period === before && readValue(other.id, other.result)) : lastRead;
  const fredBefore = before && !storedBefore ? (backfill[key] ?? []).find(point => point.period === before) ?? null : null;
  const previousRow = revised ? row : storedBefore;
  const previousValue = revised ?? (previousRow ? readValue(previousRow.id, previousRow.result) : fredBefore ? { value: fredBefore.value, decimals: fredBefore.decimals } : null);
  const expected = expectations.find(item => item.id === `expected-${row.id}`);
  const forecastValue = expected && spec ? readValue(row.id, { ja: expected.resultJa, en: expected.resultEn }) : null;
  const history = value ? historyBars(row, value, earlier, backfill, lang) : [];
  const latest = sameIndicator.at(-1)?.id === row.id;
  const next = spec && latest ? schedule.filter(item => indicatorKey(item.id) === key && Date.parse(item.at) > Math.max(now, at)).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null : null;
  const summaryText = cleanResult(row.result[lang]);
  const summary = spec ? summaryText : summaryText.split(/｜| \| /)[0].trim();
  // A row we have no spec for (an election) keeps the rest of its result and its stated facts as lines.
  const facts = spec ? [] : [...new Set([...summaryText.split(/｜| \| /).slice(1).map(part => part.trim()), ...factSentences(row.detail[lang], lang)])].filter(Boolean);
  let link: ReleaseView["link"] = null;
  const host = (() => { try { return new URL(row.sourceUrl).hostname; } catch { return ""; } })();
  if (spec) link = spec.official.host.test(host) ? { url: row.sourceUrl, name: spec.official.name[lang], official: true } : { url: spec.official.url, name: spec.official.name[lang], official: true };
  else if (host && !/(^|\.)(news\.google\.com|x\.com|twitter\.com)$/.test(host)) link = { url: row.sourceUrl, name: host.replace(/^www\./, ""), official: false };
  let move: Move | null = null;
  if (spec && value && previousValue) {
    const { direction, size } = difference(spec.unit, value, previousValue, lang);
    const good = GOOD_WHEN_UP[key];
    move = { direction, size, tone: direction === "same" || good === null || good === undefined ? "neutral" : (direction === "up") === good ? "good" : "bad" };
  }
  const forecast = value && forecastValue ? { value: forecastValue, display: formatValue(row.id, forecastValue, lang), vs: compare(value, forecastValue) } : null;
  const others = spec && value ? [...otherFigures(row, lastRead, lang), ...(forecast ? [{ label: lang === "ja" ? "予想" : "Forecast", value: forecast.display, note: null }] : [])] : [];
  // Fewer than four values: no chart, only the figures (owner, Nov 28: no two- or three-bar charts).
  const shownHistory = history.filter(bar => bar.value !== null).length >= 4 ? history : [];
  return {
    key, known: !!spec, unit: spec?.unit ?? null, name: releaseName(row, lang), summary, value, display: value ? formatValue(row.id, value, lang) : null,
    label: spec && spec.unit === "pct" ? spec.label[lang] : null,
    previous: previousValue ? { row: previousRow ?? null, value: previousValue, display: formatValue(row.id, previousValue, lang), ...(revised ? { revised: true } : {}) } : null,
    move, forecast, history: shownHistory, others, facts, about: spec ? ABOUT[key]?.[lang] ?? spec.about[lang] : null, next, link,
    expandable: !!(value || facts.length || spec || shownHistory.length || next),
  };
}
