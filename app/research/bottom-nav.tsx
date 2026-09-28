"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import NavigationIcon, { type NavigationIconName } from "./navigation-icon";
import { useResearchLanguage } from "./use-research-language";
import styles from "./bottom-nav.module.css";

function subscribe(notify: () => void) {
  window.addEventListener("hashchange", notify); window.addEventListener("popstate", notify);
  return () => { window.removeEventListener("hashchange", notify); window.removeEventListener("popstate", notify); };
}
const getHash = () => window.location.hash;
const serverHash = () => "";

export default function BottomNav() {
  const pathname = usePathname();
  const [lang] = useResearchLanguage();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const hash = useSyncExternalStore(subscribe, getHash, serverHash);
  const ja = lang === "ja";
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  if (pathname.endsWith("/widget")) return null;
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    setOpen(false);
    if (pathname !== "/research" || !href.startsWith("/research#")) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const tabs: { href: string; label: string; icon: NavigationIconName; active: boolean }[] = [
    { href: "/research#research-main", label: ja ? "ホーム" : "Home", icon: "home", active: pathname === "/research" && (!hash || hash === "#research-main") },
    { href: "/research/news", label: ja ? "速報" : "News", icon: "changes", active: pathname === "/research/news" || pathname === "/research/price-targets" },
    { href: "/research/stocks", label: ja ? "銘柄検索" : "Search", icon: "search", active: pathname.startsWith("/research/stocks") },
    { href: "/research/market", label: ja ? "マーケット" : "Markets", icon: "metrics", active: pathname === "/research/market" },
  ];
  const links: [string, string, NavigationIconName][] = [
    ["/research/notes", ja ? "リゼルのひとりごと" : "RIZEL’s Notes", "pro"],
    ["/research/qa", ja ? "リサーチQ&A" : "Research Q&A", "changes"],
    ["/research/weekly", ja ? "週刊PRO" : "PRO Weekly", "saved"],
    ["/research/account", ja ? "マイアカウント" : "My account", "home"],
    ["/research#what-changed", ja ? "何が変わった？" : "What changed?", "changes"],
    ["/research/watchlist", ja ? "お気に入り" : "Favorites", "favorite"],
    ["/research/calendar", ja ? "決算・経済指標" : "Earnings & economy", "calendar"],
    ["/research/notifications", ja ? "スマホ通知設定" : "Notifications", "bell"],
    ["/research#saved", ja ? "保存したリサーチ" : "Saved research", "saved"],
    ["/research#monitored-companies", ja ? "分析対象企業" : "Company coverage", "companies"],
  ];
  return <div className={styles.mobile}>
    {open && <><button className={styles.backdrop} aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={() => { setOpen(false); trigger.current?.focus(); }} />
      <nav ref={panel} id="mobile-more-menu" className={styles.sheet} aria-label={ja ? "その他のメニュー" : "More navigation"}><div className={styles.sheetHeading}><strong>{ja ? "メニュー" : "Explore"}</strong><button aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</button></div><div className={styles.menuGrid}>{links.map(([href, label, icon]) => <Link key={href} href={href} onClick={(event) => navigate(event, href)}><span className={styles.menuIcon}><NavigationIcon name={icon} /></span><span>{label}</span></Link>)}</div></nav></>}
    <nav className={styles.bar} aria-label={ja ? "メインメニュー" : "Main navigation"}>
      {tabs.map(({ href, label, icon, active }) => <Link key={href} href={href} aria-current={!open && active ? "page" : undefined} onClick={(event) => navigate(event, href)}><NavigationIcon name={icon} /><span>{label}</span></Link>)}
      <button ref={trigger} aria-expanded={open} aria-controls="mobile-more-menu" onClick={() => setOpen(!open)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg><span>{ja ? "メニュー" : "Menu"}</span></button>
    </nav>
  </div>;
}
