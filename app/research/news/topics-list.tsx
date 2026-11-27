"use client";

import { useRef, useState } from "react";
import type { Language } from "@/lib/research/data";
import type { CompanyWireItem } from "@/lib/research/company-wire";
import type { GeneralNewsFeed } from "@/lib/research/general-news";
import { summaryToggle, topicCards, topicCredit, topicImpact, type TopicImpact } from "@/lib/research/topics";
import { dayKey, dayLabel, pageWindow, withDayDividers } from "@/lib/research/news-day";
import { displayClock } from "@/lib/research/display-time";
import FeedPagination, { turnPageInPlace } from "./feed-pagination";
import styles from "./general-news.module.css";

const IMPACT_CLASS: Record<TopicImpact, string> = { positive: "topicPositive", negative: "topicNegative", neutral: "topicNeutral" };

/** Owner, Nov 26: a card shows its headline only; 「＋」 beside the publisher opens the summary under the headline and 「−」 closes it.
 * Only a card with a summary has the button (topicCards drops an empty one), so the button always opens something. */
function TopicFoot({ summary, publisher, lang, id }: { summary?: string; publisher: string; lang: Language; id: string }) {
  const ja = lang === "ja";
  const [open, setOpen] = useState(false);
  const toggle = summaryToggle(open, ja);
  const panel = `${id}-summary`;
  return <>
    {summary && open && <p id={panel} className={styles.topicSummary} lang={lang}>{summary}</p>}
    <div className={styles.topicFoot}>
      <p className={styles.topicPublisher}>{publisher}</p>
      {summary && <button type="button" className={styles.topicMore} aria-expanded={open} aria-controls={panel} aria-label={toggle.label} onClick={() => setOpen(!open)}>{toggle.text}</button>}
    </div>
  </>;
}

/** 注目トピック (owner, Nov 15): the Stock News API stories as cards, newest first, with a divider per day. Each card: ticker and impact,
 * the time, the full headline (in English, the link to the article in a new tab; in Japanese plain text, owner Nov 21), 「＋」 to open its summary (owner, Nov 26), and the publisher in
 * small type. The same story from several publishers is one card (topicCards). One credit line closes the list.
 * No business-impact text or confidence (the provider gives only a short summary), and no gold: FREE members see this page too. */
export default function TopicsList({ lang, data, wire, wireReady, updating = false, error, receivedAt, page, onPage }: {
  lang: Language; data: GeneralNewsFeed | null; wire: Record<string, CompanyWireItem[]>; wireReady: boolean;
  /** A check for new stories is running: the dot beside 自動で更新中 blinks (owner, Nov 26). */ updating?: boolean; error: boolean;
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
    <p className={styles.topicLive}><span aria-hidden="true" className={updating ? styles.topicLiveUpdating : undefined} />{ja ? "自動で更新中" : "Updating automatically"}</p>
    {!cards.length ? (error
      ? <p role="status" className={styles.topicEmpty}>{ja ? "トピックを読み込めません" : "Topics can't be loaded"}</p>
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
          <TopicFoot summary={card.summary} publisher={card.publisher} lang={lang} id={card.id} />
        </article>;
        return rule ? [rule, row] : row;
      })}</div>}
    <FeedPagination page={current} pages={pages} ja={ja} onChange={n => { turnPageInPlace(top.current?.closest("main")?.querySelector("h1")?.closest("header") ?? top.current, top.current); onPage(n); }} />
    {cards.length > 0 && <p className={styles.topicCredit}>{topicCredit(ja)}</p>}
  </section>;
}
