"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { useMemberDisplay, useOwnerAccount } from "./member-display-provider";
import { useProIntroduction } from "./header-pro";
import { useScrollLock } from "./use-scroll-lock";
import NavigationIcon, { type NavigationIconName } from "./navigation-icon";
import base from "./research.module.css";
import styles from "./site-header.module.css";

/** "RESEARCH · 運営者/Owner | PRO | FREE"; signed-out and unknown visitors read FREE. */
export function planLabel(lang: Language, plan: "free" | "pro" | null, ownerAccount: boolean) {
  if (ownerAccount) return lang === "ja" ? "運営者" : "Owner";
  return plan === "pro" ? "PRO" : "FREE";
}

export function reloadPage() {
  // Paint the pressed state before the full document reload.
  window.setTimeout(() => window.location.reload(), 150);
}

const RefreshIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>;

/** One-row header (owner's final design): brand · JA/EN · PRO or 更新 · menu. */
export default function SiteHeader({ lang, setLang, nav }: { lang: Language; setLang: (lang: Language) => void; nav?: ReactNode }) {
  const plan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const member = ownerAccount || plan === "pro";
  const pro = useProIntroduction();
  const [menu, setMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const closeMenu = useCallback(() => setMenu(false), []);
  const ja = lang === "ja";
  function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    reloadPage();
  }
  return <>
    <header className={styles.header}>
      <Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={`${base.logoMark} ${styles.mark}`} aria-hidden="true" />
        <span className={styles.words}><span className={`${base.brandText} ${styles.name}`}>TECH PHASE</span><small className={styles.sub}>RESEARCH · {planLabel(lang, plan, ownerAccount)}</small></span>
      </Link>
      {nav && <div className={styles.center}>{nav}</div>}
      <div className={styles.tools}>
        <div className={styles.lang} role="group" aria-label={ja ? "言語" : "Language"}>
          <button type="button" aria-pressed={ja} onClick={() => setLang("ja")}>JA</button>
          <button type="button" aria-pressed={!ja} onClick={() => setLang("en")}>EN</button>
        </div>
        {member
          ? <button type="button" className={styles.refresh} aria-label={ja ? "再読み込み" : "Refresh"} aria-busy={refreshing} onClick={refresh}><RefreshIcon /><span>{ja ? "更新" : "Refresh"}</span></button>
          : <button type="button" className={styles.pro} aria-label={ja ? "PROを見る" : "See PRO"} aria-expanded={pro.open} onClick={() => pro.toggle()}>PRO</button>}
        <button type="button" className={styles.ico} aria-label={ja ? "メニュー" : "Menu"} aria-expanded={menu} aria-controls="site-menu" onClick={() => setMenu(value => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
    </header>
    {menu && <SiteMenu lang={lang} member={member} onClose={closeMenu} onRefresh={refresh} onPro={() => pro.toggle(true)} />}
  </>;
}

const PRO_ONLY = new Set(["/research/compare", "/research/notes", "/research/qa", "/research/weekly"]);

function SiteMenu({ lang, member, onClose, onRefresh, onPro }: { lang: Language; member: boolean; onClose: () => void; onRefresh: () => void; onPro: () => void }) {
  const ja = lang === "ja";
  const pathname = usePathname();
  const panel = useRef<HTMLElement>(null);
  const unlock = useScrollLock(true);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button,a")?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    unlock();
    onClose();
    if (pathname !== "/research" || !href.startsWith("/research#")) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const links: [string, string, NavigationIconName][] = [
    ["/research/calendar", ja ? "決算・経済指標カレンダー" : "Earnings & economy", "calendar"],
    ["/research/price-targets", ja ? "目標株価" : "Price targets", "metrics"],
    ["/research#monitored-companies", ja ? "監視22銘柄リスト" : "22-stock watch list", "companies"],
    ["/research#what-changed", ja ? "何が変わった？" : "What changed?", "changes"],
    ["/research#saved", ja ? "保存したリサーチ" : "Saved research", "saved"],
    ["/research/compare", ja ? "銘柄比較 · PRO" : "Compare · PRO", "companies"],
    ["/research/notes", ja ? "リゼルのひとりごと" : "RIZEL’s Notes", "pro"],
    ["/research/qa", ja ? "リサーチQ&A" : "Research Q&A", "changes"],
    ["/research/weekly", ja ? "週刊PRO" : "PRO Weekly", "saved"],
    ["/research/learn", ja ? "米国株のはじめ方" : "US stock basics", "saved"],
    ["/research/faq", ja ? "よくある質問・使い方" : "FAQ & help", "changes"],
  ];
  return <>
    <button type="button" className={styles.backdrop} aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={onClose} />
    <nav ref={panel} id="site-menu" className={styles.menu} aria-label={ja ? "メニュー" : "Menu"}>
      <div className={styles.menuHead}><strong>{ja ? "メニュー" : "Menu"}</strong><button type="button" aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={onClose}>×</button></div>
      <div className={styles.menuBody}>
        <div className={styles.quick}>
          <button type="button" onClick={() => { unlock(); onClose(); onRefresh(); }}><span className={styles.menuIcon}><RefreshIcon /></span>{ja ? "再読み込み" : "Refresh"}</button>
          <Link href="/research/account" onClick={event => navigate(event, "/research/account")}><span className={styles.menuIcon}><NavigationIcon name="home" /></span>{ja ? "アカウント" : "Account"}</Link>
          <Link href="/research/notifications" onClick={event => navigate(event, "/research/notifications")}><span className={styles.menuIcon}><NavigationIcon name="bell" /></span>{ja ? "設定・スマホ通知" : "Settings & alerts"}</Link>
          <button type="button" className={styles.gold} onClick={() => { unlock(); onClose(); onPro(); }}><span className={styles.menuIcon}><NavigationIcon name="pro" /></span>{ja ? "PROの案内" : "About PRO"}</button>
        </div>
        <p className={styles.section}>{ja ? "その他" : "MORE"}</p>
        <div className={styles.links}>
          {links.filter(([href]) => member || !PRO_ONLY.has(href)).map(([href, label, icon]) =>
            <Link key={href} href={href} onClick={event => navigate(event, href)}><span className={styles.menuIcon}><NavigationIcon name={icon} /></span><span>{label}</span></Link>)}
        </div>
      </div>
    </nav>
  </>;
}
