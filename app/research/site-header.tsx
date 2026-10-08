"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { useMemberDisplay, useOwnerAccount } from "./member-display-provider";
import { useProIntroduction } from "./header-pro";
import { useScrollLock } from "./use-scroll-lock";
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
    // The arrow turns once (0.7 s) as the page reloads immediately after.
    reloadPage();
  }
  const tier = ownerAccount ? "owner" : plan === "pro" ? "pro" : "free";
  return <>
    <header className={styles.header} data-plan={tier}>
      <Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={styles.markWrap}><span className={`${base.logoMark} ${styles.mark}`} aria-hidden="true" /></span>
        <span className={styles.words}><span className={`${base.brandText} ${styles.name}`}>TECH PHASE</span><small className={styles.sub}>
          {tier === "pro" && <svg className={styles.planIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 9-7 9-7-9z" /></svg>}
          {tier === "owner" && <svg className={styles.planIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>}
          <span>RESEARCH ·</span><span className={styles.planName}>{planLabel(lang, plan, ownerAccount)}</span></small></span>
      </Link>
      {nav && <div className={styles.center}>{nav}</div>}
      <div className={styles.tools}>
        <div className={styles.lang} role="group" aria-label={ja ? "言語" : "Language"}>
          <button type="button" aria-pressed={ja} onClick={() => setLang("ja")}>JA</button>
          <button type="button" aria-pressed={!ja} onClick={() => setLang("en")}>EN</button>
        </div>
        {member
          ? <button type="button" className={`${styles.ring} ${refreshing ? styles.spinOnce : ""}`} aria-label={ja ? "再読み込み" : "Refresh"} aria-busy={refreshing} onClick={refresh}>
              <svg className={styles.ringTrack} viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" /></svg>
              <RefreshIcon />
            </button>
          : <button type="button" className={styles.pro} aria-label={ja ? "PROを見る" : "See PRO"} aria-expanded={pro.open} onClick={() => pro.toggle()}>PRO</button>}
        <button type="button" className={styles.ico} aria-label={ja ? "メニュー" : "Menu"} aria-expanded={menu} aria-controls="site-menu" onClick={() => setMenu(value => !value)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
    </header>
    {menu && <SiteMenu lang={lang} member={member} ownerAccount={ownerAccount} onClose={closeMenu} onRefresh={refresh} onPro={() => pro.toggle(true)} />}
  </>;
}

type MenuIcon = keyof typeof menuIcons;
const menuIcons = {
  gem: <path d="M12 3l7 9-7 9-7-9z" />,
  next: <path d="M9 6l6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  account: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></>,
  bell: <path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" />,
  refresh: <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" />,
  tracked: <path d="M5 20V9l7-5 7 5v11zM9 20v-6h6v6" />,
  calendar: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  changes: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  star: <path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z" />,
  targets: <path d="M4 4v16h16M9 16v-5M13 16V8M17 16v-3" />,
  saved: <path d="M7 4h10v16l-5-4-5 4z" />,
  book: <path d="M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-6" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>,
} as const;
const Icon = ({ name, className }: { name: MenuIcon; className?: string }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{menuIcons[name]}</svg>;

/** Menu sheet (owner's "プラン別メニュー見本"): plan card, two short buttons,
 * then PRO (members only), Research and Guides. Phone: bottom sheet; desktop:
 * a panel from the top right with the same content. */
function SiteMenu({ lang, member, ownerAccount, onClose, onRefresh, onPro }: { lang: Language; member: boolean; ownerAccount: boolean; onClose: () => void; onRefresh: () => void; onPro: () => void }) {
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
  const act = (run: () => void) => () => { unlock(); onClose(); run(); };
  const realtime = ja ? "リアルタイム監視" : "Real-time monitoring";
  const alerts = ja ? "スマホ通知" : "Mobile alerts";
  const item = (href: string, icon: MenuIcon, label: string) =>
    <Link key={href} className={styles.item} href={href} onClick={event => navigate(event, href)}><Icon name={icon} className={styles.itemIcon} /><span>{label}</span><Icon name="next" className={styles.chev} /></Link>;
  return <>
    <button type="button" className={styles.backdrop} aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={onClose} />
    <nav ref={panel} id="site-menu" className={styles.sheet} aria-label={ja ? "メニュー" : "Menu"}>
      <div className={styles.grab} aria-hidden="true" />
      <div className={styles.shHead}><h2>{ja ? "メニュー" : "Menu"}</h2><button type="button" className={styles.close} aria-label={ja ? "閉じる" : "Close"} onClick={onClose}><Icon name="close" /></button></div>
      {member
        ? <div className={styles.cardPaid}>
            <div className={styles.cardRow}>
              <span className={styles.badge}><Icon name="gem" /><span>{ownerAccount ? (ja ? "運営者　全機能" : "Owner · Full access") : "TECH PHASE PRO"}</span></span>
              <Link className={styles.manage} href="/research/account" onClick={event => navigate(event, "/research/account")}>{ja ? "プランの管理" : "Manage plan"}</Link>
            </div>
            <h3>{ja ? "すべての機能が使えます" : "All features unlocked"}</h3>
            <p className={styles.featline}>{ja ? `銘柄比較 PRO、RIZEL'S DESK、${realtime}、${alerts}` : `Compare · PRO, RIZEL'S DESK, ${realtime}, ${alerts}`}</p>
          </div>
        : <button type="button" className={styles.cardFree} aria-label={ja ? "PROの案内を見る" : "Learn more about PRO"} onClick={act(onPro)}>
            <span className={styles.frTop}><span className={styles.frTitle}><Icon name="gem" />{ja ? "PROで、もっと深く" : "Go deeper with PRO"}</span><span className={styles.frGo}>{ja ? "案内を見る" : "Learn more"}<Icon name="next" /></span></span>
            <span className={styles.frPerks}><span>RIZEL&apos;S DESK</span><span>{ja ? "銘柄比較 PRO" : "Compare · PRO"}</span><span>{realtime}</span><span>{alerts}</span></span>
          </button>}
      <div className={styles.tiles}>
        {member
          ? <><Link className={styles.tile} href="/research/account" onClick={event => navigate(event, "/research/account")}><Icon name="account" />{ja ? "アカウント" : "Account"}</Link>
              <Link className={`${styles.tile} ${styles.bell}`} href="/research/notifications" onClick={event => navigate(event, "/research/notifications")}><Icon name="bell" />{alerts}</Link></>
          : <><button type="button" className={styles.tile} onClick={act(onRefresh)}><Icon name="refresh" />{ja ? "再読み込み" : "Refresh"}</button>
              <Link className={styles.tile} href="/research/account" onClick={event => navigate(event, "/research/account")}><Icon name="account" />{ja ? "アカウント" : "Account"}</Link></>}
      </div>
      <div className={styles.grp}>
        <h4>{ja ? "リサーチ" : "Research"}</h4>
        {item("/research#monitored-companies", "tracked", ja ? "監視22銘柄リスト" : "22 Tracked Stocks")}
        {item("/research/calendar", "calendar", ja ? "決算・経済指標" : "Earnings & Indicators")}
        {item("/research#what-changed", "changes", ja ? "何が変わった？" : "What changed?")}
        {item("/research/watchlist", "star", ja ? "お気に入り" : "Watchlist")}
        {item("/research/price-targets", "targets", ja ? "目標株価" : "Price targets")}
        {item("/research#saved", "saved", ja ? "保存したリサーチ" : "Saved research")}
      </div>
      <div className={styles.grp}>
        <h4>{ja ? "ガイド" : "Guides"}</h4>
        {item("/research/learn", "book", ja ? "米国株のはじめ方" : "US stock basics")}
        {item("/research/faq", "help", ja ? "よくある質問・使い方" : "FAQ & help")}
      </div>
    </nav>
  </>;
}
