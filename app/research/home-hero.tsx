"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./home-hero.module.css";

const dateLabel = (ja: boolean) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", month: ja ? "long" : "short", day: "numeric", weekday: "short" }).format(new Date());

/** Home heading: date, market state, one-line headline. Visual only; the
 * market state is read once from the existing /api/market clock and is simply
 * left out when that is unavailable (never guessed from the time of day). */
export default function HomeHero({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const [open, setOpen] = useState<boolean | null>(null);
  const date = useSyncExternalStore(() => () => {}, () => dateLabel(ja), () => "");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/market", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : null)
      .then((data: { marketOpen?: unknown } | null) => setOpen(typeof data?.marketOpen === "boolean" ? data.marketOpen : null))
      .catch(() => setOpen(null));
    return () => controller.abort();
  }, []);
  return <header className={styles.hero}>
    <p className={styles.status}>
      {open !== null ? <b><i aria-hidden="true" />{open ? (ja ? "米国市場 取引中" : "US MARKET OPEN") : (ja ? "米国市場 閉場中" : "US MARKET CLOSED")}</b> : <b className={styles.quiet}>TECH PHASE RESEARCH</b>}
      <span>{date}</span>
    </p>
    <h1 id="research-page-title" className={ja ? styles.ja : styles.en}>{ja ? <>米国株の変化を、<em>先読み</em>する。</> : <>Read US stocks <em>one move ahead</em>.</>}</h1>
    <p className={styles.sub}>{ja ? "速報・決算・資金の流れをひとつの画面で" : "News, earnings and capital flows on one screen"}</p>
  </header>;
}
