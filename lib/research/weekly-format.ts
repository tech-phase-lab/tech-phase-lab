/** Display helpers for 週刊 Tech Phase PRO number cards. Pure, so the badge rule is tested without a browser. */
export type WeeklyCard = { label: string; value: number | null; outlook: number | null; previous: number | null; unit: string; outlookUnit: string; range: string; delta: "pct" | "pt" | null };
export type Badge = { text: string; tone: "up" | "down" | "flat"; caption: string };

const trim = (value: number, digits: number) => value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
/** 542.29 → "542.29", 1234567 → "1,234,567". Never more than two decimals. */
export function formatNumber(value: number): string {
  const [whole, fraction] = trim(value, 2).split(".");
  return `${Number(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`.replace(/^-0(?=\.|$)/, "0");
}
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "−" : "");

/** The change badge: next-quarter outlook against this time's value; if there is no outlook, this time against the previous one.
 * Points (pt) when the figures are percentages (unit "%" or delta "pt"); percent otherwise. null when nothing can be compared. */
export function cardBadge(card: WeeklyCard, lang: "ja" | "en" = "ja"): Badge | null {
  const to = card.value !== null && card.outlook !== null ? card.outlook : card.value !== null && card.previous !== null ? card.value : null;
  const from = card.value !== null && card.outlook !== null ? card.value : card.value !== null && card.previous !== null ? card.previous : null;
  if (to === null || from === null) return null;
  const outlook = card.value !== null && card.outlook !== null;
  const caption = lang === "ja" ? (outlook ? "見通し" : "前回比") : (outlook ? "Outlook" : "vs. previous");
  const points = card.delta === "pt" || (card.delta !== "pct" && card.unit.trim() === "%");
  let amount: number;
  if (points) amount = to - from;
  else { if (from === 0) return null; amount = ((to - from) / Math.abs(from)) * 100; }
  const rounded = Math.round(Math.abs(amount) * (points ? 100 : 10)) / (points ? 100 : 10);
  if (rounded === 0) return { text: points ? "0pt" : "0.0%", tone: "flat", caption };
  const body = points ? `${trim(rounded, 2)}pt` : `${rounded.toFixed(1)}%`;
  return { text: `${sign(amount)}${body}`, tone: amount > 0 ? "up" : "down", caption };
}
/** Bar heights as 0–100 (from zero, never from the smallest bar). */
export function barHeights(values: number[]): number[] {
  const top = Math.max(0, ...values);
  return values.map(value => (top > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / top) * 100)) : 0));
}
const WEEK = ["日", "月", "火", "水", "木", "金", "土"], WEEK_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MONTH = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "2026-10-02" → { month: "OCT", day: "2", weekday: "金" } (the date is a calendar date, so no time zone shift). */
export function scheduleDate(iso: string, lang: "ja" | "en" = "ja") {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return { month: MONTH[month - 1] ?? "", day: String(day), weekday: (lang === "ja" ? WEEK : WEEK_EN)[date.getUTCDay()] };
}
/** "2026-10-01" → "10/01" */
export const shortDate = (iso: string) => iso.slice(5).replace("-", "/");

/** The owner's review memo of a weekly draft. The generator writes each line as "【tag】text〔code〕" (scripts/research/weekly_generator.py, `note`);
 * lines saved before that format are sorted by their old wording. Pure, so the grouping is tested without a browser. */
export type NoteKind = "attention" | "substituted" | "missing" | "omitted";
export type MemoLine = { kind: NoteKind; text: string; code: string };
const TAGS: Record<string, NoteKind> = { 要確認: "attention", 定型文: "substituted", 取得なし: "missing", AI省略: "omitted" };
export const NOTE_TITLES: Record<NoteKind, string> = { attention: "要確認(外した部分)", substituted: "定型文に差し替えた箇所", missing: "集まらなかった材料", omitted: "AIが載せなかった話題" };
const NOTE_ORDER: NoteKind[] = ["attention", "substituted", "missing", "omitted"];

export function parseNote(raw: string): MemoLine {
  const tagged = /^【([^】]+)】([\s\S]*)$/.exec(raw);
  const body = tagged ? tagged[2] : raw;
  const coded = /^([\s\S]*?)〔([^〕]+)〕\s*$/.exec(body);
  const text = (coded ? coded[1] : body).trim(), code = coded ? coded[2] : "";
  if (tagged && TAGS[tagged[1]]) return { kind: TAGS[tagged[1]], text, code };
  // Old drafts (before the tags): sorted by what they said.
  const legacy = /（([a-z][a-z-]+)）$/.exec(text);
  if (/定型文/.test(text)) return { kind: "substituted", text: legacy ? text.replace(legacy[0], "") : text, code: legacy ? legacy[1] : "" };
  if (/^数字が食い違った/.test(text)) return { kind: "attention", text, code: "" };
  if (/見送りました|記載していません|掲載していません/.test(text)) return { kind: "omitted", text, code: "" };
  return { kind: "missing", text: text.replace(/^ここは取れませんでした[:：]\s*/, "取れませんでした: "), code: "" };
}

export type Memo = { groups: { kind: NoteKind; title: string; lines: MemoLine[] }[]; counts: Record<NoteKind, number>; total: number;
  /** The headline and the lead that were replaced by the fixed sentence (shown as a small mark on the draft). */ substituted: { headline: boolean; lead: boolean }; summary: string };

export function groupNotes(notes: readonly string[] | undefined): Memo {
  const lines = (notes ?? []).map(parseNote);
  const counts = { attention: 0, substituted: 0, missing: 0, omitted: 0 } as Record<NoteKind, number>;
  for (const line of lines) counts[line.kind] += 1;
  const groups = NOTE_ORDER.filter(kind => counts[kind] > 0).map(kind => ({ kind, title: NOTE_TITLES[kind], lines: lines.filter(line => line.kind === kind) }));
  const replaced = lines.filter(line => line.kind === "substituted");
  const substituted = { headline: replaced.some(line => /^見出し/.test(line.text)), lead: replaced.some(line => /^導入文/.test(line.text)) };
  const todo = counts.attention + counts.substituted;
  const summary = lines.length === 0 ? "確認メモはありません。" : todo === 0 ? `確認メモ ${lines.length}件(要対応はありません)` : `要対応 ${todo}件(確認メモ 計${lines.length}件)`;
  return { groups, counts, total: lines.length, substituted, summary };
}
