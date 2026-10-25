"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { researchViewHashes, type ResearchView } from "@/lib/research/navigation";
import { useAlertsUnread } from "./use-alerts-unread";
import styles from "./home-sidebar.module.css";

const icon = (paths: ReactNode) => <svg viewBox="0 0 24 24" aria-hidden="true">{paths}</svg>;
const icons = {
  alerts: icon(<path d="M13 3L5 14h6l-1 7 8-11h-6z" />),
  search: icon(<><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></>),
  star: icon(<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" />),
  market: icon(<path d="M3 17l5-6 4 3 8-9M15 5h5v5" />),
  news: icon(<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM9 9h6M9 13h6" />),
  target: icon(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 2v3M12 19v3" /></>),
  watch: icon(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />),
  calendar: icon(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  map: icon(<><circle cx="8" cy="14" r="4.5" /><circle cx="17" cy="7" r="3" /><circle cx="18" cy="17" r="2.5" /><path d="M11.5 11.5L15 8.5M12 15.5h3.5" /></>),
  compare: icon(<path d="M4 20V9h6v11M14 20V4h6v16M2 20h20" />),
  saved: icon(<path d="M6 3.5h12v17l-6-4-6 4z" />),
  learn: icon(<path d="M12 3l9 5-9 5-9-5zM7 11v5c0 1.5 2.2 3 5 3s5-1.5 5-3v-5" />),
  gem: icon(<path d="M12 3l7 9-7 9-7-9z" />),
  anchor: icon(<><circle cx="12" cy="5" r="2" /><path d="M12 7v14M8 11h8M5 14a7 7 0 0 0 14 0" /></>),
  faq: icon(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>),
};

type Item = { key: string; icon: ReactNode; label: string; href?: string; onClick?: () => void; current?: boolean; badge?: ReactNode; pro?: boolean };

/** Desktop left menu of the home (owner, Oct 14). Links are the existing ones. */
export default function HomeSidebar({ lang, tab, companyCount, savedCount, openView, standalone = false, pathname }: {
  lang: Language; tab: ResearchView; companyCount?: number; savedCount?: number; openView?: (view: ResearchView) => void; standalone?: boolean; pathname?: string;
}) {
  const ja = lang === "ja";
  const t = (jaText: string, en: string) => ja ? jaText : en;
  const unread = useAlertsUnread(false);
  const quick: Item[] = [
    { key: "alerts", icon: icons.alerts, label: t("ハイテク速報", "Tech Alerts"), href: "/research/news", badge: unread ? <em className={`${styles.count} ${styles.fresh}`}>NEW</em> : null },
    { key: "search", icon: icons.search, label: t("銘柄検索", "Stock search"), href: "/research/stocks" },
    { key: "watchlist", icon: icons.star, label: t("お気に入り", "Watchlist"), href: "/research/watchlist" },
    { key: "market", icon: icons.market, label: t("マーケット", "Markets"), href: "/research/market" },
    { key: "news", icon: icons.news, label: t("一般ニュース", "General News"), href: "/research/general-news" },
    { key: "targets", icon: icons.target, label: t("目標株価", "Price targets"), href: "/research/price-targets" },
  ];
  const research: Item[] = [
    { key: "watch", icon: icons.watch, label: t("監視22銘柄", "22 Tracked Stocks"), onClick: () => openView?.("companies"), current: tab === "companies", badge: companyCount === undefined ? null : <em className={styles.count}>{companyCount}</em> },
    { key: "metrics", icon: icons.calendar, label: t("決算・経済指標", "Earnings & Economy"), href: "/research/calendar", current: pathname === "/research/calendar" },
    { key: "map", icon: icons.map, label: t("資本マップ", "Capital Map"), href: "/research/capital-map" },
    { key: "compare", icon: icons.compare, label: t("銘柄比較", "Compare stocks"), href: "/research/compare", pro: true },
    { key: "themes", icon: icons.market, label: t("テーマランキング", "Theme Ranking"), href: "/research/themes", pro: true },
    { key: "saved", icon: icons.saved, label: t("保存したリサーチ", "Saved research"), onClick: () => openView?.("saved"), current: tab === "saved", badge: savedCount === undefined ? null : <em className={styles.count}>{savedCount}</em> },
  ];
  const destinations: Record<string, string> = { watch: "/research" + researchViewHashes.companies, metrics: "/research/calendar", saved: "/research" + researchViewHashes.saved };
  const row = (original: Item) => {
    const item = standalone ? { ...original, href: original.href ?? destinations[original.key], current: original.href ? original.href === pathname : original.current } : original;
    const inner = <>{item.icon}<span>{item.label}</span>{item.badge}{item.pro && <b className={styles.tag}>PRO</b>}</>;
    const props = { className: `${styles.item} ${item.current ? styles.on : ""}`, "aria-current": item.current ? "page" as const : undefined };
    return item.href ? <Link key={item.key} href={item.href} {...props}>{inner}</Link> : <button key={item.key} type="button" onClick={item.onClick} {...props}>{inner}</button>;
  };
  return <nav className={styles.menu} aria-label={t("メインメニュー", "Main menu")}>
    <div className={styles.group}><p className={styles.eyebrow}>QUICK</p>{quick.map(row)}</div>
    <div className={styles.group}><p className={styles.eyebrow}>RESEARCH</p>{research.map(row)}</div>
    <div className={styles.group}>
      {standalone ? <Link href={"/research" + researchViewHashes.pro} className={[styles.item, styles.proLine].join(" ")}>{icons.gem}<span>Tech Phase PRO</span></Link> : <button type="button" className={`${styles.item} ${styles.proLine} ${tab === "pro" ? styles.on : ""}`} aria-current={tab === "pro" ? "page" : undefined} onClick={() => openView?.("pro")}>{icons.gem}<span>Tech Phase PRO</span></button>}
      <Link href="/resolute" className={`${styles.item} ${styles.rzLine}`}>{icons.anchor}<span>RESOLUTE</span></Link>
    </div>
    <div className={styles.foot}>
      <div className={styles.group}>
        <Link className={styles.item} href="/research/learn">{icons.learn}<span>{t("米国株のはじめ方", "US stock basics")}</span></Link>
        <Link className={styles.item} href="/research/faq">{icons.faq}<span>{t("よくある質問・使い方", "FAQ & help")}</span></Link>
      </div>
      <div className={styles.source}><b>SOURCE FIRST</b><p>{t("数字には、必ず根拠を。", "Every number, with its source.")}</p></div>
    </div>
  </nav>;
}
