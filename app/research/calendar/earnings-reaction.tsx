"use client";

import { useEffect, useState } from "react";
import { percentText, reactionLines, type ReactionQuote } from "@/lib/research/earnings-reaction";
import calendarStyles from "./event-calendar.module.css";

const clock = (zone: string, at: string) => new Intl.DateTimeFormat("ja-JP", { timeZone: zone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));

/** Share price after the release (Twelve Data quote, pre/post-market included). It states what moved and when; it never says why. */
export default function EarningsReaction({ ticker, releasedAt }: { ticker: string; releasedAt: string }) {
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
    <strong>決算後の株価の反応</strong>
    {lines.length ? <ul>{lines.map(line => <li key={line.label}>{line.label} {percentText(line.percent)}（{line.base}・{clock("Asia/Tokyo", line.at)} JST／{clock("America/New_York", line.at)} ET時点）</li>)}</ul>
      : <p>{quote === "failed" ? "株価を取得できません。" : "発表後の株価の値動きは、まだ取得できていません。"}</p>}
    <small>株価の提供: Twelve Data。値動きの理由は断定しません。</small>
  </div>;
}
