"use client";

import { useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./price-targets-panel.module.css";
import { EventStreamParser, abortableDelay, createSnapshotRevisionGuard } from "@/lib/research/event-stream";
import { observePageActivity } from "@/lib/research/page-activity";

import { formatTargetTime } from "@/lib/research/price-target-time";
import { publicPriceTargets, type PriceTarget as Target } from "@/lib/research/price-targets";

import FeedPagination from "./news/feed-pagination";
import { useCalendarClock } from "./use-calendar-clock";
import PriceTargetCard from "./price-target-card";
import NotificationSettings from "./notification-settings";

let snapshot: { items: Target[]; at: string; time: number } | null = null;
const recent = () => snapshot && Date.now() - snapshot.time < 120_000 ? snapshot : null;

export default function PriceTargetsPanel({ lang }: { lang: Language }) {
  const panelRef = useRef<HTMLElement>(null);
  const now = useCalendarClock();
  const [items, setItems] = useState<Target[]>(() => recent()?.items ?? []);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => recent() ? "ready" : "loading");
  const [updatedAt, setUpdatedAt] = useState<string | null>(() => recent()?.at ?? null);
  const [delivery, setDelivery] = useState<"connecting" | "live" | "polling">("connecting");
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / 4));
  const current = Math.min(page, pages);
  useEffect(() => {
    let active = true;
    let visible = false;
    let session: AbortController | null = null;
    let fallbackRequest: AbortController | null = null;
    let resumedAt = -Infinity;
    const snapshotRevision = createSnapshotRevisionGuard();
    const applySnapshot = (value: unknown, signal: AbortSignal) => {
      const data = publicPriceTargets(value);
      if (active && !signal.aborted) {
        const at = new Date().toISOString(); snapshot = { items: data.items, at, time: Date.now() };
        setItems(data.items); setStatus("ready"); setUpdatedAt(at);
      }
    };
    const readFallback = async (signal: AbortSignal) => {
      if (signal.aborted || fallbackRequest) return;
      const request = new AbortController();
      fallbackRequest = request;
      const requestSignal = AbortSignal.any([signal, request.signal, AbortSignal.timeout(10_000)]);
      const isCurrent = snapshotRevision.beginFallback();
      try {
        const response = await fetch("/api/research/price-targets", { signal: requestSignal });
        if (!response.ok) throw new Error("Feed unavailable");
        const snapshot = await response.json();
        // An initial GET can overlap the reconnect GET as well as SSE.
        if (isCurrent()) applySnapshot(snapshot, requestSignal);
      } catch {
        if (active && !signal.aborted && !request.signal.aborted && isCurrent()) {
          // Keep mounted items with the existing stale warning, but never
          // remount a failed check as a fresh, ready in-memory snapshot.
          snapshot = null;
          setStatus("error");
        }
      }
      finally { if (fallbackRequest === request) fallbackRequest = null; }
    };
    const run = async (signal: AbortSignal) => {
      let failures = 0;
      while (!signal.aborted) {
        const connection = new AbortController();
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        let firstSnapshotDeadline: ReturnType<typeof setTimeout> | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        let expiresAt = 0;
        try {
          const response = await fetch("/api/research/price-targets/stream", { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
          if (!response.ok) throw new Error("Stream unavailable");
          const config = await response.json();
          if (!config.ok || typeof config.ticket !== "string" || typeof config.url !== "string") throw new Error("Invalid connection");
          expiresAt = config.expiresAt * 1000;
          watchdog = setTimeout(() => connection.abort(), 15_000);
          // Pings/headers alone are not a usable initial feed.
          firstSnapshotDeadline = setTimeout(() => connection.abort(), 8_000);
          const stream = await fetch(config.url, { headers: { Authorization: `Bearer ${config.ticket}` },
            signal: AbortSignal.any([signal, connection.signal]), credentials: "omit", cache: "no-store" });
          if (!stream.ok || !stream.body || !stream.headers.get("content-type")?.includes("text/event-stream")) throw new Error("Stream unavailable");
          reader = stream.body.getReader();
          const decoder = new TextDecoder();
          const parser = new EventStreamParser();
          while (!signal.aborted) {
            const chunk = await reader.read();
            if (!active || signal.aborted) break;
            if (chunk.done) break;
            clearTimeout(watchdog);
            watchdog = setTimeout(() => connection.abort(), 45_000);
            for (const event of parser.push(decoder.decode(chunk.value, { stream: true }))) {
              if (event.event === "unavailable") throw new Error("Feed unavailable");
              if (event.event === "snapshot") {
                applySnapshot(JSON.parse(event.data), signal);
                snapshotRevision.streamUpdated();
                clearTimeout(firstSnapshotDeadline);
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
          clearTimeout(firstSnapshotDeadline);
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
          // Display the shared snapshot immediately; SSE connects independently.
          void readFallback(session.signal);
          void run(session.signal);
        }
      } else { session?.abort(); session = null; }
    };
    // Start the initial snapshot immediately, even below the fold. Only the
    // long-lived SSE connection depends on viewport visibility.
    const lifetime = new AbortController();
    const pause = () => {
      // iOS may suspend network callbacks and timeout clocks while hidden.
      // Invalidate the initial GET too, so resume cannot wait behind it.
      fallbackRequest?.abort(); fallbackRequest = null;
      session?.abort(); session = null;
      resumedAt = -Infinity;
    };
    const resume = () => {
      if (Date.now() - resumedAt < 1_000) return;
      resumedAt = Date.now();
      void readFallback(lifetime.signal);
      syncVisibility();
    };
    if (!document.hidden) resume();
    const panel = panelRef.current;
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncVisibility();
    }, { rootMargin: "300px" });
    if (observer && panel) observer.observe(panel);
    else { visible = true; syncVisibility(); }
    const stopObserving = observePageActivity(resume, pause);
    return () => { active = false; lifetime.abort(); pause(); observer?.disconnect(); stopObserving(); };
  }, []);
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const time = (date: string) => formatTargetTime(date, lang);
  return <section ref={panelRef} className={styles.panel} aria-label={t("目標株価の速報", "Price target updates")}>
    <div className={styles.head}><h3>{t("目標株価の変更（過去1週間）", "Price target changes (past week)")}</h3></div>
    {status === "error" && <p role="status" className={styles.state}>{t("現在、目標株価の更新を取得できません。表示内容は最新とは限りません。", "Price target updates are temporarily unavailable. Displayed items may be stale.")}</p>}
    {status === "loading" && <div aria-busy="true" aria-label={t("目標株価を取得中", "Fetching price targets")} className={styles.pending} />}
    {status === "ready" && items.length === 0 && <p className={styles.state}>{t("条件に合う目標株価の投稿はまだありません。", "No matching price target posts yet.")}</p>}
    {items.length > 0 && <div className={styles.list}>{items.slice((current - 1) * 4, current * 4).map(item =>
      <PriceTargetCard key={item.id} item={item} lang={lang} now={now} />
    )}</div>}
    <FeedPagination page={current} pages={pages} ja={lang === "ja"} onChange={n => { setPage(n); panelRef.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
    <div className={styles.footer}>
      <NotificationSettings lang={lang} />
      <div className={styles.syncMeta}>
        {updatedAt && <p className={styles.updated}>{t("表示データの取得日時", "Data fetched at")}: <time dateTime={updatedAt} title={time(updatedAt)}>{time(updatedAt)}</time></p>}
        <span className={styles.refresh}>{delivery === "live" ? t("新着を自動表示", "Live updates") : delivery === "polling" ? t("再接続中…", "Reconnecting…") : t("接続中…", "Connecting…")}</span>
      </div>
    </div>
  </section>;
}
