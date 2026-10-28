"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Language } from "@/lib/research/data";
import { sampleStockReturns } from "@/lib/research/theme-ranking";
import { signedPercent, weekSummary, type WeekMover } from "@/lib/research/watchlist-week";
import { useMemberDisplay, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import styles from "./week-moves.module.css";

type Data = { asOf: string; full: boolean; up: number; down: number; flat: number; covered: number; missing: number; ranked?: WeekMover[] };
type State = "loading" | "ready" | "not-connected" | "sign-in" | "error";

/** 銘柄手帳, this week's price moves for every stock in the chosen list: they do not depend on any news existing. */
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
  }, [key]);

  const shown = useMemo<Data | null>(() => {
    if (!sample) return data;
    const summary = weekSummary(sampleStockReturns(tickers), tickers);
    return { asOf: "SAMPLE", full: true, ...summary };
  }, [sample, data, tickers]);

  const rows = shown?.full || (shown && full) ? shown.ranked : undefined;
  const top = rows?.slice(0, 5) ?? [], bottom = rows && rows.length > 5 ? rows.slice(-Math.min(5, rows.length - 5)).reverse() : [];
  const tone = (value: number) => value > 0 ? styles.up : value < 0 ? styles.down : "";
  const reach = Math.max(1, ...(rows ?? []).map(item => Math.abs(item.change)));
  const line = (item: WeekMover) => <li key={item.ticker} style={{ "--reach": `${Math.max(4, Math.abs(item.change) / reach * 100)}%` } as React.CSSProperties} data-dir={item.change >= 0 ? "up" : "down"}><Link href={`/research/stocks?q=${encodeURIComponent(item.ticker)}`}><b>{item.ticker}</b></Link><span className={tone(item.change)}>{signedPercent(item.change)}</span></li>;
  const total = shown ? shown.up + shown.down + shown.flat : 0;

  return <section className={styles.week} aria-label={t("今週の値動き", "This week's moves")}>
    <h2>{t("今週の値動き", "This week's moves")}</h2>
    {!key ? <p className={styles.note}>{t("このリストには、まだ銘柄がありません。", "This list has no stocks yet.")}</p>
      : state === "loading" && !sample ? <p role="status" className={styles.note}>{t("株価を集計中…", "Tallying prices…")}</p>
      : state === "sign-in" && !sample ? <p className={styles.note}>{t("ログインすると、今週の値動きが見られます。", "Sign in to see this week's moves.")}</p>
      : state === "error" && !sample ? <p role="alert" className={styles.note}>{t("株価を取得できませんでした。しばらくしてからもう一度お試しください。", "Prices could not be loaded. Please try again shortly.")}</p>
      : state === "not-connected" && !sample ? <>
        <p className={styles.note}>{t("株価データの接続準備中です。接続でき次第、ここに今週の上昇・下落が出ます。", "Price data is being connected. This week's gainers and losers will appear here once it is.")}</p>
        {owner && <button type="button" className={styles.sampleButton} onClick={() => setSample(true)}>{t("見本の数字で見た目を確認（運営者のみ・実際の株価ではありません）", "Preview with sample numbers (owner only, not real prices)")}</button>}
      </> : shown && <>
        {sample && <p role="status" className={styles.sample}><b>SAMPLE</b>{t("見た目の確認用の見本です。実際の株価ではありません。", "A preview with sample numbers, not real prices.")}</p>}
        <div className={styles.tiles}>
          <div className={styles.tile}><span>{t("上昇", "Up")}</span><strong className={styles.up}>{shown.up}</strong><small>{t("銘柄", "stocks")}</small></div>
          <div className={styles.tile}><span>{t("下落", "Down")}</span><strong className={styles.down}>{shown.down}</strong><small>{t("銘柄", "stocks")}</small></div>
          <div className={styles.tile}><span>{t("変わらず", "Flat")}</span><strong>{shown.flat}</strong><small>{t("銘柄", "stocks")}</small></div>
        </div>
        {total > 0 && <div className={styles.split} role="img" aria-label={t(`上昇${shown.up}・下落${shown.down}・変わらず${shown.flat}`, `Up ${shown.up}, down ${shown.down}, flat ${shown.flat}`)}><i className={styles.upBar} style={{ flexGrow: shown.up }} /><i className={styles.flatBar} style={{ flexGrow: shown.flat }} /><i className={styles.downBar} style={{ flexGrow: shown.down }} /></div>}
        {rows ? <div className={styles.lists}>
          <div><h3>{t("上昇ベスト", "Top gainers")}</h3><ol>{top.map(line)}</ol></div>
          {bottom.length > 0 && <div><h3>{t("下落ワースト", "Top losers")}</h3><ol>{bottom.map(line)}</ol></div>}
        </div> : <p className={styles.lock}><b>FREE</b>{t("上昇・下落の数のみ表示しています。", "Counts only.")}<br /><Link href="/research#tech-phase-pro">{t("PRO版は、どの銘柄が何％動いたかまで見られます。", "PRO shows which stocks moved, and by how much.")}</Link></p>}
        <p className={styles.fine}>{t("直近5営業日の終値の変化です。", "Change in closing price over the last 5 trading days. ")}{shown.missing > 0 && t(`株価が取れなかった銘柄が${shown.missing}件あります。`, `${shown.missing} stock(s) had no price data.`)}</p>
      </>}
  </section>;
}
