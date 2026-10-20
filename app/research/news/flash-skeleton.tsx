"use client";
import styles from "./flash-page.module.css";

/** One loading look for both the route fallback and the page before its first feed arrives, so the two never read as two loads (owner, Oct 20). */
export default function FlashSkeleton({ ja, bare = false }: { ja: boolean; bare?: boolean }) {
  const loading = <div className={styles.loading} role="status" aria-busy="true" aria-label={ja ? "読み込み中" : "Loading"}><span /><span /><span /><em>{ja ? "ニュースを読み込み中…" : "Loading news…"}</em></div>;
  return bare ? loading : <div className={styles.panel}>{loading}</div>;
}
