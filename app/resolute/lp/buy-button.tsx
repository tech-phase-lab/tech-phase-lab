"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { checkoutUrl, liveApprovalUrl, liveCheckoutRequest, liveOrder } from "@/lib/resolute/live-checkout";
import { ConsentCheck, ConsentError, useConsent } from "../../legal/consent-check";
import { resoluteBuyLines } from "../../legal/agree-button";

const lineStyle = { margin: "12px 0 0", fontSize: 12.5, lineHeight: 1.5, textAlign: "left" } as const;

/**
 * The LP's gold button (owner, Nov 24): one tick, one press, then PayPal. Pressing it creates the order on the server —
 * the member's own order when signed in, otherwise a guest order (no login needed) — and goes straight to PayPal. After
 * paying, PayPal returns to the checkout page, which completes the payment by itself (no second tick, no second button).
 * The amount is decided by the server when the order is created. If it is not the price this page showed (the page was
 * opened before the 2027-03-01 switch), the checkout page shows the order's amount first. Anything else (sales closed, an
 * error) opens the checkout page, which explains it; the link itself also leads there without JavaScript.
 * Right above the consent line (lawyer review, Nov 24), always shown: the automatic-renewal line (how and by when to stop;
 * it applies to orders made while signed in) and the refund line. The tick time goes with the order and is the consent
 * used when the payment is completed.
 */
export default function BuyButton({ language, shownValue, className, children, navigate = url => window.location.assign(url) }: {
 language: "ja" | "en"; shownValue: string; className: string; children: ReactNode; navigate?: (url: string) => void;
}) {
 const [busy, setBusy] = useState(false);
 const consent = useConsent(), en = language === "en";
 const lock = useRef(false), requestKey = useRef<string | null>(null);
 // Coming back from PayPal with the browser's back button restores this page from memory: make the button usable again.
 useEffect(() => {
  const reset = (event: PageTransitionEvent) => { if (event.persisted) { lock.current = false; setBusy(false); } };
  window.addEventListener("pageshow", reset);
  return () => window.removeEventListener("pageshow", reset);
 }, []);
 async function create(guest: boolean, consentAt: string) {
  requestKey.current ??= crypto.randomUUID();
  if (guest) await liveCheckoutRequest("session", {}, true);
  return liveOrder(await liveCheckoutRequest("orders", { kind: "initial", language, requestKey: requestKey.current, consentAt }, guest));
 }
 async function buy() {
  if (lock.current) return;
  const consentAt = consent.require();
  if (!consentAt) return;
  lock.current = true; setBusy(true);
  let guest = false;
  try {
   let order;
   try { order = await create(false, consentAt); }
   catch (e) {
    const code = e instanceof Error ? e.message : "";
    if (code === "AUTH_REQUIRED") { guest = true; order = await create(true, consentAt); }
    else if (code === "ORDER_EXPIRED") { requestKey.current = null; order = await create(false, consentAt); }
    else throw e;
   }
   const approval = liveApprovalUrl(order.approvalUrl);
   navigate(approval && order.quote.value === shownValue ? approval : checkoutUrl(language, order.orderId, false, guest));
  } catch (e) {
   const code = e instanceof Error ? e.message : "";
   requestKey.current = null;
   navigate(code === "ALREADY_PURCHASED" ? `/resolute?lang=${language}` : checkoutUrl(language));
  }
 }
 return <>
  <div data-buy-lines="">{resoluteBuyLines(en).map(line => <p key={line} style={lineStyle}>{line}</p>)}</div>
  <ConsentCheck en={en} consent={consent} />
  <a href={checkoutUrl(language)} className={className} aria-busy={busy || undefined} data-buy="paypal"
   onClick={event => { event.preventDefault(); void buy(); }}>{children}</a>
  <ConsentError en={en} consent={consent} />
 </>;
}
