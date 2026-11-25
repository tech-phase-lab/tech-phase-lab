// RESOLUTE「今日のお知らせ」(/resolute/alerts/latest)。③の通知を押すと開く画面で、中身はアラートメールの本文と同じ(オーナー 2026-11-17)。
// データは、その人に受け付け済み(accepted_at あり)の最新の③1件だけ。銘柄・終値・基準からの%・届いたラインのみで、計画の回答や自由記述は含めない。
import { formatDate } from "./mail-templates.ts";
import { DISCLAIMER } from "../legal/disclaimer.ts";
import { formatMoney, type RuleFacts } from "./plan-rules.ts";

export type LatestAlertItem = {
  kind: "line_reached" | "surge_cap"; symbol: string; close: number;
  dropPct?: number; risePct?: number; newLines?: number[];
};
export type LatestAlert = { date: string; items: LatestAlertItem[] };
export type LatestAlertSnapshot = { alert: LatestAlert | null };

const SYMBOL = /^[A-Z][A-Z0-9.-]{0,14}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const finite = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Known fields only, checked strictly; anything else makes the whole answer invalid. */
export function parseLatestAlert(value: unknown): LatestAlertSnapshot {
  if (!value || typeof value !== "object" || Object.keys(value).join() !== "alert") throw new Error("Invalid latest alert");
  const alert = (value as { alert: unknown }).alert;
  if (alert === null) return { alert: null };
  const a = alert as { date?: unknown; items?: unknown };
  if (!a || typeof a !== "object" || typeof a.date !== "string" || !DATE.test(a.date) || !Array.isArray(a.items) || !a.items.length || a.items.length > 5) {
    throw new Error("Invalid latest alert");
  }
  const items = a.items.map((raw): LatestAlertItem => {
    const i = raw as Record<string, unknown>;
    if (!i || typeof i !== "object" || (i.kind !== "line_reached" && i.kind !== "surge_cap") || typeof i.symbol !== "string" || !SYMBOL.test(i.symbol)
      || !finite(i.close, 0.01, 1_000_000)) throw new Error("Invalid latest alert");
    if (i.kind === "line_reached") {
      const lines = i.newLines;
      if (!finite(i.dropPct, 0, 100) || !Array.isArray(lines) || !lines.length || lines.length > 10 || !lines.every(l => finite(l, 0.1, 100))) throw new Error("Invalid latest alert");
      return { kind: "line_reached", symbol: i.symbol, close: i.close, dropPct: i.dropPct, newLines: [...lines] as number[] };
    }
    if (!finite(i.risePct, 0, 100_000)) throw new Error("Invalid latest alert");
    return { kind: "surge_cap", symbol: i.symbol, close: i.close, risePct: i.risePct };
  });
  return { alert: { date: a.date, items } };
}

/** The outbox digest (alert-judge's payload) reduced to what the page shows. */
export function latestAlertFromDigest(digest: unknown): LatestAlert | null {
  const d = digest as { date?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.items)) return null;
  try {
    return parseLatestAlert({ alert: { date: d.date, items: d.items.map((e) => {
      const i = e as Record<string, unknown>;
      return i?.kind === "line_reached" ? { kind: i.kind, symbol: i.symbol, close: i.close, dropPct: i.dropPct, newLines: i.newLines }
        : { kind: i?.kind, symbol: i?.symbol, close: i?.close, risePct: i?.risePct };
    }) } }).alert;
  } catch { return null; }
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** What the page knows besides the alert: the member's rules and saved reference prices (both optional). */
export type LatestAlertContext = { rules?: RuleFacts | null; references?: Record<string, number> };

/** The page's words, as in screens 02_alert_page_*. `date`, `notes` and `check` are the alert email's sentences
 * (mail-templates.ts renderAlertMail), still used by the LP sample. The page itself shows `lead`, the cards with the member's
 * own rule and 「今日やること」 instead (owner, Nov 25: the two 「あなたの計画では…」 sentences are removed from the page). */
export function latestAlertView(alert: LatestAlert, locale: "ja" | "en", context: LatestAlertContext = {}) {
  const ja = locale === "ja";
  const hasLine = alert.items.some(i => i.kind === "line_reached");
  const hasSurge = alert.items.some(i => i.kind === "surge_cap");
  const notes: string[] = [];
  if (hasLine) notes.push(ja ? "あなたの計画では 下落のラインは決めておいたルールを見直す合図です" : "In your plan, a drop to this level is your cue to pause and reread the rules you wrote for yourself.");
  if (hasSurge) notes.push(ja ? "あなたの計画では 上昇の目安は持ち分の偏りを確認する合図です" : "In your plan, reaching a rise alert level is your cue to check whether one holding has grown too big.");
  const rules = context.rules ?? null;
  const cards = alert.items.map(i => {
    const line = i.kind === "line_reached" ? Math.max(...(i.newLines ?? [0])) : 0;
    const pct = i.kind === "line_reached" ? -(i.dropPct ?? 0) : (i.risePct ?? 0);
    const reference = context.references?.[i.symbol];
    // The saved reference price is shown only when it is the one this alert was measured from.
    const base = typeof reference === "number" && reference > 0 && Math.abs((i.close / reference - 1) * 100 - pct) < 0.15 ? usd(reference).replace(/\.00$/, "") : null;
    const signed = `${pct < 0 ? "−" : "+"}${Math.abs(pct)}%`;
    const change = base ? (ja ? `基準 ${base} から ${signed}` : `${signed} from ${base}`) : (ja ? `基準から ${signed}` : `${signed} from your reference price`);
    return i.kind === "line_reached"
      ? { symbol: i.symbol, chip: `-${line}%`, rise: false, price: usd(i.close), change, label: ja ? `−${line}% のライン` : `−${line}% level`,
          text: ja ? `終値 ${usd(i.close)}(基準から -${i.dropPct}%)` : `Closed at ${usd(i.close)}, down ${i.dropPct}% from your reference price`,
          rule: rules ? buyRule(rules, line, ja) : null }
      : { symbol: i.symbol, chip: ja ? "上昇の目安" : "Rise level", rise: true, price: usd(i.close), change, label: ja ? "上昇の目安" : "Rise level",
          text: ja ? `終値 ${usd(i.close)}(基準から +${i.risePct}%)` : `Closed at ${usd(i.close)}, up ${i.risePct}% from your reference price`,
          rule: rules ? capRule(rules, ja) : null };
  });
  return {
    eyebrow: "RESOLUTE",
    title: ja ? "今日のお知らせ" : "Today's alert",
    date: ja ? `${formatDate(alert.date, "ja")}(米国市場)の終値` : `Closing prices on ${formatDate(alert.date, "en")} (US market)`,
    lead: ja ? `${formatDate(alert.date, "ja")}（米国市場）の終値で、あなたのラインに届いた銘柄です。` : `These stocks reached your levels at the ${formatDate(alert.date, "en")} close (US market).`,
    rulesLabel: ja ? "あなたのルール" : "Your rule",
    todoLabel: ja ? "今日やること" : "What to do today",
    notes, cards, todo: todayTodo(alert, rules, locale),
    check: ja ? `計画に書いた買い増し額と買わない条件を確認してください${hasSurge ? "。上昇時は1銘柄の上限も確認できます" : ""}`
      : `Check your planned purchase amounts and conditions for not buying.${hasSurge ? " After a rise, check your single-stock cap too." : ""}`,
    openPlan: ja ? "計画を開く" : "Open your plan",
    openBook: ja ? "一冊を開く" : "Open your rulebook",
    tonight: ja ? "今夜のひと息" : "A moment to breathe",
    disclaimer: ja ? DISCLAIMER.ja : DISCLAIMER.en,
  };
}

const money = (rules: RuleFacts, minor: number, ja: boolean) => formatMoney(minor / rules.scale, rules.currency, !ja);
/** 「買い増し　10%下がったら30万円」: the member's purchase at the line reached (the deepest new one). */
function buyRule(rules: RuleFacts, line: number, ja: boolean): string {
  const at = rules.buyLines.find(l => Math.abs(l.dropPct - line) < 1e-9);
  if (!at) return ja ? `買い増しライン　−${line}%` : `Purchase level: −${line}%`;
  return ja ? `買い増し　${line}%下がったら${money(rules, at.amount, ja)}` : `Buy more: ${money(rules, at.amount, ja)} at −${line}%`;
}
/** 「1銘柄の上限　30万円　持ち分の偏りを確かめる」 */
function capRule(rules: RuleFacts, ja: boolean): string {
  const cap = rules.capAmount === null ? (ja ? `投資額の${rules.perStockCapPct}%` : `${rules.perStockCapPct}% of your investments`) : money(rules, rules.capAmount, ja);
  return ja ? `1銘柄の上限　${cap}　持ち分の偏りを確かめる` : `Single-stock cap: ${cap}. Check your balance.`;
}

/** 「今日やること」. Fixed sentences built from the lines reached and the member's own rules. The AI-written version
 * (resolute-pc-1125 sheet, item 4) is not built yet, so this is what every day shows for now. Only the member's own rule, never advice. */
export function todayTodo(alert: LatestAlert, rules: RuleFacts | null, locale: "ja" | "en"): { title: string; sentences: string[] } {
  const ja = locale === "ja";
  const drops = alert.items.filter(i => i.kind === "line_reached").map(i => ({ symbol: i.symbol, line: Math.max(...(i.newLines ?? [0])) }));
  const rises = alert.items.filter(i => i.kind === "surge_cap").map(i => i.symbol);
  const list = (names: string[]) => names.join(ja ? "・" : ", ");
  const sentences: string[] = [];
  if (drops.length === 1) {
    const [d] = drops;
    sentences.push(ja ? `${d.symbol}が決めておいた−${d.line}%のラインに届きました。` : `${d.symbol} reached the −${d.line}% level you set.`);
    const at = rules?.buyLines.find(l => Math.abs(l.dropPct - d.line) < 1e-9);
    if (rules && at) sentences.push(ja ? `ルールどおりなら${money(rules, at.amount, ja)}を買い足す段階です。` : `Your rule at this level is to buy ${money(rules, at.amount, ja)} more.`);
  } else if (drops.length > 1) {
    sentences.push(ja ? `${drops.map(d => `${d.symbol}（−${d.line}%）`).join("と")}が決めておいたラインに届きました。` : `${list(drops.map(d => `${d.symbol} (−${d.line}%)`))} reached the levels you set.`);
    if (rules) sentences.push(ja ? "ルールどおりなら、それぞれのラインの金額を買い足す段階です。" : "Your rules set the amount to buy at each level.");
  }
  if (rises.length && drops.length) sentences.push(ja ? `${list(rises)}は上がりすぎていないか、1銘柄の上限と比べてください。` : `Check that ${list(rises)} has not risen past your single-stock cap.`);
  if (rises.length && !drops.length) sentences.push(ja ? `${list(rises)}が上昇の目安に届きました。` : `${list(rises)} reached your rise level.`,
    ja ? "上がりすぎていないか、1銘柄の上限と比べてください。" : "Check it against your single-stock cap.");
  return { title: drops.length ? (ja ? "決めていた買い増しの日" : "A day you planned for") : (ja ? "持ち分を確かめる日" : "A day to check your balance"), sentences };
}

/** Vercel → resolute-api (same service credential and session JWT as the notification settings). */
export async function fetchLatestAlert(token: string, base: string | undefined, secret: string | undefined, fetcher: typeof fetch = fetch) {
  if (!base || !secret || secret.length < 43 || !token || token.length > 16384) throw new Error("Unavailable");
  const url = new URL(base);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !url.hostname.endsWith(".up.railway.app")) throw new Error("Unavailable");
  url.pathname = "/internal/v1/latest-alert";
  const response = await fetcher(url, { method: "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${token}`, "X-Resolute-Service-Token": secret, Accept: "application/json" } });
  if (response.status === 200) {
    const text = await response.text();
    if (text.length > 8192) throw new Error("Unavailable");
    return { status: 200, body: parseLatestAlert(JSON.parse(text)) };
  }
  await response.body?.cancel();
  if ([401, 403, 429].includes(response.status)) return { status: response.status, body: { error: response.status === 401 ? "AUTH_REQUIRED" : response.status === 403 ? "ACCESS_DENIED" : "RATE_LIMITED" } };
  throw new Error("Unavailable");
}
