"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Language } from "@/lib/research/data";
import { availableNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { parseCompanyWire, type CompanyWireItem } from "@/lib/research/company-wire";
import { flashRows } from "@/lib/research/flash-rows";
import { calendarEvents } from "@/lib/research/calendar";
import { publicPriceTargets, type PriceTarget } from "@/lib/research/price-targets";
import { buildNotebook, type Notebook, type NotebookNews } from "@/lib/research/stock-notebook";
import { useMemberDisplay, useOwnerAccount, useResearchOwner } from "../member-display-provider";
import styles from "./stock-notebook.module.css";

type Kind = "earnings" | "targets" | "news";
type Entry =
  | { id: string; kind: "earnings"; at: string; ticker: string; title: string; facts: string[] }
  | { id: string; kind: "targets"; at: string; ticker: string; firm: string; previous: number; latest: number }
  | { id: string; kind: "news"; at: string; ticker: string; title: string }
  | { id: string; kind: "institutional"; at: string; items: NotebookNews[] };

const usd = (value: number) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const dayKey = (value: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dayHeading = (value: string, ja: boolean) => {
  const date = new Date(value);
  const md = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(date);
  return `${md} ${new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", weekday: "short" }).format(date)}`;
};
const clock = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));

/** The entries of the notebook, newest first. News from investment firms buying or selling shares are folded into one line per day. */
export function notebookEntries(notebook: Notebook): Entry[] {
  const entries: Entry[] = [
    ...notebook.earnings.map((item): Entry => ({ id: `e-${item.ticker}`, kind: "earnings", at: item.at, ticker: item.ticker, title: item.title, facts: item.facts })),
    ...notebook.targets.map((item, index): Entry => ({ id: `t-${item.ticker}-${index}`, kind: "targets", at: item.at, ticker: item.ticker, firm: item.firm, previous: item.previous, latest: item.latest })),
  ];
  const folded = new Map<string, NotebookNews[]>();
  notebook.news.forEach((item, index) => {
    if (!item.institutional) { entries.push({ id: `n-${item.ticker}-${index}`, kind: "news", at: item.at, ticker: item.ticker, title: item.title }); return; }
    const key = dayKey(item.at);
    folded.set(key, [...(folded.get(key) ?? []), item]);
  });
  for (const [key, items] of folded) entries.push({ id: `i-${key}`, kind: "institutional", at: items[0].at, items });
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** 銘柄手帳, the week's entries for the stocks on the chosen list. FREE sees how many; PRO and the owner see what.
 * Prices do not come from here: a price problem never hides the news and earnings below. */
export default function StockNotebook({ tickers, lang, weeksBack }: { tickers: string[]; lang: Language; weeksBack: number }) {
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
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});

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
    tickers, now: now - weeksBack * 7 * 86_400_000, lang, rows: flashRows(feed, wire, lang), targets: targets ?? [], events: calendarEvents,
  }) : null, [state, now, weeksBack, tickers, lang, feed, wire, targets]);
  const entries = useMemo(() => notebook ? notebookEntries(notebook) : [], [notebook]);
  const counts = { earnings: notebook?.earnings.length ?? 0, targets: notebook?.targets.length ?? 0, news: notebook?.news.length ?? 0 };
  const chips: { key: "all" | Kind; label: string; count: number }[] = [
    { key: "all", label: t("すべて", "All"), count: counts.earnings + counts.targets + counts.news },
    { key: "earnings", label: t("決算", "Earnings"), count: counts.earnings },
    { key: "targets", label: t("目標株価", "Targets"), count: counts.targets },
    { key: "news", label: t("ニュース", "News"), count: counts.news },
  ];
  const shown = entries.filter(entry => filter === "all" || (filter === "news" ? entry.kind === "news" || entry.kind === "institutional" : entry.kind === filter));
  const days = [...new Set(shown.map(entry => dayKey(entry.at)))];
  const label = (kind: Kind) => kind === "earnings" ? t("決算", "Earnings") : kind === "targets" ? t("目標株価", "Target") : t("ニュース", "News");

  return <section className={styles.notebook} aria-label={t("ニュース・決算・目標株価", "News, earnings and targets")}>
    {state === "loading" && <p role="status" className={styles.note}>{t("今週の動きを集計中…", "Tallying this week…")}</p>}
    {state === "failed" && <p role="alert" className={styles.note}>{t("ニュースと決算を取得できませんでした。しばらくしてからもう一度お試しください。", "News and earnings could not be loaded. Please try again shortly.")}</p>}
    {notebook && <>
      <div className={styles.chips} role="group" aria-label={t("種類で絞り込み", "Filter")}>
        {chips.map(chip => <button type="button" key={chip.key} aria-pressed={filter === chip.key} className={filter === chip.key ? styles.on : ""} onClick={() => setFilter(chip.key)}>{chip.label}<small>{chip.count}</small></button>)}
      </div>
      {full ? <div className={styles.details}>
        {days.map(day => <section key={day} className={styles.day}>
          <h3>{dayHeading(shown.find(entry => dayKey(entry.at) === day)!.at, ja)}</h3>
          <ul>{shown.filter(entry => dayKey(entry.at) === day).map(entry => {
            if (entry.kind === "institutional") {
              const names = [...new Set(entry.items.map(item => item.ticker))];
              const expanded = !!open[entry.id];
              return <li key={entry.id} className={styles.fold}>
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(current => ({ ...current, [entry.id]: !expanded }))}>
                  <span>{t(`機関投資家の売買 ${entry.items.length}件(${names.join("、")})`, `Institutional trades: ${entry.items.length} (${names.join(", ")})`)}</span><i aria-hidden="true">{expanded ? "⌃" : "⌄"}</i>
                </button>
                {expanded && <ul className={styles.foldList}>{entry.items.map((item, index) => <li key={index}><b>{item.ticker}</b><span>{item.title}</span><time dateTime={item.at}>{clock(item.at)}</time></li>)}</ul>}
              </li>;
            }
            const kind: Kind = entry.kind;
            const change = entry.kind === "targets" && entry.previous > 0 ? (entry.latest / entry.previous - 1) * 100 : null;
            return <li key={entry.id} className={styles.entry} data-kind={kind}>
              <div className={styles.entryTop}><i className={styles.dot} aria-hidden="true" /><b>{entry.ticker}</b><span className={styles.tag}>{label(kind)}</span><time dateTime={entry.at}>{clock(entry.at)}</time></div>
              {entry.kind === "targets" ? <>
                <p>{entry.firm}</p>
                <div className={styles.facts}><span>{usd(entry.previous)} → {usd(entry.latest)}</span>{change !== null && <span className={change >= 0 ? styles.rise : styles.fall}>{change > 0 ? "+" : change < 0 ? "−" : ""}{Math.abs(change).toFixed(1)}%</span>}</div>
              </> : <>
                <p>{entry.title}</p>
                {entry.kind === "earnings" && entry.facts.length > 0 && <div className={styles.facts}>{entry.facts.map(fact => <span key={fact}>{fact}</span>)}</div>}
              </>}
            </li>;
          })}</ul>
        </section>)}
        {!shown.length && <p className={styles.note}>{t("この週は、登録銘柄に目立った動きはありませんでした。", "No notable moves for your stocks this week.")}</p>}
      </div> : <p className={styles.lock}><b>FREE</b>{t("件数のみ表示しています。", "Counts only.")}<br /><Link href="/research#tech-phase-pro">{t("PRO版は、中身まで読めます。", "PRO shows what is behind them.")}</Link></p>}
      <p className={styles.fine}>{t("ニュースは、取得対象の銘柄だけに表示されます。", "News covers the stocks Tech Phase monitors.")}</p>
    </>}
  </section>;
}
