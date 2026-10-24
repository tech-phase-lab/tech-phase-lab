/** A tab-local return destination, never an authentication token or entitlement. */
export const accountReturnKey = "tech-phase:account-return:v1";
const maxAge = 30 * 60 * 1000;
export function safeAccountReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/research") || /[\\\u0000-\u0020]/.test(value)) return null;
  try {
    const url = new URL(value, "https://tech-phase.invalid");
    if (url.origin !== "https://tech-phase.invalid" || !/^\/research(?:\/|$)/.test(url.pathname) || /^\/research\/account(?:\/|$)/.test(url.pathname)) return null;
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
