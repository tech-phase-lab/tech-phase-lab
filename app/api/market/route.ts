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
        quotes: [],
        error: "ALPACA_API_KEY / ALPACA_SECRET_KEY are not available to this deployment.",
      },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      `https://data.alpaca.markets/v2/stocks/quotes/latest?symbols=${symbols.join(",")}&feed=iex`,
      {
        headers: {
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        {
          ok: false,
          live: false,
          source: "Alpaca IEX",
          fetchedAt: new Date().toISOString(),
          quotes: [],
          error: `Alpaca returned ${response.status}: ${errorText.slice(0, 160)}`,
        },
        { status: 502 },
      );
    }

    const payload = await response.json();
    const quotes = symbols.map((symbol) => {
      const quote = payload.quotes?.[symbol];
      const bid = typeof quote?.bp === "number" ? quote.bp : null;
      const ask = typeof quote?.ap === "number" ? quote.ap : null;
      const mid = bid !== null && ask !== null ? (bid + ask) / 2 : bid ?? ask;

      return {
        symbol,
        bid,
        ask,
        mid,
        timestamp: quote?.t ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      live: true,
      source: "Alpaca IEX latest quote",
      fetchedAt: new Date().toISOString(),
      quotes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        live: false,
        source: "Alpaca IEX",
        fetchedAt: new Date().toISOString(),
        quotes: [],
        error: error instanceof Error ? error.message : "Unknown market-data error",
      },
      { status: 500 },
    );
  }
}
