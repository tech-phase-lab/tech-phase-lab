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
