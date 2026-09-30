"use client";

import Link from "next/link";
import MembershipLabel from "./membership-label";
import HeaderPro from "./header-pro";
import HomeLink from "./home-link";
import PageRefresh from "./page-refresh";
import { usePathname } from "next/navigation";
import NavigationIcon from "./navigation-icon";
import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import base from "./research.module.css";
import styles from "./research-tools.module.css";

export default function ResearchToolShell({ lang, setLang, title, description, children, desk = false, showTools = true }: { lang: Language; setLang: (lang: Language) => void; title: string; description: string; children: ReactNode; desk?: boolean; showTools?: boolean }) {
  const pathname = usePathname();
  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#tool-main">{lang === "ja" ? "本文へ移動" : "Skip to content"}</a>
    <header className={base.header}>
      <div className={base.brandGroup}><Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.logoMark} aria-hidden="true" /><span>TECH PHASE<MembershipLabel /></span></Link></div>
      <div className={base.headerRight}><HomeLink lang={lang} /><PageRefresh lang={lang} /><div className={base.languages} aria-label={lang === "ja" ? "言語" : "Language"}><button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button></div><HeaderPro /></div>
    </header>
    <main id="tool-main" className={`${styles.main} ${desk ? styles.desk : ""}`}>
      {!desk && showTools && <nav className={styles.links} aria-label={lang === "ja" ? "便利な機能" : "Research tools"}>
        <Link href="/research/stocks" aria-current={pathname === "/research/stocks" ? "page" : undefined}><NavigationIcon name="search" />{lang === "ja" ? "銘柄検索" : "Stock search"}</Link>
        <Link href="/research/watchlist" aria-current={pathname === "/research/watchlist" ? "page" : undefined}><NavigationIcon name="favorite" />{lang === "ja" ? "お気に入り銘柄" : "Favorite stocks"}</Link>
        <Link href="/research/calendar" aria-current={pathname === "/research/calendar" ? "page" : undefined}><NavigationIcon name="calendar" />{lang === "ja" ? "カレンダー" : "Calendar"}</Link>
        <Link href="/research/market" aria-current={pathname === "/research/market" ? "page" : undefined}><NavigationIcon name="metrics" />{lang === "ja" ? "マーケット" : "Markets"}</Link>
        <Link href="/research/learn" aria-current={pathname === "/research/learn" ? "page" : undefined}><NavigationIcon name="saved" />{lang === "ja" ? "米国株の基礎" : "Stock basics"}</Link>
        <Link href="/research/faq" aria-current={pathname === "/research/faq" ? "page" : undefined}><NavigationIcon name="changes" />{lang === "ja" ? "よくある質問・使い方" : "FAQ & help"}</Link>
        <Link href="/research/compare" aria-current={pathname === "/research/compare" ? "page" : undefined}><NavigationIcon name="companies" />{lang === "ja" ? "銘柄比較 · PRO" : "Compare · PRO"}</Link>
        <Link href="/research/columns" aria-current={pathname === "/research/columns" ? "page" : undefined}><NavigationIcon name="pro" />{lang === "ja" ? "PRO記事・週刊" : "PRO articles & weekly"}</Link>
      </nav>}
      {desk && <div className={styles.deskSignature}><span>RIZEL’S DESK</span><small>TECH PHASE PRO</small></div>}
      <h1>{title}</h1>{description && <p className={styles.description}>{description}</p>}
      {desk && <nav className={styles.deskNav} aria-label={lang === "ja" ? "RIZEL’S DESKメニュー" : "RIZEL’S DESK navigation"}>
        <Link href="/research/notes" aria-current={pathname === "/research/notes" ? "page" : undefined}>{lang === "ja" ? "ひとりごと" : "Notes"}</Link>
        <Link href="/research/qa" aria-current={pathname?.startsWith("/research/qa") ? "page" : undefined}>{lang === "ja" ? "リゼルに聞く" : "Ask RIZEL"}</Link>
        <Link href="/research/weekly" aria-current={pathname === "/research/weekly" ? "page" : undefined}>{lang === "ja" ? "週刊PRO" : "Weekly"}</Link>
      </nav>}
      {children}
    </main>
  </div>;
}
