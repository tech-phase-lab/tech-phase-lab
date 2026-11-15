"use client";

import { useRef } from "react";
import type { Language } from "@/lib/research/data";
import type { CompanyWireItem } from "@/lib/research/company-wire";
import type { GeneralNewsFeed } from "@/lib/research/general-news";
import { topicCards, topicImpact, type TopicImpact } from "@/lib/research/topics";
import { dayKey, dayLabel, pageWindow, withDayDividers } from "@/lib/research/news-day";
import FeedPagination from "./feed-pagination";
import styles from "./general-news.module.css";

const clock = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false });
const IMPACT_CLASS: Record<TopicImpact, string> = { positive: "topicPositive", negative: "topicNegative", neutral: "topicNeutral" };

/** 注目トピック (owner, Nov 15): the Stock News API stories as cards, newest first, with a divider per day. Every card is open:
 * ticker and impact, the time, the full headline, its summary when one exists, and the publisher with a link to the article.
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
      : <div className={styles.topicList}>{withDayDividers(visible.map(card => ({ card, dayKey: dayKey(card.at, "time") }))).map(({ entry: { card }, divider }) => {
        const rule = divider ? <h2 className={styles.topicDay} key={`day-${divider}-${card.id}`}>{dayLabel(divider, now, ja)}</h2> : null;
        const row = <article key={card.id} className={`${styles.topicCard} ${styles[IMPACT_CLASS[card.impact]]}`}>
          <div className={styles.topicMeta}>
            <span className={styles.topicTags}>{card.tickers && <span className={styles.topicTicker}>{card.tickers}</span>}<span className={styles.topicImpact}>{impactText(card.impact)}</span></span>
            <time dateTime={card.at}>{clock.format(new Date(card.at))}</time>
          </div>
          <h3 className={styles.topicTitle} lang={lang}>{card.title}</h3>
          {card.summary && <p className={styles.topicSummary} lang={lang}>{card.summary}</p>}
          <div className={styles.topicSource}>
            <span>{card.publisher}</span>
            <a href={card.url} target="_blank" rel="noopener noreferrer">{ja ? "元記事を読む" : "Read the article"} <span aria-hidden="true">↗</span></a>
          </div>
        </article>;
        return rule ? [rule, row] : row;
      })}</div>}
    <FeedPagination page={current} pages={pages} ja={ja} onChange={n => { onPage(n); top.current?.scrollIntoView({ block: "start", behavior: "instant" }); }} />
  </section>;
}
