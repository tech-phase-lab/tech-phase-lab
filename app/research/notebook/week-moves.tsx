"use client";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import type { Language } from "@/lib/research/data";
import { sampleStockReturns } from "@/lib/research/theme-ranking";
import { weekSummary, type WeekMover } from "@/lib/research/watchlist-week";
import { useMemberDisplay, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import styles from "./week-moves.module.css";

type Data = { asOf: string; full: boolean; up: number; down: number; flat: number; covered: number; missing: number; ranked?: WeekMover[] };
const tilePercent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
type State = "loading" | "ready" | "not-connected" | "sign-in" | "error";

/** 銘柄手帳, this week's price moves for every stock in the chosen list, as a row of tiles: they do not depend on any news existing.
 * A price problem is told here, in this strip only. */
export default function WeekMoves({ tickers, lang }: { tickers: string[]; lang: Language }) {
  const t = (a: string, b: string) => lang === "ja" ? a : b;
  const plan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const ownerRole = useResearchOwner();
  const owner = ownerAccount || ownerRole;
  const full = plan === "pro" || owner;
  const key = tickers.join(",");
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<Data | null>(null);
  const [sample, setSample] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`/api/research/notebook-week?tickers=${encodeURIComponent(key)}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const body = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (response.ok && body?.ok) { setData(body); setState("ready"); }
        else setState(body?.error === "not-connected" ? "not-connected" : body?.error === "sign-in" ? "sign-in" : "error");
      } catch { if (!controller.signal.aborted) setState("error"); }
    })();
    return () => controller.abort();
  }, [key, attempt]);

  const shown = useMemo<Data | null>(() => {
    if (!sample) return data;
    const summary = weekSummary(sampleStockReturns(tickers), tickers);
    return { asOf: "SAMPLE", full: true, ...summary };
  }, [sample, data, tickers]);

  const rows = shown?.full || (shown && full) ? shown.ranked : undefined;
  const reach = Math.max(1, ...(rows ?? []).map(item => Math.abs(item.change)));
  const retry = () => { setState("loading"); setAttempt(value => value + 1); };

  if (!key) return null;
  return <section className={styles.week} aria-label={t("今週の値動き", "This week's moves")}>
    {state === "loading" && !sample ? <p role="status" className={styles.note}>{t("株価を集計中…", "Tallying prices…")}</p>
      : state === "sign-in" && !sample ? <p className={styles.note}>{t("ログインすると、今週の値動きが見られます。", "Sign in to see this week's moves.")}</p>
      : state === "error" && !sample ? <p role="alert" className={styles.note}>{t("株価を取得できませんでした", "Prices could not be loaded")}<button type="button" onClick={retry}>{t("再読み込み", "Reload")}</button></p>
      : state === "not-connected" && !sample ? <p className={styles.note}>{t("株価データの接続準備中です。", "Price data is being connected.")}
        {owner && <button type="button" onClick={() => setSample(true)}>{t("見本で確認(運営者のみ)", "Sample (owner only)")}</button>}</p>
      : shown && <>
        {sample && <p role="status" className={styles.sample}><b>SAMPLE</b>{t("見た目の確認用の見本です。実際の株価ではありません。", "A preview with sample numbers, not real prices.")}</p>}
        {rows ? <ul className={styles.tiles}>{[...rows].sort((a, b) => b.change - a.change).map(item => <li key={item.ticker} data-dir={item.change >= 0 ? "up" : "down"} style={{ "--reach": `${Math.max(8, Math.abs(item.change) / reach * 100)}%` } as CSSProperties}>
          <Link href={`/research/stocks?q=${encodeURIComponent(item.ticker)}`}><b>{item.ticker}</b><strong>{tilePercent(item.change)}</strong><i aria-hidden="true"><u /></i></Link>
        </li>)}</ul>
        : <>
          <ul className={styles.counts}>
            <li><span>{t("上昇", "Up")}</span><strong data-dir="up">{shown.up}</strong></li>
            <li><span>{t("下落", "Down")}</span><strong data-dir="down">{shown.down}</strong></li>
            <li><span>{t("変わらず", "Flat")}</span><strong>{shown.flat}</strong></li>
          </ul>
          <p className={styles.lock}><b>FREE</b>{t("上昇・下落の数のみ表示しています。", "Counts only.")} <Link href="/research#tech-phase-pro">{t("PRO版は、どの銘柄が何％動いたかまで見られます。", "PRO shows which stocks moved, and by how much.")}</Link></p>
        </>}
        {shown.missing > 0 && <p className={styles.fine}>{t(`株価が取れなかった銘柄が${shown.missing}件あります。`, `${shown.missing} stock(s) had no price data.`)}</p>}
      </>}
  </section>;
}
