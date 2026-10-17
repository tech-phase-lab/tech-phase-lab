"use client";

import Link from "next/link";
import SiteHeader from "./site-header";
import { usePathname } from "next/navigation";
import HomeSidebar from "./home-sidebar";
import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import base from "./research.module.css";
import styles from "./research-tools.module.css";

export default function ResearchToolShell({ lang, setLang, title, description, children, desk = false, showTools = true, showHeading = true }: { lang: Language; setLang: (lang: Language) => void; title: string; description: string; children: ReactNode; desk?: boolean; showTools?: boolean; showHeading?: boolean }) {
  const pathname = usePathname();
  return <div className={base.app} lang={lang}>
    <a className={base.skip} href="#tool-main">{lang === "ja" ? "本文へ移動" : "Skip to content"}</a>
    <SiteHeader lang={lang} setLang={setLang} />
    <div className={!desk && showTools ? styles.withSidebar : undefined}>
    {!desk && showTools && <aside className={styles.toolSidebar}><HomeSidebar lang={lang} tab={pathname === "/research/calendar" ? "metrics" : "home"} standalone pathname={pathname} /></aside>}
    <main id="tool-main" className={`${styles.main} ${desk ? styles.desk : ""}`}>
      {desk && <div className={styles.deskSignature}><span>RIZEL’S DESK</span><small>TECH PHASE PRO</small></div>}
      {showHeading && <><h1>{title}</h1>{description && <p className={styles.description}>{description}</p>}</>}
      {desk && <nav className={styles.deskNav} aria-label={lang === "ja" ? "RIZEL’S DESKメニュー" : "RIZEL’S DESK navigation"}>
        <Link href="/research/notes" aria-current={pathname === "/research/notes" ? "page" : undefined}>{lang === "ja" ? "ひとりごと" : "Notes"}</Link>
        <Link href="/research/qa" aria-current={pathname?.startsWith("/research/qa") ? "page" : undefined}>{lang === "ja" ? "リゼルに聞く" : "Ask RIZEL"}</Link>
        <Link href="/research/weekly" aria-current={pathname === "/research/weekly" ? "page" : undefined}>{lang === "ja" ? "週刊PRO" : "Weekly"}</Link>
      </nav>}
      {children}
    </main>
    </div>
  </div>;
}
