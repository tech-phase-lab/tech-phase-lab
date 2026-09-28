"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { dateLabel } from "@/lib/research/presentation";
import { useStockFavorites } from "./use-stock-favorites";
import styles from "./home-tools.module.css";

export default function HomeTools({ lang, onChanges }: { lang: Language; onChanges: () => void }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const [latestNote, setLatestNote] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/posts/latest-note", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) })
      .then(async response => response.ok ? response.json() : null)
      .then(data => { if (data?.ok && typeof data.item?.publishedAt === "string") setLatestNote(data.item.publishedAt); })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  const latestLabel = latestNote ? new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", { dateStyle: "medium", timeZone: "Asia/Tokyo" }).format(new Date(latestNote)) : null;
  return <>
    <nav className={styles.grid} aria-label={t("よく使う機能", "Quick tools")}>
      <Link href="/research/stocks"><span className={styles.icon} aria-hidden="true">🔍</span><strong>{t("銘柄検索", "Stock search")}</strong><p>{t("株価・チャート・企業情報", "Quotes, charts & company data")}</p><span className={styles.action} aria-hidden="true">↗</span></Link>
      <Link href="/research/market"><span className={styles.icon} aria-hidden="true">📊</span><strong>{t("マーケット", "Markets")}</strong><p>{t("主要指数・金利・為替", "Indices, yields & currencies")}</p><span className={styles.action} aria-hidden="true">↗</span></Link>
      <Link href="/research/calendar"><span className={styles.icon} aria-hidden="true">🗓️</span><strong>{t("決算・経済指標", "Earnings & economy")}</strong><p>{t("カレンダーで予定を確認", "Upcoming events")}</p><span className={styles.action} aria-hidden="true">↗</span></Link>
      <button onClick={onChanges}><span className={styles.icon} aria-hidden="true">♻️</span><strong>{t("何が変わった？", "What changed?")}</strong><p>{t("企業の変化と、その根拠", "Company shifts & evidence")}</p><span className={styles.action} aria-hidden="true">↗</span></button>
      <Link href="/research/learn"><span className={styles.icon} aria-hidden="true">📘</span><strong>{t("米国株のはじめ方", "US stock basics")}</strong><p>{t("口座・注文・決算を順番に", "Accounts, orders & earnings")}</p><span className={styles.action} aria-hidden="true">↗</span></Link>
      <Link href="/research/faq"><span className={styles.icon} aria-hidden="true">💬</span><strong>{t("サービスFAQ", "Service FAQ")}</strong><p>{t("会員・質問・通知の案内", "Membership, questions & alerts")}</p><span className={styles.action} aria-hidden="true">↗</span></Link>
    </nav>
    <nav className={styles.reading} aria-label={t("リゼルのリサーチ", "RIZEL’s research")}>
      <div className={styles.deskHeading}><span>RIZEL’S DESK</span><span className={styles.deskEdition}>TECH PHASE PRO</span></div>
      <Link href="/research/notes" className={styles.deskLead}><div><strong>{t("リゼルのひとりごと", "RIZEL’s Notes")}</strong><p>{latestLabel ? t(`最新の投稿 · ${latestLabel}（本文はPRO会員向け）`, `Latest post · ${latestLabel} (PRO body)`) : t("数字の先にある、相場の着眼点。", "A perspective beyond the numbers.")}</p></div><span aria-hidden="true">→</span></Link>
      <div className={styles.deskPair}>
        <Link href="/research/qa"><strong>{t("リゼルに聞く", "Ask RIZEL")}</strong><span className={styles.deskSmall}>{t("疑問から、理解を深める", "Questions worth exploring")}</span><span aria-hidden="true">→</span></Link>
        <Link href="/research/weekly"><strong>{t("週刊PRO", "PRO Weekly")}</strong><span className={styles.deskSmall}>{t("一週間の変化と展望", "The week’s shifts & outlook")}</span><span aria-hidden="true">→</span></Link>
      </div>
    </nav>
  </>;
}

export function FavoriteResearch({ lang, events, onOpenResearch }: { lang: Language; events: ResearchEvent[]; onOpenResearch: (event: ResearchEvent) => void }) {
  const { favorites } = useStockFavorites();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const matches = events.filter((event) => favorites.includes(event.ticker)).toSorted((a, b) => b.publishedOn.localeCompare(a.publishedOn));
  const uncovered = favorites.filter((ticker) => !events.some((event) => event.ticker === ticker));
  return <section className={styles.favoriteResearch} aria-labelledby="favorite-research-title">
    <div className={styles.favoriteHead}><div><p className={styles.favoriteEyebrow}>YOUR WATCHLIST</p><h2 id="favorite-research-title">{t("お気に入りの更新", "Updates for your favorites")}</h2></div><Link href="/research/watchlist">{t("ウォッチリスト", "Watchlist")} →</Link></div>
    {!favorites.length ? <div className={styles.favoriteEmpty}><p>{t("銘柄をお気に入りに追加すると、公開済みリサーチをここで確認できます。", "Add stocks to your favorites to see published research here.")}</p><Link href="/research/watchlist">{t("お気に入りを設定する", "Set up favorites")} →</Link></div> : <>
      {matches.length ? <ul className={styles.favoriteList}>{matches.slice(0, 3).map((event) => <li key={event.id}><button onClick={() => onOpenResearch(event)}><span className={styles.favoriteTicker}>{event.ticker}</span><span className={styles.favoriteTitle}>{event.title[lang]}</span><time dateTime={event.publishedOn}>{dateLabel(event.publishedOn, lang)}</time><span aria-hidden="true">→</span></button></li>)}</ul> : <p className={styles.favoriteEmptyCopy}>{t("お気に入り銘柄に関する公開リサーチはまだありません。", "No published research is available for your favorites yet.")}</p>}
      {uncovered.length > 0 && <p className={styles.favoriteCoverage}>{t("公開リサーチ未掲載", "No published research yet")}: {uncovered.join(", ")}</p>}
      <p className={styles.favoriteFoot}>{t("公開済みの過去リサーチです。速報・自動監視ではありません。", "Published historical research; this is not a live alert or automated monitoring feed.")}</p>
    </>}
  </section>;
}
