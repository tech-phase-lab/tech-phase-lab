/**
 * What an economic-results row shows (owner, Nov 24: "+で開いても有益な情報がない。リンクばっかり。もっと見やすく").
 * Pure helpers: the headline number read from the stored result text, the previous release of the same indicator, the market
 * expectation when we hold one, a short history, the next scheduled date and one official link. Nothing here makes up a number:
 * every value is read from a stored result; a value we cannot read is simply left out.
 */
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
const bls = { host: /(^|\.)bls\.gov$/, url: "https://www.bls.gov/", name: { ja: "米労働統計局（BLS）", en: "U.S. Bureau of Labor Statistics" } };
const bea = { host: /(^|\.)bea\.gov$/, url: "https://www.bea.gov/", name: { ja: "米経済分析局（BEA）", en: "U.S. Bureau of Economic Analysis" } };

/** One spec per indicator, keyed by the id's leading word (retail-2026-10, adp-2026-10, jobs-2026-09…). */
export const INDICATORS: Record<string, Spec> = {
  retail: { unit: "pct", label: { ja: "前月比", en: "MoM" }, ...monthly,
    about: { ja: "お店やネット通販の売上の合計です。米国の景気の約7割を占める個人消費の強さが分かり、金利の見通しにも影響します。", en: "Total sales at stores and online. It shows the strength of consumer spending, about 70% of the U.S. economy, and moves rate expectations." },
    official: { host: /(^|\.)census\.gov$/, url: "https://www.census.gov/retail/sales.html", name: { ja: "米国勢調査局", en: "U.S. Census Bureau" } } },
  adp: { unit: "jobs", label: { ja: "民間雇用者数", en: "Private payrolls" }, en: new RegExp(`employment\\s*${num}`, "i"), ja: new RegExp(`${num}(万)?人`),
    about: { ja: "民間企業の雇用者数の増減（ADP社の集計）です。2日後に出る政府の雇用統計の前触れとして注目されます。", en: "The change in private-sector jobs, counted by ADP. Markets watch it as a preview of the government jobs report two days later." },
    official: { host: /(^|\.)(adp\.com|adpemploymentreport\.com|prnewswire\.com)$/, url: "https://adpemploymentreport.com/", name: { ja: "ADP", en: "ADP" } } },
  jobs: { unit: "jobs", label: { ja: "非農業部門雇用者数", en: "Nonfarm payrolls" }, en: new RegExp(`nonfarm payrolls\\s*${num}`, "i"), ja: new RegExp(`非農業部門雇用者数\\s*${num}(万)?人`),
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
    official: { host: /(^|\.)dol\.gov$/, url: "https://www.dol.gov/ui/data.pdf", name: { ja: "米労働省（DOL）", en: "U.S. Department of Labor" } } },
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
    const value = toNumber(match[1]) * (match[2] === "万" ? 10_000 : 1);
    if (!Number.isFinite(value)) continue;
    return { value, decimals: match[2] === "万" ? 0 : decimalsOf(match[1]) };
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
  if (spec.unit === "count") return `${fixed(v.value, 0)}${lang === "ja" ? "件" : ""}`;
  if (spec.unit === "jobs") return `${sign(v.value)}${fixed(v.value, 0)}${lang === "ja" ? "人" : ""}`;
  return `${sign(v.value)}${fixed(v.value)}%`;
}

/** "前回から0.6ポイント低下" / "down 0.6 pt from the previous release". */
export function describeChange(id: string, now: Value, before: Value, lang: Lang) {
  const spec = specOf(id);
  if (!spec) return null;
  const decimals = Math.max(now.decimals, before.decimals);
  const diff = Number((now.value - before.value).toFixed(decimals));
  if (diff === 0) return lang === "ja" ? "前回と同じ" : "Same as the previous release";
  const size = Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (spec.unit === "jobs") return lang === "ja" ? `前回より${size}人${diff > 0 ? "多い" : "少ない"}` : `${size} ${diff > 0 ? "more" : "fewer"} than the previous release`;
  if (spec.unit === "count") return lang === "ja" ? `前週より${size}件${diff > 0 ? "増加" : "減少"}` : `${diff > 0 ? "Up" : "Down"} ${size} from the previous week`;
  return lang === "ja" ? `前回から${size}ポイント${diff > 0 ? "上昇" : "低下"}` : `${diff > 0 ? "Up" : "Down"} ${size} pt from the previous release`;
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

/** "10月" / "7〜9月期" / "Oct" / "Q3" from the row's title, for the history chips. */
export function periodLabel(title: Copy, lang: Lang) {
  // A weekly release is named by the week it ends: "11/21" / "Nov 21".
  const week = lang === "ja" ? /（(\d+)月(\d+)日終了週/.exec(title.ja) : /\(week ending (January|February|March|April|May|June|July|August|September|October|November|December) (\d+)/.exec(title.en);
  if (week) return lang === "ja" ? `${week[1]}/${week[2]}` : `${week[1].slice(0, 3)} ${week[2]}`;
  if (lang === "ja") return /（(\d+(?:〜\d+)?月期?)/.exec(title.ja)?.[1] ?? null;
  const month = /\((January|February|March|April|May|June|July|August|September|October|November|December)\b/.exec(title.en)?.[1];
  return month ? month.slice(0, 3) : /\((Q\d)/.exec(title.en)?.[1] ?? null;
}

/** One line of the opened row's table (owner, Nov 27): 今回 / 前回 / 予想 (only the headline holds one) / 変化. */
export type FigureRow = { key: string; label: string; now: string; previous: string | null; forecast: string | null;
  change: { direction: "up" | "down" | "same"; text: string } | null };

type FigureUnit = "pct" | "level" | "count" | "persons" | "billion";
/** A stated change from the previous figure ("前週比1,500件減" / "down 1,500 from the previous week"): the signed amount, 0 for unchanged. */
type Stated = number | null;
type Read = { value: Value; stated: Stated } | null;
type Figure = { key: string; label: Copy; unit: FigureUnit; read: (text: Copy) => Read; fact: RegExp };

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
const shortPct = /^[+\-−]?[\d.]+% (?:YoY|MoM|year over year|month over month)$/i;

const inflation: Figure[] = [
  { key: "yoy", label: { ja: "前年比", en: "YoY" }, unit: "pct", read: either(t => plain(yoyEn.exec(headPart(t))), t => plain(yoyJa.exec(headPart(t)))),
    fact: /^前年比\s*[+\-−]?[\d.]+%$|^[+\-−]?[\d.]+% (?:YoY|year over year)$/i },
  { key: "core-mom", label: { ja: "コア前月比", en: "Core MoM" }, unit: "pct", read: either(t => plain(momEn.exec(corePart(t))), t => plain(momJa.exec(corePart(t)))), fact: /^(?:コア|core\b)/i },
  { key: "core-yoy", label: { ja: "コア前年比", en: "Core YoY" }, unit: "pct", read: either(t => plain(yoyEn.exec(corePart(t))), t => plain(yoyJa.exec(corePart(t)))), fact: shortPct },
];
/** The figures after the headline, per indicator, read from the stored result and detail. A figure we cannot read is left out. */
const FIGURES: Record<string, Figure[]> = {
  pce: inflation, cpi: inflation, ppi: inflation,
  retail: [{ key: "sales", label: { ja: "売上高", en: "Sales" }, unit: "billion",
    read: either(t => plain(/\(\$(\d[\d,]*(?:\.\d+)?) billion\)/.exec(t)),
      t => { const m = /売上高\s*(\d[\d,]*(?:\.\d+)?)億ドル/.exec(t); return m ? { value: { value: toNumber(m[1]) / 10, decimals: decimalsOf(m[1]) + 1 }, stated: null } : null; }),
    fact: /^売上高 |^\$[\d,.]+ billion$/ }],
  claims: [
    { key: "average", label: { ja: "4週平均", en: "4-week average" }, unit: "count",
      read: either(t => counted(new RegExp(`4-week average: ${num}(?: \\((?:(up|down) ([\\d,]+)|(unchanged)) from the previous week\\))?`, "i").exec(t), m => statedEn(m[2], m[3], m[4])),
        t => counted(new RegExp(`4週平均：${num}件(?:（(?:前週比([\\d,]+)件(増|減)|前週から(変わらず))）)?`).exec(t), m => statedJa(m[2], m[3], m[4]))),
      fact: /^4週平均|^4-week average/i },
    { key: "continuing", label: { ja: "継続受給者数", en: "Continuing claims" }, unit: "persons",
      read: either(t => counted(new RegExp(`Continuing claims: ${num} \\(week ending [A-Za-z]+ \\d+(?:, (?:(up|down) ([\\d,]+)|(unchanged)) from the previous week)?\\)`, "i").exec(t), m => statedEn(m[2], m[3], m[4])),
        t => counted(new RegExp(`継続受給者数：${num}人（\\d+月\\d+日終了週(?:・(?:前週比([\\d,]+)人(増|減)|前週から(変わらず)))?）`).exec(t), m => statedJa(m[2], m[3], m[4]))),
      fact: /^継続受給者数|^Continuing claims/i },
  ],
  jobs: [
    { key: "unemployment", label: { ja: "失業率", en: "Unemployment rate" }, unit: "level",
      read: either(t => plain(/unemployment rate (\d+(?:\.\d+)?)%/i.exec(t)), t => plain(/失業率\s*(\d+(?:\.\d+)?)%/.exec(t))), fact: /^失業率|^unemployment rate/i },
    { key: "wages-mom", label: { ja: "平均時給 前月比", en: "Hourly earnings MoM" }, unit: "pct",
      read: either(t => plain(new RegExp(`average hourly earnings:? ${pctRe}% (?:m/m|MoM|month over month)`, "i").exec(t)), t => plain(new RegExp(`平均時給[：\\s]*前月比\\s*${pctRe}%`).exec(t))),
      fact: /^平均時給|^average hourly earnings/i },
    { key: "wages-yoy", label: { ja: "平均時給 前年比", en: "Hourly earnings YoY" }, unit: "pct",
      read: either(t => plain(new RegExp(`average hourly earnings(?:(?!\\. )[^;\\n])*?${pctRe}% \\(?(?:y/y|YoY|year over year)`, "i").exec(t)), t => plain(new RegExp(`平均時給[^。／\\n]*?前年比\\s*${pctRe}%`).exec(t))),
      fact: /^前年比\s*[+\-−]?[\d.]+%$|^[+\-−]?[\d.]+% y\/y$/i },
  ],
};
/** The headline row's label where the table names it differently from the collapsed line. */
const HEADLINE_LABEL: Record<string, Copy> = { claims: { ja: "件数", en: "Claims" } };

const textOf = (row: ReleaseRow): Copy => ({ ja: `${cleanResult(row.result.ja)}\n${row.detail.ja}`, en: `${cleanResult(row.result.en)}\n${row.detail.en}` });

function formatFigure(unit: FigureUnit, v: Value, lang: Lang) {
  const fixed = (n: number, d = v.decimals) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (unit === "billion") return lang === "ja" ? `${fixed(v.value * 10, Math.max(0, v.decimals - 1))}億ドル` : `$${fixed(v.value)}B`;
  if (unit === "count") return `${fixed(v.value, 0)}${lang === "ja" ? "件" : ""}`;
  if (unit === "persons") return `${fixed(v.value, 0)}${lang === "ja" ? "人" : ""}`;
  if (unit === "level") return `${fixed(v.value)}%`;
  return `${v.value > 0 ? "+" : v.value < 0 ? "−" : ""}${fixed(v.value)}%`;
}

/** The difference from the previous figure, rounded to the figures' own decimals; "same" when it rounds to zero. */
export function figureChange(unit: Unit | FigureUnit, now: Value, before: Value, lang: Lang): FigureRow["change"] {
  const decimals = Math.max(now.decimals, before.decimals);
  const diff = Number((now.value - before.value).toFixed(decimals));
  if (diff === 0) return { direction: "same", text: lang === "ja" ? "変わらず" : "Unchanged" };
  const size = (n: number, d = decimals) => Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const text = unit === "billion" ? (lang === "ja" ? `${size(diff * 10, Math.max(0, decimals - 1))}億ドル` : `$${size(diff)}B`)
    : unit === "count" ? `${size(diff, 0)}${lang === "ja" ? "件" : ""}`
    : unit === "persons" || unit === "jobs" ? `${size(diff, 0)}${lang === "ja" ? "人" : ""}`
    : unit === "index" ? size(diff)
    : lang === "ja" ? `${size(diff)}pt` : `${size(diff)} pts`;
  return { direction: diff > 0 ? "up" : "down", text };
}

/** The figures table: the headline (with the forecast when we hold one), then the indicator's other stated figures. */
function figureTable(row: ReleaseRow, previousRow: ReleaseRow | undefined, headline: { value: Value | null; previous: Value | null; forecast: Value | null }, lang: Lang): FigureRow[] {
  const key = indicatorKey(row.id), spec = INDICATORS[key];
  if (!spec || !headline.value) return [];
  const rows: FigureRow[] = [{ key: "headline", label: (HEADLINE_LABEL[key] ?? spec.label)[lang], now: formatValue(row.id, headline.value, lang),
    previous: headline.previous ? formatValue(row.id, headline.previous, lang) : null, forecast: headline.forecast ? formatValue(row.id, headline.forecast, lang) : null,
    change: headline.previous ? figureChange(spec.unit, headline.value, headline.previous, lang) : null }];
  const before = previousRow ? textOf(previousRow) : null;
  for (const figure of FIGURES[key] ?? []) {
    const read = figure.read(textOf(row));
    if (!read) continue;
    // A stated change gives the previous figure as the release states it; otherwise the previous release's own figure.
    const previous = read.stated !== null ? { value: read.value.value - read.stated, decimals: read.value.decimals } : before ? figure.read(before)?.value ?? null : null;
    rows.push({ key: figure.key, label: figure.label[lang], now: formatFigure(figure.unit, read.value, lang), previous: previous ? formatFigure(figure.unit, previous, lang) : null,
      forecast: null, change: previous ? figureChange(figure.unit, read.value, previous, lang) : null });
  }
  return rows;
}
/** The stated figures the table already shows, so they are not listed again under it. */
function tableFacts(row: ReleaseRow, table: FigureRow[]) {
  const shown = new Set(table.map(item => item.key));
  return (FIGURES[indicatorKey(row.id)] ?? []).filter(figure => shown.has(figure.key)).map(figure => figure.fact);
}

export type ReleaseView = {
  key: string; known: boolean; unit: Unit | null; summary: string; value: Value | null; display: string | null; label: string | null;
  previous: { row: ReleaseRow; value: Value; display: string; revised?: boolean } | null; change: string | null;
  forecast: { value: Value; display: string; vs: Comparison } | null;
  history: { id: string; label: string | null; releasedAt: string; display: string; value: number; current: boolean }[];
  facts: string[]; about: string | null; next: Scheduled | null; link: { url: string; name: string; official: boolean } | null;
  /** 今回 / 前回 / 予想 / 変化 per figure (owner, Nov 27); empty when the headline number cannot be read. */
  table: FigureRow[];
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

export function releaseView(row: ReleaseRow, all: ReleaseRow[], expectations: Expectation[], schedule: Scheduled[], now: number, lang: Lang): ReleaseView {
  const key = indicatorKey(row.id), spec = INDICATORS[key];
  const value = readValue(row.id, row.result);
  const at = Date.parse(row.releasedAt);
  const sameIndicator = spec ? all.filter(other => indicatorKey(other.id) === key).toSorted((a, b) => Date.parse(a.releasedAt) - Date.parse(b.releasedAt)) : [];
  const earlier = sameIndicator.filter(other => Date.parse(other.releasedAt) < at);
  const revised = revisedPrevious(row, value);
  const previousRow = revised ? row : earlier.toReversed().find(other => readValue(other.id, other.result));
  const previousValue = revised ?? (previousRow ? readValue(previousRow.id, previousRow.result) : null);
  const expected = expectations.find(item => item.id === `expected-${row.id}`);
  const forecastValue = expected && spec ? readValue(row.id, { ja: expected.resultJa, en: expected.resultEn }) : null;
  const history = value ? [...earlier, row].map(item => ({ item, v: readValue(item.id, item.result) })).filter(entry => entry.v).slice(-6)
    .map(({ item, v }) => ({ id: item.id, label: periodLabel(item.title, lang), releasedAt: item.releasedAt, display: formatValue(item.id, v!, lang), value: v!.value, current: item.id === row.id })) : [];
  const latest = sameIndicator.at(-1)?.id === row.id;
  const next = spec && latest ? schedule.filter(item => indicatorKey(item.id) === key && Date.parse(item.at) > Math.max(now, at)).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null : null;
  const summaryText = cleanResult(row.result[lang]);
  const summary = spec ? summaryText : summaryText.split(/｜| \| /)[0].trim();
  // A row we have no spec for (an election) keeps the rest of its result as one line; known indicators list their stated extra figures.
  const facts = [...(spec ? extraFacts(row.result[lang], lang) : summaryText.split(/｜| \| /).slice(1).map(part => part.trim())), ...factSentences(row.detail[lang], lang)];
  let link: ReleaseView["link"] = null;
  const host = (() => { try { return new URL(row.sourceUrl).hostname; } catch { return ""; } })();
  if (spec) link = spec.official.host.test(host) ? { url: row.sourceUrl, name: spec.official.name[lang], official: true } : { url: spec.official.url, name: spec.official.name[lang], official: true };
  else if (host && !/(^|\.)(news\.google\.com|x\.com|twitter\.com)$/.test(host)) link = { url: row.sourceUrl, name: host.replace(/^www\./, ""), official: false };
  const table = figureTable(row, earlier.toReversed().find(other => readValue(other.id, other.result)), { value, previous: previousValue, forecast: value ? forecastValue : null }, lang);
  const consumed = tableFacts(row, table);
  const allFacts = [...new Set(facts)].filter(fact => !consumed.some(pattern => pattern.test(fact.replace(/。$/, "").trim())));
  const shownHistory = history.length >= 3 ? history : [];
  return {
    key, known: !!spec, unit: spec?.unit ?? null, summary, value, display: value ? formatValue(row.id, value, lang) : null, label: spec ? spec.label[lang] : null,
    previous: previousRow && previousValue ? { row: previousRow, value: previousValue, display: formatValue(previousRow.id, previousValue, lang), ...(revised ? { revised: true } : {}) } : null,
    change: value && previousValue ? describeChange(row.id, value, previousValue, lang) : null,
    forecast: value && forecastValue ? { value: forecastValue, display: formatValue(row.id, forecastValue, lang), vs: compare(value, forecastValue) } : null,
    history: shownHistory, facts: allFacts, table, about: spec ? spec.about[lang] : null, next, link,
    expandable: !!(value || allFacts.length || spec || shownHistory.length || next),
  };
}
