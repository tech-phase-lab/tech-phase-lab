import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;

  if (!key || !secret) {
    return NextResponse.json(
      { ok: false, error: "Alpaca credentials are missing.", news: [] },
      { status: 503 },
    );
  }

  try {
    const response = await fetch(
      "https://data.alpaca.markets/v1beta1/news?sort=desc&limit=8",
      {
        headers: {
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Alpaca news REST returned ${response.status}`,
          news: [],
        },
        { status: 502 },
      );
    }

    const payload = await response.json();
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      news: (payload.news ?? []).map((item: Record<string, unknown>) => ({
        id: item.id ?? null,
        headline: item.headline ?? "",
        source: item.source ?? "",
        symbols: item.symbols ?? [],
        createdAt: item.created_at ?? null,
        updatedAt: item.updated_at ?? null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown news REST error",
        news: [],
      },
      { status: 500 },
    );
  }
}
