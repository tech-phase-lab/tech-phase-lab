"use client";
import ResearchToolShell from "./research-tool-shell";
import { useResearchLanguage } from "./use-research-language";
import styles from "./loading.module.css";

/** Lightweight route fallback; disappears as soon as the destination is ready. */
export default function ResearchLoading() {
  const [lang,setLang]=useResearchLanguage();
  return <ResearchToolShell lang={lang} setLang={setLang} title="" description="" showHeading={false} showTools={false}>
    <div className={styles.loading} role="status" aria-live="polite">
      <svg className={styles.mark} viewBox="0 0 104 104" fill="currentColor" aria-hidden="true"><path d="M2 32 72 2v28L2 60Z"/><path d="m27 56 19-8v50l-19-9Z"/><path d="m72 30 30 17v34l-49 21V65l19-9Z"/></svg>
      <strong className={styles.name}>TECH PHASE</strong>
      <span className={styles.edition}>RESEARCH</span>
      <span className={styles.progress} aria-hidden="true" />
      <span className={styles.caption}>{lang === "ja" ? "読み込み中…" : "Loading…"}</span>
    </div>
  </ResearchToolShell>;
}
