/**
 * The consent line right above every purchase button (lawyer review, Nov 24; owner pack legal-final-1124 §1): unticked at
 * first, the button stays pressable, and pressing it without the tick stops the purchase and shows the red line under it.
 * The tick time is sent with the purchase and stored with the order (RESOLUTE) or the subscription (PRO).
 */
export const CONSENT_LINE = {
  ja: { before: "", terms: "利用規約", between: "と", privacy: "プライバシーポリシー", after: "に同意する" },
  en: { before: "I agree to the ", terms: "Terms of Service", between: " and ", privacy: "Privacy Policy", after: "" },
} as const;
export const CONSENT_ERROR = { ja: "同意のチェックを入れてください", en: "Please check the box to agree" } as const;
export function privacyHref(en: boolean) { return en ? "/privacy?lang=en" : "/privacy"; }

export type ConsentState = { agreedAt: string | null; missing: boolean };
export const NO_CONSENT: ConsentState = { agreedAt: null, missing: false };
/** Ticking records the time; unticking clears it. Either way the red line goes away. */
export function tickConsent(checked: boolean, now = Date.now()): ConsentState {
  return { agreedAt: checked ? new Date(now).toISOString() : null, missing: false };
}
/** Pressing a purchase button: the consent time to send, or null (the purchase must not start) with the red line shown. */
export function pressPurchase(state: ConsentState): { consentAt: string | null; state: ConsentState } {
  return state.agreedAt ? { consentAt: state.agreedAt, state: { ...state, missing: false } } : { consentAt: null, state: { agreedAt: null, missing: true } };
}

/**
 * A tick given on a card whose button only leads to the purchase screen (the PRO card on the Tech Phase PRO page, owner Nov 25):
 * the time travels with the link (?consentAt=) and in this tab's sessionStorage (it survives the sign-in step), and the
 * purchase screen starts with the tick on and sends that time, so the subscription row records it (terms_consent_at).
 */
export const CARRIED_CONSENT_KEY = "tech-phase:pro-consent:v1";
/** A carried tick older than this is not reused: the purchase screen asks again. */
export const CARRIED_CONSENT_MAX_AGE = 24 * 60 * 60 * 1000;
/** The carried time, or null when it is missing, malformed, from the future (10 minutes of skew) or too old. */
export function carriedConsent(value: unknown, now = Date.now()): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 600_000 && now - at <= CARRIED_CONSENT_MAX_AGE ? new Date(at).toISOString() : null;
}
/** The link with the tick time added (?consentAt=…), keeping its other parameters and hash. */
export function withConsent(href: string, consentAt: string) {
  const [path, hash = ""] = href.split("#");
  return `${path}${path.includes("?") ? "&" : "?"}consentAt=${encodeURIComponent(consentAt)}${hash ? `#${hash}` : ""}`;
}
