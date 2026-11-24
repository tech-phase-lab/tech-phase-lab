"use client";
import { useState, type CSSProperties } from "react";
import { CONSENT_ERROR, CONSENT_LINE, NO_CONSENT, pressPurchase, privacyHref, tickConsent, type ConsentState } from "@/lib/legal/consent";

const termsLink = (en: boolean) => en ? "/terms?lang=en" : "/terms";

/** The controls for a consent state kept by the screen (one useState). `require()` is called first by every purchase button:
 * null means stop (and the red line shows). */
export function consentControls(state: ConsentState, setState: (next: ConsentState) => void) {
  return { ...state, set: (checked: boolean) => setState(tickConsent(checked)),
    require: () => { const r = pressPurchase(state); setState(r.state); return r.consentAt; } };
}
/** One consent per purchase screen. */
export function useConsent() {
  const [state, setState] = useState<ConsentState>(NO_CONSENT);
  return consentControls(state, setState);
}
export type Consent = ReturnType<typeof consentControls>;

const rowStyle: CSSProperties = { display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 8, margin: "12px 0 10px", fontSize: 12.5, lineHeight: 1.5, textAlign: "left", cursor: "pointer" };
// A gold-edged square like the owner's sample; ticked, it fills gold with a dark check.
const TICK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%232a1f05' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12l5 5 9-10'/%3E%3C/svg%3E\")";
const boxStyle = (checked: boolean): CSSProperties => ({ appearance: "none", WebkitAppearance: "none", boxSizing: "border-box", width: 18, height: 18, margin: 0, flex: "none", cursor: "pointer",
  border: "1.5px solid #d9b25f", borderRadius: 4, background: checked ? `#d9b25f ${TICK} center / 14px no-repeat` : "transparent" });
const linkStyle: CSSProperties = { color: "inherit", textDecoration: "underline", textUnderlineOffset: 3 };
const errorStyle: CSSProperties = { margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "#f07b6b", textAlign: "center" };

/** 「利用規約とプライバシーポリシーに同意する」: small, one line, right above the purchase button. The links open in a new tab. */
export function ConsentCheck({ en, consent, className }: { en: boolean; consent: Consent; className?: string }) {
  const w = CONSENT_LINE[en ? "en" : "ja"];
  return <label className={className} style={className ? undefined : rowStyle} data-consent="">
    <input type="checkbox" style={boxStyle(consent.agreedAt !== null)} checked={consent.agreedAt !== null} aria-invalid={consent.missing || undefined} onChange={e => consent.set(e.target.checked)} />
    <span>{w.before}<a href={termsLink(en)} target="_blank" rel="noopener" style={linkStyle}>{w.terms}</a>{w.between}<a href={privacyHref(en)} target="_blank" rel="noopener" style={linkStyle}>{w.privacy}</a>{w.after}</span>
  </label>;
}
/** The red line right under the button, only after pressing it without the tick. */
export function ConsentError({ en, consent }: { en: boolean; consent: Consent }) {
  return consent.missing ? <p role="alert" style={errorStyle} data-consent-error="">{CONSENT_ERROR[en ? "en" : "ja"]}</p> : null;
}
