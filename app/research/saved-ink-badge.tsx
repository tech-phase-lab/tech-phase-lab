"use client";

import { useMemo, useSyncExternalStore } from "react";
import { parseAnnotations } from "@/lib/research/annotations";
import type { Language } from "@/lib/research/data";
import styles from "./research.module.css";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("tech-phase:annotations-changed", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("tech-phase:annotations-changed", callback);
  };
}
export default function SavedInkBadge({ articleId, lang }: { articleId: string; lang: Language }) {
  const key = `tech-phase:annotations:v1:${encodeURIComponent(articleId)}:${lang}`;
  const raw = useSyncExternalStore(subscribe, () => {
    try { return localStorage.getItem(key) ?? "[]"; } catch { return "[]"; }
  }, () => "[]");
  const hasInk = useMemo(() => parseAnnotations(raw).length > 0, [raw]);
  if (!hasInk) return null;
  const label = lang === "ja" ? "書き込みあり" : "Annotated";
  return <span className={styles.savedInkBadge} title={label} role="img" aria-label={label}>
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z" /></svg>
  </span>;
}
