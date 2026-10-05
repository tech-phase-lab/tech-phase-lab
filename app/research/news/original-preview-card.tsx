import type { Language } from "@/lib/research/data";
import type { OriginalPreviewItem } from "@/lib/research/original-preview-news";
import NewsStory from "./news-story";
import styles from "./general-news.module.css";

/** Only the bounded original excerpt is shown; this card is never a verified story. */
export default function OriginalPreviewCard({ item, lang }: { item: OriginalPreviewItem; lang: Language }) {
  const ja = lang === "ja";
  const format = (value: string) => new Date(value).toLocaleString(ja ? "ja-JP" : "en-US", { timeZone: "Asia/Tokyo", hour12: false }) + " JST";
  if (item.status === "sec-filing-notice-unreviewed") return <article className={styles.originalPreview}>
    <p className={styles.previewBadge}>SEC · {ja ? "提出情報・未確認・テスト掲載" : "Filing notice · Unreviewed · Test publication"}</p>
    <p className={styles.summary}>{item.issuerName} ({item.issuerTicker}) · Form {item.form}</p>
    <p className={styles.note}>{ja ? "提出情報のみ。本文の内容は未確認です。" : "Filing metadata only. Contents have not been reviewed."}<br />
      {item.bodyAvailability === "unavailable" ? (ja ? "本文未取得" : "Body unavailable") : (ja ? "本文取得済み・未確認・非表示" : "Body retained; unreviewed and not shown")}</p>
    <p className={styles.note}>{ja ? "出典" : "Source"}: <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">SEC EDGAR · {ja ? "提出原文を開く" : "Open filing"}</a></p>
    <p className={styles.note}>{ja ? "SEC受付日時" : "SEC accepted"}: {item.acceptedAt
      ? <time dateTime={item.acceptedAt}>{format(item.acceptedAt)}</time> : (ja ? "日時不明" : "Date/time unknown")}<br />
      {ja ? "提出日" : "Filing date"}: {item.filingDate
        ? <><time dateTime={item.filingDate}>{item.filingDate}</time> ({ja ? "日付のみ・時刻不明" : "date only; time unknown"})</>
        : (ja ? "日付不明" : "Date unknown")}</p>
    <p className={styles.note}>{ja ? "提出情報取得" : "Metadata acquired"}: <time dateTime={item.acquiredAt}>{format(item.acquiredAt)}</time><br />
      {ja ? "自動テスト掲載" : "Automatic test publication"}: <time dateTime={item.previewPublishedAt}>{format(item.previewPublishedAt)}</time></p>
  </article>;
  if (item.status === "source-metadata-notice-unreviewed") {
    const labels = {
      "issuer-metadata": ja ? "企業発表の取得情報" : "Issuer announcement metadata",
      "exchange-disclosure": ja ? "取引所開示の取得情報" : "Exchange disclosure metadata",
      "official-document": ja ? "公式ドキュメントの取得情報" : "Official document metadata",
      "seeded-document": ja ? "登録済みPDFの取得情報" : "Seeded PDF metadata",
    };
    return <article className={styles.originalPreview}>
      <p className={styles.previewBadge}>SOURCE · {labels[item.sourceClass]} · {ja ? "未確認・テスト掲載" : "Unreviewed · Test publication"}</p>
      {item.titleOriginal && <p className={styles.summary}>{item.titleOriginal}</p>}
      <p className={styles.note}>{ja ? "出典情報のみ。本文の内容は未確認・非表示です。" : "Source metadata only. Contents are unreviewed and not shown."}<br />
        {item.bodyAvailability === "unavailable" ? (ja ? "本文未取得" : "Body unavailable") : (ja ? "本文取得済み・未確認" : "Body retained; unreviewed")}</p>
      <p className={styles.note}>{ja ? "出典" : "Source"}: <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceName} · {ja ? "出典を開く" : "Open source"}</a></p>
      <p className={styles.note}>{ja ? "出典の発表日" : "Source publication date"}: {item.sourcePublishedOn
        ? <><time dateTime={item.sourcePublishedOn}>{item.sourcePublishedOn}</time> ({ja ? "日付のみ・時刻不明" : "date only; time unknown"})</>
        : (ja ? "日付不明" : "Date unknown")}</p>
      <p className={styles.note}>{ja ? "出典情報取得" : "Source metadata acquired"}: <time dateTime={item.acquiredAt}>{format(item.acquiredAt)}</time><br />
        {ja ? "自動テスト掲載" : "Automatic test publication"}: <time dateTime={item.previewPublishedAt}>{format(item.previewPublishedAt)}</time></p>
    </article>;
  }
  if (item.summary) {
    // One-line summary; the detail opens from ＋ on the right.
    const published = item.sourceTimePrecision === "timestamp" ? format(item.sourcePublishedAt!)
      : item.sourceTimePrecision === "date" ? item.sourcePublishedOn! : format(item.acquiredAt);
    return <article>
      <NewsStory label={`${item.sourceName} · ${ja ? "AI要約・テスト掲載" : "AI summary · Test publication"}`}
        title={ja ? item.summary.titleJa : item.summary.titleEn}
        body={ja ? item.summary.bodyJa : item.summary.bodyEn} publication={published} lang={lang} />
      <p className={styles.note}>{ja ? "出典" : "Source"}: <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">{item.sourceName} · {ja ? "原文を開く" : "Read original"}</a></p>
    </article>;
  }
  return <article className={styles.originalPreview}>
    <p className={styles.previewBadge}>ORIGINAL · {ja ? "翻訳準備中（原文）・未確認・テスト掲載" : "Original · Summary pending · Unreviewed · Test publication"}</p>
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
