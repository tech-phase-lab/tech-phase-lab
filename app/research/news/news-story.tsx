import type { Language } from "@/lib/research/data";
import { additionalNewsDetail } from "@/lib/research/news-detail";
import styles from "./general-news.module.css";

const SENTENCE = /(?<=[。！？])|(?<=[a-z0-9]{2}[.!?])\s+(?=[A-Z])/;

/** Long company prose, cut at a sentence boundary once it reads at a glance. */
function openedNewsText(body: string, limit = /[぀-ヿ㐀-鿿]/.test(body) ? 160 : 360, sourceNames: string[] = []): string {
  const seen = new Set<string>();
  const paragraphs = body.trim().split(/\n+/).map(text => text.trim().replace(/[（(]([^()（）]+)[）)]\s*$/, (suffix, names: string) =>
    names.split(" / ").every(name => sourceNames.includes(name.trim())) ? "" : suffix).trim())
    .filter(text => text && !seen.has(text) && seen.add(text));
  const kept: string[] = [];
  let length = 0;
  for (const paragraph of paragraphs) {
    const sentences: string[] = [];
    for (const sentence of paragraph.split(SENTENCE)) {
      if (length && length + sentence.length > limit) break;
      sentences.push(sentence);
      length += sentence.length;
    }
    if (sentences.length) kept.push(sentences.join(/[぀-ヿ㐀-鿿]/.test(paragraph) ? "" : " "));
    if (sentences.length < paragraph.split(SENTENCE).length || length >= limit) break;
  }
  return kept.join("\n\n");
}

/** A disclosure promises additional information, never a repeated headline.
 * Opened, the detail continues right after the headline and the date moves to
 * the end. ``concise`` trims long company prose at a sentence boundary. */
export default function NewsStory({ label, title, body, publication, lang, concise = false }: {
  label: string; title: string; body?: string; publication: string; lang: Language; concise?: boolean;
}) {
  const heading = <><span className={styles.tickers}>{label}</span><span className={styles.headline} lang={lang}>{title}</span></>;
  const detail = additionalNewsDetail([label, title, publication], body);
  if (!detail) return <div className={styles.shortStory}>{heading}<span className={styles.note}>{publication}</span></div>;
  return <details className={styles.story}>
    <summary>{heading}<span className={`${styles.note} ${styles.closedOnly}`}>{publication}</span><span className={styles.expand} aria-hidden="true">＋</span><span className={styles.srOnly}>{lang === "ja" ? "詳細を開閉" : "Toggle details"}</span></summary>
    <div className={styles.body} lang={lang}>{concise ? openedNewsText(detail) : detail}<span className={styles.note}>{publication}</span></div>
  </details>;
}
