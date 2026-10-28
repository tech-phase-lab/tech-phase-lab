import type { ReactNode } from "react";
import styles from "./layout.module.css";

export default function WatchlistLayout({ children }: { children: ReactNode }) {
  return <div className={styles.watchlist}>{children}</div>;
}
