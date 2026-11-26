import type { GeneralNewsFeed } from "./general-news";

/** A PRO member's (or an owner account's) last view of a news page, kept on this device so the page shows it as soon as the membership
 * check confirms PRO, then refreshes (speed, Nov 26; the same idea as クジラの足あと #891). The public news pages run without the identity
 * proxy (owner, Oct 21), so the server cannot draw a member's own feed; a signed-out visitor gets the FREE view drawn by the server instead.
 * - Shown only after this browser's membership check confirmed PRO (or an owner account): never to a FREE reader, never before the check.
 * - Written only while the browser carries the verified member mark (<html data-member-hint="pro" | "owner">).
 * - Every copy goes when the member hint is cleared (sign-out, a check that finds the reader is not PRO: member-display-provider.tsx), and
 *   an expired copy is deleted when it is read. Kept a day at most. The server still decides what every refresh returns. */
type Kept<T> = { data: T; at: number };
const KEEP_MS = 24 * 3_600_000;
const PREFIX = "tech-phase:last-view:";
const key = (name: string) => `${PREFIX}${name}:v1`;

export function memberMarked(): boolean {
  try { const mark = document.documentElement.dataset.memberHint; return mark === "pro" || mark === "owner"; } catch { return false; }
}
export function readLastView<T>(name: string, now = Date.now()): Kept<T> | null {
  if (!memberMarked()) return null;
  try {
    const kept = JSON.parse(localStorage.getItem(key(name)) ?? "null") as Kept<T> | null;
    if (kept && Number.isFinite(kept.at) && now - kept.at < KEEP_MS && kept.data != null) return kept;
    if (kept) localStorage.removeItem(key(name));
    return null;
  } catch { return null; }
}
export function writeLastView<T>(name: string, data: T, at = Date.now()) {
  if (!memberMarked()) { forgetLastView(name); return; }
  try { localStorage.setItem(key(name), JSON.stringify({ data, at })); } catch { /* full or blocked: the next open waits for the server */ }
}
export function forgetLastView(name: string) {
  try { localStorage.removeItem(key(name)); } catch { /* storage unavailable */ }
}
/** Every kept view on this device (the member hint was cleared). */
export function forgetAllLastViews() {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k?.startsWith(PREFIX)) keys.push(k); }
    keys.forEach(k => localStorage.removeItem(k));
  } catch { /* storage unavailable */ }
}
/** 注目トピック keeps only what its cards read: the general feed's stories, without the impact texts or any other part of the feed. */
export function topicsSubset(feed: GeneralNewsFeed): GeneralNewsFeed {
  return { ok: true, enabled: feed.enabled, items: feed.items.map(item => ({ ...item, impactJa: "", impactEn: "" })) };
}
