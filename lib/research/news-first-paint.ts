import "server-only";
import { cookies } from "next/headers";
import { getMembership } from "@/lib/membership/server";
import { buildPublicNews } from "./public-news-response";
import { parseCompanyWire, type CompanyWireItem } from "./company-wire";
import { freeTechSelection, isFullAccess, projectFreeNews, projectFreeWire } from "./tech-news-access";
import { readMonitor } from "./tech-news-server";
import type { GeneralNewsFeed } from "./general-news";

/** What a news page draws into its first HTML for this viewer (speed, Nov 26): exactly what /api/research/news and
 * /api/research/company-wire would answer the same session, decided here on the server — PRO (or an owner account) the full feed,
 * everyone else the FREE projection (30 minutes behind, newest five, headlines only; docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md)
 * made before anything is sent. The monitor is read once per feed (no provider is asked). `wire` is null when the company headlines
 * could not be read in time, and then the screen asks for them as before. */
export type FirstNews = { full: boolean; feed: GeneralNewsFeed; wire: Record<string, CompanyWireItem[]> | null; checkedAt: number };

/** Whose feed to draw: a browser holding no session (the identity SDK's readable `__client_uat` absent or "0") is a visitor, FREE by
 * definition. A signed-in browser gets its verified membership; when the server cannot verify it here (these pages run without the identity
 * middleware, where the check is unavailable or answers signed-out), nothing is drawn and the page asks the APIs as before, so a PRO reader
 * never opens on the FREE list. */
async function viewerAccess(): Promise<boolean | null> {
  const jar = await cookies();
  const session = jar.getAll().some(cookie => /^__client_uat(?:_[A-Za-z0-9-]+)?$/.test(cookie.name) && cookie.value !== "" && cookie.value !== "0");
  if (!session) return false;
  const member = await getMembership().catch(() => null);
  return member && member.status === "signed-in" ? isFullAccess(member) : null;
}

export async function loadFirstNews(): Promise<FirstNews | null> {
  const full = await viewerAccess();
  if (full === null) return null;
  const [raw, rawWire] = await Promise.all([readMonitor("news", 500_000, 5_000), readMonitor("company-wire", 400_000, 2_500).catch(() => null)]);
  const checkedAt = Date.now();
  const feed = buildPublicNews(raw, { allowOriginalPreview: full && process.env.VERCEL_ENV === "preview" });
  const wire = rawWire ? parseCompanyWire(rawWire).items : null;
  if (full) return { full, feed, wire, checkedAt };
  // FREE: the same selection both routes make (the news route with an empty wire when the headlines cannot be read).
  const selection = freeTechSelection(feed, wire ?? {}, checkedAt);
  return { full, feed: projectFreeNews(feed, selection), wire: wire ? projectFreeWire(wire, selection) : null, checkedAt };
}

/** The first paint waits this long at most; without an answer by then the page opens as before and asks the APIs. */
export const FIRST_NEWS_WAIT_MS = 1_200;
export function firstNewsWithin(wait = FIRST_NEWS_WAIT_MS): Promise<FirstNews | null> {
  return Promise.race([loadFirstNews().catch(() => null), new Promise<null>(resolve => setTimeout(() => resolve(null), wait))]);
}
