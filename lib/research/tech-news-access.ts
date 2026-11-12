import type { GeneralNewsFeed } from "./general-news.ts";
import type { CompanyWireItem } from "./company-wire.ts";
import { flashRows, flashInstant, WATCH_TICKERS } from "./flash-rows.ts";
import { earningsResults } from "./earnings-results.ts";
import { wireStories } from "./wire-stories.ts";
import { FREE_FLASH_DELAY_MS, FREE_FLASH_LIMIT } from "./free-flash.ts";

/** Server-side FREE limit for the 速報 data (owner, 2026-11-12: "close the back door too").
 * The 速報 data is the 22 watched companies' live news: company news items, issuer/official updates, analyst
 * updates and company wire headlines. FREE gets only the newest five that are at least 30 minutes old, as
 * headlines (no summary, no body). Everything FREE keeps free is left whole: general news (no watched
 * company), earnings results, market updates, result briefs, event results (calendar). PRO and the owner
 * (showing PRO) get the feed untouched. Policy: docs/TECH-PHASE-FREE-PRO-POLICY-2026-10-25.md. */

type Member = { status?: string; plan?: string; isAdmin?: boolean; testing?: boolean } | null | undefined;

/** PRO member, or the owner/administrator who is not switched to a member view. A failed or missing check is FREE. */
export function isFullAccess(member: Member): boolean {
  if (!member || member.status !== "signed-in") return false;
  if (member.testing === true) return member.plan === "pro";
  return member.plan === "pro" || member.isAdmin === true;
}

/** Row ids (as `flashRows` names them) that FREE may see now: at least 30 minutes old, newest first, at most five.
 * Both languages are considered so that either display shows a subset of the same five. A story that arrives
 * from two sources (the same URL) uses one place. */
export function freeTechSelection(feed: GeneralNewsFeed, wire: Record<string, CompanyWireItem[]>, now = Date.now()): Set<string> {
  const rows = new Map<string, ReturnType<typeof flashRows>[number]>();
  for (const lang of ["ja", "en"] as const) for (const row of flashRows(feed, wire, lang)) if (row.kind === "news" && !rows.has(row.id)) rows.set(row.id, row);
  const urlOf = new Map<string, string>();
  for (const item of feed.officialUpdates ?? []) urlOf.set(`official:${item.id}`, item.url);
  for (const item of feed.items) urlOf.set(`news:${item.id}`, item.url);
  for (const lang of ["ja", "en"] as const) for (const story of wireStories(wire, lang, WATCH_TICKERS)) urlOf.set(`wire:${story.id}`, story.url);
  const seen = new Set<string>(), picked = new Set<string>();
  const ordered = [...rows.values()].sort((a, b) => flashInstant(b) - flashInstant(a) || a.id.localeCompare(b.id));
  for (const row of ordered) {
    // A source that states only a day is released 30 minutes after we first saw it, never from midnight.
    const release = row.timeKind === "date" ? Date.parse(row.observedAt ?? "") : Date.parse(row.at);
    if (!Number.isFinite(release) || !Number.isFinite(now) || release > now - FREE_FLASH_DELAY_MS) continue;
    const key = urlOf.get(row.id) ?? row.id;
    if (seen.has(key)) continue;
    seen.add(key); picked.add(row.id);
    if (picked.size >= FREE_FLASH_LIMIT) break;
  }
  return picked;
}

/** The FREE view of the news feed: watched-company stories that are not in `selected` are removed, and the
 * ones that remain lose their summaries. Built from the source arrays so unknown fields do not leak. */
export function projectFreeNews(feed: GeneralNewsFeed, selected: ReadonlySet<string>): GeneralNewsFeed {
  const watched = (tickers: readonly string[]) => tickers.some(ticker => WATCH_TICKERS.has(ticker));
  const resultUrls = new Set(earningsResults(feed.officialUpdates, feed.resultBriefs).flatMap(row => row.sources.map(source => source.url)));
  const out: GeneralNewsFeed = { ok: true, enabled: feed.enabled, items: [] };
  for (const item of feed.items) {
    if (!watched(item.tickers)) out.items.push(item);
    else if (selected.has(`news:${item.id}`)) {
      // The validator requires an impact text; the headline stands in for it, so no summary is sent.
      out.items.push({ ...item, impactJa: item.summaryJa, impactEn: item.summaryEn, impactLabel: "neutral", confidence: "low" });
    }
  }
  out.officialUpdates = [];
  for (const item of feed.officialUpdates ?? []) {
    if (!watched(item.tickers) || resultUrls.has(item.url)) out.officialUpdates.push(item);
    else if (selected.has(`official:${item.id}`)) {
      const { bodyJa: _ja, bodyEn: _en, brief: _brief, sources: _sources, researchId: _research, pendingResearch: _pending, ...headline } = item;
      out.officialUpdates.push(headline);
    }
  }
  out.analystUpdates = [];
  for (const item of feed.analystUpdates ?? []) {
    if (!WATCH_TICKERS.has(item.ticker)) out.analystUpdates.push(item);
    else if (selected.has(`analyst:${item.id}`)) { const { bodyJa: _ja, bodyEn: _en, ...headline } = item; out.analystUpdates.push(headline); }
  }
  if (feed.marketUpdates) out.marketUpdates = feed.marketUpdates;
  if (feed.resultBriefs) out.resultBriefs = feed.resultBriefs;
  if (feed.eventResults) out.eventResults = feed.eventResults;
  // History counts describe the PRO list; original-preview excerpts are never a public path.
  return out;
}

/** The FREE view of the company wire: only the headlines in `selected`. */
export function projectFreeWire(wire: Record<string, CompanyWireItem[]>, selected: ReadonlySet<string>): Record<string, CompanyWireItem[]> {
  const ids = new Set<string>();
  for (const lang of ["ja", "en"] as const) for (const story of wireStories(wire, lang, WATCH_TICKERS)) if (selected.has(`wire:${story.id}`)) ids.add(story.id);
  const out: Record<string, CompanyWireItem[]> = {};
  for (const [ticker, list] of Object.entries(wire)) {
    // Companies we do not watch carry no tech alert; they are not part of this limit.
    const kept = WATCH_TICKERS.has(ticker) ? list.filter(item => ids.has(item.id)) : list;
    if (kept.length) out[ticker] = kept;
  }
  return out;
}
