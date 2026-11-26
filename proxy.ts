import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { companyFreeHref } from "./lib/research/company-href.ts";

/** The 監視22銘柄 pages are PRO only (lib/membership/pro-page.ts). A visitor with no session is sent to the stock's FREE page here, before the
 * page is rendered (speed, Nov 26): the page's own redirect arrives after the streamed shell, so the browser loaded the app twice. Signed-in
 * readers still get the page's check (their plan is looked up there). */
const COMPANY_PAGE = /^\/research\/companies(?:\/([^/]+))?\/?$/;
const identity = clerkMiddleware(async (auth, request) => {
  const company = COMPANY_PAGE.exec(request.nextUrl.pathname);
  if (!company || request.method !== "GET") return;
  const { userId } = await auth();
  if (userId) return;
  const ticker = company[1] ? decodeURIComponent(company[1]) : undefined;
  return NextResponse.redirect(new URL(companyFreeHref(ticker), request.url), 307);
});
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  return identity(request, event);
}
export const config = { matcher: ["/resolute/:path*", "/api/resolute/:path*", "/research/((?!(?:news|watchlist|stocks|market|calendar|learn|general-news|faq|capital-map)(?:/|$)).*)", "/api/research/member/:path*", "/api/research/market/:path*", "/api/research/earnings-consensus", "/api/research/news", "/api/research/company-wire", "/api/research/account/:path*", "/api/research/portfolio/:path*", "/api/research/billing/:path*", "/api/research/favorites", "/api/research/saved", "/api/research/articles/:path*", "/api/research/notifications", "/api/research/posts", "/api/research/compare", "/api/research/themes", "/api/research/notebook-week", "/api/research/deep-analysis", "/api/research/chain-map", "/api/research/radar", "/api/research/watch-earnings", "/api/research/value-check", "/api/research/whales", "/api/research/author", "/api/research/desk-post", "/api/research/desk-media/:path*", "/api/research/desk-inbox/:path*", "/api/research/desk-reactions", "/api/research/weekly-author", "/api/research/editor-owner", "/api/research/questions/:path*", "/api/research/weekly-issues", "/api/research/event-results"] };
