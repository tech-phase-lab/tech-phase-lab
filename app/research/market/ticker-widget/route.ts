export function GET(request: Request) {
  const locale = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ja";
  const config = {
    width: "100%", height: "100%", locale, colorTheme: "dark", showSymbolLogo: false,
    symbolsGroups: [{ name: locale === "ja" ? "米国主要指数" : "U.S. major indices", symbols: [
      { name: "FOREXCOM:DJI", displayName: locale === "ja" ? "ダウ" : "Dow" },
      { name: "FOREXCOM:NSXUSD", displayName: "NASDAQ 100" },
      { name: "FOREXCOM:SPXUSD", displayName: "S&P 500" },
    ] }],
  };
  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#131722;color:#aab9c4;font:12px sans-serif}.tradingview-widget-container{width:100%;height:100%}.tradingview-widget-container__widget{width:100%;height:calc(100% - 32px)}.tradingview-widget-copyright{text-align:center;line-height:32px}a{color:#9abaff}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/markets/?utm_source=www.tradingview.com&amp;utm_medium=widget_new&amp;utm_campaign=market-quotes" rel="noopener nofollow" target="_blank">Market summary</a> by TradingView</div><script src="https://s3.tradingview.com/external-embedding/embed-widget-market-quotes.js" async>${JSON.stringify(config)}</script></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "frame-ancestors 'self'" } });
}
