"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import type { GroupFilter } from "@/lib/research/theme-definitions";
import { PERIODS, type Period, type StockReturns } from "@/lib/research/theme-ranking";
import { formatDisplay } from "@/lib/research/display-time";
import { THEME_REQUEST_MS, fetchThemeData } from "@/lib/research/theme-fetch";
import { useIdentityRefresh } from "../identity-provider";
import styles from "./themes.module.css";

export type ThemeData = { stocks: StockReturns[]; asOf: string; fetchedAt: number; marketOpen: boolean; validUntil: number };
export type DataState = "loading" | "ready" | "not-connected" | "error" | "sign-in" | "pro-required";

/** "−" (a true minus) and a fixed one decimal, as in the design (+6.8%, −1.2%). */
/** What the screen shows is the value rounded to one decimal, so a tiny fall such as −0.04 reads (and counts) as 0.0%, never "−0.0%". */
export const shown = (value: number) => Math.round(value * 10) / 10 || 0;
export const signed = (value: number) => { const v = shown(value); return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`; };
export const toneClass = (value: number) => shown(value) > 0 ? styles.up : shown(value) < 0 ? styles.down : styles.flat;
export const arrow = (value: number) => shown(value) > 0 ? "▲" : shown(value) < 0 ? "▼" : "";

export const periodLabel = (period: Period, ja: boolean): string => ({
  "1d": ja ? "1日" : "1D", "1w": ja ? "1週間" : "1W", "1m": ja ? "1ヵ月" : "1M", "3m": ja ? "3ヵ月" : "3M",
  "6m": ja ? "6ヵ月" : "6M", "ytd": ja ? "年初来" : "YTD", "1y": ja ? "1年" : "1Y",
} as const)[period];

const PERIOD_KEY = "tech-phase:theme-period";
const PERIOD_EVENT = "tech-phase:theme-period-changed";
const readPeriod = (): Period => {
  try { const saved = sessionStorage.getItem(PERIOD_KEY); if (saved && (PERIODS as readonly string[]).includes(saved)) return saved as Period; } catch { /* storage may be blocked */ }
  return "1d";
};
const subscribePeriod = (notify: () => void) => { window.addEventListener(PERIOD_EVENT, notify); return () => window.removeEventListener(PERIOD_EVENT, notify); };
/** The chosen period is kept for the whole visit, so the detail screen opens on the same one (owner, Nov 10). */
export function usePeriod(): [Period, (period: Period) => void] {
  const period = useSyncExternalStore(subscribePeriod, readPeriod, () => "1d" as Period);
  const choose = useCallback((next: Period) => { try { sessionStorage.setItem(PERIOD_KEY, next); } catch { /* storage may be blocked */ } window.dispatchEvent(new Event(PERIOD_EVENT)); }, []);
  return [period, choose];
}

/** One genre's (or all genres') per-stock returns, from the server. `plan` gates the request: only PRO asks.
 * Every request ends in data, "not connected", a refusal or an error, each with something on screen: it never stays on loading
 * (owner, Nov 18). A refusal used to leave "loading" up and wait for the membership display to change, which it often did not
 * (stuck), or which flipped back to PRO and asked again (an endless loop). `retry` asks again. */
export function useThemeData(group: GroupFilter, plan: string | null, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  // The answer for one genre and attempt; anything else (another genre, a retry, not PRO) reads as loading until its own answer comes.
  const key = `${group}|${attempt}`;
  const [result, setResult] = useState<{ key: string; state: DataState; data: ThemeData | null } | null>(null);
  const refreshIdentity = useIdentityRefresh();
  // Held in a ref: the session helper changes identity while the sign-in SDK starts, which must not restart a request in flight.
  const refresh = useRef(refreshIdentity);
  useEffect(() => { refresh.current = refreshIdentity; }, [refreshIdentity]);
  // A refusal asks the membership display to check again only once per visit (or per retry), so a refusal that persists cannot loop.
  const announced = useRef(false);
  const retry = useCallback(() => { announced.current = false; setAttempt(value => value + 1); }, []);
  useEffect(() => {
    if (plan !== "pro" || !enabled) return;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, THEME_REQUEST_MS);
    fetchThemeData(group, { fetch: (url, init) => fetch(url, init), refresh: force => refresh.current(force), signal: controller.signal }).then(outcome => {
      if (controller.signal.aborted) return;
      if (outcome.kind === "ready") { setResult({ key, state: "ready", data: outcome.data }); return; }
      setResult({ key, state: outcome.kind === "denied" ? outcome.reason : outcome.kind, data: null });
      if (outcome.kind === "denied" && !announced.current) { announced.current = true; window.dispatchEvent(new Event("tech-phase:membership-changed")); }
    }, () => { if (timedOut) setResult({ key, state: "error", data: null }); }).finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [plan, group, enabled, key]);
  const current = plan === "pro" && enabled && result?.key === key ? result : null;
  const data = current?.data ?? null;
  // The access window can close while the page is open: drop the numbers then and ask again (the server decides what is shown next).
  useEffect(() => {
    if (!data?.validUntil) return;
    const timer = setTimeout(() => { setResult(null); setAttempt(value => value + 1); }, Math.max(0, Math.min(data.validUntil - Date.now(), 2147483647)));
    return () => clearTimeout(timer);
  }, [data]);
  return { state: current?.state ?? "loading", data, retry };
}

/** The existing "could not load" message with a button to ask again, whatever stopped the data (owner, Nov 18: never a dead end). */
export function DataProblem({ ja, onRetry }: { state: "error" | "sign-in" | "pro-required"; ja: boolean; onRetry: () => void }) {
  const text = ja ? "データを取得できませんでした。しばらくしてからもう一度お試しください。" : "We couldn't load the data. Please try again in a moment.";
  return <div role="alert" className={styles.note}>
    <p className={styles.problemText}>{text}</p>
    <button type="button" className={styles.retry} onClick={onRetry}>{ja ? "もう一度読み込む" : "Try again"}</button>
  </div>;
}

/** Which day the numbers are as of (owner, Nov 11: "no date, so I can't tell when this is"): the last close, with the period it is measured over. */
export function BasisLine({ data, period, ja }: { data: ThemeData | null; period: Period; ja: boolean }) {
  const m = data?.asOf.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const day = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const label = ja ? `${Number(m[2])}/${Number(m[3])}(${"日月火水木金土"[day.getUTCDay()]})` : day.toLocaleDateString("en-US", { month: "short", day: "numeric", weekday: "short", timeZone: "UTC" });
  const unit = period === "1d" ? (ja ? "前営業日の終値からの騰落" : "change from the previous close") : (ja ? `${periodLabel(period, true)}の騰落` : `${periodLabel(period, false)} change`);
  return <p className={styles.basis}>{ja ? <><b>{label}</b> の終値時点 ・ {unit}</> : <>As of the close on <b>{label}</b> · {unit}</>}</p>;
}

export function PeriodPills({ period, onChange, ja }: { period: Period; onChange: (period: Period) => void; ja: boolean }) {
  return <div className={styles.periods} role="group" aria-label={ja ? "期間" : "Period"}>
    {PERIODS.map(key => <button key={key} type="button" aria-pressed={key === period} onClick={() => onChange(key)}>{periodLabel(key, ja)}</button>)}
  </div>;
}

export type ChartRow = { id: string; rank?: number; value: number; href: string; name: ReactNode; tag?: string; sub?: ReactNode };

/** The up/down comparison chart (owner, Nov 10): one list, strongest first; 0 in the middle, rises to the right in green, falls to the left in
 * red. A bar is |value| / the largest |value| shown, up to 48% of the width from the centre. 0% and above count as rising. */
export function DivergingChart({ rows, ja, mono = false, onSelect }: { rows: ChartRow[]; ja: boolean; mono?: boolean; onSelect?: (id: string) => void }) {
  const widest = Math.max(1e-9, ...rows.map(row => Math.abs(row.value)));
  const falling = rows.filter(row => shown(row.value) < 0).length;
  return <section className={styles.chart} aria-label={ja ? "騰落率の比較" : "Performance comparison"}>
    <div className={styles.scale}><span className={styles.scaleDown}>← {ja ? "下落" : "Down"} {falling}</span><span className={styles.scaleZero}>0</span><span className={styles.scaleUp}>{ja ? "上昇" : "Up"} {rows.length - falling} →</span></div>
    <ol>{rows.map(row => { const content = <>
        {row.rank !== undefined && <span className={`${styles.rankDot} ${row.rank === 1 ? styles.rankGold : ""}`}>{row.rank}</span>}
        <span className={`${styles.who} ${row.rank === undefined ? styles.whoWide : ""}`}><strong className={mono ? styles.ticker : undefined}>{row.name}</strong>{row.sub && <span className={styles.sub}>{row.sub}</span>}{row.tag && <em className={styles.tag}>{row.tag}</em>}</span>
        <span className={`${styles.figure} ${toneClass(row.value)}`}><i aria-hidden="true">{arrow(row.value)}</i>{signed(row.value)}</span>
        <span className={styles.track} aria-hidden="true"><i className={styles.mid} />
          <b className={`${styles.bar} ${shown(row.value) < 0 ? styles.barDown : styles.barUp}`} style={{ width: `${Math.abs(row.value) / widest * 48}%` }} /></span>
      </>;
      // The PRO feature tour's fixed sample passes onSelect: the row then stays on the page (a button) instead of linking to another screen.
      return <li key={row.id}>{onSelect
        ? <button type="button" className={`${styles.row} ${styles.rowButton}`} onClick={() => onSelect(row.id)}>{content}</button>
        : <Link href={row.href} className={styles.row}>{content}</Link>}</li>; })}</ol>
  </section>;
}

/** Clock for the note under the chart, Japan time in Japanese and U.S. Eastern in English: "更新 23:19 JST · 米国市場 取引中 / 休場中". */
export function updateNote(data: ThemeData, ja: boolean) {
  const time = formatDisplay(data.fetchedAt || Date.now(), ja ? "ja" : "en", { hour: "2-digit", minute: "2-digit", hour12: false });
  return ja ? `更新 ${time} JST ・ 米国市場 ${data.marketOpen ? "取引中" : "休場中"}` : `Updated ${time} ET · U.S. market ${data.marketOpen ? "open" : "closed"}`;
}

export function useScrolledToEnd() {
  const [atEnd, setAtEnd] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const check = useCallback(() => {
    const element = ref.current;
    if (element) setAtEnd(element.scrollLeft + element.clientWidth >= element.scrollWidth - 3);
  }, []);
  useEffect(() => { check(); }, [check]);
  return { ref, atEnd, check };
}
