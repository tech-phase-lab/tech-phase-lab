"use client";

import { useEffect, useState } from "react";
import type { Language } from "@/lib/research/data";
import { publicNewsPayload, type GeneralNewsFeed } from "@/lib/research/general-news";
import styles from "./general-news.module.css";

export default function GeneralNewsPanel({ lang }: { lang: Language }) {
  const [data, setData] = useState<GeneralNewsFeed | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [receivedAt, setReceivedAt] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/research/news", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const payload = publicNewsPayload(await response.json());
        if (!stopped) { setData(payload); setError(false); setReceivedAt(new Date().toISOString()); }
      } catch {
        if (!stopped) { setData(null); setError(true); setReceivedAt(null); }
      } finally { if (!stopped) timer = setTimeout(load, 30_000); }
    }
    void load();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [refresh]);
  const format = (value: string) => new Date(value).toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";
  const impactLabels = lang === "ja"
    ? { positive: "プラス", negative: "マイナス", mixed: "両面", neutral: "中立", uncertain: "不明" }
    : { positive: "Positive", negative: "Negative", mixed: "Mixed", neutral: "Neutral", uncertain: "Uncertain" };
  const confidenceLabels = lang === "ja" ? { high: "高", medium: "中", low: "低" } : { high: "High", medium: "Medium", low: "Low" };
  return <section className={styles.panel} aria-labelledby="general-news-title">
    <div className={styles.head}><h2 id="general-news-title">{lang === "ja" ? "通常ニュース" : "General news"}</h2><button type="button" onClick={() => setRefresh(value => value + 1)}>{lang === "ja" ? "更新" : "Refresh"}</button></div>
    {error ? <p role="status">{lang === "ja" ? "ニュースを取得できません。しばらくしてから更新してください。" : "News is unavailable. Please refresh shortly."}</p> : !data ? <p role="status">{lang === "ja" ? "読み込み中…" : "Loading…"}</p> : !data.enabled ? <p>{lang === "ja" ? "通常ニュースの配信は準備中です。" : "General news coverage is coming soon."}</p> : <>
      <p className={styles.note}>{lang === "ja" ? "日英の内容を確認した記事を掲載しています。" : "Articles are published after review of both language versions."}</p>
      {!data.items.length && <p>{lang === "ja" ? "現在、公開中の記事はありません。" : "No articles are currently published."}</p>}
      <div className={styles.items}>{data.items.map(item => <article key={item.id}>
        <p className={styles.tickers}>{item.tickers.join(" · ")}</p><h3>{item.title}</h3>
        <p className={styles.summary} lang={lang}>{lang === "ja" ? item.summaryJa : item.summaryEn}</p>
        <div className={styles.impact}><p><strong>{lang === "ja" ? "事業への影響" : "Business impact"}</strong><span>{impactLabels[item.impactLabel]} · {lang === "ja" ? "確信度" : "Confidence"} {confidenceLabels[item.confidence]}</span></p><p lang={lang}>{lang === "ja" ? item.impactJa : item.impactEn}</p></div>
        <p className={styles.note}>{lang === "ja" ? "発表" : "Published"} {format(item.publishedAt)} · {lang === "ja" ? "確認" : "Reviewed"} {format(item.approvedAt)}</p>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{item.publisher} ↗</a>
      </article>)}</div>
      {receivedAt && <p className={styles.note}>{lang === "ja" ? "画面取得" : "Fetched"} {format(receivedAt)} · {lang === "ja" ? "30秒ごとに更新" : "Refreshes every 30 seconds"}</p>}
    </>}
  </section>;
}
