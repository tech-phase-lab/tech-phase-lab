export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lang = params.get("lang") === "en" ? "en" : "ja";
  const symbols = [
    { proName: "FOREXCOM:DJI", title: lang === "ja" ? "ダウ · CFD" : "Dow · CFD" },
    { proName: "FOREXCOM:NSXUSD", title: "NASDAQ 100 · CFD" },
    { proName: "FOREXCOM:SPXUSD", title: "S&P 500 · CFD" },
  ];
  const single = params.get("single");
  const selected = symbols[Number(single)] ?? symbols[0];
  const config = single !== null
    ? { symbol: selected.proName, width: "100%", colorTheme: "dark", isTransparent: true, locale: lang }
    : { symbols, colorTheme: "dark", isTransparent: true, showSymbolLogo: false, displayMode: "regular", locale: lang, isMoving: params.get("moving") === "1" };
  const type = single !== null ? "single-quote" : "ticker-tape";
  return new Response(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:#0b121a;color:#a4b9be;font:10px sans-serif}.tradingview-widget-container{width:100%}a{color:#a4b9be}.tradingview-widget-copyright{text-align:center;line-height:20px}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/markets/" target="_blank" rel="noopener nofollow">Quotes by TradingView</a></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-${type}.js" async>${JSON.stringify(config)}</script></div></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "frame-ancestors 'self'" } });
}
