"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Quote = {
  symbol: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  timestamp: string | null;
  quoteTimestamp: string | null;
};

type MarketResponse = {
  ok: boolean;
  live: boolean;
  source: string;
  fetchedAt: string;
  marketOpen: boolean | null;
  nextOpen: string | null;
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

type Benchmark = {
  runs: number;
  avg: number;
  p50: number;
  p95: number;
};

type LatestNewsItem = {
  id: number | null;
  headline: string;
  source: string;
  symbols: string[];
  createdAt: string | null;
  updatedAt: string | null;
};

type LatestNewsResponse = {
  ok: boolean;
  fetchedAt?: string;
  news: LatestNewsItem[];
  error?: string;
};

type RealNewsResult = {
  ok: boolean;
  headline?: string;
  symbols?: string[];
  source?: string;
  createdAt?: string | null;
  receivedAt?: string;
  serverRespondAt?: string;
  sourceToServerMs?: number | null;
  serverProcessMs?: number | null;
  waitedMs?: number;
  relatedToWatchlist?: string[];
  error?: string;
  timeout?: boolean;
  deliveryOverheadMs?: number | null;
  approxSourceToVisibleMs?: number | null;
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

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function sessionLabel(iso: string | null) {
  if (!iso) return "NO TRADE";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const minutes = hour * 60 + minute;

  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return "PRE-MARKET";
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return "REGULAR";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "AFTER HOURS";
  return "OVERNIGHT / LAST";
}

export default function Home() {
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [flash, setFlash] = useState<FlashItem[]>([]);
  const [testing, setTesting] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [probingNews, setProbingNews] = useState(false);
  const [probeStatus, setProbeStatus] = useState("");
  const [realNews, setRealNews] = useState<RealNewsResult | null>(null);
  const [latestNews, setLatestNews] = useState<LatestNewsResponse | null>(null);
  const [lastRoundTrip, setLastRoundTrip] = useState<number | null>(null);
  const [benchmark, setBenchmark] = useState<Benchmark | null>(null);
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
        marketOpen: null,
        nextOpen: null,
        quotes: [],
        error: "Market endpoint unavailable",
      });
    }
  }

  async function loadLatestNews() {
    try {
      const response = await fetch("/api/news-latest", { cache: "no-store" });
      const data = (await response.json()) as LatestNewsResponse;
      setLatestNews(data);
    } catch {
      setLatestNews({ ok: false, news: [], error: "Latest news endpoint unavailable" });
    }
  }

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      void loadMarket();
      void loadLatestNews();
    }, 0);
    const marketTimer = window.setInterval(loadMarket, 15000);
    const newsTimer = window.setInterval(loadLatestNews, 60000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(marketTimer);
      window.clearInterval(newsTimer);
    };
  }, []);

  const quoteMap = useMemo(() => {
    return new Map((market?.quotes ?? []).map((quote) => [quote.symbol, quote]));
  }, [market]);

  async function sendFlash(event: (typeof sampleHeadlines)[number], showCard: boolean) {
    const started = performance.now();
    const response = await fetch("/api/flash", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    });
    const data = await response.json();
    const latencyMs = performance.now() - started;

    if (showCard) {
      const item: FlashItem = {
        id: data.id,
        ticker: data.ticker,
        headline: data.headline,
        impact: "HIGH",
        receivedAt: data.receivedAt,
        latencyMs,
        status: "SIMULATED",
      };
      setFlash((current) => [item, ...current].slice(0, 6));
    }

    return latencyMs;
  }

  async function runFlashTest() {
    setTesting(true);
    try {
      const event = sampleHeadlines[selected % sampleHeadlines.length];
      const latencyMs = await sendFlash(event, true);
      setLastRoundTrip(latencyMs);
      setSelected((value) => value + 1);
    } finally {
      setTesting(false);
    }
  }

  async function runBenchmark() {
    setBenchmarking(true);
    setBenchmark(null);
    try {
      const values: number[] = [];
      for (let i = 0; i < 10; i += 1) {
        const event = sampleHeadlines[(selected + i) % sampleHeadlines.length];
        values.push(await sendFlash(event, false));
      }
      const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
      const result = {
        runs: values.length,
        avg,
        p50: percentile(values, 50),
        p95: percentile(values, 95),
      };
      setBenchmark(result);
      setLastRoundTrip(values[values.length - 1]);
      setSelected((value) => value + values.length);
    } finally {
      setBenchmarking(false);
    }
  }

  async function runRealNewsProbe() {
    setProbingNews(true);
    setRealNews(null);
    setProbeStatus("Listening for live news…");

    try {
      let finalResult: RealNewsResult | null = null;

      for (let attempt = 1; attempt <= 6; attempt += 1) {
        setProbeStatus(`Listening… window ${attempt}/6 (up to 2 min total)`);
        const clientStarted = performance.now();
        const response = await fetch("/api/news-probe", { cache: "no-store" });
        const data = (await response.json()) as RealNewsResult;
        const clientFinished = performance.now();

        if (data.ok) {
          const totalClientFetchMs = clientFinished - clientStarted;
          const serverWaitMs = data.waitedMs ?? 0;
          const deliveryOverheadMs = Math.max(0, totalClientFetchMs - serverWaitMs);
          data.deliveryOverheadMs = deliveryOverheadMs;
          data.approxSourceToVisibleMs =
            data.sourceToServerMs == null ? null : data.sourceToServerMs + deliveryOverheadMs;
          finalResult = data;
          break;
        }

        finalResult = data;
        if (!data.timeout) break;
      }

      setRealNews(
        finalResult ?? {
          ok: false,
          error: "No live news arrived during the 2-minute listening window.",
        },
      );
    } catch (error) {
      setRealNews({
        ok: false,
        error: error instanceof Error ? error.message : "Real news probe failed.",
      });
    } finally {
      setProbeStatus("");
      setProbingNews(false);
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
          <div className="flex items-center gap-3 text-xs">
            <Link href="/research" className="rounded-lg border border-emerald-400/30 px-3 py-2 text-emerald-200 hover:bg-emerald-400/10">
              RESEARCH PREVIEW →
            </Link>
            <span className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${market?.live ? "bg-emerald-400" : "bg-amber-300"}`} />
              <span className="text-zinc-400">{market?.live ? "ALPACA CONNECTED" : "CONNECTING"}</span>
            </span>
            <span className="hidden rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold sm:inline">
              {market?.marketOpen === true ? "MARKET OPEN" : market?.marketOpen === false ? "MARKET CLOSED" : "MARKET —"}
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
              Real-time delivery prototype. Current FLASH button is simulated; market data is live Alpaca IEX.
            </p>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
          <section className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 text-xs font-semibold tracking-[0.18em] text-amber-300">LIVE INTELLIGENCE</div>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Market events, delivered before the noise.</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
                The current lab test measures browser → server → browser delivery. It does not yet measure real news-source latency.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={runRealNewsProbe}
                disabled={probingNews || benchmarking || testing}
                className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-4 py-3 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-400/[0.1] disabled:cursor-wait disabled:opacity-50"
              >
                {probingNews ? "LISTENING…" : "LISTEN FOR REAL NEWS"}
              </button>
              <button
                onClick={runBenchmark}
                disabled={benchmarking || testing || probingNews}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-50"
              >
                {benchmarking ? "BENCHMARKING…" : "RUN 10× BENCHMARK"}
              </button>
              <button
                onClick={runFlashTest}
                disabled={testing || benchmarking || probingNews}
                className="rounded-xl bg-amber-300 px-4 py-3 text-sm font-bold text-black transition hover:bg-amber-200 disabled:cursor-wait disabled:opacity-60"
              >
                {testing ? "RUNNING TEST…" : "INJECT TEST FLASH"}
              </button>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="LATEST LAB ROUND-TRIP"
              value={lastRoundTrip === null ? "—" : `${lastRoundTrip.toFixed(0)} ms`}
              sub="browser → API → visible card"
            />
            <Metric
              label="10× BENCHMARK"
              value={benchmark ? `P95 ${benchmark.p95.toFixed(0)} ms` : "—"}
              sub={benchmark ? `P50 ${benchmark.p50.toFixed(0)} ms · AVG ${benchmark.avg.toFixed(0)} ms` : "run benchmark to measure stability"}
            />
            <Metric
              label="MARKET FEED"
              value={market?.live ? "CONNECTED" : "WAITING"}
              sub={market?.source ?? "Alpaca IEX"}
            />
          </section>

          <section className="mt-4 overflow-hidden rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.025]">
            <div className="flex flex-col gap-3 border-b border-white/[0.07] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div>
                <div className="text-sm font-semibold text-emerald-300">REAL NEWS PROBE</div>
                <div className="mt-1 text-xs text-zinc-600">
                  Opens Alpaca&apos;s live news WebSocket repeatedly and listens for up to 2 minutes.
                </div>
              </div>
              <div className="text-[10px] font-semibold tracking-[0.12em] text-zinc-600">
                SOURCE → SERVER + DELIVERY
              </div>
            </div>
            <div className="px-4 py-5 sm:px-5">
              {!realNews ? (
                <div className="text-sm text-zinc-600">
                  {probingNews ? probeStatus : <>Press <span className="text-emerald-300">LISTEN FOR REAL NEWS</span> to capture the next live Alpaca news item.</>}
                </div>
              ) : realNews.ok ? (
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded bg-emerald-400/10 px-2 py-1 font-bold text-emerald-300">LIVE NEWS</span>
                    <span className="font-semibold text-white">{realNews.source ?? "unknown source"}</span>
                    <span className="text-zinc-600">{(realNews.symbols ?? []).join(", ") || "No ticker"}</span>
                  </div>
                  <div className="mt-3 text-base font-medium leading-6 text-zinc-100">{realNews.headline}</div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <Metric
                      label="SOURCE CREATED → SERVER"
                      value={realNews.sourceToServerMs == null ? "—" : `${realNews.sourceToServerMs} ms`}
                      sub="approx. using Alpaca created_at"
                    />
                    <Metric
                      label="DELIVERY OVERHEAD"
                      value={realNews.deliveryOverheadMs == null ? "—" : `${realNews.deliveryOverheadMs.toFixed(0)} ms`}
                      sub="request + response after removing news wait"
                    />
                    <Metric
                      label="APPROX. SOURCE → VISIBLE"
                      value={realNews.approxSourceToVisibleMs == null ? "—" : `${realNews.approxSourceToVisibleMs.toFixed(0)} ms`}
                      sub="clock-safe estimate"
                    />
                  </div>
                </div>
              ) : (
                <div className="text-sm text-amber-300">
                  {realNews.error ?? "No live news arrived during this probe."}
                </div>
              )}
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#090b0f]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <div className="text-sm font-semibold">LATEST REAL NEWS</div>
                <div className="text-xs text-zinc-600">Recent Alpaca/Benzinga articles via REST. Refreshes every 60 seconds.</div>
              </div>
              <button
                onClick={loadLatestNews}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-zinc-400 hover:bg-white/[0.05]"
              >
                REFRESH
              </button>
            </div>
            <div className="divide-y divide-white/[0.07]">
              {!latestNews ? (
                <div className="px-5 py-8 text-sm text-zinc-600">Loading recent news…</div>
              ) : !latestNews.ok ? (
                <div className="px-5 py-8 text-sm text-amber-300">{latestNews.error ?? "News unavailable"}</div>
              ) : latestNews.news.length === 0 ? (
                <div className="px-5 py-8 text-sm text-zinc-600">No recent articles returned.</div>
              ) : (
                latestNews.news.map((item) => (
                  <article key={String(item.id) + item.headline} className="px-4 py-3.5 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-emerald-300">{item.source || "news"}</span>
                      <span className="text-zinc-600">{item.symbols.join(", ") || "GENERAL"}</span>
                      <span className="ml-auto text-zinc-700">{formatTime(item.createdAt)}</span>
                    </div>
                    <div className="mt-2 text-sm leading-5 text-zinc-200">{item.headline}</div>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-[#090b0f]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div>
                <div className="text-sm font-semibold">FLASH STREAM</div>
                <div className="text-xs text-zinc-600">Newest intelligence appears at the top without page refresh.</div>
              </div>
              <div className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-semibold tracking-wider text-zinc-500">LIVE UI</div>
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
                      <span className="rounded bg-red-500/15 px-2 py-1 text-[10px] font-bold tracking-wider text-red-300">HIGH IMPACT</span>
                      <span className="text-sm font-black text-white">{item.ticker}</span>
                      <span className="text-xs text-zinc-600">{formatTime(item.receivedAt)}</span>
                      <span className="ml-auto font-mono text-xs text-amber-300">{item.latencyMs.toFixed(0)} ms</span>
                    </div>
                    <h2 className="mt-3 text-base font-medium leading-6 text-zinc-100">{item.headline}</h2>
                    <div className="mt-3 flex gap-2 text-[11px]">
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-zinc-500">SIMULATED EVENT</span>
                      <span className="rounded-full border border-emerald-400/15 bg-emerald-400/[0.04] px-2.5 py-1 text-emerald-300">FLASH DELIVERED</span>
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
                    <span className="text-[10px] text-zinc-600">{sessionLabel(quote?.timestamp ?? null)}</span>
                  </div>
                  <div className="mt-4 text-xl font-semibold">{formatPrice(quote?.last ?? null)}</div>
                  <div className="mt-2 flex justify-between text-[11px] text-zinc-600">
                    <span>Bid {formatPrice(quote?.bid ?? null)}</span>
                    <span>Ask {formatPrice(quote?.ask ?? null)}</span>
                  </div>
                  <div className="mt-3 text-[10px] leading-4 text-zinc-700">
                    Latest IEX trade · {formatTime(quote?.timestamp ?? null)} JST
                  </div>
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
