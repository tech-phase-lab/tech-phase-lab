"use client";

import { useEffect, useMemo, useState } from "react";

type Quote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  timestamp: string | null;
};

type MarketResponse = {
  ok: boolean;
  live: boolean;
  source: string;
  fetchedAt: string;
  quotes: Quote[];
  error?: string;
};

type FlashItem = {
  id: string;
  ticker: string;
  headline: string;
  impact: "HIGH" | "MEDIUM";
  receivedAt: string;
  latencyMs: number;
  status: "SIMULATED";
};

const watchlist = ["MU", "NVDA", "NBIS", "AVGO", "TSM"];

const sampleHeadlines = [
  { ticker: "MU", headline: "Micron raises HBM revenue outlook in test event" },
  { ticker: "NVDA", headline: "NVIDIA announces new AI infrastructure update in test event" },
  { ticker: "NBIS", headline: "Nebius reports new capacity expansion in test event" },
];

function formatPrice(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `$${value.toFixed(value >= 100 ? 2 : 3)}`;
}

function formatTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export default function Home() {
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [flash, setFlash] = useState<FlashItem[]>([]);
  const [testing, setTesting] = useState(false);
  const [lastRoundTrip, setLastRoundTrip] = useState<number | null>(null);
  const [selected, setSelected] = useState(0);

  async function loadMarket() {
    try {
      const response = await fetch("/api/market", { cache: "no-store" });
      const data = (await response.json()) as MarketResponse;
      setMarket(data);
    } catch {
      setMarket({
        ok: false,
        live: false,
        source: "Unavailable",
        fetchedAt: new Date().toISOString(),
        quotes: [],
        error: "Market endpoint unavailable",
      });
    }
  }

  useEffect(() => {
    loadMarket();
    const timer = window.setInterval(loadMarket, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const quoteMap = useMemo(() => {
    return new Map((market?.quotes ?? []).map((quote) => [quote.symbol, quote]));
  }, [market]);

  async function runFlashTest() {
    setTesting(true);
    const event = sampleHeadlines[selected % sampleHeadlines.length];
    const started = performance.now();

    try {
      const response = await fetch("/api/flash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      });

      const data = await response.json();
      const latencyMs = performance.now() - started;

      const item: FlashItem = {
        id: data.id,
        ticker: data.ticker,
        headline: data.headline,
        impact: "HIGH",
        receivedAt: data.receivedAt,
        latencyMs,
        status: "SIMULATED",
      };

      setLastRoundTrip(latencyMs);
      setFlash((current) => [item, ...current].slice(0, 6));
      setSelected((value) => value + 1);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#050608] text-zinc-100">
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-300/30 bg-amber-300/10 text-sm font-black text-amber-300">
              TP
            </div>
            <div>
              <div className="text-sm font-semibold tracking-[0.26em] text-white">TECH PHASE</div>
              <div className="text-[10px] tracking-[0.2em] text-zinc-500">RESEARCH LAB</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`h-2 w-2 rounded-full ${market?.live ? "bg-emerald-400" : "bg-amber-300"}`}
            />
            <span className="text-zinc-400">
              {market?.live ? "ALPACA LIVE" : "CONNECTING / FALLBACK"}
            </span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] grid-cols-1 gap-0 lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <aside className="hidden min-h-[calc(100vh-73px)] border-r border-white/10 px-4 py-6 lg:block">
          <nav className="space-y-1 text-sm">
            {["LIVE INTELLIGENCE", "WHAT CHANGED?", "EARNINGS", "AI INFRA", "SEMICONDUCTORS", "WATCHLIST", "CALENDAR"].map(
              (item, index) => (
                <div
                  key={item}
                  className={`rounded-lg px-3 py-2.5 ${
                    index === 0
                      ? "bg-white/8 font-medium text-white"
                      : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                  }`}
                >
                  {item}
                </div>
              ),
            )}
          </nav>

          <div className="mt-8 rounded-xl border border-amber-300/15 bg-amber-300/[0.04] p-4">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-amber-300">LAB MODE</div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              Real-time delivery architecture prototype. Not an investment recommendation.
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <section className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 text-xs font-semibold tracking-[0.18em] text-amber-300">LIVE INTELLIGENCE</div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Market events, delivered before the noise.
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                Tech Phase Lab measures the path from event ingestion to visible FLASH delivery. The first test below
                measures browser → server → browser round-trip latency.
              </p>
            </div>

            <button
              onClick={runFlashTest}
              disabled={testing}
              className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-bold text-black transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-60"
            >
              {testing ? "RUNNING TEST…" : "INJECT TEST FLASH"}
            </button>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="LATEST LAB ROUND-TRIP"
              value={lastRoundTrip === null ? "—" : `${lastRoundTrip.toFixed(0)} ms`}
              sub="browser → API → visible card"
            />
            <Metric label="TARGET SOURCE → FLASH" value="< 1,000 ms" sub="production architecture goal" />
            <Metric
              label="MARKET FEED"
              value={market?.live ? "LIVE" : "WAITING"}
              sub={market?.source ?? "Alpaca IEX"}
            />
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#090b0f]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <div className="text-sm font-semibold">FLASH STREAM</div>
                <div className="text-xs text-zinc-600">Newest intelligence appears at the top without page refresh.</div>
              </div>
              <div className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-zinc-500">
                LIVE UI
              </div>
            </div>

            <div className="divide-y divide-white/[0.07]">
              {flash.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <div className="mx-auto mb-3 h-2 w-2 animate-pulse rounded-full bg-amber-300" />
                  <div className="text-sm font-medium text-zinc-300">No lab event injected yet.</div>
                  <div className="mt-1 text-xs text-zinc-600">Press “INJECT TEST FLASH” to measure delivery latency.</div>
                </div>
              ) : (
                flash.map((item) => (
                  <article key={item.id} className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-red-500/15 px-2 py-1 text-[10px] font-bold tracking-wider text-red-300">
                        HIGH IMPACT
                      </span>
                      <span className="text-sm font-black text-white">{item.ticker}</span>
                      <span className="text-xs text-zinc-600">{formatTime(item.receivedAt)}</span>
                      <span className="ml-auto font-mono text-xs text-amber-300">{item.latencyMs.toFixed(0)} ms</span>
                    </div>
                    <h2 className="mt-3 text-base font-medium leading-6 text-zinc-100">{item.headline}</h2>
                    <div className="mt-3 flex gap-2 text-[11px]">
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-zinc-500">SIMULATED EVENT</span>
                      <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-emerald-300">
                        FLASH DELIVERED
                      </span>
                    </div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {watchlist.map((symbol) => {
              const quote = quoteMap.get(symbol);
              return (
                <div key={symbol} className="rounded-xl border border-white/10 bg-[#090b0f] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">{symbol}</span>
                    <span className="text-[10px] text-zinc-600">IEX</span>
                  </div>
                  <div className="mt-4 text-xl font-semibold">{formatPrice(quote?.mid ?? null)}</div>
                  <div className="mt-2 flex justify-between text-[11px] text-zinc-600">
                    <span>Bid {formatPrice(quote?.bid ?? null)}</span>
                    <span>Ask {formatPrice(quote?.ask ?? null)}</span>
                  </div>
                  <div className="mt-3 text-[10px] text-zinc-700">{formatTime(quote?.timestamp ?? null)} JST</div>
                </div>
              );
            })}
          </section>
        </main>

        <aside className="border-t border-white/10 px-4 py-6 lg:min-h-[calc(100vh-73px)] lg:border-l lg:border-t-0 lg:px-5">
          <div className="text-xs font-semibold tracking-[0.16em] text-zinc-500">WATCHLIST STATUS</div>
          <div className="mt-4 space-y-2">
            {watchlist.map((symbol) => (
              <div key={symbol} className="flex items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2.5">
                <span className="text-sm font-semibold">{symbol}</span>
                <span className={`h-2 w-2 rounded-full ${quoteMap.has(symbol) ? "bg-emerald-400" : "bg-zinc-700"}`} />
              </div>
            ))}
          </div>

          <div className="mt-7 border-t border-white/10 pt-6">
            <div className="text-xs font-semibold tracking-[0.16em] text-zinc-500">PIPELINE</div>
            <div className="mt-4 space-y-4">
              <PipelineStep number="01" title="INGEST" detail="News / filing / market event" />
              <PipelineStep number="02" title="FLASH" detail="Fact-only immediate delivery" active />
              <PipelineStep number="03" title="QUICK TAKE" detail="AI impact classification" />
              <PipelineStep number="04" title="FULL IMPACT" detail="Deep supply-chain analysis" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#090b0f] p-4">
      <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-600">{label}</div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</div>
      <div className="mt-1 text-xs text-zinc-600">{sub}</div>
    </div>
  );
}

function PipelineStep({
  number,
  title,
  detail,
  active = false,
}: {
  number: string;
  title: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
          active ? "border-amber-300/50 bg-amber-300/10 text-amber-300" : "border-white/10 text-zinc-600"
        }`}
      >
        {number}
      </div>
      <div>
        <div className={`text-xs font-semibold ${active ? "text-amber-300" : "text-zinc-300"}`}>{title}</div>
        <div className="mt-1 text-[11px] leading-4 text-zinc-600">{detail}</div>
      </div>
    </div>
  );
}
