import { usableFavoriteQuote, type FavoriteQuote } from "./favorite-lists.ts";

const marketDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

// Use only observed points from the quote's market date. Never synthesize a
// curve, join separate trading days, or extend it past the quote timestamp.
export function favoriteIntradayChart(quote: FavoriteQuote) {
  if (!usableFavoriteQuote(quote, quote.ticker) || quote.change === null || !quote.history?.length) return null;
  const reference = quote.price - quote.change;
  if (!Number.isFinite(reference) || reference <= 0) return null;
  const asOf = Date.parse(quote.asOf);
  const day = marketDate.format(asOf);
  const points = quote.history;
  if (points.some((point, index) => !Number.isFinite(point.price) || point.price <= 0 ||
    !Number.isFinite(Date.parse(point.at)) || (index > 0 && Date.parse(point.at) <= Date.parse(points[index - 1].at)))) return null;
  const intraday = points.filter(point => Date.parse(point.at) <= asOf && marketDate.format(Date.parse(point.at)) === day);
  if (intraday.length < 2) return null;
  return { reference, values: intraday.map(point => point.price), start: intraday[0].at, end: intraday[intraday.length - 1].at };
}
