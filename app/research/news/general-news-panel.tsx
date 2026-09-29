"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import { publicNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import { officialHeadlineJa } from "@/lib/research/official-news-ja";
import styles from "./general-news.module.css";

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
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/research/news", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const payload = publicNewsPayload(await response.json());
        if (!stopped) { const at = new Date().toISOString(); snapshot = { data: payload, at, time: Date.now() }; setData(payload); setError(false); setReceivedAt(at); }
      } catch {
        if (!stopped) { setData(null); setError(true); setReceivedAt(null); }
      } finally { if (!stopped) timer = setTimeout(load, 30_000); }
    }
    if (refresh === 0 && recent()) timer = setTimeout(load, Math.max(0, 30_000 - (Date.now() - snapshot!.time)));
    else void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
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
    {!!visibleOfficial.length && <section aria-label={lang === "ja" ? "企業の公式発表" : "Official company updates"}>
      <h2>{lang === "ja" ? "企業の公式発表" : "Official company updates"}</h2>
      <p className={styles.note}>{lang === "ja" ? "公式発表・投稿の内容を日本語の見出しで紹介します。時刻は取得日時です。" : "Official company updates. Times show when we found each update."}</p>
      <div className={styles.items}>{visibleOfficial.map(item => { const translated = officialHeadlineJa(item.url); const linkOnly = /^https?:\/\/\S+$/.test(item.title.trim()); return <article key={item.id}>
        <p className={styles.tickers}>{item.tickers.join(" · ")} · {item.publisher}</p>
        <h3><a href={item.url} target="_blank" rel="noopener noreferrer">{lang === "ja" ? translated ?? (linkOnly ? "公式投稿（リンクのみ・本文未取得）" : "公式アップデート（日本語訳を準備中）") : item.title}</a></h3>
        <p className={styles.note}>{lang === "ja" ? "取得日時" : "Found at"} {format(item.observedAt)}</p>
      </article>; })}</div>
    </section>}
    {officialOnly && !data?.officialUpdates?.length && <p role="status">{error ? (lang === "ja" ? "公式発表を取得できません。" : "Official updates unavailable.") : !data ? (lang === "ja" ? "読み込み中…" : "Loading…") : (lang === "ja" ? "現在、掲載中の公式発表はありません。" : "No official updates currently listed.")}</p>}
    {!officialOnly && (visibleNews.length > 0 || !data?.enabled || !news.length) && <><div className={styles.head}><h2 id="general-news-title">{lang === "ja" ? "通常ニュース" : "General news"}</h2><button type="button" onClick={() => setRefresh(value => value + 1)}>{lang === "ja" ? "更新" : "Refresh"}</button></div>
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
