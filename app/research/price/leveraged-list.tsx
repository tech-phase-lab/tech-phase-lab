"use client";
import { useEffect, useState } from "react";
import { startPolling } from "./polling";
import { LEVERAGED_SORTS, LEVERAGED_START, leveragedPercent, leveragedPrice, nextLeveragedView, sortLeveraged, type LeveragedRow, type LeveragedSort } from "@/lib/research/leveraged-etfs";
import styles from "./leveraged.module.css";

const SORT_LABEL: Record<LeveragedSort, { ja: string; en: string }> = { gainers: { ja: "上昇率", en: "Gainers" }, losers: { ja: "下落率", en: "Losers" }, volume: { ja: "出来高", en: "Volume" } };
const tone = (value: number | null) => value === null || value === 0 ? styles.flat : value > 0 ? styles.up : styles.down;
/** A minute between reads; while part of the list is still unread, or a read failed, again after 8 seconds (at most QUICK_TRIES times in a row).
 * One read never waits more than 15 seconds (the server's own limit is 30): it is abandoned and counted as failed. */
const EVERY_MS = 60_000, QUICK_RETRY_MS = 8_000, QUICK_TRIES = 8, READ_TIMEOUT_MS = 15_000;

/** マーケット「レバETF」(owner, Nov 25; FREE page, so mint and no gold): the long 2x / 3x funds in compact rows. Left: the fund's ticker and its
 * 「2倍」/「3倍」 mark, under it the stock and that stock's day change only. Right: price and day change, under them the pre-market / after-hours
 * price and change with its 「プレ」/「時間外」 mark while that session is under way. Nothing is cut with an ellipsis. */
export default function LeveragedList({ ja }: { ja: boolean }) {
  const [sort, setSort] = useState<LeveragedSort>("gainers");
  const [state, setState] = useState(LEVERAGED_START);
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | undefined, stopped = false, quick = 0, controller: AbortController | undefined;
    const read = async () => {
      clearTimeout(retry);
      controller?.abort();
      const own = controller = new AbortController(), timer = setTimeout(() => own.abort(), READ_TIMEOUT_MS);
      let answer: { rows: LeveragedRow[]; missing: number } | null = null;
      try {
        const response = await fetch("/api/research/market/leveraged", { cache: "no-store", signal: own.signal }), body = await response.json();
        if (response.ok && body.ok && Array.isArray(body.rows)) answer = { rows: body.rows as LeveragedRow[], missing: Number(body.missing) || 0 };
      } catch { /* failed or timed out: counted below */ } finally { clearTimeout(timer); }
      if (stopped || own !== controller) return;
      setState(old => nextLeveragedView(old, answer));
      // Part of the list not read yet (the server reads at most 48 symbols a request), or the read failed: ask again soon, not in a minute.
      if ((answer === null || answer.missing > 0) && quick < QUICK_TRIES) { quick++; retry = setTimeout(() => { if (!stopped) void read(); }, QUICK_RETRY_MS); }
      else if (answer && answer.missing === 0) quick = 0;
    };
    const stop = startPolling(read, EVERY_MS);
    return () => { stopped = true; clearTimeout(retry); controller?.abort(); stop(); };
  }, []);
  const rows = state.rows ? sortLeveraged(state.rows, sort) : null;
  const t = (a: string, b: string) => ja ? a : b;
  return <section className={styles.wrap} aria-label={t("レバレッジETF", "Leveraged ETFs")}>
    <div className={styles.sorts} role="group" aria-label={t("並び替え", "Sort")}>{LEVERAGED_SORTS.map(item =>
      <button key={item} type="button" aria-pressed={sort === item} onClick={() => setSort(item)}>{SORT_LABEL[item][ja ? "ja" : "en"]}</button>)}</div>
    <div className={styles.head} aria-hidden="true"><span>{t("レバETF／元の株", "ETF / underlying")}</span><span>{t("価格", "Price")}</span><span>{t("騰落率", "Change")}</span></div>
    {rows === null ? <p className={styles.note} role="status">{t("読み込み中…", "Loading…")}</p>
      : !rows.length ? <p className={styles.note} role="status">{t("データを取得できませんでした", "Data could not be loaded")}</p>
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
