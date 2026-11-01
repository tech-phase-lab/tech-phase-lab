import { parseBarState } from "../research/resolute-bar-state.ts";

export type EntryDecision = "home" | "landing" | "unknown";
/** What /resolute shows, from the answer remembered on this device and whether a sign-in cookie exists
 * (`null` = not known yet). A purchaser is never shown the landing page: when the device cannot say for sure
 * the entry stays blank until the purchase answer arrives. */
export const NOT_OWNED_FRESH_MS = 30_000;
/** Signed in, and the remembered answer says "not a purchaser" but is older than 30 s: access may have started since. */
export function staleNotOwned(raw: string | null, signedIn: boolean | null, now: number = Date.now()): boolean {
  if (!signedIn) return false;
  const state = parseBarState(raw);
  return !!state && !state.anon && !state.owned && now - state.at > NOT_OWNED_FRESH_MS;
}
/** `ownerHint`: this device remembers the owner account. The owner never sees the landing page, so a stale answer
 * makes the entry wait (a dark moment, owner only); everyone else keeps the landing page and the answer is refreshed
 * in the background, so a visitor is not made to wait. */
export function entryDecision(raw: string | null, signedIn: boolean | null, now: number = Date.now(), ownerHint = false): EntryDecision {
  if (signedIn === null) return "unknown";
  const state = parseBarState(raw);
  if (!signedIn) return state?.owned ? "home" : "landing";
  // Signed in: an answer learned while signed out says nothing about this person.
  if (!state || state.anon) return "unknown";
  if (state.owned) return "home";
  return ownerHint && staleNotOwned(raw, signedIn, now) ? "unknown" : "landing";
}

/** Clerk keeps a readable `__client_uat` cookie: 0 (or absent) when signed out, a timestamp when signed in. */
export function signedInFromCookies(cookies: string): boolean {
  const match = /(?:^|;\s*)__client_uat(?:_[A-Za-z0-9]+)?=(\d+)/.exec(cookies);
  return !!match && Number(match[1]) > 0;
}

/** First visit on a device by someone who bought but has no saved plan: start from the quiz, once. */
export const FIRST_VISIT_KEY = "tech-phase:resolute-first-visit-done";

/** Runs before the landing page is painted: hides it on a device that remembers a purchase. */
export const ownedGuardScript = (key: string) =>
  `try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(key)})||"null");if(s&&s.owned===true)document.documentElement.setAttribute("data-resolute-owned","1")}catch(e){}`;
