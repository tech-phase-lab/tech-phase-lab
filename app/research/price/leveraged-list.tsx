"use client";
import { useEffect, useState } from "react";
import { startPolling } from "./polling";
import { LEVERAGED_SORTS, leveragedPercent, leveragedPrice, sortLeveraged, type LeveragedRow, type LeveragedSort } from "@/lib/research/leveraged-etfs";
import styles from "./leveraged.module.css";

const SORT_LABEL: Record<LeveragedSort, { ja: string; en: string }> = { gainers: { ja: "上昇率", en: "Gainers" }, losers: { ja: "下落率", en: "Losers" }, volume: { ja: "出来高", en: "Volume" } };
const tone = (value: number | null) => value === null || value === 0 ? styles.flat : value > 0 ? styles.up : styles.down;
const EVERY_MS = 60_000, MISSING_RETRY_MS = 8_000;

/** マーケット「レバETF」(owner, Nov 25; FREE page, so mint and no gold): the long 2x / 3x funds in compact rows. Left: the fund's ticker and its
 * 「2倍」/「3倍」 mark, under it the stock and that stock's day change only. Right: price and day change, under them the pre-market / after-hours
 * price and change with its 「プレ」/「時間外」 mark while that session is under way. Nothing is cut with an ellipsis. */
export default function LeveragedList({ ja }: { ja: boolean }) {
  const [sort, setSort] = useState<LeveragedSort>("gainers");
  const [state, setState] = useState<{ rows: LeveragedRow[] | null; failed: boolean }>({ rows: null, failed: false });
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined, stopped = false;
    const read = async () => {
      clearTimeout(retry);
      try {
        const response = await fetch("/api/research/market/leveraged", { cache: "no-store" }), body = await response.json();
        if (stopped) return;
        if (response.ok && body.ok) {
          setState({ rows: body.rows as LeveragedRow[], failed: false });
          // A first view can find part of the list not read yet (the server reads at most 48 symbols a request): ask once more soon.
          if (body.missing > 0) retry = setTimeout(() => { if (!stopped) void read(); }, MISSING_RETRY_MS);
        } else setState(old => ({ rows: old.rows ?? [], failed: !old.rows?.length }));
      } catch { if (!stopped) setState(old => ({ rows: old.rows ?? [], failed: !old.rows?.length })); }
    };
    const stop = startPolling(read, EVERY_MS);
    return () => { stopped = true; clearTimeout(retry); stop(); };
  }, []);
  const rows = state.rows ? sortLeveraged(state.rows, sort) : null;
  const t = (a: string, b: string) => ja ? a : b;
  return <section className={styles.wrap} aria-label={t("レバレッジETF", "Leveraged ETFs")}>
    <div className={styles.sorts} role="group" aria-label={t("並び替え", "Sort")}>{LEVERAGED_SORTS.map(item =>
      <button key={item} type="button" aria-pressed={sort === item} onClick={() => setSort(item)}>{SORT_LABEL[item][ja ? "ja" : "en"]}</button>)}</div>
    <div className={styles.head} aria-hidden="true"><span>{t("レバETF／元の株", "ETF / underlying")}</span><span>{t("価格", "Price")}</span><span>{t("騰落率", "Change")}</span></div>
    {rows === null ? <p className={styles.note} role="status">{t("読み込み中…", "Loading…")}</p>
      : !rows.length ? <p className={styles.note} role="status">{state.failed ? t("価格を取得できませんでした", "Prices unavailable") : t("読み込み中…", "Loading…")}</p>
      : <ul className={styles.rows}>{rows.map(row => {
        const mark = row.extended ? row.extended.session === "pre" ? t("プレ", "Pre") : t("時間外", "After") : "";
        return <li key={row.etf} className={styles.row}>
          <span className={styles.name}>
            <span className={styles.top}><b className={styles.etf}>{row.etf}</b><span className={styles.badge}>{ja ? `${row.leverage}倍` : `${row.leverage}x`}</span></span>
            <span className={styles.under}>{row.underlying}{row.underlyingChange !== null && <span className={tone(row.underlyingChange)}> {leveragedPercent(row.underlyingChange, 1)}</span>}</span>
          </span>
          <span className={styles.price}><b>{leveragedPrice(row.price)}</b>{row.extended && <small>{leveragedPrice(row.extended.price)}</small>}</span>
          <span className={styles.change}><b className={tone(row.percentChange)}>{row.percentChange === null ? "—" : leveragedPercent(row.percentChange)}</b>
            {row.extended && <small><span className={tone(row.extended.percentChange)}>{leveragedPercent(row.extended.percentChange)}</span><i className={styles.mark}>{mark}</i></small>}</span>
        </li>;
      })}</ul>}
  </section>;
}
