import type { ReactNode } from "react";
import type { Language } from "@/lib/research/data";
import styles from "./general-news.module.css";

/** A disclosure promises additional information, never a repeated headline. */
export default function NewsStory({ label, title, body, publication, lang, source, children }: {
  label: string; title: string; body?: string; publication: string; lang: Language; source?: { url: string; publisher: string }; children?: ReactNode;
}) {
  const heading = <><span className={styles.tickers}>{label}</span><span className={styles.headline} lang={lang}>{title}</span><span className={styles.note}>{publication}</span></>;
  const attribution = source && <a className={styles.source} href={source.url} target="_blank" rel="noopener noreferrer">{source.publisher} · {lang === "ja" ? "原文" : "Source"} ↗</a>;
  if (!body) return <div className={styles.shortStory}>{heading}{attribution}{children}</div>;
  return <details className={styles.story}>
    <summary>{heading}<span className={styles.expand} aria-hidden="true">＋</span><span className={styles.srOnly}>{lang === "ja" ? "詳細を開閉" : "Toggle details"}</span></summary>
    <div className={styles.body} lang={lang}>{body}</div>{attribution}{children}
  </details>;
}
