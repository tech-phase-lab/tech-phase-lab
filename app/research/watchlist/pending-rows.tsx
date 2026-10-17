import styles from "./pending-rows.module.css";

export function PendingRows({ lang }: { lang: "ja" | "en" }) {
  return <div className={styles.loading} role="status" aria-busy="true" aria-label={lang === "ja" ? "ウォッチリストを読み込み中" : "Loading your watchlist"}>
    <span>{lang === "ja" ? "読み込み中…" : "Loading…"}</span>
  </div>;
}
