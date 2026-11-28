"use client";

import { useEffect, useState } from "react";
import { percentText, reactionDay, reactionLines, type ReactionQuote } from "@/lib/research/earnings-reaction";
import calendarStyles from "./event-calendar.module.css";

/** The share price after the release in one line under the table (owner, Nov 28, mock 01): on the left 「翌日の株価 +6.70%」 (larger,
 * coloured), on the right, small, the pre-market / after-hours move. It states what moved, never why. Nothing is shown until a move
 * stamped after the release exists; a later day's move is named by its date, never as the next day's. */
export default function EarningsReaction({ ticker, releasedAt, lang }: { ticker: string; releasedAt: string; lang: "ja" | "en" }) {
  const ja = lang === "ja";
  const [quote, setQuote] = useState<ReactionQuote | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/research/market/quotes?tickers=${encodeURIComponent(ticker)}`, { signal: controller.signal, cache: "no-store" })
      .then(r => r.ok ? r.json() : null).then(body => setQuote(body?.quotes?.[ticker] ?? null)).catch(() => {});
    return () => controller.abort();
  }, [ticker]);
  const lines = reactionLines(quote, releasedAt);
  if (!lines.length) return null;
  const minus = (p: number) => percentText(p).replace("-", "−");
  const regular = lines.find(line => line.label === "通常取引");
  const extended = lines.find(line => line !== regular);
  const day = regular ? reactionDay(regular.at, releasedAt) : null;
  const name = !regular ? null : day === "next" ? (ja ? "翌日の株価" : "Next day") : day === "same" ? (ja ? "当日の株価" : "Same day")
    : (() => { const d = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).format(new Date(regular.at)); return ja ? `株価（${d}）` : `Share price (${d})`; })();
  return <p className={calendarStyles.reaction}>
    {regular && <span>{name} <b data-tone={regular.percent < 0 ? "down" : "up"}>{minus(regular.percent)}</b></span>}
    {extended && <small>{ja ? extended.label : extended.labelEn} {minus(extended.percent)}</small>}
  </p>;
}
