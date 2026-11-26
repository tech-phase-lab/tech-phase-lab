import "server-only";
import { buildPublicNews } from "./public-news-response";
import { parseCompanyWire, type CompanyWireItem } from "./company-wire";
import { freeTechSelection, projectFreeNews, projectFreeWire } from "./tech-news-access";
import { readMonitor } from "./tech-news-server";
import type { GeneralNewsFeed } from "./general-news";

/** What a news page draws into its first HTML (speed, Nov 26): the FREE view, the same for every reader — exactly the projection
 * /api/research/news and /api/research/company-wire give a visitor or a FREE member (30 minutes behind, newest five, headlines only;
 * docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md), made before anything is sent, so nothing member-only is ever in it and nobody's
 * membership is looked up (these pages run without the identity proxy, owner Oct 21).
 * - Signed-out visitors and FREE members see it at once: it is their view.
 * - A browser remembering PRO (or an owner account) never sees it: the member mark set before the first paint
 *   (<html data-member-hint>) hides it by CSS, and the page reads its own feed at once (flash-page.tsx, general-news-panel.tsx).
 * The monitor is read once per feed (no provider is asked). `wire` is null when the company headlines could not be read in time. */
export type FirstNews = { feed: GeneralNewsFeed; wire: Record<string, CompanyWireItem[]> | null; checkedAt: number };

export async function loadFirstNews(): Promise<FirstNews> {
  const [raw, rawWire] = await Promise.all([readMonitor("news", 500_000, 5_000), readMonitor("company-wire", 400_000, 2_500).catch(() => null)]);
  const checkedAt = Date.now();
  const feed = buildPublicNews(raw);
  const wire = rawWire ? parseCompanyWire(rawWire).items : null;
  // The same selection both routes make for a non-PRO reader (the news route with an empty wire when the headlines cannot be read).
  const selection = freeTechSelection(feed, wire ?? {}, checkedAt);
  return { feed: projectFreeNews(feed, selection), wire: wire ? projectFreeWire(wire, selection) : null, checkedAt };
}

/** The first paint waits this long at most; without an answer by then the page opens as before and asks the APIs. */
export const FIRST_NEWS_WAIT_MS = 1_200;
export function firstNewsWithin(wait = FIRST_NEWS_WAIT_MS): Promise<FirstNews | null> {
  return Promise.race([loadFirstNews().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), wait))]);
}
