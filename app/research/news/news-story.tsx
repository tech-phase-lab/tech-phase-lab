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

/** Source-attribution filler a summary sometimes appends; never a fact. */
const FILLER = /^(?:この)?(?:投稿|情報|内容|報道)は.{0,20}(?:Twitter|X|ツイッター)の?アカウントから(?:の|による)?(?:報告|投稿|情報)です。?$|^(?:This|The) (?:post|information|report) (?:is|was|comes) (?:from|reported by|shared by|posted by) (?:a|an|the) (?:Twitter|X) account\.?$/i;

function withoutFiller(text: string): string {
  return text.split(/\n+/).map(paragraph => {
    const sentences = paragraph.trim().split(SENTENCE);
    const kept = sentences.filter(sentence => !FILLER.test(sentence.trim()));
    return (kept.length ? kept : sentences).join(/[぀-ヿ㐀-鿿]/.test(paragraph) ? "" : " ").trim();
  }).filter(Boolean).join("\n\n");
}

/** The body already tells the headline when it opens with the same words and
 * every headline number; the opened story then replaces the headline. */
function bodyRestatesTitle(title: string, body: string): boolean {
  const comparable = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en").replace(/[^\p{L}\p{N}.%$]+/gu, "");
  const head = comparable(title), lead = comparable(body.trim().split(/\n+/)[0] ?? "");
  if (head.length < 6 || !lead) return false;
  const numbers = title.normalize("NFKC").match(/\d+(?:[.,]\d+)*/g) ?? [];
  if (numbers.some(number => !body.normalize("NFKC").includes(number))) return false;
  const pairs = Array.from({ length: head.length - 1 }, (_, index) => head.slice(index, index + 2));
  return pairs.filter(pair => lead.includes(pair)).length / pairs.length >= 0.7;
}

/** Opened text that only rewords the headline promises nothing more, so the
 * story stays a plain headline without a ＋ (owner, Oct 8). */
function addsInformation(title: string, text: string): boolean {
  const norm = (value: string) => value.normalize("NFKC").toLocaleLowerCase("en");
  const head = norm(title), body = norm(text);
  if ((body.match(/\d+(?:[.,]\d+)*/g) ?? []).some(number => !head.includes(number))) return true;
  let units: string[], known: (unit: string) => boolean;
  if (/[぀-ヿ㐀-鿿]/.test(body)) {
    const content = (value: string) => value.replace(/[぀-ゟ]|[^\p{L}\p{N}.%$]/gu, "");
    const core = content(body), seen = content(head);
    units = Array.from({ length: Math.max(core.length - 1, 0) }, (_, index) => core.slice(index, index + 2));
    known = unit => seen.includes(unit);
  } else {
    const STOP = /^(?:that|this|with|from|have|has|been|were|was|will|which|their|they|said|says|also|into|than|about|after|over|more)$/;
    const words = (value: string) => (value.match(/\p{L}{4,}/gu) ?? []).filter(word => !STOP.test(word)).map(word => word.slice(0, 5));
    const seen = new Set(words(head));
    units = words(body);
    known = unit => seen.has(unit);
  }
  return units.length > 0 && units.filter(known).length / units.length < 0.85;
}

/** A disclosure promises additional information, never a repeated headline.
 * Opened, the detail continues right after the headline and the date moves to
 * the end. A ``concise`` company story instead replaces its headline with the
 * full story text (cut at a sentence boundary) when opened (owner, Oct 7). */
export default function NewsStory({ label, title, body, fullBody, publication, lang, concise = false }: {
  label: string; title: string; body?: string; fullBody?: string; publication: string; lang: Language; concise?: boolean;
}) {
  const detail = additionalNewsDetail([label, title, publication], body);
  if (!detail) return <div className={styles.shortStory}><span className={styles.tickers}>{label}</span><span className={styles.headline} lang={lang}>{title}</span><span className={styles.note}>{publication}</span></div>;
  // Opened, every story reads as one text: a body that already restates the
  // headline replaces it rather than repeating it (owner, Oct 8).
  const replaces = concise || (!!body && bodyRestatesTitle(title, body));
  const opened = withoutFiller(concise ? openedNewsText(fullBody?.trim() ? fullBody : `${title}\n\n${detail}`) : replaces ? openedNewsText(body!, Infinity) : detail);
  if (!addsInformation(title, opened)) return <div className={styles.shortStory}><span className={styles.tickers}>{label}</span><span className={styles.headline} lang={lang}>{title}</span><span className={styles.note}>{publication}</span></div>;
  return <details className={replaces ? `${styles.story} ${styles.replaces}` : styles.story}>
    <summary><span className={styles.tickers}>{label}</span><span className={replaces ? `${styles.headline} ${styles.closedOnly}` : styles.headline} lang={lang}>{title}</span><span className={`${styles.note} ${styles.closedOnly}`}>{publication}</span><span className={styles.expand} aria-hidden="true">＋</span><span className={styles.srOnly}>{lang === "ja" ? "詳細を開閉" : "Toggle details"}</span></summary>
    <div className={styles.body} lang={lang}>{opened}<span className={styles.note}>{publication}</span></div>
  </details>;
}
