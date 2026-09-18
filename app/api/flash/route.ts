import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const receivedAt = new Date().toISOString();

  try {
    const body = await request.json();
    const ticker = typeof body.ticker === "string" ? body.ticker.toUpperCase().slice(0, 10) : "MU";
    const headline =
      typeof body.headline === "string"
        ? body.headline.slice(0, 240)
        : "Simulated Tech Phase market event";

    return NextResponse.json({
      id: crypto.randomUUID(),
      ticker,
      headline,
      receivedAt,
      serverProcessedAt: new Date().toISOString(),
      simulated: true,
    });
  } catch {
    return NextResponse.json(
      {
        id: crypto.randomUUID(),
        ticker: "MU",
        headline: "Simulated Tech Phase market event",
        receivedAt,
        serverProcessedAt: new Date().toISOString(),
        simulated: true,
      },
      { status: 200 },
    );
  }
}
