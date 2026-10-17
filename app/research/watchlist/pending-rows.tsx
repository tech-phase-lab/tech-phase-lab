import styles from "./pending-rows.module.css";

export function PendingRows({ lang }: { lang: "ja" | "en" }) {
  return <div className={styles.rows} role="status" aria-busy="true" aria-label={lang === "ja" ? "ウォッチリストを読み込み中" : "Loading your watchlist"}>
    {[0, 1, 2].map(row => <div key={row} className={styles.row} aria-hidden="true"><span /><span /><span /></div>)}
  </div>;
}
