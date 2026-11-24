"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import ResearchToolShell from "../research-tool-shell";
import StockLogo from "../watchlist/stock-logo";
import StockRowLink from "../stock-row-link";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "../member-display-provider";
import { useResearchLanguage } from "../use-research-language";
import {
  ABOUT, SORTS, WHALE_TABS, asOfLine, dateStack, filterInsiders, money, monthDay, parseWhaleSnapshot, percent, quarterLabel, roleLabel, signedPoints,
  sortBuybacks, sortInstitutions, sortShort, stockHref, type WhaleSnapshot, type WhaleTab,
} from "@/lib/research/whale-moves";
import styles from "./whales.module.css";

/** クジラの足あと / Whale Tracks (owner, Nov 22: the English name was Whale Moves). Internal names (whales, WHALE_MOVES_ENABLED) stay. */
export const WHALE_TRACKS = { ja: "クジラの足あと", en: "Whale Tracks" } as const;
export const FIRST_SORTS: Record<WhaleTab, string> = { institutions: "up", short: "high", insiders: "all", buybacks: "new" };

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
    <StockRowLink href={stockHref(row.ticker)} className={styles.row}>
      <div className={styles.line}>
        <StockLogo ticker={row.ticker} className={styles.logo} full />
        <Name ticker={row.ticker} name={ja ? row.ja : row.en} />
        <span className={styles.figure}>
          <b className={styles.big}>{row.pct > 100 ? (ja ? "100%超" : ">100%") : percent(row.pct)}</b>
          <span className={`${styles.change} ${tone(row.change)}`}>{signedPoints(row.change, 1, ja)}</span>
        </span>
      </div>
      <span className={styles.bar} aria-hidden="true"><i style={{ width: `${Math.min(100, row.pct)}%` }} /></span>
    </StockRowLink>
  </li>)}</ul>;
}

function Short({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  return <ul className={styles.list}>{sortShort(data.short, sort).map(row => <li key={row.ticker}>
    <StockRowLink href={stockHref(row.ticker)} className={`${styles.row} ${styles.line}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <Name ticker={row.ticker} name={ja ? row.ja : row.en} />
      <span className={styles.figure}>
        <span className={styles.label}>{ja ? "空売り比率" : "Short interest"}</span>
        <b className={styles.mid}>{percent(row.pct, row.pct < 10 ? 2 : 1)}</b>
        <span className={`${styles.change} ${tone(row.change, row.pct < 10 ? 2 : 1)}`}>{signedPoints(row.change, row.pct < 10 ? 2 : 1, ja)}</span>
      </span>
      <span className={styles.days}>
        <span className={styles.label}>{ja ? "買い戻し" : "Days to cover"}</span>
        <b>{row.days === null ? "—" : ja ? `${row.days.toFixed(1)}日` : row.days.toFixed(1)}</b>
      </span>
    </StockRowLink>
  </li>)}</ul>;
}

function Insiders({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  const items = filterInsiders(data.insiders, sort);
  if (!items.length) return <p className={styles.note}>{ja ? "該当する届け出はありません。" : "No filings to show."}</p>;
  const newestYear = items.reduce((year, row) => row.date.slice(0, 4) > year ? row.date.slice(0, 4) : year, "");
  return <ul className={styles.timeline}>{items.map((row, index) => {
    const date = index === 0 || items[index - 1].date !== row.date ? dateStack(row.date, ja, newestYear) : null;
    return <li key={`${row.ticker}-${row.date}-${index}`}>
    <span className={styles.date}>{date && <time dateTime={row.date} aria-label={date.label}>
      {date.year && <small className={styles.dateYear}>{date.year}</small>}<small>{date.month}</small><b>{date.day}</b>
    </time>}</span>
    <StockRowLink href={stockHref(row.ticker)} className={`${styles.card} ${row.side === "buy" ? styles.buyCard : styles.sellCard}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <span className={styles.names}>
        <b className={styles.ticker}>{row.ticker}</b>
        <span className={styles.company}>{[roleLabel(row.role, ja), row.planned ? (ja ? "計画売買" : "Planned") : ""].filter(Boolean).join(ja ? "・" : " · ")}</span>
      </span>
      <span className={styles.figure}>
        <i className={row.side === "buy" ? styles.buyTag : styles.sellTag}>{row.side === "buy" ? (ja ? "買い" : "Bought") : (ja ? "売り" : "Sold")}</i>
        <b className={styles.amount}>{money(row.value, ja)}</b>
      </span>
    </StockRowLink>
  </li>;
  })}</ul>;
}

function Buybacks({ data, sort, ja }: { data: WhaleSnapshot; sort: string; ja: boolean }) {
  return <ul className={styles.stack}>{sortBuybacks(data.buybacks, sort).map((row, index) => <li key={`${row.ticker}-${row.kind}-${row.date}-${index}`}>
    <StockRowLink href={stockHref(row.ticker)} className={`${styles.card} ${row.kind === "authorization" ? styles.goldCard : ""}`}>
      <StockLogo ticker={row.ticker} className={styles.logo} full />
      <span className={styles.names}>
        <b className={styles.ticker}>{row.ticker}</b>
        <span className={styles.company}>{row.kind === "authorization"
          ? (ja ? `${monthDay(row.date)}・新しい枠を発表` : `${monthDay(row.date, false)} · New authorization`)
          : (ja ? `${quarterLabel(row.end ?? row.date, true)}・買い戻した金額` : `${quarterLabel(row.end ?? row.date, false)} · Repurchased`)}</span>
      </span>
      <b className={styles.amount}>{money(row.amount, ja)}</b>
    </StockRowLink>
  </li>)}</ul>;
}

/** The sheet: WHALE TRACKS over the heading and the 「i」 text for the four tabs. The page and the PRO feature tour's sample share it. */
export function WhaleTracksSheet({ ja, top, children }: { ja: boolean; top?: ReactNode; children: ReactNode }) {
  const [about, setAbout] = useState(false);
  return <section className={styles.sheet} aria-labelledby="whale-tracks-title">
    {top}
    <header className={styles.head}>
      <div>
        <p className={styles.eyebrow}><span aria-hidden="true" />WHALE TRACKS</p>
        <h1 id="whale-tracks-title">{ja ? WHALE_TRACKS.ja : WHALE_TRACKS.en}</h1>
      </div>
      <button type="button" className={styles.info} aria-expanded={about} aria-controls="whale-tracks-about" aria-label={ja ? "このページについて" : "About this page"} onClick={() => setAbout(open => !open)}>i</button>
    </header>
    {about && <dl id="whale-tracks-about" className={styles.about}>
      {WHALE_TABS.map(item => <div key={item.id}><dt>{ja ? item.ja : item.en}</dt><dd>{ja ? ABOUT[item.id].ja : ABOUT[item.id].en}</dd></div>)}
    </dl>}
    {children}
  </section>;
}

export function WhaleTabBar({ tab, onChange, ja }: { tab: WhaleTab; onChange: (tab: WhaleTab) => void; ja: boolean }) {
  return <div className={styles.tabs} role="tablist" aria-label={ja ? "データの種類" : "Data type"}>
    {WHALE_TABS.map(item => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => onChange(item.id)}>{ja ? item.ja : item.en}</button>)}
  </div>;
}

/** One tab: the as-of line, the sort buttons and the list. withYear: the tour's sample shows the made-up year (owner, Nov 22). */
export function WhalePanel({ data, tab, sort, onSort, ja, withYear = false }: { data: WhaleSnapshot; tab: WhaleTab; sort: string; onSort: (sort: string) => void; ja: boolean; withYear?: boolean }) {
  const body = useMemo(() => {
    if (tab === "institutions") return <Institutions data={data} sort={sort} ja={ja} />;
    if (tab === "short") return <Short data={data} sort={sort} ja={ja} />;
    if (tab === "insiders") return <Insiders data={data} sort={sort} ja={ja} />;
    return <Buybacks data={data} sort={sort} ja={ja} />;
  }, [data, tab, sort, ja]);
  return <div role="tabpanel">
    <p className={styles.asOf}>{asOfLine(tab, data, ja, withYear)}</p>
    <div className={styles.sorts} role="group" aria-label={ja ? "並び替え" : "Sort"}>
      {SORTS[tab].map(option => <button key={option.id} type="button" aria-pressed={sort === option.id} onClick={() => onSort(option.id)}>{ja ? option.ja : option.en}</button>)}
    </div>
    {body}
  </div>;
}

export const whaleCredit = (tab: WhaleTab, ja: boolean) => ja ? `提供：SEC・FINRA${tab === "short" ? "・Twelve Data" : ""}` : `Data: SEC, FINRA${tab === "short" ? ", Twelve Data" : ""}`;

export default function WhaleMovesScreen() {
  const memberPlan = useMemberDisplay();
  const settled = useMemberSettled();
  const owner = useOwnerAccount();
  const plan = owner ? "pro" : memberPlan ?? (settled ? "free" : null);
  const [lang, setLang] = useResearchLanguage();
  const ja = lang === "ja";
  const t = (a: string, b: string) => ja ? a : b;
  const [tab, setTab] = useState<WhaleTab>("institutions");
  const [sorts, setSorts] = useState<Record<WhaleTab, string>>(FIRST_SORTS);
  const { state, data, retry } = useWhaleMoves(plan === "pro");

  return <ResearchToolShell lang={lang} setLang={setLang} title={t(WHALE_TRACKS.ja, WHALE_TRACKS.en)} showHeading={false} description="">
    <WhaleTracksSheet ja={ja}>
      {plan === null && <p role="status" className={styles.note}>{t("会員情報を確認中…", "Checking membership…")}</p>}
      {plan === "free" && <div className={styles.lock}>
        <p>{t("クジラの足あとはPRO会員限定です", "Whale Tracks is available to PRO members")}</p>
        <Link href="/research#tech-phase-pro">{t("Tech Phase PROを見る", "Learn about Tech Phase PRO")}</Link>
      </div>}

      {plan === "pro" && <>
        <WhaleTabBar tab={tab} onChange={setTab} ja={ja} />
        {state === "loading" && <p role="status" className={styles.note}>{t("データを読み込み中…", "Loading data…")}</p>}
        {state === "not-ready" && <p role="status" className={styles.note}>{t("データを準備中です。準備ができ次第、ここに表示されます。", "Data is being prepared. It will appear here once it's ready.")}</p>}
        {(state === "error" || state === "sign-in" || state === "pro-required") && <p role="alert" className={styles.note}>
          {state === "sign-in" ? t("ログインしてください。", "Please sign in.") : state === "pro-required" ? t("PRO会員の期間を確認できませんでした。", "We couldn't confirm your PRO membership.") : t("データを読み込めませんでした。", "Couldn't load the data.")}
          {state === "error" && <button type="button" className={styles.retry} onClick={retry}>{t("再読み込み", "Retry")}</button>}
        </p>}
        {state === "ready" && data && <WhalePanel data={data} tab={tab} sort={sorts[tab]} onSort={sort => setSorts(current => ({ ...current, [tab]: sort }))} ja={ja} />}
      </>}
    </WhaleTracksSheet>
    {plan === "pro" && state === "ready" && <p className={styles.credit}>{whaleCredit(tab, ja)}</p>}
  </ResearchToolShell>;
}
