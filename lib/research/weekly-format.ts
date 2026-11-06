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
