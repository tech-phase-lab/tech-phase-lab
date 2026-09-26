"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";

type Target = {
  id: number; ticker: string; firm: string; previous: number; latest: number;
  source: string; url: string; publishedAt: string; observedAt: string;
};

export default function PriceTargetsPanel({ lang }: { lang: Language }) {
  const panelRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<Target[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let visible = false;
    let inFlight = false;
    const read = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/research/price-targets");
        if (!response.ok) throw new Error("Feed unavailable");
        const data: { ok: boolean; items: Target[] } = await response.json();
        if (!data.ok || !Array.isArray(data.items)) throw new Error("Invalid feed");
        if (active) { setItems(data.items); setStatus("ready"); setUpdatedAt(new Date().toISOString()); }
      } catch { if (active) setStatus("error"); }
      finally { inFlight = false; }
    };
    const refreshWhenVisible = () => { if (visible && !document.hidden) void read(); };
    const panel = panelRef.current;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      const wasVisible = visible;
      visible = entry.isIntersecting;
      if (visible && !wasVisible) refreshWhenVisible();
    }, { rootMargin: "300px" });
    if (observer && panel) observer.observe(panel);
    else { visible = true; refreshWhenVisible(); }
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const timer = window.setInterval(refreshWhenVisible, 15_000);
    return () => { active = false; observer?.disconnect(); document.removeEventListener("visibilitychange", refreshWhenVisible); window.clearInterval(timer); };
  }, []);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const time = (date: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(date));
  return <section ref={panelRef} className={styles.panel} aria-label={t("目標株価の速報", "Price target updates")}>
    <div className={styles.head}><div><span className={styles.kicker}>X PRICE TARGET MONITOR · {t("試験表示", "PILOT")}</span><h3>{t("目標株価の変更", "Price target changes")}</h3></div><span className={styles.refresh}>{t("15秒ごとに画面を更新", "Page refreshes every 15 seconds")}</span></div>
    {status === "error" && <p role="status" className={styles.state}>{t("現在、目標株価の更新を取得できません。表示内容は最新とは限りません。", "Price target updates are temporarily unavailable. Displayed items may be stale.")}</p>}
    {status === "loading" && <p role="status" className={styles.state}>{t("更新を確認中…", "Checking updates…")}</p>}
    {status === "ready" && items.length === 0 && <p className={styles.state}>{t("条件に合う目標株価の投稿はまだありません。", "No matching price target posts yet.")}</p>}
    {items.length > 0 && <div className={styles.list}>{items.map((item) => {
      const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
      const seconds = Math.max(0, Math.round((Date.parse(item.observedAt) - Date.parse(item.publishedAt)) / 1000));
      return <article key={item.id} className={styles.card}>
        <span className={styles.ticker}>{item.ticker}</span>
        <div className={styles.body}><strong>{lang === "ja" ? `${item.firm}の目標株価：$${number(item.previous)} → $${number(item.latest)}（${item.latest > item.previous ? "引き上げ" : "引き下げ"}）` : `${item.firm} price target: $${number(item.previous)} → $${number(item.latest)} (${item.latest > item.previous ? "raised" : "lowered"})`}</strong>
          <small>{item.source} · {t("X投稿", "X post")} <time dateTime={item.publishedAt}>{time(item.publishedAt)} JST</time> · {t("取得", "Detected")} <time dateTime={item.observedAt}>{time(item.observedAt)} JST</time> · {t("取得差", "Detection lag")} {seconds}{t("秒", "s")}</small></div>
        <a href={item.url} target="_blank" rel="noopener noreferrer">{t("投稿を確認 ↗", "View post ↗")}</a>
      </article>;
    })}</div>}
    {updatedAt && <p className={styles.updated}>{t("画面の最終確認", "Last page check")}: {time(updatedAt)} JST</p>}
  </section>;
}
