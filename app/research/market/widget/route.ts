// The provider renders its data directly; no per-visitor paid API requests.
export function GET(request: Request) {
  const lang = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ja";
  const ja = lang === "ja";
  const config = {
    colorTheme: "dark", dateRange: "1D", locale: lang, width: "100%", height: "100%",
    showChart: true, showSymbolLogo: true, isTransparent: false,
    tabs: [
      { title: ja ? "指数" : "Indices", symbols: [
        { s: "FOREXCOM:SPXUSD", d: "S&P 500 · CFD" },
        { s: "FOREXCOM:NSXUSD", d: "Nasdaq 100 · CFD" },
        { s: "FOREXCOM:DJI", d: "Dow 30 · CFD" },
      ] },
      { title: ja ? "米国債利回り" : "Treasury yields", symbols: [
        { s: "TVC:US02Y", d: ja ? "米国債 2年" : "U.S. 2-year yield" },
        { s: "TVC:US10Y", d: ja ? "米国債 10年" : "U.S. 10-year yield" },
        { s: "TVC:US30Y", d: ja ? "米国債 30年" : "U.S. 30-year yield" },
      ] },
      { title: ja ? "為替" : "Forex", symbols: [
        { s: "FX:USDJPY", d: ja ? "米ドル / 円" : "USD / JPY" },
        { s: "FX:EURUSD", d: ja ? "ユーロ / 米ドル" : "EUR / USD" },
        { s: "FX:EURJPY", d: ja ? "ユーロ / 円" : "EUR / JPY" },
      ] },
    ],
  };
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#131722;color:#b2b5be;font:12px sans-serif}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 32px);width:100%}.tradingview-widget-copyright{line-height:32px;text-align:center}a{color:#9abaff}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/markets/" target="_blank" rel="noopener nofollow">Market overview</a> by TradingView</div><script src="https://s3.tradingview.com/external-embedding/embed-widget-market-overview.js" async>${JSON.stringify(config)}</script></div></body></html>`, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'", "Referrer-Policy": "strict-origin-when-cross-origin" },
  });
}
