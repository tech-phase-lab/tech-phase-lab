import { companyFreeHref } from "./company-href.ts";

/** The 監視22銘柄 pages are PRO only (lib/membership/pro-page.ts). A visitor is sent to the stock's FREE page by proxy.ts before the page
 * is rendered (speed, Nov 26): the page's own redirect arrives after the streamed shell, so the browser loaded the app twice.
 * Only a browser with no session at all (no `__client_uat` other than "0", no `__session`) and no user, and never a prefetch or an
 * in-app (RSC) request: a member whose short-lived session token is being renewed must not be sent to the FREE page; the page's own
 * check (which looks the plan up) still handles everyone else. Returns the FREE page to send the visitor to, or null. */
const COMPANY_PAGE = /^\/research\/companies(?:\/([^/]+))?\/?$/;
export function visitorCompanyRedirect(request: { method: string; pathname: string; headers: Headers; cookies: { name: string; value: string }[] }, userId: string | null | undefined): string | null {
  const company = COMPANY_PAGE.exec(request.pathname);
  if (!company || request.method !== "GET" || userId) return null;
  const h = request.headers;
  if (h.has("next-router-prefetch") || h.has("rsc") || h.get("purpose") === "prefetch" || h.get("sec-purpose")?.includes("prefetch")) return null;
  const session = request.cookies.some(c => (/^__client_uat(?:_[A-Za-z0-9-]+)?$/.test(c.name) && c.value !== "" && c.value !== "0") || (/^__session(?:_[A-Za-z0-9-]+)?$/.test(c.name) && c.value !== ""));
  if (session) return null;
  let ticker: string | undefined;
  try { ticker = company[1] ? decodeURIComponent(company[1]) : undefined; } catch { ticker = undefined; }
  return companyFreeHref(ticker);
}
