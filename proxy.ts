import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { visitorCompanyRedirect } from "./lib/research/company-redirect.ts";

/** 監視22銘柄: a visitor with no session goes to the stock's FREE page before the PRO page renders (lib/research/company-redirect.ts). */
const identity = clerkMiddleware(async (auth, request) => {
  if (!request.nextUrl.pathname.startsWith("/research/companies")) return;
  const { userId } = await auth();
  const href = visitorCompanyRedirect({ method: request.method, pathname: request.nextUrl.pathname, headers: request.headers, cookies: request.cookies.getAll() }, userId);
  if (href) return NextResponse.redirect(new URL(href, request.url), 307);
});
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  return identity(request, event);
}
export const config = { matcher: ["/resolute/:path*", "/api/resolute/:path*", "/research/((?!(?:news|watchlist|stocks|market|calendar|learn|general-news|faq|capital-map)(?:/|$)).*)", "/api/research/member/:path*", "/api/research/market/:path*", "/api/research/earnings-consensus", "/api/research/news", "/api/research/company-wire", "/api/research/account/:path*", "/api/research/portfolio/:path*", "/api/research/billing/:path*", "/api/research/favorites", "/api/research/saved", "/api/research/articles/:path*", "/api/research/notifications", "/api/research/posts", "/api/research/compare", "/api/research/themes", "/api/research/notebook-week", "/api/research/deep-analysis", "/api/research/chain-map", "/api/research/radar", "/api/research/watch-earnings", "/api/research/value-check", "/api/research/whales", "/api/research/author", "/api/research/desk-post", "/api/research/desk-media/:path*", "/api/research/desk-inbox/:path*", "/api/research/desk-reactions", "/api/research/weekly-author", "/api/research/editor-owner", "/api/research/questions/:path*", "/api/research/weekly-issues", "/api/research/event-results"] };
