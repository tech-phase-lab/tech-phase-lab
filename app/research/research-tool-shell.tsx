"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import base from "./research.module.css";
import styles from "./research-tools.module.css";

export default function ResearchToolShell({ lang, setLang, title, description, children }: { lang: Language; setLang: (lang: Language) => void; title: string; description: string; children: ReactNode }) {
  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#tool-main">{lang === "ja" ? "本文へ移動" : "Skip to content"}</a>
    <header className={base.header}>
      <Link href="/research" className={base.brand} aria-label="Tech Phase Research"><span className={base.mark}>TP<span /></span><span>TECH PHASE<small>RESEARCH</small></span></Link>
      <div className={base.languages} aria-label={lang === "ja" ? "言語" : "Language"}><button onClick={() => setLang("ja")} aria-pressed={lang === "ja"}>日本語</button><button onClick={() => setLang("en")} aria-pressed={lang === "en"}>EN</button></div>
    </header>
    <main id="tool-main" className={styles.main}>
      <nav className={styles.links} aria-label={lang === "ja" ? "便利な機能" : "Research tools"}>
        <Link href="/research">{lang === "ja" ? "← ホーム" : "← Home"}</Link>
        <Link href="/research/stocks">{lang === "ja" ? "銘柄検索" : "Stock search"}</Link>
        <Link href="/research/watchlist">{lang === "ja" ? "お気に入り銘柄" : "Favorite stocks"}</Link>
        <Link href="/research/calendar">{lang === "ja" ? "カレンダー" : "Calendar"}</Link>
      </nav>
      <h1>{title}</h1><p className={styles.description}>{description}</p>
      {children}
    </main>
  </div>;
}
