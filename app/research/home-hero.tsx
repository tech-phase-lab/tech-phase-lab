"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Language } from "@/lib/research/data";
import { usMarketSession, type MarketSession } from "@/lib/research/us-market-session";
import styles from "./home-hero.module.css";

const dateLabel = (ja: boolean) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", month: ja ? "long" : "short", day: "numeric", weekday: "short" }).format(new Date());

/** Home heading: date, market state, one-line headline. Visual only. The market
 * state comes from the clock and the NYSE holiday calendar (lib/research/us-market-session). */
export default function HomeHero({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  const date = useSyncExternalStore(() => () => {}, () => dateLabel(ja), () => "");
  const session = now ? usMarketSession(new Date(now)) : null;
  const labels: Record<MarketSession, [string, string]> = {
    regular: ["米国市場 取引中", "US MARKET OPEN"], pre: ["米国市場 プレマーケット", "US PRE-MARKET"], post: ["米国市場 時間外取引", "US AFTER-HOURS"],
    closed: ["米国市場 閉場中", "US MARKET CLOSED"], holiday: ["米国市場 休場日", "US MARKET HOLIDAY"],
  };
  return <header className={styles.hero}>
    <p className={styles.status}>
      {session ? <b className={session === "regular" ? undefined : styles.idle}><i aria-hidden="true" />{labels[session][ja ? 0 : 1]}</b> : <b className={styles.idle}><i aria-hidden="true" /></b>}
      <span>{date}</span>
    </p>
    <h1 id="research-page-title" className={ja ? styles.ja : styles.en}>{ja ? <>米国株の変化を、<em>先読み</em>する。</> : <>Read US stocks <em>one move ahead</em>.</>}</h1>
    <p className={styles.sub}>{ja ? "速報・決算・資金の流れをひとつの画面で" : "News, earnings and capital flows on one screen"}</p>
  </header>;
}
