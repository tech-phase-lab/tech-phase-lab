// The provider renders its data directly; no per-visitor paid API requests.
export function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ja";
  const ja = lang === "ja";
  const config = {
    colorTheme: "dark", dateRange: "1D", locale: lang, width: "100%", height: "100%",
    showChart: true, showFloatingTooltip: true, scaleFontColor: "#aab9c4", gridLineColor: "rgba(140,160,175,0.12)", showSymbolLogo: true, isTransparent: false,
    tabs: [
      { title: ja ? "指数" : "Indices", symbols: [
        { s: "FOREXCOM:SPXUSD", d: "S&P 500 · CFD" },
        { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100 · CFD" },
        { s: "FOREXCOM:DJI", d: "Dow 30 · CFD" },
      ] },
      { title: ja ? "債券ETF" : "Bond ETFs", symbols: [
        { s: "NASDAQ:SHY", d: ja ? "米国債 1–3年 · SHY" : "1–3 year Treasuries · SHY" },
        { s: "NASDAQ:IEF", d: ja ? "米国債 7–10年 · IEF" : "7–10 year Treasuries · IEF" },
        { s: "NASDAQ:TLT", d: ja ? "米国債 20年超 · TLT" : "20+ year Treasuries · TLT" },
      ] },
      { title: ja ? "為替" : "Forex", symbols: [
        { s: "FX:USDJPY", d: ja ? "米ドル / 円" : "USD / JPY" },
        { s: "FX:EURUSD", d: ja ? "ユーロ / 米ドル" : "EUR / USD" },
        { s: "FX:EURJPY", d: ja ? "ユーロ / 円" : "EUR / JPY" },
      ] },
    ],
  };
  const params = new URL(request.url).searchParams;
  const candles = params.get("chart") === "1";
  const allowed = config.tabs.flatMap(tab => tab.symbols.map(symbol => symbol.s));
  const requested = params.get("symbol") ?? "";
  const chartConfig = { symbol: allowed.includes(requested) ? requested : "FOREXCOM:SPXUSD", interval: "D", style: params.get("style") === "line" ? "2" : "1", theme: "dark", locale: lang, timezone: ja ? "Asia/Tokyo" : "America/New_York", autosize: true, hide_side_toolbar: true, hide_top_toolbar: false, allow_symbol_change: false, save_image: false, calendar: false, support_host: "https://www.tradingview.com" };
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#131722;color:#b2b5be;font:12px sans-serif}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 32px);width:100%}.tradingview-widget-copyright{line-height:32px;text-align:center}a{color:#9abaff}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/markets/" target="_blank" rel="noopener nofollow">Market overview</a> by TradingView</div><script src="https://s3.tradingview.com/external-embedding/embed-widget-${candles ? "advanced-chart" : "market-overview"}.js" async>${JSON.stringify(candles ? chartConfig : config)}</script></div></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'", "Referrer-Policy": "strict-origin-when-cross-origin" },
  });
}
