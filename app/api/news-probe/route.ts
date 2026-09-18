import { NextResponse } from "next/server";
import WebSocket from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const watchlist = new Set(["MU", "NVDA", "NBIS", "AVGO", "TSM"]);

type NewsMessage = {
  T?: string;
  id?: number;
  headline?: string;
  summary?: string;
  author?: string;
  created_at?: string;
  updated_at?: string;
  symbols?: string[];
  source?: string;
  url?: string;
  msg?: string;
};

export async function GET() {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;

  if (!key || !secret) {
    return NextResponse.json(
      { ok: false, error: "Alpaca credentials are missing." },
      { status: 503 },
    );
  }

  const startedAt = Date.now();

  try {
    const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const ws = new WebSocket("wss://stream.data.alpaca.markets/v1beta1/news", {
        headers: {
          "APCA-API-KEY-ID": key,
          "APCA-API-SECRET-KEY": secret,
        },
      });

      let settled = false;
      const finish = (value: Record<string, unknown>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.terminate();
        } catch {}
        resolve(value);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try {
          ws.terminate();
        } catch {}
        reject(error);
      };

      const timeout = setTimeout(() => {
        finish({
          ok: false,
          timeout: true,
          error: "No news item arrived within 20 seconds. Try again.",
          waitedMs: Date.now() - startedAt,
        });
      }, 20_000);

      ws.on("message", (raw) => {
        try {
          const parsed = JSON.parse(raw.toString()) as NewsMessage[];
          const messages = Array.isArray(parsed) ? parsed : [parsed];

          for (const message of messages) {
            if (message.T === "success" && message.msg === "authenticated") {
              ws.send(JSON.stringify({ action: "subscribe", news: ["*"] }));
              continue;
            }

            if (message.T !== "n" || !message.headline) continue;

            const receivedMs = Date.now();
            const createdMs = message.created_at ? Date.parse(message.created_at) : Number.NaN;
            const symbols = Array.isArray(message.symbols) ? message.symbols : [];
            const related = symbols.filter((symbol) => watchlist.has(symbol));

            finish({
              ok: true,
              id: message.id ?? null,
              headline: message.headline,
              summary: message.summary ?? "",
              symbols,
              source: message.source ?? "unknown",
              url: message.url ?? null,
              createdAt: message.created_at ?? null,
              receivedAt: new Date(receivedMs).toISOString(),
              serverRespondAt: new Date().toISOString(),
              sourceToServerMs: Number.isFinite(createdMs) ? receivedMs - createdMs : null,
              serverProcessMs: Date.now() - receivedMs,
              waitedMs: receivedMs - startedAt,
              relatedToWatchlist: related,
            });
            return;
          }
        } catch (error) {
          fail(error instanceof Error ? error : new Error("Failed to parse news stream."));
        }
      });

      ws.on("error", (error) => {
        fail(new Error(error.message || "Alpaca news WebSocket error"));
      });

      ws.on("close", () => {
        if (!settled) {
          fail(new Error("Alpaca news WebSocket closed before a news item arrived."));
        }
      });
    });

    return NextResponse.json(result, { status: result.ok ? 200 : 504 });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown news probe error",
        waitedMs: Date.now() - startedAt,
      },
      { status: 502 },
    );
  }
}
