const groups: Record<string, string[]> = {
  memory: ["NASDAQ:MU", "NASDAQ:SNDK", "NASDAQ:WDC", "NASDAQ:STX"],
  cloud: ["NASDAQ:NBIS", "NASDAQ:CRWV", "NASDAQ:IREN"],
  optical: ["NASDAQ:LITE", "NYSE:COHR", "NASDAQ:CRDO"],
  chips: ["NASDAQ:NVDA", "NASDAQ:AMD", "NASDAQ:AVGO", "NASDAQ:MRVL"],
  security: ["NASDAQ:CRWD", "NASDAQ:PANW", "NASDAQ:ZS", "NASDAQ:FTNT"],
  gold: ["NYSE:NEM", "NYSE:AEM", "NYSE:KGC"],
  software: ["NASDAQ:MSFT", "NYSE:CRM", "NYSE:NOW", "NASDAQ:ADBE"],
  space: ["NASDAQ:RKLB", "NASDAQ:ASTS", "NASDAQ:IRDM"],
  power: ["NYSE:VRT", "NYSE:GEV", "NYSE:BE", "NYSE:VST"],
};
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const locale = params.get("lang") === "en" ? "en" : "ja";
  const heatmap = params.get("view") === "heatmap";
  const requested = params.get("theme") ?? "memory";
  const symbols = Object.hasOwn(groups, requested) ? groups[requested] : groups.memory;
  const config = heatmap ? {
    dataSource: "SPX500", blockSize: "market_cap_basic", blockColor: "change", grouping: "sector", locale,
    colorTheme: "dark", exchanges: [], hasTopBar: false, isDataSetEnabled: false,
    isZoomEnabled: true, hasSymbolTooltip: true, isMonoSize: false, width: "100%", height: "100%",
  } : {
    colorTheme: "dark", dateRange: "1D", locale, width: "100%", height: "100%", showChart: true,
    showFloatingTooltip: true, showSymbolLogo: true, isTransparent: false,
    tabs: [{ title: locale === "ja" ? "構成銘柄" : "Constituents", symbols: symbols.map(s => ({ s, d: s.split(":")[1] })) }],
  };
  const kind = heatmap ? "stock-heatmap" : "market-overview";
  const url = heatmap ? "https://www.tradingview.com/heatmap/stock/" : "https://www.tradingview.com/markets/stocks-usa/";
  return new Response(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;background:#131722;color:#aab9c4;font:12px sans-serif}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 32px);width:100%}.tradingview-widget-copyright{line-height:32px;text-align:center}a{color:#9abaff}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="${url}" rel="noopener nofollow" target="_blank">${heatmap ? "Stock Heatmap" : "Market overview"}</a> by TradingView</div><script src="https://s3.tradingview.com/external-embedding/embed-widget-${kind}.js" async>${JSON.stringify(config)}</script></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Content-Security-Policy": "frame-ancestors 'self'", "Referrer-Policy": "strict-origin-when-cross-origin" } });
}
