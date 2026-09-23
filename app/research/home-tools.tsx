"use client";

import Link from "next/link";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { dateLabel } from "@/lib/research/presentation";
import { useStockFavorites } from "./use-stock-favorites";
import styles from "./home-tools.module.css";

export default function HomeTools({ lang, onChanges }: { lang: Language; onChanges: () => void }) {
  const { favorites } = useStockFavorites();
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  return <nav className={styles.grid} aria-label={t("よく使う機能", "Quick tools")}>
    <Link href="/research/stocks"><span className={styles.icon} aria-hidden="true">🔍</span><strong>{t("銘柄検索", "Stock search")}</strong><p>{t("株価・チャート・企業情報", "Quotes, charts & company data")}</p><span className={styles.action}>{t("銘柄を探す", "Find stocks")} →</span></Link>
    <Link href="/research/watchlist"><span className={styles.icon} aria-hidden="true">⭐️</span><strong>{t("お気に入り銘柄", "Favorite stocks")}{favorites.length > 0 && <small> ({favorites.length})</small>}</strong><p>{t("銘柄へすぐアクセス", "Your stocks, one tap away")}</p><span className={styles.action}>{t("ウォッチリストを開く", "Open watchlist")} →</span></Link>
    <Link href="/research/calendar"><span className={styles.icon} aria-hidden="true">🗓️</span><strong>{t("決算・経済指標", "Earnings & economy")}<br />{t("カレンダー", "calendar")}</strong><p>{t("公式予定を日本時間で確認", "Official schedules in U.S. Eastern time")}</p><span className={styles.action}>{t("日程を見る", "View schedule")} →</span></Link>
    <button onClick={onChanges}><span className={styles.icon} aria-hidden="true">♻️</span><strong>{t("何が変わった？", "What changed?")}</strong><p>{t("企業の変化をひと目で", "Company changes at a glance")}</p><span className={styles.action}>{t("リサーチを読む", "Read research")} →</span></button>
  </nav>;
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
