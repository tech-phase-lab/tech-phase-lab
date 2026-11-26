import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
// ハイテク速報 and 注目トピック run the identity middleware (speed, Nov 26): their first HTML carries the viewer's own feed
// (lib/research/news-first-paint.ts), so the page must be able to verify the session — PRO, FREE and the owner's accounts alike.
const identity = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  return identity(request, event);
}
export const config = { matcher: ["/resolute/:path*", "/api/resolute/:path*", "/research/((?!(?:watchlist|stocks|market|calendar|learn|faq|capital-map)(?:/|$)).*)", "/api/research/member/:path*", "/api/research/market/:path*", "/api/research/earnings-consensus", "/api/research/news", "/api/research/company-wire", "/api/research/account/:path*", "/api/research/portfolio/:path*", "/api/research/billing/:path*", "/api/research/favorites", "/api/research/saved", "/api/research/articles/:path*", "/api/research/notifications", "/api/research/posts", "/api/research/compare", "/api/research/themes", "/api/research/notebook-week", "/api/research/deep-analysis", "/api/research/chain-map", "/api/research/radar", "/api/research/watch-earnings", "/api/research/value-check", "/api/research/whales", "/api/research/author", "/api/research/desk-post", "/api/research/desk-media/:path*", "/api/research/desk-inbox/:path*", "/api/research/desk-reactions", "/api/research/weekly-author", "/api/research/editor-owner", "/api/research/questions/:path*", "/api/research/weekly-issues", "/api/research/event-results"] };
