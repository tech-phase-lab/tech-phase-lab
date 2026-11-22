"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import StockLogo from "../watchlist/stock-logo";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import {
  ABOUT, SORTS, WHALE_TABS, asOfLine, filterInsiders, money, monthDay, parseWhaleSnapshot, percent, quarterLabel, roleLabel, signedPoints,
  sortBuybacks, sortInstitutions, sortShort, stockHref, type WhaleSnapshot, type WhaleTab,
} from "@/lib/research/whale-moves";
import styles from "./whales.module.css";

type State = "loading" | "ready" | "not-ready" | "error" | "sign-in" | "pro-required";

function useWhaleMoves(allowed: boolean) {
  const [state, setState] = useState<State>("loading");
  const [data, setData] = useState<WhaleSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    fetch("/api/research/whales", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
        if (response.ok && body?.ok) { setData(parseWhaleSnapshot(body)); setState("ready"); return; }
        const error = body?.error;
        setState(error === "sign-in" ? "sign-in" : error === "pro-required" ? "pro-required" : error === "not-ready" || error === "not-connected" ? "not-ready" : "error");
      })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [allowed, attempt]);
  return { state, data, retry: () => { setState("loading"); setAttempt(n => n + 1); } };
}

const Name = ({ ticker, name }: { ticker: string; name: string }) => <span className={styles.names}>
  <b className={styles.ticker}>{ticker}</b><span className={styles.company}>{name}</span>
</span>;
const tone = (value: number | null, digits = 1) => value === null || Number(Math.abs(value).toFixed(digits)) === 0 ? styles.flat : value > 0 ? styles.up : styles.down;

function Institutions({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  return <ul className={styles.list}>{sortInstitutions(data.institutional, sort).map(row => <li key={row.ticker}>
    <Link href={stockHref(row.ticker)} className={styles.row}>
      <div className={styles.line}>
        <StockLogo ticker={row.ticker} className={styles.logo} full />
        <Name ticker={row.ticker} name={ja ? row.ja : row.en} />
        <span className={styles.figure}>
          <b className={styles.big}>{row.pct > 100 ? (ja ? "100%超" : "Over 100%") : percent(row.pct)}</b>
          <span className={`${styles.change} ${tone(row.change)}`}>{signedPoints(row.change)}</span>
        </span>
      </div>
      <span className={styles.bar} aria-hidden="true"><i style={{ width: `${Math.min(100, row.pct)}%` }} /></span>
    </Link>
  </li>)}</ul>;
}

function Short({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  return <ul className={styles.list}>{sortShort(data.short, sort).map(row => <li key={row.ticker}>
    <Link href={stockHref(row.ticker)} className={`${styles.row} ${styles.line}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <Name ticker={row.ticker} name={ja ? row.ja : row.en} />
      <span className={styles.figure}>
        <span className={styles.label}>{ja ? "空売り比率" : "Short share"}</span>
        <b className={styles.mid}>{percent(row.pct, row.pct < 10 ? 2 : 1)}</b>
        <span className={`${styles.change} ${tone(row.change, row.pct < 10 ? 2 : 1)}`}>{signedPoints(row.change, row.pct < 10 ? 2 : 1)}</span>
      </span>
      <span className={styles.days}>
        <span className={styles.label}>{ja ? "買い戻し" : "Days to cover"}</span>
        <b>{row.days === null ? "—" : ja ? `${row.days.toFixed(1)}日` : row.days.toFixed(1)}</b>
      </span>
    </Link>
  </li>)}</ul>;
}

function Insiders({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  const items = filterInsiders(data.insiders, sort);
  if (!items.length) return <p className={styles.note}>{ja ? "該当する届け出はありません。" : "No filings to show."}</p>;
  return <ul className={styles.timeline}>{items.map((row, index) => <li key={`${row.ticker}-${row.date}-${index}`}>
    <span className={styles.date}>{index === 0 || items[index - 1].date !== row.date ? monthDay(row.date) : ""}</span>
    <Link href={stockHref(row.ticker)} className={`${styles.card} ${row.side === "buy" ? styles.buyCard : styles.sellCard}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <span className={styles.names}>
        <b className={styles.ticker}>{row.ticker}</b>
        <span className={styles.company}>{[roleLabel(row.role, ja), row.planned ? (ja ? "計画売買" : "Planned") : ""].filter(Boolean).join(ja ? "・" : " · ")}</span>
      </span>
      <span className={styles.figure}>
        <i className={row.side === "buy" ? styles.buyTag : styles.sellTag}>{row.side === "buy" ? (ja ? "買い" : "Buy") : (ja ? "売り" : "Sell")}</i>
        <b className={styles.amount}>{money(row.value, ja)}</b>
      </span>
    </Link>
  </li>)}</ul>;
}

function Buybacks({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  return <ul className={styles.stack}>{sortBuybacks(data.buybacks, sort).map((row, index) => <li key={`${row.ticker}-${row.kind}-${row.date}-${index}`}>
    <Link href={stockHref(row.ticker)} className={`${styles.card} ${row.kind === "authorization" ? styles.goldCard : ""}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <span className={styles.names}>
        <b className={styles.ticker}>{row.ticker}</b>
        <span className={styles.company}>{row.kind === "authorization"
          ? (ja ? `${monthDay(row.date)}・新しい枠を発表` : `${monthDay(row.date)} · New authorization`)
          : (ja ? `${quarterLabel(row.end ?? row.date, true)}・買い戻した金額` : `${quarterLabel(row.end ?? row.date, false)} · Amount bought back`)}</span>
      </span>
      <b className={styles.amount}>{money(row.amount, ja)}</b>
    </Link>
  </li>)}</ul>;
}

export default function WhaleMovesScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  const owner = useOwnerAccount();
  const plan = owner ? "pro" : memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [tab, setTab] = useState<WhaleTab>("institutions");
  const [sorts, setSorts] = useState<Record<WhaleTab, string>>({ institutions: "up", short: "high", insiders: "all", buybacks: "new" });
  const [about, setAbout] = useState(false);
  const { state, data, retry } = useWhaleMoves(plan === "pro");
  const sort = sorts[tab];
  const body = useMemo(() => {
    if (!data) return null;
    if (tab === "institutions") return <Institutions data={data} sort={sort} ja={ja} />;
    if (tab === "short") return <Short data={data} sort={sort} ja={ja} />;
    if (tab === "insiders") return <Insiders data={data} sort={sort} ja={ja} />;
    return <Buybacks data={data} sort={sort} ja={ja} />;
  }, [data, tab, sort, ja]);

  return <ResearchToolShell lang={lang} setLang={setLang} title={t("クジラの足あと", "Whale Moves")} showHeading={false} description="">
    <section className={styles.sheet} aria-labelledby="whale-moves-title">
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}><span aria-hidden="true" />WHALE MOVES</p>
          <h1 id="whale-moves-title">{t("クジラの足あと", "Whale Moves")}</h1>
        </div>
        <button type="button" className={styles.info} aria-expanded={about} aria-controls="whale-moves-about" aria-label={t("このページについて", "About this page")} onClick={() => setAbout(open => !open)}>i</button>
      </header>
      {about && <dl id="whale-moves-about" className={styles.about}>
        {WHALE_TABS.map(item => <div key={item.id}><dt>{ja ? item.ja : item.en}</dt><dd>{ja ? ABOUT[item.id].ja : ABOUT[item.id].en}</dd></div>)}
      </dl>}

      {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}
      {plan === "free" && <div className={styles.lock}>
        <p>{t("クジラの足あとはPRO会員限定です", "Whale Moves is for PRO members")}</p>
        <Link href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "See Tech Phase PRO")}</Link>
      </div>}

      {plan === "pro" && <>
        <div className={styles.tabs} role="tablist" aria-label={t("データの種類", "Data")}>
          {WHALE_TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{ja ? item.ja : item.en}</button>)}
        </div>
        {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
        {state === "not-ready" && <p role="status" className={styles.note}>{t("データを準備中です。準備ができ次第、ここに表示されます。", "The data is being prepared. It will appear here once it is ready.")}</p>}
        {(state === "error" || state === "sign-in" || state === "pro-required") && <p role="alert" className={styles.note}>
          {state === "sign-in" ? t("ログインしてください。", "Please sign in.") : state === "pro-required" ? t("PRO会員の期間を確認できませんでした。", "Your PRO membership could not be confirmed.") : t("データを読み込めませんでした。", "The data could not be loaded.")}
          {state === "error" && <button type="button" className={styles.retry} onClick={retry}>{t("再読み込み", "Retry")}</button>}
        </p>}
        {state === "ready" && data && <div role="tabpanel">
          <p className={styles.asOf}>{asOfLine(tab, data, ja)}</p>
          <div className={styles.sorts} role="group" aria-label={t("並び替え", "Sort")}>
            {SORTS[tab].map(option => <button key={option.id} type="button" aria-pressed={sort === option.id} onClick={() => setSorts(current => ({ ...current, [tab]: option.id }))}>{ja ? option.ja : option.en}</button>)}
          </div>
          {body}
        </div>}
      </>}
    </section>
    {plan === "pro" && state === "ready" && <p className={styles.credit}>{t(`提供：SEC・FINRA${tab === "short" ? "・Twelve Data" : ""}`, `Data: SEC, FINRA${tab === "short" ? ", Twelve Data" : ""}`)}</p>}
  </ResearchToolShell>;
}
