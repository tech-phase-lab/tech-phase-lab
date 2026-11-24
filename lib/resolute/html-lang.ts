/** English for /resolute/lp/en and ?lang=en, otherwise Japanese (app/resolute/html-lang.tsx). */
export function resoluteHtmlLang(pathname: string, search: string): "ja" | "en" {
  if (/^\/resolute\/lp\/en(?:\/|$)/.test(pathname)) return "en";
  return new URLSearchParams(search).get("lang") === "en" ? "en" : "ja";
}
