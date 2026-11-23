"use client";

import { useEffect, useState } from "react";
import { percentText, reactionLines, type ReactionQuote } from "@/lib/research/earnings-reaction";
import calendarStyles from "./event-calendar.module.css";

const clock = (zone: string, at: string, ja: boolean) => new Intl.DateTimeFormat(ja ? "ja-JP" : "en-US", { timeZone: zone, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(at));

/** Share price after the release (pre/post-market included), one short line per session: 「プレマーケット −9.26%（11/23 20:19 JST時点）」.
 * It states what moved and when; it never says why. Nothing is shown until a move stamped after the release exists (owner, Nov 23:
 * no provider or disclaimer lines inside the card; the price provider is credited once under the results list). */
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
  return <p className={calendarStyles.reaction}>{lines.map(line => <span key={line.label}>{ja
    ? <>{line.label} <b data-tone={line.percent < 0 ? "down" : "up"}>{minus(line.percent)}</b>（{clock("Asia/Tokyo", line.at, ja)} JST時点）</>
    : <>{line.labelEn} <b data-tone={line.percent < 0 ? "down" : "up"}>{minus(line.percent)}</b> (as of {clock("America/New_York", line.at, ja)} ET)</>}</span>)}</p>;
}
