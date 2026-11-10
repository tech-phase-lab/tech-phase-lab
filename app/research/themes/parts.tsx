"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import type { GroupFilter } from "@/lib/research/theme-definitions";
import { PERIODS, type Period, type StockReturns } from "@/lib/research/theme-ranking";
import styles from "./themes.module.css";

export type ThemeData = { stocks: StockReturns[]; asOf: string; fetchedAt: number; marketOpen: boolean; validUntil: number };
export type DataState = "loading" | "ready" | "not-connected" | "error";

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

/** One genre's (or all genres') per-stock returns, from the server. `plan` gates the request: only PRO asks. */
export function useThemeData(group: GroupFilter, plan: string | null, enabled = true) {
  const [state, setState] = useState<DataState>("loading");
  const [data, setData] = useState<ThemeData | null>(null);
  useEffect(() => {
    if (plan !== "pro" || !enabled) { setData(null); return; }
    const controller = new AbortController();
    setState("loading");
    (async () => {
      try {
        const response = await fetch(`/api/research/themes?group=${group}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(55_000)]) });
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { setData(null); window.dispatchEvent(new Event("tech-phase:membership-changed")); return; }
        if (body?.error === "not-connected") { setState("not-connected"); return; }
        if (!response.ok || !body.ok || !Array.isArray(body.stocks)) throw Error();
        setData({ stocks: body.stocks, asOf: body.asOf, fetchedAt: Number(body.fetchedAt) || 0, marketOpen: body.marketOpen === true, validUntil: body.validUntil });
        setState("ready");
      } catch { if (!controller.signal.aborted) setState("error"); }
    })();
    return () => controller.abort();
  }, [plan, group, enabled]);
  // The access window can close while the page is open: drop the numbers then.
  useEffect(() => {
    if (!data?.validUntil) return;
    const timer = setTimeout(() => setData(null), Math.max(0, Math.min(data.validUntil - Date.now(), 2147483647)));
    return () => clearTimeout(timer);
  }, [data]);
  return { state, data };
}

export function PeriodPills({ period, onChange, ja }: { period: Period; onChange: (period: Period) => void; ja: boolean }) {
  return <div className={styles.periods} role="group" aria-label={ja ? "期間" : "Period"}>
    {PERIODS.map(key => <button key={key} type="button" aria-pressed={key === period} onClick={() => onChange(key)}>{periodLabel(key, ja)}</button>)}
  </div>;
}

export type ChartRow = { id: string; rank?: number; value: number; href: string; name: ReactNode; tag?: string; sub?: ReactNode };

/** The up/down comparison chart (owner, Nov 10): one list, strongest first; 0 in the middle, rises to the right in green, falls to the left in
 * red. A bar is |value| / the largest |value| shown, up to 48% of the width from the centre. 0% and above count as rising. */
export function DivergingChart({ rows, ja, mono = false }: { rows: ChartRow[]; ja: boolean; mono?: boolean }) {
  const widest = Math.max(1e-9, ...rows.map(row => Math.abs(row.value)));
  const falling = rows.filter(row => shown(row.value) < 0).length;
  return <section className={styles.chart} aria-label={ja ? "騰落率の比較" : "Performance comparison"}>
    <div className={styles.scale}><span className={styles.scaleDown}>← {ja ? "下落" : "Down"} {falling}</span><span className={styles.scaleZero}>0</span><span className={styles.scaleUp}>{ja ? "上昇" : "Up"} {rows.length - falling} →</span></div>
    <ol>{rows.map(row => <li key={row.id}>
      <Link href={row.href} className={styles.row}>
        {row.rank !== undefined && <span className={`${styles.rankDot} ${row.rank === 1 ? styles.rankGold : ""}`}>{row.rank}</span>}
        <span className={`${styles.who} ${row.rank === undefined ? styles.whoWide : ""}`}><strong className={mono ? styles.ticker : undefined}>{row.name}</strong>{row.sub && <span className={styles.sub}>{row.sub}</span>}{row.tag && <em className={styles.tag}>{row.tag}</em>}</span>
        <span className={`${styles.figure} ${toneClass(row.value)}`}><i aria-hidden="true">{arrow(row.value)}</i>{signed(row.value)}</span>
        <span className={styles.track} aria-hidden="true"><i className={styles.mid} />
          <b className={`${styles.bar} ${shown(row.value) < 0 ? styles.barDown : styles.barUp}`} style={{ width: `${Math.abs(row.value) / widest * 48}%` }} /></span>
      </Link>
    </li>)}</ol>
  </section>;
}

/** Clock in Japan time for the note under the chart: "更新 23:19 JST · 米国市場 取引中 / 休場中". */
export function updateNote(data: ThemeData, ja: boolean) {
  const time = new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: ja ? "Asia/Tokyo" : "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false }).format(data.fetchedAt || Date.now());
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
