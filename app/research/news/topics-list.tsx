"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import type { CompanyWireItem } from "@/lib/research/company-wire";
import type { GeneralNewsFeed } from "@/lib/research/general-news";
import { summaryMayOverflow, summaryToggle, topicCards, topicCredit, topicImpact, type TopicImpact } from "@/lib/research/topics";
import { dayKey, dayLabel, pageWindow, withDayDividers } from "@/lib/research/news-day";
import { displayClock } from "@/lib/research/display-time";
import FeedPagination from "./feed-pagination";
import styles from "./general-news.module.css";

const IMPACT_CLASS: Record<TopicImpact, string> = { positive: "topicPositive", negative: "topicNegative", neutral: "topicNeutral" };

/** A card's summary in four lines; a longer one gets a 「＋」 that opens the full text (「−」 closes it). Until the browser has measured
 * the text, the length decides whether the button is shown (summaryMayOverflow), so the first paint already has it. */
function TopicSummary({ text, lang }: { text: string; lang: Language }) {
  const ja = lang === "ja";
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(() => summaryMayOverflow(text, ja));
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, open]);
  const toggle = summaryToggle(open, ja);
  return <div className={styles.topicSummaryRow}>
    <p ref={ref} className={`${styles.topicSummary}${open ? "" : ` ${styles.topicClamped}`}`} lang={lang}>{text}</p>
    {(overflow || open) && <button type="button" className={styles.topicMore} aria-expanded={open} aria-label={toggle.label} onClick={() => setOpen(!open)}>{toggle.text}</button>}
  </div>;
}

/** 注目トピック (owner, Nov 15): the Stock News API stories as cards, newest first, with a divider per day. Each card: ticker and impact,
 * the time, the full headline (in English, the link to the article in a new tab; in Japanese plain text, owner Nov 21), its summary in up to four lines with 「＋」, and the publisher in
 * small type. The same story from several publishers is one card (topicCards). One credit line closes the list.
 * No business-impact text or confidence (the provider gives only a short summary), and no gold: FREE members see this page too. */
export default function TopicsList({ lang, data, wire, wireReady, error, receivedAt, page, onPage }: {
  lang: Language; data: GeneralNewsFeed | null; wire: Record<string, CompanyWireItem[]>; wireReady: boolean; error: boolean;
  receivedAt: string | null; page: number; onPage: (page: number) => void;
}) {
  const ja = lang === "ja";
  const top = useRef<HTMLElement>(null);
  const cards = topicCards(data, wire, lang);
  const { pages, current, start, end } = pageWindow(cards.length, page);
  const visible = cards.slice(start, end);
  // 今日 / 昨日 are judged at the time the feeds were last checked.
  const now = receivedAt ? Date.parse(receivedAt) : 0;
  const impactText = (impact: TopicImpact) => topicImpact(impact, ja);
  return <section ref={top} className={styles.topics} aria-label={ja ? "注目トピック一覧" : "Top topics"}>
    <p className={styles.topicLive}><span aria-hidden="true" />{ja ? "自動で更新中" : "Updating automatically"}</p>
    {!cards.length ? (error
      ? <p role="status" className={styles.topicEmpty}>{ja ? "トピックを取得できません。しばらくしてからもう一度開いてください。" : "Topics are unavailable. Please try again shortly."}</p>
      : !data && !wireReady
        ? <div className={styles.placeholder} aria-busy="true" aria-label={ja ? "トピックを取得中" : "Fetching topics"} />
        : <p role="status" className={styles.topicEmpty}>{ja ? "現在、掲載中のトピックはありません。" : "No topics are currently listed."}</p>)
      : <div className={styles.topicList}>{withDayDividers(visible.map(card => ({ card, dayKey: dayKey(card.at, "time", lang) }))).map(({ entry: { card }, divider }) => {
        const rule = divider ? <h2 className={styles.topicDay} key={`day-${divider}-${card.id}`}>{dayLabel(divider, now, ja)}</h2> : null;
        const row = <article key={card.id} className={`${styles.topicCard} ${styles[IMPACT_CLASS[card.impact]]}`}>
          <div className={styles.topicMeta}>
            <span className={styles.topicTags}>{card.tickers && <span className={styles.topicTicker}>{card.tickers}</span>}<span className={styles.topicImpact}>{impactText(card.impact)}</span></span>
            <time dateTime={card.at}>{displayClock(card.at, lang)}</time>
          </div>
          {/* Owner, Nov 21: the articles are all in English, so the Japanese page shows the headline as plain text, not a link. */}
          <h3 className={styles.topicTitle} lang={lang}>{ja ? card.title : <a href={card.url} target="_blank" rel="noopener noreferrer">{card.title}</a>}</h3>
          {card.summary && <TopicSummary text={card.summary} lang={lang} />}
          <p className={styles.topicPublisher}>{card.publisher}</p>
        </article>;
        return rule ? [rule, row] : row;
      })}</div>}
    <FeedPagination page={current} pages={pages} ja={ja} onChange={n => { onPage(n); top.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
    {cards.length > 0 && <p className={styles.topicCredit}>{topicCredit(ja)}</p>}
  </section>;
}
