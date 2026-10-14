"use client";

import { useMemberDisplay } from "./member-display-provider";
import Link from "next/link";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { dateLabel } from "@/lib/research/presentation";
import { useStockFavorites } from "./use-stock-favorites";
import styles from "./home-tools.module.css";

export default function HomeTools({ lang, onPro, onWatch }: { lang: Language; onPro: () => void; onWatch: () => void }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const plan = useMemberDisplay();
  const locked = plan !== "pro";
  return <>
    <nav className={styles.grid} aria-label={t("よく使う機能", "Quick tools")}>
      <Link href="/research/calendar"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">📅</span><strong>{t("決算・経済指標", "Earnings")}</strong></span><small>{t("今週の予定を確認", "This week")}</small></Link>
      <Link href="/resolute"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">⚓</span><strong>RESOLUTE</strong></span><small>{t("独自ルール開発キット", "Build your own rules")}</small></Link>
      <Link href="/research/capital-map"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">🗺️</span><strong>{t("資本マップ", "Capital Map")}</strong></span><small>{t("運用会社・ETFの投資先", "Funds and ETFs")}</small></Link>
      <Link href="/research#monitored-companies" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onWatch(); }}><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">🔭</span><strong>{t("監視22銘柄", "Watch 22")}</strong></span><small>{t("厳選株をリアルタイムで", "Live, curated")}</small></Link>
    </nav>
    <nav className={`${styles.reading} ${locked ? styles.readingLocked : ""}`} aria-label={t("リゼルのリサーチ", "RIZEL’s research")}>
      <div className={styles.deskHeading}><span>RIZEL’S DESK</span><span className={styles.deskEdition}>TECH PHASE PRO</span></div>
      <Link href="/research/notes" className={styles.deskLead}><div><strong>{t("リゼルのひとりごと", "RIZEL’s Notes")}</strong><p>{t("数字の先にある、相場の着眼点。", "A perspective beyond the numbers.")}</p></div><span aria-hidden="true">→</span></Link>
      <div className={styles.deskPair}>
        <Link href="/research/qa"><strong>{t("リゼルに聞く", "Ask RIZEL")}</strong><span className={styles.deskSmall}>{t("疑問から、理解を深める", "Questions worth exploring")}</span><span aria-hidden="true">→</span></Link>
        <Link href="/research/weekly"><strong>{t("週刊PRO", "PRO Weekly")}</strong><span className={styles.deskSmall}>{t("一週間の変化と展望", "The week’s shifts & outlook")}</span><span aria-hidden="true">→</span></Link>
      </div>
      {locked && <div className={styles.deskOverlay}>
        <div className={styles.overlayCaption}><span className={styles.overlayLabel}>TECH PHASE PRO</span>{locked && <strong><span className={styles.overlayLock} aria-hidden="true">🔒</span>{t("PRO会員限定", "Exclusive to PRO")}</strong>}</div>
      </div>}
    </nav>
    {locked && <button type="button" className={styles.proHint} onClick={onPro}><strong>{t("PROの限定機能を見る", "Explore PRO-exclusive features")} →</strong></button>}
  </>;
}

export function HomeHelp({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  return <section className={styles.help} aria-label={ja ? "学びとご利用案内" : "Learning and help"}>
    <p className={styles.helpEyebrow}>GUIDE</p>
    <h2>{ja ? "学びとご利用案内" : "Learning and help"}</h2>
    <nav className={styles.helpLinks} aria-label={ja ? "学びとご利用案内" : "Learning and help"}>
      <Link href="/research/learn"><span className={styles.helpIcon} aria-hidden="true">🔰</span>{ja ? "米国株のはじめ方" : "US stock basics"}</Link>
      <Link href="/research/faq"><span className={styles.helpIcon} aria-hidden="true">💡</span>{ja ? "よくある質問・使い方" : "FAQ & help"}</Link>
    </nav>
  </section>;
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
