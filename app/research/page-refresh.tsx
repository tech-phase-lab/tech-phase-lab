"use client";
import styles from "./page-refresh.module.css";
export default function PageRefresh({ lang }: { lang: "ja" | "en" }) {
  const label = lang === "ja" ? "ページを更新" : "Refresh page";
  return <button type="button" className={styles.button} aria-label={label} title={label} onClick={() => window.location.reload()}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.34 6.66M20 4v7h-7" /></svg></button>;
}
