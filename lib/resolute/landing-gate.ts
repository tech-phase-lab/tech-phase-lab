import { parseBarState } from "../research/resolute-bar-state.ts";

export type EntryDecision = "home" | "landing" | "unknown";
/** What /resolute shows, from the answer remembered on this device and whether a sign-in cookie exists
 * (`null` = not known yet). A purchaser is never shown the landing page: when the device cannot say for sure
 * the entry stays blank until the purchase answer arrives. */
export function entryDecision(raw: string | null, signedIn: boolean | null): EntryDecision {
  if (signedIn === null) return "unknown";
  const state = parseBarState(raw);
  if (!signedIn) return state?.owned ? "home" : "landing";
  // Signed in: an answer learned while signed out says nothing about this person.
  if (!state || state.anon) return "unknown";
  return state.owned ? "home" : "landing";
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
