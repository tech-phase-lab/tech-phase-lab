/** A tab-local return destination, never an authentication token or entitlement. */
export const accountReturnKey = "tech-phase:account-return:v1";
const maxAge = 30 * 60 * 1000;
/** Tech Phase pages, and RESOLUTE pages (owner, Nov 25: a phone that opens 「ルールのお守り」 from the PC's QR code and signs in
 * comes back to /resolute/wall). The path after normalising must stay in the same area it started in. */
export function safeAccountReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || /[\\\u0000-\u0020]/.test(value)) return null;
  const area = /^\/(research|resolute)(?=[/?#]|$)/.exec(value)?.[1];
  if (!area) return null;
  try {
    const url = new URL(value, "https://tech-phase.invalid");
    if (url.origin !== "https://tech-phase.invalid" || !new RegExp(`^/${area}(?:/|$)`).test(url.pathname) || /^\/research\/account(?:\/|$)/.test(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}
export function readAccountReturn(storage: Pick<Storage, "getItem">, now = Date.now()): string {
  try {
    const value = JSON.parse(storage.getItem(accountReturnKey) ?? "null");
    if (!value || !Number.isFinite(value.at) || value.at > now || now - value.at > maxAge) return "/research/account";
    return safeAccountReturn(value.path) ?? "/research/account";
  } catch { return "/research/account"; }
}
/** Remember where to come back to after signing in, from pages outside /research (the RESOLUTE sign-in link). */
export function rememberAccountReturn(storage: Pick<Storage, "setItem">, path: string, now = Date.now()) {
  const safe = safeAccountReturn(path);
  if (safe) try { storage.setItem(accountReturnKey, JSON.stringify({ path: safe, at: now })); } catch { /* Keep the normal account destination. */ }
}
