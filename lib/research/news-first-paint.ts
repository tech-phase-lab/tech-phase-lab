import "server-only";
import { cookies } from "next/headers";
import { buildPublicNews } from "./public-news-response";
import { parseCompanyWire, type CompanyWireItem } from "./company-wire";
import { freeTechSelection, projectFreeNews, projectFreeWire } from "./tech-news-access";
import { readMonitor } from "./tech-news-server";
import type { GeneralNewsFeed } from "./general-news";

/** What a news page draws into its first HTML for a signed-out visitor (speed, Nov 26): the FREE projection /api/research/news and
 * /api/research/company-wire give a visitor (30 minutes behind, newest five, headlines only; docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md),
 * made before anything is sent. A browser with a session gets nothing drawn: these pages run without the identity proxy (owner, Oct 21), so
 * its membership cannot be verified here, and it asks the APIs as before (members see their own last view, lib/research/member-last-view.ts).
 * The monitor is read once per feed (no provider is asked). `wire` is null when the company headlines could not be read in time. */
export type FirstNews = { feed: GeneralNewsFeed; wire: Record<string, CompanyWireItem[]> | null; checkedAt: number };

/** A browser holding no session: the identity SDK's readable `__client_uat` absent or "0", and no `__session`. */
async function signedOutVisitor(): Promise<boolean> {
  const jar = await cookies();
  return !jar.getAll().some(cookie => (/^__client_uat(?:_[A-Za-z0-9-]+)?$/.test(cookie.name) && cookie.value !== "" && cookie.value !== "0") || (/^__session(?:_[A-Za-z0-9-]+)?$/.test(cookie.name) && cookie.value !== ""));
}

export async function loadFirstNews(): Promise<FirstNews | null> {
  if (!await signedOutVisitor()) return null;
  const [raw, rawWire] = await Promise.all([readMonitor("news", 500_000, 5_000), readMonitor("company-wire", 400_000, 2_500).catch(() => null)]);
  const checkedAt = Date.now();
  const feed = buildPublicNews(raw);
  const wire = rawWire ? parseCompanyWire(rawWire).items : null;
  // The same selection both routes make for a visitor (the news route with an empty wire when the headlines cannot be read).
  const selection = freeTechSelection(feed, wire ?? {}, checkedAt);
  return { feed: projectFreeNews(feed, selection), wire: wire ? projectFreeWire(wire, selection) : null, checkedAt };
}

/** The first paint waits this long at most; without an answer by then the page opens as before and asks the APIs. */
export const FIRST_NEWS_WAIT_MS = 1_200;
export function firstNewsWithin(wait = FIRST_NEWS_WAIT_MS): Promise<FirstNews | null> {
  return Promise.race([loadFirstNews().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), wait))]);
}
