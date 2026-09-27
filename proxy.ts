import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
const identity = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return NextResponse.next();
  return identity(request, event);
}
export const config = { matcher: ["/research/account/:path*", "/api/research/member/:path*", "/api/research/articles/:path*", "/api/research/notifications"] };
