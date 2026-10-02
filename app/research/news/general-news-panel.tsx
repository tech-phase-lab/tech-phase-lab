"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import { publicNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { officialHeadlineJa } from "@/lib/research/official-news-ja";
import { officialTime } from "@/lib/research/news-time";
import { createNewsPoller, NEWS_POLL_INTERVAL_MS } from "@/lib/research/news-poller";
import styles from "./general-news.module.css";

import { publishNews } from "@/lib/research/news-snapshot";
import FeedPagination from "./feed-pagination";
let snapshot: { data: GeneralNewsFeed; at: string; time: number } | null = null;
const recent = () => snapshot && Date.now() - snapshot.time < 120_000 ? snapshot : null;

export default function GeneralNewsPanel({ lang, officialOnly = false }: { lang: Language; officialOnly?: boolean }) {
  const [data, setData] = useState<GeneralNewsFeed | null>(() => recent()?.data ?? null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [receivedAt, setReceivedAt] = useState<string | null>(() => recent()?.at ?? null);
  const panel = useRef<HTMLElement>(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    const cached = refresh === 0 ? recent() : null;
    const poller = createNewsPoller({
      load: async signal => {
        const response = await fetch("/api/research/news", { cache: "no-store", signal });
        if (!response.ok) throw new Error("unavailable");
        return publicNewsPayload(await response.json());
      },
      onSuccess: payload => {
        const at = new Date().toISOString();
        snapshot = { data: payload, at, time: Date.now() };
        setData(payload); publishNews(payload); setError(false); setReceivedAt(at);
      },
      onFailure: () => {
        // A failed check must not let a stale module snapshot reappear after remount.
        snapshot = null;
        setData(null); publishNews(null); setError(true); setReceivedAt(null);
      },
    });
    poller.start(cached ? Math.max(0, NEWS_POLL_INTERVAL_MS - (Date.now() - cached.time)) : 0);
    const wake = () => poller.wake();
    const wakeWhenVisible = () => { if (document.visibilityState === "visible") wake(); };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", wakeWhenVisible);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", wakeWhenVisible);
      poller.stop();
    };
  }, [refresh]);
  const official = data?.officialUpdates ?? [];
  const news = officialOnly ? [] : data?.items ?? [];
  const pages = Math.max(1, Math.ceil((official.length + news.length) / 5));
  const current = Math.min(page, pages), start = (current - 1) * 5;
  const visibleOfficial = official.slice(start, start + 5);
  const visibleNews = news.slice(Math.max(0, start - official.length), Math.max(0, start + 5 - official.length));
  const format = (value: string) => new Date(value).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";
  const impactLabels = lang === "ja"
    ? { positive: "プラス", negative: "マイナス", mixed: "両面", neutral: "中立", uncertain: "不明" }
    : { positive: "Positive", negative: "Negative", mixed: "Mixed", neutral: "Neutral", uncertain: "Uncertain" };
  const confidenceLabels = lang === "ja" ? { high: "高", medium: "中", low: "低" } : { high: "High", medium: "Medium", low: "Low" };
  return <section ref={panel} className={styles.panel} aria-label={lang === "ja" ? "ニュース一覧" : "News list"}>
    {!!visibleOfficial.length && <section aria-label={lang === "ja" ? "公式発表" : "Official updates"}>
      <div className={styles.items}>{visibleOfficial.map(item => { const publication = officialTime(item); const translated = officialHeadlineJa(item.url) ?? item.translationJa; const linkOnly = /^https?:\/\/\S+$/.test(item.title.trim()); return <article key={item.id}>
        <p className={styles.tickers}>{[item.tickers.join(" · "), item.researchId?.startsWith("x-result-") ? "" : item.publisher].filter(Boolean).join(" · ")}</p>
        <h3><a href={item.researchId ? `/research?result=${item.researchId}#what-changed/${item.researchId}` : item.url} target={item.researchId ? undefined : '_blank'} rel="noopener noreferrer">{lang === "ja" ? translated ?? (linkOnly ? "公式投稿（リンクのみ・本文未取得）" : "公式アップデート（日本語訳を準備中）") : item.title}</a></h3>
        <p className={styles.note}>{publication.kind === "observed" ? (lang === "ja" ? "取得" : "Found") : (lang === "ja" ? "発表" : "Published")} {publication.kind === "date" ? publication.at : format(publication.at)}</p>
      </article>; })}</div>
    </section>}
    {officialOnly && !data?.officialUpdates?.length && <p role="status">{error ? (lang === "ja" ? "公式発表を取得できません。" : "Official updates unavailable.") : !data ? (lang === "ja" ? "読み込み中…" : "Loading…") : (lang === "ja" ? "現在、掲載中の公式発表はありません。" : "No official updates currently listed.")}</p>}
    {!officialOnly && (visibleNews.length > 0 || (!official.length && (!data?.enabled || !news.length))) && <><div className={styles.head}><h2 id="general-news-title">{lang === "ja" ? "通常ニュース" : "General news"}</h2><button type="button" onClick={() => setRefresh(value => value + 1)}>{lang === "ja" ? "更新" : "Refresh"}</button></div>
    {error ? <p role="status">{lang === "ja" ? "ニュースを取得できません。しばらくしてから更新してください。" : "News is unavailable. Please refresh shortly."}</p> : !data ? <div className={styles.placeholder} aria-busy="true" aria-label={lang === "ja" ? "ニュースを取得中" : "Fetching news"} /> : !data.enabled ? <p>{lang === "ja" ? "通常ニュースの配信は準備中です。" : "General news coverage is coming soon."}</p> : <>
      <p className={styles.note}>{lang === "ja" ? "日英の内容を確認した記事を掲載しています。" : "Articles are published after review of both language versions."}</p>
      {!data.items.length && <p>{lang === "ja" ? "現在、公開中の記事はありません。" : "No articles are currently published."}</p>}
      <div className={styles.items}>{visibleNews.map(item => <article key={item.id}>
        <p className={styles.tickers}>{item.tickers.join(" · ")}</p><h3>{item.title}</h3>
        <p className={styles.summary} lang={lang}>{lang === "ja" ? item.summaryJa : item.summaryEn}</p>
        <div className={styles.impact}><p><strong>{lang === "ja" ? "事業への影響" : "Business impact"}</strong><span>{impactLabels[item.impactLabel]} · {lang === "ja" ? "確信度" : "Confidence"} {confidenceLabels[item.confidence]}</span></p><p lang={lang}>{lang === "ja" ? item.impactJa : item.impactEn}</p></div>
        <p className={styles.note}>{lang === "ja" ? "発表" : "Published"} {format(item.publishedAt)} · {lang === "ja" ? "確認" : "Reviewed"} {format(item.approvedAt)}</p>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.publisher} ↗</a>
      </article>)}</div>
      {receivedAt && <p className={styles.note}>{lang === "ja" ? "画面取得" : "Fetched"} {format(receivedAt)} · {lang === "ja" ? "30秒ごとに更新" : "Refreshes every 30 seconds"}</p>}
    </>}
    </>}
    <FeedPagination page={current} pages={pages} ja={lang === "ja"} onChange={n => { setPage(n); panel.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
  </section>;
}
