"use client";

import { useMemberDisplay, useMemberSettled } from "./member-display-provider";
import Link from "next/link";
import type { Language, ResearchEvent } from "@/lib/research/data";
import { dateLabel } from "@/lib/research/presentation";
import { useStockFavorites } from "./use-stock-favorites";
import styles from "./home-tools.module.css";

export default function HomeTools({ lang, onPro, onWatch }: { lang: Language; onPro: () => void; onWatch: () => void }) {
  const t = (ja: string, en: string) => lang === "ja" ? ja : en;
  const plan = useMemberDisplay();
  const locked = plan !== "pro";
  // Until the membership check answers, the DESK shows no dark cover, lock or PRO wording, so a PRO member never sees them flash (owner, Oct 21).
  // Once it answers, anyone who is not PRO gets the cover, the lock and the PRO wording as before.
  const settled = useMemberSettled();
  const covered = locked && settled;
  return <>
    <nav className={styles.grid} aria-label={t("よく使う機能", "Quick tools")}>
      <Link href="/research/calendar"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">📅</span><strong>{t("決算・経済指標", "Earnings & Economy")}</strong></span><small>{t("今週の予定を確認", "This week")}</small></Link>
      <Link href="/research/themes"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">📊</span><strong className={styles.longTitle}>{t("テーマランキング", "Theme Ranking")}</strong></span><small>{t("テーマ別の値動きの強さ", "Which themes are moving")}</small></Link>
      <Link href="/research/capital-map"><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">🗺️</span><strong>{t("資本マップ", "Capital Map")}</strong></span><small>{t("運用会社・ETFの投資先", "Funds and ETFs")}</small></Link>
      <Link href="/research#monitored-companies" onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); onWatch(); }}><span className={styles.cardTop}><span className={styles.icon} aria-hidden="true">🔭</span><strong>{t("監視22銘柄", "22 Tracked Stocks")}</strong></span><small>{t("厳選株をリアルタイムで", "Live, curated")}</small></Link>
    </nav>
    <nav id="rizels-desk" className={`${styles.reading} ${covered ? styles.readingLocked : ""}`} aria-label={t("リゼルのリサーチ", "RIZEL’s research")}>
      <div className={styles.deskHeading}><span>RIZEL’S DESK</span><span className={styles.deskEdition}>TECH PHASE PRO</span></div>
      <Link href="/research/notes" className={styles.deskLead}><div><strong>{t("リゼルのひとりごと", "RIZEL’s Notes")}</strong><p>{t("数字の先にある、相場の着眼点。", "A perspective beyond the numbers.")}</p></div><span aria-hidden="true">→</span></Link>
      <div className={styles.deskPair}>
        <Link href="/research/qa"><strong>{t("リゼルに聞く", "Ask Rizel")}</strong><span className={styles.deskSmall}>{t("疑問から、理解を深める", "Questions worth exploring")}</span><span aria-hidden="true">→</span></Link>
        <Link href="/research/weekly"><strong>{t("週刊PRO", "PRO Weekly")}</strong><span className={styles.deskSmall}>{t("一週間の変化と展望", "The week’s shifts & outlook")}</span><span aria-hidden="true">→</span></Link>
      </div>
      {covered && <div className={styles.deskOverlay}>
        <div className={styles.overlayCaption}><span className={styles.overlayLabel}>TECH PHASE PRO</span><strong><span className={styles.overlayLock} aria-hidden="true">🔒</span>{t("PRO会員限定", "Exclusive to PRO")}</strong></div>
      </div>}
    </nav>
    {covered && <button type="button" className={styles.proHint} onClick={onPro}><strong>{t("PROの限定機能を見る", "Explore PRO-exclusive features")} →</strong></button>}
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
    <div className={styles.favoriteHead}><div><p className={styles.favoriteEyebrow}>YOUR WATCHLIST</p><h2 id="favorite-research-title">{t("ウォッチリストの更新", "Watchlist updates")}</h2></div><Link href="/research/watchlist">{t("ウォッチリスト", "Watchlist")} →</Link></div>
    {!favorites.length ? <div className={styles.favoriteEmpty}><p>{t("銘柄をウォッチリストに追加すると、公開済みリサーチをここで確認できます。", "Add stocks to your watchlist to see published research here.")}</p><Link href="/research/watchlist">{t("ウォッチリストを設定する", "Set up your watchlist")} →</Link></div> : <>
      {matches.length ? <ul className={styles.favoriteList}>{matches.slice(0, 3).map((event) => <li key={event.id}><button onClick={() => onOpenResearch(event)}><span className={styles.favoriteTicker}>{event.ticker}</span><span className={styles.favoriteTitle}>{event.title[lang]}</span><time dateTime={event.publishedOn}>{dateLabel(event.publishedOn, lang)}</time><span aria-hidden="true">→</span></button></li>)}</ul> : <p className={styles.favoriteEmptyCopy}>{t("ウォッチリストの銘柄に関する公開リサーチはまだありません。", "No published research is available for your watchlist yet.")}</p>}
      {uncovered.length > 0 && <p className={styles.favoriteCoverage}>{t("公開リサーチ未掲載", "No published research yet")}: {uncovered.join(", ")}</p>}
      <p className={styles.favoriteFoot}>{t("公開済みの過去リサーチです。速報・自動監視ではありません。", "Published historical research; this is not a live alert or automated monitoring feed.")}</p>
    </>}
  </section>;
}

/** The RESOLUTE entrance on the home screen (owner, Oct 26): a separate service, so it gets its own dusk-blue banner
 * in silver, clearly apart from the gold of PRO. */
export function ResoluteEntrance({ lang }: { lang: Language }) {
  const ja = lang === "ja";
  return <Link href="/resolute" className={styles.resolute} aria-label={ja ? "RESOLUTE　暴落に備える、自分だけのルール作り" : "RESOLUTE: your own rules for a market crash"}>
    <span className={styles.rzEmblem} aria-hidden="true">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><path d="M12 7v14M7 11h10M5 15c0 3 3 5 7 5s7-2 7-5" /></svg>
    </span>
    <span className={styles.rzBody}>
      <span className={styles.rzEyebrow}>{ja ? "もうひとつのサービス" : "ANOTHER SERVICE"}</span>
      <strong className={styles.rzTitle}>RESOLUTE</strong>
      <span className={styles.rzCopy}>{ja ? "暴落の夜も、迷わない。" : "Stay steady when the market falls."}</span>
      <span className={styles.rzSub}>{ja ? "診断から、自分だけの投資ルールとお守りまで。" : "From a quick quiz to your own rules."}</span>
    </span>
    <span className={styles.rzGo}>{ja ? "はじめる" : "Start"}<span aria-hidden="true">→</span></span>
  </Link>;
}
