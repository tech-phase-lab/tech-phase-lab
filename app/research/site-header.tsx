"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import { useMemberDisplay, useMemberSettled, useOwnerAccount } from "./member-display-provider";
import { useProIntroduction } from "./header-pro";
import { useScrollLock } from "./use-scroll-lock";
import { rememberHash } from "@/lib/research/view-hash";
import base from "./research.module.css";
import styles from "./site-header.module.css";

/** "RESEARCH · 運営者/Owner | PRO | FREE"; signed-out and unknown visitors read FREE. */
export function planLabel(lang: Language, plan: "free" | "pro" | null, ownerAccount: boolean) {
  if (ownerAccount) return lang === "ja" ? "運営者" : "Owner";
  return plan === "pro" ? "PRO" : "FREE";
}

const REFRESHED_KEY = "tech-phase:refreshed-at";
export function reloadPage() {
  // Leave a note for the next page, which says "updated" for a moment so a reload can be told from nothing happening (owner, Oct 28).
  try { sessionStorage.setItem(REFRESHED_KEY, String(Date.now())); } catch { /* storage may be blocked */ }
  // Paint the pressed state before the full document reload.
  window.setTimeout(() => window.location.reload(), 150);
}

/** "Updating…" while the reload starts, "Updated" on the page that comes back from it. */
let updatedShown = false, updatedRead = false;
const updatedListeners = new Set<() => void>();
function subscribeUpdated(notify: () => void) { updatedListeners.add(notify); return () => { updatedListeners.delete(notify); }; }
function updatedSnapshot() {
  if (!updatedRead) {
    updatedRead = true;
    try {
      const at = Number(sessionStorage.getItem(REFRESHED_KEY));
      sessionStorage.removeItem(REFRESHED_KEY);
      if (at > 0 && Date.now() - at < 20_000) { updatedShown = true; window.setTimeout(() => { updatedShown = false; updatedListeners.forEach(listener => listener()); }, 2200); }
    } catch { /* storage may be blocked */ }
  }
  return updatedShown;
}
function RefreshNote({ updating, ja }: { updating: boolean; ja: boolean }) {
  const updated = useSyncExternalStore(subscribeUpdated, updatedSnapshot, () => false);
  if (!updating && !updated) return null;
  return <div className={styles.refreshNote} role="status" aria-live="polite">{updating ? (ja ? "更新中…" : "Updating…") : (ja ? "更新しました" : "Updated")}</div>;
}

const RefreshIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>;

/** One-row header (owner's final design): brand · JA/EN · PRO or 更新 · menu. */
export default function SiteHeader({ lang, setLang, nav }: { lang: Language; setLang: (lang: Language) => void; nav?: ReactNode }) {
  const plan = useMemberDisplay();
  const ownerAccount = useOwnerAccount();
  const settled = useMemberSettled() || ownerAccount || plan !== null;
  const pathname = usePathname();
  // The menu is drawn from what the device remembers (the pre-paint hint) until the membership check answers, so it never changes shape after opening.
  const hint = useSyncExternalStore(() => () => {}, () => document.documentElement.dataset.memberHint ?? "", () => "");
  const member = ownerAccount || plan === "pro";
  const menuMember = member || (!settled && hint !== "");
  const menuOwner = ownerAccount || (!settled && hint === "owner");
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
  // Desktop (owner, Oct 14; every research page since Oct 27): two buttons left of the home icon.
  const home = pathname === "/research";
  const tier = ownerAccount ? "owner" : plan === "pro" ? "pro" : "free";
  // Desktop home button (owner, Oct 9): on the home page itself, return to the
  // main view the same way the phone bar does.
  function goHome(event: MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/research" || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState(null, "", "/research#research-main");
    rememberHash("#research-main");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return <>
    <header className={styles.header} data-plan={tier} data-promo={home ? "home" : "on"}>
      <Link href="/research" className={styles.brand} aria-label="Tech Phase Research">
        <span className={styles.markWrap}><span className={`${base.logoMark} ${styles.mark}`} aria-hidden="true" /></span>
        <span className={styles.words}><span className={`${base.brandText} ${styles.name}`}>TECH PHASE</span><small className={styles.sub}>
          {tier === "pro" && <svg className={styles.planIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></svg>}
          {tier === "owner" && <svg className={styles.planIcon} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" /><path d="M12 8l3.2 3.5L12 16l-3.2-4.5z" /></svg>}
          {settled
            ? <><span>RESEARCH ·</span><span className={styles.planName}>{planLabel(lang, plan, ownerAccount)}</span></>
            : <><span>RESEARCH</span>
                <span className={styles.hintOwner}><span>·</span><span className={styles.planName}>{planLabel(lang, null, true)}</span></span>
                <span className={styles.hintPro}><span>·</span><span className={styles.planName}>PRO</span></span></>}</small></span>
      </Link>
      {nav && <div className={styles.center}>{nav}</div>}
      <div className={styles.tools}>
        <div className={styles.promo}>
          <button type="button" className={styles.proBtn} aria-label={ja ? "Tech Phase PROを見る" : "See Tech Phase PRO"} onClick={() => pro.toggle(true)}><span>Tech Phase PRO</span><b className={styles.proTag}>PRO</b></button>
          <Link href="/resolute" className={styles.rzBtn} aria-label="RESOLUTE"><span aria-hidden="true">⚓</span>RESOLUTE</Link>
        </div>
        <Link href="/research#research-main" className={`${styles.ico} ${styles.home}`} aria-label={ja ? "ホームへ" : "Home"} onClick={goHome}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" /></svg>
        </Link>
        <div className={styles.lang} role="group" aria-label={ja ? "言語" : "Language"}>
          <button type="button" aria-pressed={ja} onClick={() => setLang("ja")}>JA</button>
          <button type="button" aria-pressed={!ja} onClick={() => setLang("en")}>EN</button>
        </div>
        {member
          ? <button type="button" className={`${styles.ring} ${refreshing ? styles.spinOnce : ""}`} aria-label={ja ? "再読み込み" : "Refresh"} aria-busy={refreshing} onClick={refresh}>
              <svg className={styles.ringTrack} viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" /></svg>
              <RefreshIcon />
            </button>
          : !settled
          ? <><span className={`${styles.pro} ${styles.hintHide}`} style={{ visibility: "hidden" }} aria-hidden="true">PRO</span>
              <button type="button" className={`${styles.ring} ${styles.hintRing}`} aria-label={ja ? "再読み込み" : "Refresh"} onClick={refresh}>
                <svg className={styles.ringTrack} viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="16" /></svg>
                <RefreshIcon />
              </button></>
          : <button type="button" className={styles.pro} aria-label={ja ? "PROを見る" : "See PRO"} aria-expanded={pro.open} onClick={() => pro.toggle()}>PRO</button>}
        <button type="button" className={`${styles.ico} ${styles.menuBtn}`} aria-label={ja ? "メニュー" : "Menu"} aria-expanded={menu} aria-controls="site-menu" onClick={() => { if (!menu) window.dispatchEvent(new Event("tech-phase:menu-open")); setMenu(value => !value); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </div>
    </header>
    <RefreshNote updating={refreshing} ja={ja} />
    {menu && <SiteMenu lang={lang} member={menuMember} ownerAccount={menuOwner} onClose={closeMenu} onRefresh={refresh} onPro={() => pro.toggle(true)} />}
  </>;
}

type MenuIcon = keyof typeof menuIcons;
const menuIcons = {
  news: <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM9 9h6M9 13h6" />,
  alerts: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
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
  notebook: <><path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6zM6 3v18M10 8h6M10 12h6" /></>,
  anchor: <><circle cx="12" cy="5" r="2" /><path d="M12 7v14M7 11h10M5 15c0 3 3 5 7 5s7-2 7-5" /></>,
  desk: <path d="M4 6h16v10H4zM9 20h6M12 16v4M8 10h8" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M16 16l5 5" /></>,
  market: <><circle cx="12" cy="12" r="3" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></>,
  watch22: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  bars: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  compare: <path d="M12 4v16M5 8h14M5 8l-2 5h4zM19 8l-2 5h4z" />,
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  radar: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l5-5M12 3.5v2M3.5 12h2" /></>,
  crown: <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />,
  book: <path d="M4 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H4zM20 5h-6" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01" /></>,
} as const;
/** The PRO emblem (owner, Oct 26): a gold crown for PRO, a star for the owner; `shine` lets light sweep across it. */
function ProBadge({ size = 22, shine = false, star = false }: { size?: number; shine?: boolean; star?: boolean }) {
  const id = useId();
  return <svg className={shine ? `${styles.proBadge} ${styles.proShine}` : styles.proBadge} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}a`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3c9" /><stop offset=".5" stopColor="#e8c46a" /><stop offset="1" stopColor="#a67c24" /></linearGradient>
      <linearGradient id={`${id}b`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff8dc" /><stop offset="1" stopColor="#c9972f" /></linearGradient>
    </defs>
    {star
      ? <path d="M16 2.8l3.9 8.1 8.9 1.2-6.5 6.2 1.6 8.8L16 22.7l-7.9 4.4 1.6-8.8-6.5-6.2 8.9-1.2z" fill={`url(#${id}a)`} stroke="#8a6518" strokeWidth=".9" strokeLinejoin="round" />
      : <>
        <path d="M3.5 10.5l5.6 5.2L16 6l6.9 9.7 5.6-5.2-2.1 14.2H5.6z" fill={`url(#${id}a)`} stroke="#8a6518" strokeWidth=".9" strokeLinejoin="round" />
        <path d="M5.6 24.7h20.8v3.1H5.6z" fill={`url(#${id}b)`} stroke="#8a6518" strokeWidth=".8" strokeLinejoin="round" />
        <circle cx="3.5" cy="9.6" r="2" fill={`url(#${id}b)`} stroke="#8a6518" strokeWidth=".6" /><circle cx="16" cy="5.2" r="2.2" fill={`url(#${id}b)`} stroke="#8a6518" strokeWidth=".6" /><circle cx="28.5" cy="9.6" r="2" fill={`url(#${id}b)`} stroke="#8a6518" strokeWidth=".6" />
        <path d="M9 24l1.4-6.5M16 24V13M23 24l-1.4-6.5" stroke="#fff3c9" strokeOpacity=".5" strokeWidth=".8" fill="none" />
      </>}
    {shine && <rect className={styles.proSweep} x="-14" y="0" width="9" height="32" fill="#fff" fillOpacity=".55" transform="skewX(-20)" />}
  </svg>;
}
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
    panel.current?.focus({ preventScroll: true });
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => {
    // Phone sheet follows the finger (owner, Oct 9): past the top it slides
    // down and closes when pulled far enough; past the end it gives a little.
    const sheet = panel.current;
    if (!sheet || !window.matchMedia("(max-width:760px)").matches) return;
    let start: number | null = null, offset = 0;
    const place = (value: number, animate: boolean) => {
      offset = value;
      sheet.style.transition = animate ? "transform .22s cubic-bezier(.3,.9,.3,1)" : "none";
      sheet.style.transform = value ? `translateY(${value}px)` : "";
    };
    const down = (event: TouchEvent) => { start = event.touches.length === 1 ? event.touches[0].clientY : null; };
    const move = (event: TouchEvent) => {
      if (start === null) return;
      const dy = event.touches[0].clientY - start;
      const atTop = sheet.scrollTop <= 0, atEnd = sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 1;
      if (dy > 0 && atTop) place(dy, false);
      else if (dy < 0 && atEnd) place(Math.max(dy * 0.25, -28), false);
      else if (offset) place(0, false);
    };
    const up = () => {
      if (start === null) return;
      start = null;
      if (offset > 90) { place(window.innerHeight, true); window.setTimeout(onClose, 180); }
      else if (offset) place(0, true);
    };
    sheet.addEventListener("touchstart", down, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: true });
    sheet.addEventListener("touchend", up);
    sheet.addEventListener("touchcancel", up);
    return () => {
      sheet.removeEventListener("touchstart", down); sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", up); sheet.removeEventListener("touchcancel", up);
    };
  }, [onClose]);
  function navigate(event: MouseEvent<HTMLAnchorElement>, href: string) {
    unlock();
    onClose();
    if (pathname !== "/research" || !href.startsWith("/research#")) return;
    event.preventDefault();
    window.history.pushState(null, "", href);
    rememberHash(href.slice(href.indexOf("#")));
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  const act = (run: () => void) => () => { unlock(); onClose(); run(); };
  const realtime = ja ? "リアルタイム監視" : "Real-time monitoring";
  const alerts = ja ? "スマホ通知" : "Mobile alerts";
  const item = (href: string, icon: MenuIcon, label: string, extra?: ReactNode, note?: string) =>
    <Link key={href} className={styles.item} href={href} onClick={event => navigate(event, href)}><span className={styles.glassIcon}><Icon name={icon} className={styles.itemIcon} /></span><span>{label}{note && <small className={styles.itemNote}>{note}</small>}</span>{extra}<Icon name="next" className={styles.chev} /></Link>;
  const tile = (href: string, icon: MenuIcon, label: string) =>
    <Link key={href} className={styles.proTile} href={href} onClick={event => navigate(event, href)}><Icon name={icon} className={styles.itemIcon} /><span>{label}</span></Link>;
  const heading = (text: string, crown = false) => <h4>{crown && <Icon name="crown" className={styles.headCrown} />}<span className={styles.headText}>{text}</span></h4>;
  const perks = [`RIZEL'S DESK`, ja ? "テーマランキング" : "Theme Ranking", ja ? "銘柄比較" : "Compare", ja ? "連関マップ" : "Relationship maps", realtime, alerts];
  return <>
    <button type="button" className={styles.backdrop} aria-label={ja ? "メニューを閉じる" : "Close menu"} onClick={onClose} />
    <nav ref={panel} id="site-menu" tabIndex={-1} className={member ? `${styles.sheet} ${styles.luxe}` : `${styles.sheet} ${styles.navy}`} aria-label={ja ? "メニュー" : "Menu"}>
      <div className={styles.grab} aria-hidden="true" />
      <div className={styles.shHead}><h2>{ja ? "メニュー" : "Menu"}</h2>
        <span className={styles.headTools}>
          <button type="button" className={styles.refreshPill} onClick={act(onRefresh)}><Icon name="refresh" />{ja ? "再読み込み" : "Refresh"}</button>
          <button type="button" className={styles.close} aria-label={ja ? "閉じる" : "Close"} onClick={onClose}><Icon name="close" /></button>
        </span>
      </div>
      {member
        ? <div className={styles.memberCard}><div className={styles.memberInner}>
            <span className={styles.crownDisc} aria-hidden="true">{ownerAccount ? <svg viewBox="0 0 24 24" className={styles.ownerSeal}><path d="M12 2.5l8 3v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" /><path d="M12 7.6l3.6 4-3.6 5-3.6-5z" className={styles.ownerGem} /></svg> : <Icon name="crown" />}</span>
            <span className={styles.memberText}><b>{ownerAccount ? "OWNER" : "PRO MEMBER"}</b><small>{ja ? "全機能をご利用中です" : "All features unlocked"}</small></span>
            <Link className={styles.manage} href="/research/account" onClick={event => navigate(event, "/research/account")}>{ja ? "プランの管理" : "Manage plan"} ›</Link>
          </div></div>
        : <button type="button" className={styles.cardFree} aria-label={ja ? "PROの案内を見る" : "Learn more about PRO"} onClick={act(onPro)}>
            <span className={styles.frTop}><span className={styles.frTitle}><ProBadge size={24} />{ja ? "PROで、もっと深く" : "Go deeper with PRO"}</span><span className={styles.frGo}>{ja ? "案内を見る" : "Learn more"}<Icon name="next" /></span></span>
            <span className={styles.frPerks}>{perks.map(name => <span key={name}>{name}</span>)}</span>
          </button>}
      <div className={styles.grp}>
        {heading(ja ? "ニュース" : "News")}
        {item("/research/news", "alerts", ja ? "ハイテク速報" : "Tech Alerts", member ? <b className={styles.liveTag}>LIVE</b> : undefined, member ? undefined : (ja ? "30分遅れ · 見出しのみ · 直近5件" : "30 min delay · headlines only · latest 5"))}
        {item("/research/general-news", "news", ja ? "一般ニュース" : "General News")}
      </div>
      {member && <div className={styles.grp}>
        {heading(ja ? "PRO機能" : "PRO features", true)}
        <div className={styles.proTiles}>
          {tile("/research/notes", "desk", "RIZEL'S DESK")}
          {tile("/research#monitored-companies", "watch22", ja ? "監視22銘柄" : "22 Tracked Stocks")}
          {tile("/research/themes", "bars", ja ? "テーマランキング" : "Theme Ranking")}
          {tile("/research/compare", "compare", ja ? "銘柄比較" : "Compare")}
        </div>
      </div>}
      <div className={styles.grp}>
        {heading(ja ? "リサーチ" : "Research")}
        {item("/research/stocks", "search", ja ? "銘柄検索" : "Stock Search")}
        {item("/research/market", "market", ja ? "マーケット" : "Markets")}
        {item("/research/calendar", "calendar", ja ? "決算・経済指標" : "Earnings & Economy")}
        {item("/research/capital-map", "pulse", ja ? "資本マップ" : "Capital Map")}
        {item("/research/radar", "radar", ja ? "財務レーダー" : "Financial Radar")}
        {item("/research/price-targets", "bars", ja ? "目標株価" : "Price targets")}
      </div>
      <div className={styles.grp}>
        {heading(ja ? "マイページ" : "My page")}
        {item("/research/watchlist", "star", ja ? "ウォッチリスト" : "Watchlist")}
        {item("/research/notebook", "notebook", ja ? "銘柄手帳" : "Stock Notebook")}
        {item("/research#saved", "saved", ja ? "保存したリサーチ" : "Saved research")}
        {member && item("/research/notifications", "bell", alerts)}
      </div>
      <Link href="/resolute" className={styles.resCard} onClick={event => navigate(event, "/resolute")}>
        <span className={styles.resEmblem} aria-hidden="true"><Icon name="anchor" /></span>
        <span className={styles.resText}><b>RESOLUTE</b><small>{ja ? "暴落に備える、自分だけのルール作り" : "Your own rules for a market crash"}</small></span>
        <Icon name="next" className={styles.resChev} />
      </Link>
      <div className={styles.footLinks}>
        <Link href="/research/account" onClick={event => navigate(event, "/research/account")}>{ja ? "アカウント" : "Account"}</Link><i aria-hidden="true">|</i>
        <Link href="/research/learn" onClick={event => navigate(event, "/research/learn")}>{ja ? "米国株のはじめ方" : "US stock basics"}</Link><i aria-hidden="true">|</i>
        <Link href="/research/faq" onClick={event => navigate(event, "/research/faq")}>{ja ? "よくある質問・使い方" : "FAQ & help"}</Link>
      </div>
      <div className={styles.footLinks}>
        <Link href="/terms" onClick={event => navigate(event, "/terms")}>{ja ? "利用規約" : "Terms of Service"}</Link><i aria-hidden="true">|</i>
        <Link href="/privacy" onClick={event => navigate(event, "/privacy")}>{ja ? "プライバシーポリシー" : "Privacy Policy"}</Link>
      </div>
    </nav>
  </>;
}
