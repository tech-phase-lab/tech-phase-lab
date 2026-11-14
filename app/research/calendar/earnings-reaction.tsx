"use client";

import { useEffect, useState } from "react";
import { percentText, reactionLines, type ReactionQuote } from "@/lib/research/earnings-reaction";
import calendarStyles from "./event-calendar.module.css";

const clock = (zone: string, at: string, ja: boolean) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));

/** Share price after the release (Twelve Data quote, pre/post-market included). It states what moved and when; it never says why. */
export default function EarningsReaction({ ticker, releasedAt, lang }: { ticker: string; releasedAt: string; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [quote, setQuote] = useState<ReactionQuote | null | "failed">(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/quotes?tickers=${encodeURIComponent(ticker)}`, { signal: controller.signal, cache: "no-store" })
      .then(r => r.ok ? r.json() : Promise.reject()).then(body => setQuote(body?.quotes?.[ticker] ?? "failed")).catch(() => { if (!controller.signal.aborted) setQuote("failed"); });
    return () => controller.abort();
  }, [ticker]);
  if (quote === null) return null;
  const lines = quote === "failed" ? [] : reactionLines(quote, releasedAt);
  return <div className={calendarStyles.reaction}>
    <strong>{ja ? "決算後の株価の反応" : "Share price after earnings"}</strong>
    {lines.length ? <ul>{lines.map(line => <li key={line.label}>{ja
      ? <>{line.label} {percentText(line.percent)}（{line.base}・{clock("Asia/Tokyo", line.at, ja)} JST／{clock("America/New_York", line.at, ja)} ET時点）</>
      : <>{line.labelEn} {percentText(line.percent)} ({line.baseEn} · as of {clock("Asia/Tokyo", line.at, ja)} JST / {clock("America/New_York", line.at, ja)} ET)</>}</li>)}</ul>
      : <p>{quote === "failed" ? (ja ? "株価を取得できません。" : "Share price unavailable.") : (ja ? "発表後の株価の値動きは、まだ取得できていません。" : "No share price move since the release yet.")}</p>}
    <small>{ja ? "株価の提供: Twelve Data。値動きの理由は断定しません。" : "Prices: Twelve Data. We do not state why the price moved."}</small>
  </div>;
}
