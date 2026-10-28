"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { countTodayEvents, countTodayNews, countTodayTargets } from "@/lib/research/home-today";
import { newsSnapshot, serverNewsSnapshot, subscribeNews } from "@/lib/research/news-snapshot";
import { priceTargetSnapshot, serverPriceTargetSnapshot, subscribePriceTargets } from "@/lib/research/price-target-snapshot";
import { useCalendarClock } from "./use-calendar-clock";
import { useMemberDisplay, useResearchOwner } from "./member-display-provider";
import styles from "./home-today.module.css";

function scrollToSection(id: string) {
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "start" });
}

/** Today's counts for PRO members and the owner, read from the same data the
 * lists below and the calendar show. A count that cannot be read shows "–". */
export default function HomeToday({ lang }: { lang: Language }) {
  const plan = useMemberDisplay();
  const owner = useResearchOwner();
  const now = useCalendarClock();
  const news = useSyncExternalStore(subscribeNews, newsSnapshot, serverNewsSnapshot);
  const targets = useSyncExternalStore(subscribePriceTargets, priceTargetSnapshot, serverPriceTargetSnapshot);
  if (plan !== "pro" && !owner) return null;
  const ja = lang === "ja";
  const value = (count: number | null) => count === null ? "–" : String(count);
  const unit = (count: number | null) => ja && count !== null ? <i>件</i> : null;
  const newsCount = now === null ? null : countTodayNews(news?.data ?? null, lang, now);
  const eventCount = now === null ? null : countTodayEvents(now, lang);
  const targetCount = now === null ? null : countTodayTargets(targets, lang, now);
  return <section className={styles.today} aria-label="TODAY">
    <p className={styles.label}>TODAY</p>
    <div className={styles.row}>
      <button type="button" className={styles.news} onClick={() => scrollToSection("home-news")}><b>{value(newsCount)}{unit(newsCount)}</b>{ja ? "新着ニュース" : "New news"}</button>
      <Link href="/research/calendar"><b>{value(eventCount)}{unit(eventCount)}</b>{ja ? "今日の予定" : "Today’s events"}</Link>
      <button type="button" onClick={() => scrollToSection("home-price-targets")}><b>{value(targetCount)}{unit(targetCount)}</b>{ja ? "目標株価更新" : "Target price changes"}</button>
    </div>
  </section>;
}
