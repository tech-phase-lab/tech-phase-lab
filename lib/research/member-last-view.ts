/** A PRO member's (or an owner account's) last view of a news page, kept on this device so the page shows it the moment it opens and then
 * refreshes (speed, Nov 26; the same idea as クジラの足あと #891). The public news pages run without the identity proxy (owner, Oct 21), so
 * the server cannot draw a member's own feed; a signed-out visitor gets the FREE view drawn by the server instead.
 * - Read and written only while this browser carries the verified member mark (<html data-member-hint="pro" | "owner">, set before the
 *   first paint from the last verified membership, removed when a check finds the reader is not PRO): a FREE reader never sees it, and a
 *   page that has the mark opens as PRO, so there is no FREE-to-PRO change.
 * - Forgotten as soon as the reader is known not to be PRO. Kept a day at most. The server still decides what every refresh returns. */
type Kept<T> = { data: T; at: number };
const KEEP_MS = 24 * 3_600_000;
const key = (name: string) => `tech-phase:last-view:${name}:v1`;

export function memberMarked(): boolean {
  try { const mark = document.documentElement.dataset.memberHint; return mark === "pro" || mark === "owner"; } catch { return false; }
}
export function readLastView<T>(name: string, now = Date.now()): Kept<T> | null {
  if (!memberMarked()) return null;
  try {
    const kept = JSON.parse(localStorage.getItem(key(name)) ?? "null") as Kept<T> | null;
    return kept && Number.isFinite(kept.at) && now - kept.at < KEEP_MS && kept.data != null ? kept : null;
  } catch { return null; }
}
export function writeLastView<T>(name: string, data: T, at = Date.now()) {
  if (!memberMarked()) { forgetLastView(name); return; }
  try { localStorage.setItem(key(name), JSON.stringify({ data, at })); } catch { /* full or blocked: the next open waits for the server */ }
}
export function forgetLastView(name: string) {
  try { localStorage.removeItem(key(name)); } catch { /* storage unavailable */ }
}
