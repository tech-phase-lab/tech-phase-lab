"use client";

import Link from "next/link";
import type { Language } from "@/lib/research/data";
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
