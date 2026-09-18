import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const symbols = ["MU", "NVDA", "NBIS", "AVGO", "TSM"];

export async function GET() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;

  if (!key || !secret) {
    return NextResponse.json(
      {
        ok: false,
        live: false,
        source: "Alpaca credentials missing",
        fetchedAt: new Date().toISOString(),
        marketOpen: null,
        nextOpen: null,
        quotes: [],
        error: "ALPACA_API_KEY / ALPACA_SECRET_KEY are not available to this deployment.",
      },
      { status: 503 },
    );
  }

  const headers = {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
  };

  try {
    const [quoteResponse, tradeResponse, clockResponse] = await Promise.all([
      fetch(
        `https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${symbols.join(",")}&feed=iex`,
        { headers, cache: "no-store" },
      ),
      fetch(
        `https://data.alpaca.markets/v2/stocks/trades/latest?symbols=${symbols.join(",")}&feed=iex`,
        { headers, cache: "no-store" },
      ),
      fetch("https://paper-api.alpaca.markets/v2/clock", { headers, cache: "no-store" }),
    ]);

    if (!quoteResponse.ok || !tradeResponse.ok) {
      const quoteError = quoteResponse.ok ? "" : await quoteResponse.text();
      const tradeError = tradeResponse.ok ? "" : await tradeResponse.text();
      return NextResponse.json(
        {
          ok: false,
          live: false,
          source: "Alpaca IEX",
          fetchedAt: new Date().toISOString(),
          marketOpen: null,
          nextOpen: null,
          quotes: [],
          error: `Alpaca market data error. Quotes ${quoteResponse.status}: ${quoteError.slice(0, 100)} Trades ${tradeResponse.status}: ${tradeError.slice(0, 100)}`,
        },
        { status: 502 },
      );
    }

    const [quotePayload, tradePayload] = await Promise.all([
      quoteResponse.json(),
      tradeResponse.json(),
    ]);

    const clockPayload = clockResponse.ok ? await clockResponse.json() : null;

    const quotes = symbols.map((symbol) => {
      const quote = quotePayload.quotes?.[symbol];
      const trade = tradePayload.trades?.[symbol];

      const rawBid = typeof quote?.bp === "number" ? quote.bp : null;
      const rawAsk = typeof quote?.ap === "number" ? quote.ap : null;

      return {
        symbol,
        bid: rawBid !== null && rawBid > 0 ? rawBid : null,
        ask: rawAsk !== null && rawAsk > 0 ? rawAsk : null,
        last: typeof trade?.p === "number" && trade.p > 0 ? trade.p : null,
        timestamp: trade?.t ?? null,
        quoteTimestamp: quote?.t ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      live: true,
      source: "Alpaca IEX latest trade + quote",
      fetchedAt: new Date().toISOString(),
      marketOpen: typeof clockPayload?.is_open === "boolean" ? clockPayload.is_open : null,
      nextOpen: clockPayload?.next_open ?? null,
      quotes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        live: false,
        source: "Alpaca IEX",
        fetchedAt: new Date().toISOString(),
        marketOpen: null,
        nextOpen: null,
        quotes: [],
        error: error instanceof Error ? error.message : "Unknown market-data error",
      },
      { status: 500 },
    );
  }
}
