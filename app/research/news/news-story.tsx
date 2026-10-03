import type { Language } from "@/lib/research/data";
import styles from "./general-news.module.css";

/** A disclosure promises additional information, never a repeated headline. */
export default function NewsStory({ label, title, body, publication, lang }: {
  label: string; title: string; body?: string; publication: string; lang: Language;
}) {
  const heading = <><span className={styles.tickers}>{label}</span><span className={styles.headline} lang={lang}>{title}</span><span className={styles.note}>{publication}</span></>;
  if (!body) return <div className={styles.shortStory}>{heading}</div>;
  return <details className={styles.story}>
    <summary>{heading}<span className={styles.expand} aria-hidden="true">＋</span><span className={styles.srOnly}>{lang === "ja" ? "詳細を開閉" : "Toggle details"}</span></summary>
    <div className={styles.body} lang={lang}>{body}</div>
  </details>;
}
