"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";
import { EventStreamParser, abortableDelay } from "@/lib/research/event-stream";

import NotificationSettings from "./notification-settings";

type Target = {
  id: number; ticker: string; firm: string; previous: number; latest: number;
  source: string; url: string; publishedAt: string; observedAt: string;
};

export default function PriceTargetsPanel({ lang }: { lang: Language }) {
  const panelRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<Target[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"connecting" | "live" | "polling">("connecting");
  useEffect(() => {
    let active = true;
    let visible = false;
    let session: AbortController | null = null;
    const applySnapshot = (data: { ok: boolean; items: Target[] }, signal: AbortSignal) => {
      if (!data.ok || !Array.isArray(data.items) || data.items.length > 30) throw new Error("Invalid feed");
      if (active && !signal.aborted) {
        setItems(data.items); setStatus("ready"); setUpdatedAt(new Date().toISOString());
      }
    };
    const readFallback = async (signal: AbortSignal) => {
      try {
        const response = await fetch("/api/research/price-targets", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
        if (!response.ok) throw new Error("Feed unavailable");
        applySnapshot(await response.json(), signal);
      } catch { if (active && !signal.aborted) setStatus("error"); }
    };
    const run = async (signal: AbortSignal) => {
      let failures = 0;
      while (!signal.aborted) {
        const connection = new AbortController();
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let expiresAt = 0;
        try {
          const response = await fetch("/api/research/price-targets/stream", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) throw new Error("Stream unavailable");
          const config = await response.json();
          if (!config.ok || typeof config.ticket !== "string" || typeof config.url !== "string") throw new Error("Invalid connection");
          expiresAt = config.expiresAt * 1000;
          watchdog = setTimeout(() => connection.abort(), 15_000);
          const stream = await fetch(config.url, { headers: { Authorization: `Bearer ${config.ticket}` },
            signal: AbortSignal.any([signal, connection.signal]), credentials: "omit", cache: "no-store" });
          if (!stream.ok || !stream.body || !stream.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Stream unavailable");
          reader = stream.body.getReader();
          const decoder = new TextDecoder();
          const parser = new EventStreamParser();
          while (!signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) break;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => connection.abort(), 45_000);
            for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
              if (event.event === "unavailable") throw new Error("Feed unavailable");
              if (event.event === "snapshot") {
                applySnapshot(JSON.parse(event.data), signal);
                if (active && !signal.aborted) setDelivery("live");
                failures = 0;
              }
            }
          }
          // Renew an expiring ticket without treating normal rotation as failure.
          if (Date.now() < expiresAt - 2000) throw new Error("Stream disconnected");
        } catch {
          connection.abort();
          await reader?.cancel().catch(() => {});
          if (signal.aborted) break;
          if (active) setDelivery("polling");
          failures += 1;
          await readFallback(signal);
          const retryAfter = Math.min(60_000, 5_000 * 2 ** Math.min(failures - 1, 4)) + Math.random() * 1000;
          for (let waited = 0; waited < retryAfter && !signal.aborted; waited += 15_000) {
            await abortableDelay(Math.min(15_000, retryAfter - waited), signal).catch(() => {});
            if (waited + 15_000 < retryAfter && !signal.aborted) await readFallback(signal);
          }
        } finally {
          clearTimeout(watchdog);
          connection.abort();
          await reader?.cancel().catch(() => {});
        }
      }
    };
    const syncVisibility = () => {
      if (visible && !document.hidden) {
        if (!session) {
          session = new AbortController();
          void run(session.signal);
        }
      } else { session?.abort(); session = null; }
    };
    const panel = panelRef.current;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncVisibility();
    }, { rootMargin: "300px" });
    if (observer && panel) observer.observe(panel);
    else { visible = true; syncVisibility(); }
    document.addEventListener("visibilitychange", syncVisibility);
    return () => { active = false; session?.abort(); observer?.disconnect(); document.removeEventListener("visibilitychange", syncVisibility); };
  }, []);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const time = (date: string) => new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(date));
  return <section ref={panelRef} className={styles.panel} aria-label={t("目標株価の速報", "Price target updates")}>
    <div className={styles.head}><div><span className={styles.kicker}>X PRICE TARGET MONITOR · {t("試験表示", "PILOT")}</span><h3>{t("目標株価の変更", "Price target changes")}</h3></div><span className={styles.refresh}>{delivery === "live" ? t("新着を自動表示", "Live updates") : delivery === "polling" ? t("再接続中・15秒ごとに確認", "Reconnecting · checking every 15s") : t("接続中…", "Connecting…")}</span></div>
    <NotificationSettings lang={lang} />
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
    {updatedAt && <p className={styles.updated}>{t("最終同期", "Last synced")}: {time(updatedAt)} JST</p>}
  </section>;
}
