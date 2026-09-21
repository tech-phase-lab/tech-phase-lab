// Each provider widget gets a fresh document, independent of React navigation.
// Do not fetch, copy or redistribute any TradingView market data here.
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = params.get("symbol") ?? "";
  const kind = params.get("kind");
  const lang = params.get("lang") === "en" ? "en" : "ja";
  if (!/^(?:[A-Z]+:)?[A-Z0-9][A-Z0-9.-]{0,20}$/.test(symbol) || (kind !== "compact" && kind !== "chart")) {
    return new Response("Invalid widget", { status: 400 });
  }
  const chart = kind === "chart";
  const config = chart ? {
    symbol, interval: "D", range: "12M", timezone: "Etc/UTC", locale: lang,
    theme: "dark", backgroundColor: "rgba(16, 24, 32, 1)", autosize: true,
    style: "3", withdateranges: false, hide_top_toolbar: true,
    hide_side_toolbar: true, allow_symbol_change: false, save_image: false,
    calendar: false, support_host: "https://www.tradingview.com",
  } : { symbol, width: "100%", locale: lang, colorTheme: "dark", isTransparent: true };
  const script = chart ? "advanced-chart" : "symbol-info";
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><style>
    html,body{margin:0;padding:0;background:#101820;color:#d9e7ed;width:100%;overflow:hidden}
    #widget{width:100%;${chart ? "height:100vh" : "min-height:220px"}}
    .tradingview-widget-container__widget{width:100%;${chart ? "height:100%" : ""}}
  </style></head><body><div id="widget" class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div>
  <script>
    (() => {
      const host = document.getElementById('widget');
      let lastHeight = 0;
      function report() {
        const height = Math.ceil(host.getBoundingClientRect().height);
        if (height !== lastHeight && height >= 100 && height <= 2400) {
          lastHeight = height;
          parent.postMessage({type:'tech-phase-widget-size',height},location.origin);
        }
      }
      new ResizeObserver(report).observe(host);
      new MutationObserver(report).observe(host,{childList:true,subtree:true,attributes:true});
      window.addEventListener('load',report);
      window.addEventListener('error',() => console.warn('[market-widget] resource failed',${JSON.stringify({ kind, symbol })}));
    })();
  </script>
  <script type="text/javascript" src="https://s3.tradingview.com/external-embedding/embed-widget-${script}.js" async>${JSON.stringify(config)}</script>
  </div></body></html>`;
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Content-Security-Policy": "frame-ancestors 'self'",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  } });
}
