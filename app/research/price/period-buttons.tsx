"use client";
import { useEffect, useRef, useState } from "react";
import { PERIOD_LABEL, PRIMARY_PERIODS, type BoardPeriod } from "@/lib/research/market-board-periods";
import styles from "./period-buttons.module.css";

/** A stock page's periods (owner, Nov 13): the market board's buttons and candles, plus year to date in "More" (this page only). */
export type DetailPeriod = BoardPeriod | "ytd";
export const DETAIL_DEFAULT_PERIOD: DetailPeriod = "15m";
export const DETAIL_OTHER_PERIODS: readonly DetailPeriod[] = ["1h", "3h", "1w", "ytd", "5y"];
export const detailPeriodName = (period: DetailPeriod, ja: boolean) => period === "ytd" ? (ja ? "年初来" : "YTD") : PERIOD_LABEL[period][ja ? "ja" : "en"];

/** Seven buttons spread evenly across the width; "More" opens a menu above itself, and a period chosen there takes its place. */
export default function PeriodButtons({ period, onChange, ja }: { period: DetailPeriod; onChange: (period: DetailPeriod) => void; ja: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chosen = DETAIL_OTHER_PERIODS.includes(period);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key); };
  }, [open]);
  return <div ref={box} className={styles.row} role="group" aria-label={ja ? "チャートの期間" : "Chart range"}>
    {PRIMARY_PERIODS.map(p => <button key={p} type="button" className={styles.button} aria-pressed={period === p} onClick={() => { setOpen(false); onChange(p); }}>{detailPeriodName(p, ja)}</button>)}
    <button type="button" className={styles.button} aria-pressed={chosen} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
      {chosen ? detailPeriodName(period, ja) : ja ? "その他" : "More"}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={open || chosen ? "M2 6.5l3-3 3 3" : "M2 3.5l3 3 3-3"} /></svg>
    </button>
    {open && <div className={styles.menu} role="menu" aria-label={ja ? "その他の期間" : "More ranges"}>
      {DETAIL_OTHER_PERIODS.map(p => <button key={p} type="button" role="menuitemradio" aria-checked={period === p} className={styles.item} onClick={() => { setOpen(false); onChange(p); }}>
        {detailPeriodName(p, ja)}
        {period === p && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8fe3c0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7" /></svg>}
      </button>)}
    </div>}
  </div>;
}
