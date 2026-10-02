"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./page-refresh.module.css";
export default function PageRefresh({ lang }: { lang: "ja" | "en" }) {
  const [pending, setPending] = useState(false);
  const pressed = useRef(false);
  const label = pending ? (lang === "ja" ? "更新中…" : "Refreshing…") : (lang === "ja" ? "ページを更新" : "Refresh page");
  useEffect(() => {
    if (!pending) return;
    // Paint the pressed state before starting the full document reload.
    const timer = window.setTimeout(() => window.location.reload(), 150);
    return () => window.clearTimeout(timer);
  }, [pending]);
  return <button type="button" className={styles.button} aria-label={label} title={label} aria-busy={pending} disabled={pending} onClick={() => { if (!pressed.current) { pressed.current = true; setPending(true); } }}><span className={styles.icon}><svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M20 11a8 8 0 1 0-2.34 6.66M20 4v7h-7" /></svg></span>{pending && <span role="status" className={styles.feedback}>{label}</span>}</button>;
}
