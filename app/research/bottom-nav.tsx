"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useResearchLanguage } from "./use-research-language";
import { useAlertsUnread } from "./use-alerts-unread";
import styles from "./bottom-nav.module.css";

function subscribe(notify: () => void) {
  window.addEventListener("hashchange", notify); window.addEventListener("popstate", notify);
  return () => { window.removeEventListener("hashchange", notify); window.removeEventListener("popstate", notify); };
}
const getHash = () => window.location.hash;
const serverHash = () => "";

const icons = {
  home: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>,
  alerts: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4" /></svg>,
  search: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>,
  watchlist: <svg className={styles.star} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" /></svg>,
  markets: <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 4v2M12 18v2M4 12h2M18 12h2" /></svg>,
};

/** Floating five-item bar (owner's final design): glow slides to the current
 * item, search is a raised orb, 速報 shows a blinking dot for unread news. */
export default function BottomNav() {
  const pathname = usePathname();
  const hash = useSyncExternalStore(subscribe, getHash, serverHash);
  const [lang] = useResearchLanguage();
  const ja = lang === "ja";
  const bar = useRef<HTMLElement>(null);
  const [glow, setGlow] = useState<{ x: number; w: number } | null>(null);
  const alertsPage = pathname === "/research/news" || pathname === "/research/price-targets";
  const unread = useAlertsUnread(alertsPage);
  const tabs = [
    { key: "home", href: "/research#research-main", label: ja ? "ホーム" : "Home", active: pathname === "/research" && (!hash || hash === "#research-main") },
    { key: "alerts", href: "/research/news", label: ja ? "速報" : "Alerts", active: alertsPage },
    { key: "search", href: "/research/stocks", label: ja ? "銘柄検索" : "Search", active: pathname.startsWith("/research/stocks") },
    { key: "watchlist", href: "/research/watchlist", label: ja ? "お気に入り" : "Watchlist", active: pathname.startsWith("/research/watchlist") },
    { key: "markets", href: "/research/market", label: ja ? "マーケット" : "Markets", active: pathname === "/research/market" },
  ] as const;
  const current = tabs.findIndex(tab => tab.active);
  useLayoutEffect(() => {
    const place = () => {
      const item = current >= 0 ? bar.current?.querySelectorAll<HTMLElement>("[data-tab]")[current] : null;
      setGlow(item && tabs[current].key !== "search" ? { x: item.offsetLeft, w: item.offsetWidth } : null);
    };
    place();
    window.addEventListener("resize", place);
    void document.fonts?.ready.then(place);
    return () => window.removeEventListener("resize", place);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tabs` is derived from `current` inputs.
  }, [current, lang]);
  if (pathname.endsWith("/widget") || pathname === "/research/write") return null;
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    if (pathname !== "/research" || !href.startsWith("/research#")) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return <div className={styles.dock}>
    <nav ref={bar} className={styles.bar} aria-label={ja ? "メインメニュー" : "Main navigation"}>
      <span className={styles.glow} aria-hidden="true" style={glow ? { transform: `translateX(${glow.x}px)`, width: glow.w } : { opacity: 0 }} />
      {tabs.map(tab => <Link key={tab.key} data-tab="" href={tab.href} className={tab.key === "search" ? styles.mid : undefined}
        aria-current={tab.active ? "page" : undefined} onClick={event => navigate(event, tab.href)}>
        {tab.key === "search" ? <span className={styles.orb}>{icons.search}</span> : icons[tab.key]}
        <span className={styles.label}>{tab.label}</span>
        {tab.key === "alerts" && unread && <span className={styles.live} role="status" aria-label={ja ? "新着あり" : "New alerts"} />}
      </Link>)}
    </nav>
  </div>;
}
