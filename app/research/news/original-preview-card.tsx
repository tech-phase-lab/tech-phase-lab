import type { Language } from "@/lib/research/data";
import type { OriginalPreviewItem } from "@/lib/research/original-preview-news";
import styles from "./general-news.module.css";

/** Only the bounded original excerpt is shown; this card is never a verified story. */
export default function OriginalPreviewCard({ item, lang }: { item: OriginalPreviewItem; lang: Language }) {
  const ja = lang === "ja";
  const format = (value: string) => new Date(value).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";
  return <article className={styles.originalPreview}>
    <p className={styles.previewBadge}>ORIGINAL · {ja ? "未翻訳・未確認・テスト掲載" : "Untranslated · Unreviewed · Test publication"}</p>
    <p className={styles.summary}>{item.excerptOriginal}</p>
    <p className={styles.note}>{ja ? "出典" : "Source"}: <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceName} · {ja ? "原文を開く" : "Read original"}</a></p>
    <p className={styles.note}>{ja ? "原文発表" : "Source published"}: {item.sourceTimePrecision === "timestamp"
      ? <time dateTime={item.sourcePublishedAt!}>{format(item.sourcePublishedAt!)}</time>
      : item.sourceTimePrecision === "date"
        ? <><time dateTime={item.sourcePublishedOn!}>{item.sourcePublishedOn}</time> ({ja ? "日付のみ・時刻不明" : "date only; time unknown"})</>
        : (ja ? "日時不明" : "Date/time unknown")}</p>
    <p className={styles.note}>{ja ? "取得" : "Acquired"}: <time dateTime={item.acquiredAt}>{format(item.acquiredAt)}</time><br />
      {ja ? "自動テスト掲載" : "Automatic test publication"}: <time dateTime={item.previewPublishedAt}>{format(item.previewPublishedAt)}</time></p>
  </article>;
}
