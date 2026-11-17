// RESOLUTE「今日のお知らせ」(/resolute/alerts/latest)。③の通知を押すと開く画面で、中身はアラートメールの本文と同じ(オーナー 2026-11-17)。
// データは、その人に受け付け済み(accepted_at あり)の最新の③1件だけ。銘柄・終値・基準からの%・届いたラインのみで、計画の回答や自由記述は含めない。
import { formatDate } from "./mail-templates.ts";

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

/** The page's words, the same sentences as the alert email (mail-templates.ts renderAlertMail), as in screens 02_alert_page_*. */
export function latestAlertView(alert: LatestAlert, locale: "ja" | "en") {
  const ja = locale === "ja";
  const hasLine = alert.items.some(i => i.kind === "line_reached");
  const hasSurge = alert.items.some(i => i.kind === "surge_cap");
  const notes: string[] = [];
  if (hasLine) notes.push(ja ? "あなたの計画では 下落のラインは決めておいたルールを見直す合図です" : "In your plan, a drop to this level is your cue to pause and reread the rules you wrote for yourself.");
  if (hasSurge) notes.push(ja ? "あなたの計画では 上昇の目安は持ち分の偏りを確認する合図です" : "In your plan, reaching a rise alert level is your cue to check whether one holding has grown too big.");
  const cards = alert.items.map(i => i.kind === "line_reached"
    ? { symbol: i.symbol, chip: `-${Math.max(...(i.newLines ?? [0]))}%`, rise: false,
        text: ja ? `終値 ${usd(i.close)}(基準から -${i.dropPct}%)` : `Closed at ${usd(i.close)}, down ${i.dropPct}% from your reference price` }
    : { symbol: i.symbol, chip: ja ? "上昇の目安" : "Rise level", rise: true,
        text: ja ? `終値 ${usd(i.close)}(基準から +${i.risePct}%)` : `Closed at ${usd(i.close)}, up ${i.risePct}% from your reference price` });
  return {
    eyebrow: "RESOLUTE",
    title: ja ? "今日のお知らせ" : "Today's alert",
    date: ja ? `${formatDate(alert.date, "ja")}(米国市場)の終値` : `Closing prices on ${formatDate(alert.date, "en")} (US market)`,
    notes, cards,
    check: ja ? `計画に書いた買い増し額と買わない条件を確認してください${hasSurge ? "。上昇時は1銘柄の上限も確認できます" : ""}`
      : `Check your planned purchase amounts and conditions for not buying.${hasSurge ? " After a rise, check your single-stock cap too." : ""}`,
    openPlan: ja ? "計画を開く" : "Open your plan",
    tonight: ja ? "今夜のひと息" : "A moment to breathe",
    disclaimer: ja ? "情報の提供であり、投資助言ではありません。" : "It's information only, not investment advice.",
  };
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
