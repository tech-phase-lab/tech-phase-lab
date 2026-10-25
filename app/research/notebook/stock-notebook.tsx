"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { flashRows } from "@/lib/research/flash-rows";
import { calendarEvents } from "@/lib/research/calendar";
import { publicPriceTargets, type PriceTarget } from "@/lib/research/price-targets";
import { buildNotebook, weekLabel } from "@/lib/research/stock-notebook";
import { useMemberDisplay, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import styles from "./stock-notebook.module.css";

const jstTime = (value: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
const usd = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** 銘柄手帳: this week's moves for the stocks on the watchlist. FREE sees how many; PRO and the owner see what. */
export default function StockNotebook({ tickers, lang }: { tickers: string[]; lang: Language }) {
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const memberPlan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const ownerRole = useResearchOwner();
  const full = memberPlan === "pro" || ownerAccount || ownerRole;
  const [feed, setFeed] = useState<GeneralNewsFeed | null>(null);
  const [wire, setWire] = useState<Record<string, CompanyWireItem[]>>({});
  const [targets, setTargets] = useState<PriceTarget[] | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const get = async (url: string) => { const response = await fetch(url, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) }); if (!response.ok) throw Error(url); return response.json(); };
    (async () => {
      const [news, companyWire, priceTargets] = await Promise.allSettled([get("/api/research/news"), get("/api/research/company-wire"), get("/api/research/price-targets")]);
      if (controller.signal.aborted) return;
      if (news.status === "fulfilled") { try { setFeed(availableNewsPayload(news.value)); } catch { /* shown as unavailable below */ } }
      if (companyWire.status === "fulfilled") { try { setWire(parseCompanyWire(companyWire.value).items); } catch { /* optional lane */ } }
      if (priceTargets.status === "fulfilled") { try { setTargets(publicPriceTargets(priceTargets.value).items); } catch { /* optional lane */ } }
      setNow(Date.now());
      setState(news.status === "fulfilled" || priceTargets.status === "fulfilled" ? "ready" : "failed");
    })();
    return () => controller.abort();
  }, []);

  const notebook = useMemo(() => state === "ready" && now ? buildNotebook({
    tickers, now, lang, rows: flashRows(feed, wire, lang), targets: targets ?? [], events: calendarEvents,
  }) : null, [state, now, tickers, lang, feed, wire, targets]);

  const summary = notebook ? [[t("決算", "Earnings"), notebook.earnings.length], [t("目標株価", "Targets"), notebook.targets.length], [t("ニュース", "News"), notebook.news.length]] as const : null;
  return <section className={styles.notebook} aria-label={t("銘柄手帳", "Stock Notebook")}>
    <button type="button" className={styles.bar} aria-expanded={open} aria-controls="stock-notebook-body" onClick={() => setOpen(value => !value)}>
      <span className={styles.name}>{t("銘柄手帳", "Notebook")}</span>
      <span className={styles.summary}>{state === "loading" ? t("集計中…", "Tallying…") : state === "failed" ? t("取得できません", "Unavailable") : summary?.map(([label, count]) => <span key={label}>{label}<b>{count}</b></span>)}</span>
      <span className={styles.period}>{now > 0 ? weekLabel(now, lang) : ""}</span>
      <svg aria-hidden="true" viewBox="0 0 24 24" className={open ? styles.chevOpen : styles.chev}><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
    </button>
    {open && <div id="stock-notebook-body" className={styles.body}>
    {state === "loading" && <p role="status" className={styles.note}>{t("今週の動きを集計中…", "Tallying this week…")}</p>}
    {state === "failed" && <p role="alert" className={styles.note}>{t("今週の動きを取得できませんでした。しばらくしてからもう一度お試しください。", "This week's moves could not be loaded. Please try again shortly.")}</p>}
    {notebook && <>
      {full ? <div className={styles.details}>
        {notebook.earnings.length > 0 && <section><h3>{t("決算", "Earnings")}</h3><ul>{notebook.earnings.map(item => <li key={item.ticker}><b>{item.ticker}</b><span>{item.title}</span><time dateTime={item.at}>{jstTime(item.at)}</time></li>)}</ul></section>}
        {notebook.targets.length > 0 && <section><h3>{t("目標株価の変更", "Target changes")}</h3><ul>{notebook.targets.map((item, index) => <li key={`${item.ticker}-${index}`}><b>{item.ticker}</b><span>{item.firm}　{usd(item.previous)} → {usd(item.latest)}</span><time dateTime={item.at}>{jstTime(item.at)}</time></li>)}</ul></section>}
        {notebook.news.length > 0 && <section><h3>{t("ニュース", "News")}</h3><ul>{notebook.news.slice(0, 12).map((item, index) => <li key={`${item.ticker}-${index}`}><b>{item.ticker}</b><span>{item.title}</span><time dateTime={item.at}>{jstTime(item.at)}</time></li>)}</ul></section>}
        {!notebook.earnings.length && !notebook.targets.length && !notebook.news.length && <p className={styles.note}>{notebook.previous ? t("先週は、登録銘柄に目立った動きはありませんでした。", "No notable moves for your stocks last week.") : t("今週は、登録銘柄に目立った動きはありませんでした。", "No notable moves for your stocks this week.")}</p>}
      </div> : <p className={styles.lock}><b>FREE</b>{t("件数のみ表示しています。", "Counts only.")}<br /><Link href="/research#tech-phase-pro">{t("PRO版は、中身まで読めます。", "PRO shows what is behind them.")}</Link></p>}
      <p className={styles.fine}>{notebook.previous ? t("先週（月曜〜日曜）の集計です。", "Last week, Monday to Sunday. ") : t("月曜〜今日までの集計です。", "Monday to today. ")}{t("ニュースは、監視している銘柄の分のみです。", "News covers the stocks Tech Phase monitors.")}</p>
    </>}
    </div>}
  </section>;
}
